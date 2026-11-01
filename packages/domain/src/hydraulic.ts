import { basename } from "node:path";
import { nanoid } from "nanoid";

import type { DomainFeature } from "./types.js";

/**
 * Bentley OpenFlows hydraulic models (SewerGEMS .stsw, WaterGEMS .wtg) keep the whole network in
 * a SQLite file next to the model (<model>.stsw.sqlite / <model>.wtg.sqlite): every pipe and
 * node with its label, size, material and levels. That is the designer's own data, so it is
 * read in preference to labels on a drawing.
 *
 * Read here (SewerGEMS): conduits (pipes) and manholes / outfalls, active elements only
 * (HMIModelingElement.IsDeleted = 0). OpenFlows stores lengths, levels and coordinates in feet
 * internally, whatever the display units: everything is converted to metres.
 */

const FT = 0.3048;

export interface HydraulicNetwork {
  features: DomainFeature[];
  notes: string[];
  /** Counts read, for the report. */
  stats: { pipes: number; nodes: number; deletedPipes: number; lengthKm: number; endGaps: number };
}

export interface HydraulicOptions {
  /** Package layers get this prefix: "sewer" → sewer_pipes, sewer_manholes. */
  prefix?: string;
  /** The utility (Sewer, Water...): an attribute, and the start of the network name. */
  utility?: string;
  /** NETWORKNAME in InfraWorks. Default: "<utility> - <model file name>". */
  network?: string;
}

/**
 * InfraWorks columns each package field fills (Configure → Common / Table). UTILITY_TYPE is left
 * out: InfraWorks keeps it as a read-only Int32 code it sets itself (CorePanelSchema.json), with
 * no published list, so the utility goes into the network name instead ("Sewer - <model>").
 */
export const PIPE_FIELDS: Record<string, string> = {
  SIZE_X: "size_m",
  SIZE_Y: "size_m",
  PIPE_MATERIAL: "material",
  NETWORKNAME: "network",
  // InfraWorks places a pipe on the terrain plus "Elevation Offset From / To" at its two ends.
  ELEV_FROM: "off_start_m",
  ELEV_TO: "off_end_m",
};
export const CONNECTOR_FIELDS: Record<string, string> = {
  SIZE_X: "size_m",
  SIZE_Y: "size_m",
  HEIGHT: "depth_m",
  NETWORKNAME: "network",
  // A connector stands on the terrain and rises by HEIGHT: lowered by its depth, it spans invert to rim.
  ELEVATION_OFFSET: "off_base_m",
};

type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): { all(...p: unknown[]): unknown[] };
  close(): void;
}

export function isHydraulicModel(filename: string): boolean {
  return /\.(stsw|wtg)\.sqlite$/i.test(filename);
}

export async function readHydraulicModel(path: string, filename: string, opts: HydraulicOptions = {}): Promise<HydraulicNetwork> {
  let DatabaseSync: new (p: string, o?: object) => Db;
  try {
    ({ DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: typeof DatabaseSync });
  } catch {
    throw new Error("Reading a hydraulic model needs Node 22.5 or later (node:sqlite)");
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return readSewer(db, filename, opts);
  } finally {
    db.close();
  }
}

