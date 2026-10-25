import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import type { DomainFeature, Geometry, InfraFeatureClass, MappingProfile } from "./types.js";

export interface ParsedDwgLayer {
  name: string;
  entityCount: number;
}

export interface ParsedDwg {
  layers: ParsedDwgLayer[];
  features: DomainFeature[];
  /**
   * "dxf"       — real vector geometry read from the file.
   * "dwg-stub"  — binary DWG; geometry is SYNTHETIC demo data, not the drawing.
   * "synthetic" — no CAD input at all.
   */
  format: "dxf" | "dwg-stub" | "synthetic";
  notes: string[];
  /** Entity types present in the file that the reader skipped, with counts. */
  skippedEntities: Record<string, number>;
}

/**
 * XDATA application name that carries the asset id used for report joins.
 * The first 1000 string under `1001 INFRAWORKS` becomes the feature's join key.
 */
export const DXF_XDATA_APP = "INFRAWORKS";

/**
 * Parse ASCII DXF entities into domain features.
 * Binary DWG is not parsed: it yields synthetic demo geometry flagged as `dwg-stub`,
 * which validation treats as blocking so it can never ship as a real package.
 */
export function parseCadInput(
  filePath: string,
  filename: string,
  profile: MappingProfile,
): ParsedDwg {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dxf")) {
    return parseDxf(readFileSync(filePath, "utf8"), filename, profile);
  }
  return stubDwg(filename, profile);
}

function findMapping(profile: MappingProfile, layer: string) {
  return profile.layers.find((l) => l.dwgLayer.toLowerCase() === layer.toLowerCase());
}

type Pair = { code: number; value: string };

interface RawEntity {
  type: string;
  pairs: Pair[];
}

function toPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  // A trailing newline leaves one empty line; ignore it.
  if (lines.length % 2 === 1 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i]!.trim();
    const code = Number(raw);
    if (raw === "" || !Number.isInteger(code)) {
      throw new Error(`Malformed DXF: expected a group code at line ${i + 1}, found "${raw.slice(0, 40)}"`);
    }
    out.push({ code, value: lines[i + 1]!.trim() });
  }
  return out;
}

/** Entities of the ENTITIES section only — BLOCKS definitions are not model space. */
function entitiesSection(pairs: Pair[]): RawEntity[] {
  const out: RawEntity[] = [];
  let section: string | null = null;
  let current: RawEntity | null = null;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0) {
      if (current) out.push(current);
      current = null;
      if (p.value === "SECTION") {
        const name = pairs[i + 1];
        section = name && name.code === 2 ? name.value : null;
        i += 1;
        continue;
      }
      if (p.value === "ENDSEC") {
        section = null;
        continue;
      }
      if (section === "ENTITIES") current = { type: p.value, pairs: [] };
      continue;
    }
    current?.pairs.push(p);
  }
  if (current) out.push(current);
  return out;
}

interface EntityInfo {
  layer: string;
  handle?: string;
  flags: number;
  joinKey?: string;
  points: [number, number][];
  hasBulge: boolean;
}

function readInfo(e: RawEntity): EntityInfo {
  const info: EntityInfo = { layer: "0", flags: 0, points: [], hasBulge: false };
  let x: number | undefined;
  let xdataApp: string | null = null;
  for (const p of e.pairs) {
    if (p.code === 1001) {
      xdataApp = p.value;
      continue;
    }
    if (xdataApp !== null) {
      if (p.code === 1000 && xdataApp.toUpperCase() === DXF_XDATA_APP && info.joinKey === undefined) {
        info.joinKey = p.value;
      }
      continue; // XDATA coordinates (1010…) are not geometry
    }
    switch (p.code) {
      case 8:
        info.layer = p.value;
        break;
      case 5:
        info.handle = p.value;
        break;
      case 70:
        info.flags = Number(p.value) || 0;
        break;
      case 42:
        if (Number(p.value) !== 0) info.hasBulge = true;
        break;
      case 10:
      case 11:
        x = Number(p.value);
        break;
      case 20:
      case 21: {
        const y = Number(p.value);
        if (x !== undefined && Number.isFinite(x) && Number.isFinite(y)) info.points.push([x, y]);
        x = undefined;
        break;
      }
    }
  }
  return info;
}

function closeRing(points: [number, number][]): [number, number][] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

function isClosedByVertices(points: [number, number][]): boolean {
  if (points.length < 4) return false;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1];
}