function readSewer(db: Db, filename: string, opts: HydraulicOptions): HydraulicNetwork {
  const q = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Row[];
  const tables = new Set(q("select name from sqlite_master where type = 'table'").map((r) => String(r.name)));
  for (const t of ["HMIModelingElement", "Conduit", "BaseLink_HmiDataSetGeometry_Data", "BaseLink_HMIDataSetTopology_Data", "BaseNode_HmiDataSetGeometry_Data"]) {
    if (!tables.has(t)) throw new Error(`${filename} is not a SewerGEMS model database (no ${t} table)`);
  }
  const prefix = opts.prefix ?? "sewer";
  const utility = opts.utility ?? "Sewer";
  const network = opts.network ?? `${utility} - ${basename(filename).replace(/\.(stsw|wtg)\.sqlite$/i, "")}`;
  const optional = (t: string, sql: string) => (tables.has(t) ? q(sql) : []);

  const elements = new Map(q("select ElementID id, Label label, IsDeleted del from HMIModelingElement").map((r) => [Number(r.id), r]));
  const live = (id: number) => elements.get(id)?.del === 0;
  const label = (id: number) => String(elements.get(id)?.label ?? "").trim();

  /* -------- nodes: manholes and outfalls */
  const nodeXY = new Map<number, [number, number]>();
  for (const r of q("select DomainElementID id, HMIGeometry g from BaseNode_HmiDataSetGeometry_Data")) {
    const p = wkbPoints(r.g as Uint8Array | null)[0];
    if (p) nodeXY.set(Number(r.id), [p[0] * FT, p[1] * FT]);
  }
  const byId = <T>(rows: Row[], f: (r: Row) => T) => new Map(rows.map((r) => [Number(r.id), f(r)]));
  const invert = byId(optional("GravityNode_Physical_Data", "select DomainElementID id, Physical_InvertElevation v from GravityNode_Physical_Data"), (r) => Number(r.v) * FT);
  const rim = byId(
    optional("GravitySurfaceStructure_Physical_Data", "select DomainElementID id, Physical_RimElevation v, CircularStructureType_Diameter d, GravityStructureType t from GravitySurfaceStructure_Physical_Data"),
    (r) => ({ rim: Number(r.v) * FT, diameter: Number(r.d) * FT }),
  );
  const outfallRim = byId(optional("Outfall_Physical_Data", "select DomainElementID id, Physical_RimElevation v from Outfall_Physical_Data"), (r) => Number(r.v) * FT);
  const manholes = new Set(optional("Manhole", "select DomainElementID id from Manhole").map((r) => Number(r.id)));
  const outfalls = new Set(optional("Outfall", "select DomainElementID id from Outfall").map((r) => Number(r.id)));

  /** A node's rim, when it is a level at all: an outfall's rim is often left at 0. */
  const rimOf = (id: number): number | undefined => {
    const raw = rim.get(id)?.rim ?? outfallRim.get(id);
    const bottom = invert.get(id);
    return raw !== undefined && raw > 0 && (bottom === undefined || raw >= bottom) ? raw : undefined;
  };

  const features: DomainFeature[] = [];
  const src = (id: number, layer: string) => ({ sourceFile: filename, sourceLayer: layer, sourceEntityId: String(id) });
  let nodes = 0;
  let noRim = 0;
  for (const id of [...manholes, ...outfalls]) {
    if (!live(id)) continue;
    const xy = nodeXY.get(id);
    if (!xy) continue;
    const s = rim.get(id);
    const bottom = invert.get(id);
    // An outfall's rim is often left at 0: a rim below the invert is no level at all.
    const rawTop = s?.rim ?? outfallRim.get(id);
    const top = rimOf(id);
    if (rawTop !== undefined && top === undefined) noRim++;
    const kind = outfalls.has(id) ? "Outfall" : "Manhole";
    features.push({
      id: nanoid(8),
      infraFeatureClass: "pipe_connector",
      outputLayer: `${prefix}_manholes`,
      nameAttribute: "label",
      infraWorksFields: CONNECTOR_FIELDS,
      geometry: { type: "Point", coordinates: xy },
      attributes: {
        label: label(id),
        kind,
        rim_m: round(top),
        invert_m: round(bottom),
        depth_m: top !== undefined && bottom !== undefined ? round(top - bottom) : null,
        // Below the rim, which SewerGEMS sets to the ground: the connector's base offset from the terrain.
        off_base_m: top !== undefined && bottom !== undefined ? round(bottom - top) : null,
        size_m: s && s.diameter > 0 ? round(s.diameter) : null,
        utility,
        network,
      },
      provenance: src(id, kind),
    });
    nodes++;
  }

  /* -------- pipes */
  const ends = byId(q("select DomainElementID id, HMITopologyStartNodeID s, HMITopologyStopNodeID e from BaseLink_HMIDataSetTopology_Data"), (r) => [Number(r.s), Number(r.e)] as const);
  const shape = byId(optional("Conduit_Physical_Data", "select DomainElementID id, ConduitDiameter d, ConduitShape sh, Physical_ConduitShapeLabel l, ConduitSpan w, ConduitRise h from Conduit_Physical_Data"), (r) => r);
  const material = byId(optional("GravityLinkBase_Physical_Data", "select DomainElementID id, Physical_Material m from GravityLinkBase_Physical_Data"), (r) => String(r.m ?? "").trim());
  const inverts = byId(
    optional("PhysicalLink_Physical_Data", "select DomainElementID id, Physical_SetInvertToUpstream su, Physical_UpstreamInvert ui, Physical_SetInvertToDownstream sd, Physical_DownstreamInvert di from PhysicalLink_Physical_Data"),
    (r) => r,
  );
  const conduits = q("select DomainElementID id from Conduit").map((r) => Number(r.id));
  const geometry = byId(q("select DomainElementID id, HMIGeometry g from BaseLink_HmiDataSetGeometry_Data"), (r) => wkbPoints(r.g as Uint8Array | null));

  let pipes = 0;
  let deleted = 0;
  let length = 0;
  let gaps = 0;
  for (const id of conduits) {
    if (!live(id)) {
      deleted++;
      continue;
    }
    const pts = (geometry.get(id) ?? []).map(([x, y]) => [x * FT, y * FT] as [number, number]);
    if (pts.length < 2) continue;
    const [from, to] = ends.get(id) ?? [NaN, NaN];
    // A pipe should start and end on its nodes; say so when it does not (the model's own geometry is kept).
    const a = nodeXY.get(from);
    const b = nodeXY.get(to);
    if ((a && dist(a, pts[0]!) > 0.05) || (b && dist(b, pts.at(-1)!) > 0.05)) gaps++;
    const sh = shape.get(id);
    const diameter = sh ? Number(sh.d) * FT : NaN;
    const iv = inverts.get(id);
    // "Set invert to node": the pipe takes that node's invert.
    const usInv = iv && Number(iv.su) ? invert.get(from) : iv ? Number(iv.ui) * FT : undefined;
    const dsInv = iv && Number(iv.sd) ? invert.get(to) : iv ? Number(iv.di) * FT : undefined;
    const len = pts.slice(1).reduce((s, p, i) => s + dist(pts[i]!, p), 0);
    length += len;
    features.push({
      id: nanoid(8),
      infraFeatureClass: "pipeline",
      outputLayer: `${prefix}_pipes`,
      nameAttribute: "label",
      infraWorksFields: PIPE_FIELDS,
      geometry: { type: "LineString", coordinates: pts },
      attributes: {
        label: label(id),
        diameter_mm: Number.isFinite(diameter) && diameter > 0 ? Math.round(diameter * 1000) : null,
        size_m: Number.isFinite(diameter) && diameter > 0 ? round(diameter) : null,
        shape: sh ? String(sh.l ?? "") : null,
        material: material.get(id) || null,
        // Start and end follow the line as drawn, which is not always the way the sewer flows.
        inv_start_m: round(usInv),
        inv_end_m: round(dsInv),
        // Fall along the pipe, always positive; flow tells which way it goes.
        slope_pct: usInv !== undefined && dsInv !== undefined && len > 0 ? Math.round((Math.abs(usInv - dsInv) / len) * 100000) / 1000 : null,
        flow: usInv !== undefined && dsInv !== undefined ? (usInv >= dsInv ? "start-to-end" : "end-to-start") : null,
        length_m: Math.round(len * 1000) / 1000,
        node_start: label(from) || null,
        node_end: label(to) || null,
        // The pipe's centre below the ground at each end (rim of the node there, the model's ground).
        off_start_m: offsetBelow(usInv, diameter, rimOf(from)),
        off_end_m: offsetBelow(dsInv, diameter, rimOf(to)),
        utility,
        network,
      },
      provenance: src(id, "Conduit"),
    });
    pipes++;
  }

  const notes = [
    `${filename}: ${pipes} pipe(s) (${(length / 1000).toFixed(2)} km) and ${nodes} manhole(s)/outfall(s) read from the SewerGEMS model` +
      (deleted ? `; ${deleted} pipe(s) deleted in the model left out` : ""),
  ];
  if (noRim) notes.push(`${noRim} node(s) have no usable rim level in the model (0, or below the invert): rim and depth left empty`);
  if (gaps) notes.push(`${gaps} pipe(s) do not start or end on their manhole in the model's geometry (kept as drawn)`);
  return { features, notes, stats: { pipes, nodes, deletedPipes: deleted, lengthKm: length / 1000, endGaps: gaps } };
}

/** OpenFlows geometry: WKB point / line string, little endian, XY (HMIGeometry). */
export function wkbPoints(b: Uint8Array | null | undefined): [number, number][] {
  if (!b || b.length < 21) return [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = b[0] === 1;
  const type = v.getUint32(1, le) & 0xff;
  if (type === 1) return [[v.getFloat64(5, le), v.getFloat64(13, le)]];
  if (type !== 2) return [];
  const n = v.getUint32(5, le);
  const out: [number, number][] = [];
  for (let i = 0; i < n && 9 + i * 16 + 16 <= b.length; i++) out.push([v.getFloat64(9 + i * 16, le), v.getFloat64(17 + i * 16, le)]);
  return out;
}

/** Centre of a pipe of this diameter on this invert, relative to the ground level given. */
function offsetBelow(invert: number | undefined, diameter: number, ground: number | undefined): number | null {
  if (invert === undefined || ground === undefined || !Number.isFinite(invert) || !Number.isFinite(diameter)) return null;
  return round(invert + diameter / 2 - ground);
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);