export function parseDxf(text: string, filename: string, profile: MappingProfile): ParsedDwg {
  const entities = entitiesSection(toPairs(text));
  const features: DomainFeature[] = [];
  const layerCounts = new Map<string, number>();
  const skipped: Record<string, number> = {};
  let bulges = 0;

  const emit = (info: EntityInfo, geometry: Geometry) => {
    const mapping = findMapping(profile, info.layer);
    layerCounts.set(info.layer, (layerCounts.get(info.layer) ?? 0) + 1);
    if (info.hasBulge) bulges += 1;
    features.push({
      id: nanoid(8),
      infraFeatureClass: (mapping?.infraFeatureClass ?? "unmapped") as InfraFeatureClass,
      geometry,
      attributes: {
        layer: info.layer,
        ...(mapping?.joinKeyAttribute && info.joinKey !== undefined
          ? { [mapping.joinKeyAttribute]: info.joinKey }
          : {}),
      },
      provenance: {
        sourceFile: filename,
        sourceLayer: info.layer,
        sourceEntityId: info.handle,
      },
    });
  };

  const emitLine = (info: EntityInfo, closed: boolean) => {
    if (info.points.length < 2) return;
    if ((closed && info.points.length >= 3) || isClosedByVertices(info.points)) {
      emit(info, { type: "Polygon", coordinates: [closeRing(info.points)] });
    } else {
      emit(info, { type: "LineString", coordinates: info.points });
    }
  };

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]!;
    switch (e.type) {
      case "LINE":
        emitLine(readInfo(e), false);
        break;
      case "LWPOLYLINE": {
        const info = readInfo(e);
        emitLine(info, (info.flags & 1) === 1);
        break;
      }
      case "POLYLINE": {
        // Old-style polyline: the header carries layer/flags, vertices follow as VERTEX entities.
        const info = readInfo(e);
        info.points = [];
        let j = i + 1;
        while (j < entities.length && entities[j]!.type === "VERTEX") {
          const v = readInfo(entities[j]!);
          if (v.hasBulge) info.hasBulge = true;
          info.points.push(...v.points);
          j += 1;
        }
        if (entities[j]?.type === "SEQEND") j += 1;
        i = j - 1;
        emitLine(info, (info.flags & 1) === 1);
        break;
      }
      case "POINT": {
        const info = readInfo(e);
        if (info.points[0]) emit(info, { type: "Point", coordinates: info.points[0] });
        break;
      }
      default:
        skipped[e.type] = (skipped[e.type] ?? 0) + 1;
    }
  }

  const notes = [`Parsed ${features.length} entities from DXF ENTITIES section`];
  if (bulges) notes.push(`${bulges} polyline(s) contain arc segments; arcs are written as straight chords`);

  const layers = [...layerCounts.entries()].map(([name, entityCount]) => ({ name, entityCount }));
  return { layers, features, format: "dxf", notes, skippedEntities: skipped };
}

function stubDwg(filename: string, profile: MappingProfile): ParsedDwg {
  const features: DomainFeature[] = [];
  const layers: ParsedDwgLayer[] = [];
  // Demo corridor in UTM 38N near Riyadh / Al Narjis vicinity (approx)
  const originX = 673000;
  const originY = 2735000;

  profile.layers.forEach((mapping, idx) => {
    const count = mapping.infraFeatureClass === "road_centerline" ? 5 : 1;
    for (let n = 0; n < count; n += 1) {
      const y = originY + idx * 80 + n * 12;
      const assetId = `RD-${String(n + 1).padStart(3, "0")}`;
      const geomType =
        mapping.infraFeatureClass === "coverage" || mapping.infraFeatureClass === "parcel"
          ? "Polygon"
          : mapping.infraFeatureClass === "annotation"
            ? "Point"
            : "LineString";

      let geometry: Geometry;
      if (geomType === "Polygon") {
        geometry = {
          type: "Polygon",
          coordinates: [[
            [originX, y],
            [originX + 200, y],
            [originX + 200, y + 30],
            [originX, y + 30],
            [originX, y],
          ]],
        };
      } else if (geomType === "Point") {
        geometry = { type: "Point", coordinates: [originX + 100, y + 10] };
      } else {
        geometry = {
          type: "LineString",
          coordinates: [
            [originX, y],
            [originX + 250, y + 5],
            [originX + 500, y],
          ],
        };
      }

      features.push({
        id: nanoid(8),
        infraFeatureClass: mapping.infraFeatureClass,
        geometry,
        attributes: {
          layer: mapping.dwgLayer,
          ...(mapping.joinKeyAttribute ? { [mapping.joinKeyAttribute]: assetId } : {}),
        },
        provenance: {
          sourceFile: filename,
          sourceLayer: mapping.dwgLayer,
          sourceEntityId: `stub-${idx}-${n}`,
        },
      });
    }
    layers.push({ name: mapping.dwgLayer, entityCount: count });
  });

  return {
    layers,
    features,
    format: "dwg-stub",
    notes: [
      "Binary DWG is not parsed in this build: geometry is SYNTHETIC demo data. Save the drawing as ASCII DXF, or wire APS Design Automation for real DWG reading.",
    ],
    skippedEntities: {},
  };
}
