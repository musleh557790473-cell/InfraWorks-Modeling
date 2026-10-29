import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { findLayerMapping, matchesLayer } from "./layers.js";
import { resolveAssetKeys } from "./types.js";
import type { AssetKeyConfig, DomainFeature, Geometry, InfraFeatureClass, MappingProfile } from "./types.js";

export interface ParsedDwgLayer {
  name: string;
  entityCount: number;
  /** Entity types seen on this layer, with counts. */
  types: Record<string, number>;
}

export interface ParsedDwg {
  layers: ParsedDwgLayer[];
  features: DomainFeature[];
  /** "dxf" — vector geometry read from a DXF (uploaded, or converted from DWG). "none" — nothing read. */
  format: "dxf" | "none";
  notes: string[];
  /** Entity types present in model space that the reader does not convert, with counts. */
  skippedEntities: Record<string, number>;
  /** Entities on paper space (layouts, title blocks) — never converted. */
  paperSpaceSkipped: number;
  /** $INSUNITS from the header (0 unitless, 1 inch, 2 foot, 4 mm, 5 cm, 6 m …), when present. */
  insunits?: number;
  /** Where asset ids were found, per source, for layers that carry a join attribute. */
  keyStats: { xdata: number; attribute: number; text: number; missing: number };
  /** Set when the CAD file was a DWG converted to DXF first. */
  converter?: { engine: string; attempts: string[] };
  /** The DXF ends before its EOF marker (cut off while saving or copying): the end of the drawing is missing. */
  truncated?: boolean;
  /** Bound xrefs read at their own coordinates because model space had nothing to convert (a plotted sheet). */
  extractedXrefs?: string[];
}

/** Default XDATA application that carries asset ids (kept for existing drawings). */
export const DXF_XDATA_APP = "INFRAWORKS";

/** Bookkeeping records, not drawing content: never reported as skipped. */
const IGNORED = new Set(["ATTDEF", "SEQEND", "VIEWPORT", "ENDBLK", "VERTEX", "ATTRIB"]);
const GEOMETRY_CLASSES: InfraFeatureClass[] = ["road_centerline", "coverage", "water", "parcel", "pipeline"];
const MAX_BLOCK_DEPTH = 8;
/** Chord angle when turning arcs into line segments. */
const ARC_STEP_RAD = (5 * Math.PI) / 180;

export function parseCadInput(filePath: string, filename: string, profile: MappingProfile): ParsedDwg {
  if (!filename.toLowerCase().endsWith(".dxf")) {
    throw new Error(`parseCadInput reads DXF only; convert ${filename} first (convertDwgToDxf)`);
  }
  return parseDxf(readFileSync(filePath, "utf8"), filename, profile);
}

/* ---------------------------------------------------------------- tokenising */

type Pair = { code: number; value: string };
interface RawEntity {
  type: string;
  pairs: Pair[];
}
interface Block {
  name: string;
  base: [number, number];
  entities: RawEntity[];
}

/**
 * AutoCAD writes characters outside the drawing's code page as \U+XXXX in DXF R2000–R2004
 * (Arabic layer names, labels, attributes). Decode them so layer rules and labels see real text.
 */
function decodeUnicodeEscapes(s: string): string {
  return /\\U\+/i.test(s) ? s.replace(/\\U\+([0-9A-Fa-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : s;
}

function toPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  if (lines.length % 2 === 1 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i]!.trim();
    const code = Number(raw);
    if (raw === "" || !Number.isInteger(code)) {
      throw new Error(`Malformed DXF: expected a group code at line ${i + 1}, found "${raw.slice(0, 40)}"`);
    }
    out.push({ code, value: decodeUnicodeEscapes(lines[i + 1]!.trim()) });
  }
  return out;
}

function readSections(pairs: Pair[]) {
  const entities: RawEntity[] = [];
  const blocks = new Map<string, Block>();
  let insunits: number | undefined;
  let section: string | null = null;
  // `as` keeps TypeScript from narrowing these to null: closures below reassign them.
  let current = null as RawEntity | null;
  let block = null as Block | null;
  let blockHeader = null as RawEntity | null;
  let sawEof = false;

  const flush = () => {
    if (!current) return;
    if (section === "ENTITIES") entities.push(current);
    else if (section === "BLOCKS" && block) block.entities.push(current);
    current = null;
  };
  const closeBlockHeader = () => {
    if (!blockHeader) return;
    let name = "";
    let x = 0;
    let y = 0;
    for (const p of blockHeader.pairs) {
      if (p.code === 2) name = p.value;
      if (p.code === 10) x = Number(p.value) || 0;
      if (p.code === 20) y = Number(p.value) || 0;
    }
    block = { name, base: [x, y], entities: [] };
    blockHeader = null;
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (section === "HEADER" && p.code === 9 && p.value === "$INSUNITS") {
      const v = pairs[i + 1];
      if (v && v.code === 70) insunits = Number(v.value);
      continue;
    }
    if (p.code !== 0) {
      if (blockHeader) blockHeader.pairs.push(p);
      else current?.pairs.push(p);
      continue;
    }
    // code 0 starts a new record
    closeBlockHeader();
    flush();
    if (p.value === "EOF") {
      sawEof = true;
      break;
    }
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
    if (section === "BLOCKS") {
      if (p.value === "BLOCK") {
        blockHeader = { type: "BLOCK", pairs: [] };
        continue;
      }
      if (p.value === "ENDBLK") {
        if (block) blocks.set(block.name.toUpperCase(), block);
        block = null;
        current = { type: "ENDBLK", pairs: [] }; // swallow ENDBLK's own pairs
        continue;
      }
    }
    if (section === "ENTITIES" || section === "BLOCKS") current = { type: p.value, pairs: [] };
  }
  // A file cut short ends inside a section, so its last record is incomplete: drop it.
  if (section === null) {
    closeBlockHeader();
    flush();
  }
  return { entities, blocks, insunits, truncated: !sawEof };
}

/**
 * A bound xref: binding keeps the xref as a block of the same name and renames its layers to
 * "<name>$0$<layer>". Nested pieces ("<name>$0$<block>") and anonymous blocks are not counted.
 */
function isBoundXref(b: Block): boolean {
  if (b.name === "" || b.name.startsWith("*") || /\$\d+\$/.test(b.name)) return false;
  const prefix = b.name.toUpperCase() + "$";
  return b.entities.some((e) => {
    const layer = readInfo(e).layer.toUpperCase();
    return layer.startsWith(prefix) && /^\d+\$/.test(layer.slice(prefix.length));
  });
}

/** POLYLINE + VERTEX… + SEQEND and INSERT + ATTRIB… + SEQEND become one item. */
interface Item {
  e: RawEntity;
  children: RawEntity[];
}
function group(entities: RawEntity[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]!;
    if (e.type === "ENDBLK") continue;
    const childType = e.type === "POLYLINE" ? "VERTEX" : e.type === "INSERT" ? "ATTRIB" : null;
    const item: Item = { e, children: [] };
    if (childType) {
      let j = i + 1;
      while (j < entities.length && entities[j]!.type === childType) item.children.push(entities[j++]!);
      if (entities[j]?.type === "SEQEND") j += 1;
      i = j - 1;
    }
    out.push(item);
  }
  return out;
}

/* ---------------------------------------------------------------- entity fields */

interface Info {
  layer: string;
  handle?: string;
  flags: number;
  paperSpace: boolean;
  points: [number, number][];
  /** Bulge of the segment that starts at points[i]. */
  bulges: number[];
  xdata: { app: string; value: string }[];
  num: Map<number, number>;
  str: Map<number, string>;
}

function readInfo(e: RawEntity): Info {
  const info: Info = {
    layer: "0",
    flags: 0,
    paperSpace: false,
    points: [],
    bulges: [],
    xdata: [],
    num: new Map(),
    str: new Map(),
  };
  let x: number | undefined;
  let app: string | null = null;
  let mtext = "";
  for (const p of e.pairs) {
    if (p.code === 1001) {
      app = p.value;
      continue;
    }
    if (app !== null) {
      if (p.code === 1000) info.xdata.push({ app, value: p.value });
      continue; // XDATA coordinates (1010…) are not geometry
    }
    switch (p.code) {
      case 8:
        info.layer = p.value;
        break;
      case 5:
        info.handle = p.value;
        break;
      case 67:
        info.paperSpace = p.value === "1";
        break;
      case 70:
        info.flags = Number(p.value) || 0;
        break;
      case 42:
        if (e.type === "LWPOLYLINE") {
          if (info.points.length) info.bulges[info.points.length - 1] = Number(p.value) || 0;
        } else info.num.set(42, Number(p.value));
        break;
      case 10:
        x = Number(p.value);
        break;
      case 20: {
        const y = Number(p.value);
        if (x !== undefined && Number.isFinite(x) && Number.isFinite(y)) info.points.push([x, y]);
        x = undefined;
        break;
      }
      case 3:
        mtext += p.value; // MTEXT continuation chunks come before the final code 1
        break;
      case 1:
        info.str.set(1, mtext + p.value);
        break;
      case 2:
        info.str.set(2, p.value);
        break;
      default:
        if ((p.code >= 11 && p.code <= 59) || p.code === 40 || p.code === 41 || p.code === 210 || p.code === 220 || p.code === 230) {
          const n = Number(p.value);
          if (Number.isFinite(n)) info.num.set(p.code, n);
        }
    }
  }
  return info;
}

/** Strip MTEXT formatting: \P paragraphs, {\f…;} fonts, \H…; heights, braces. */
function plainText(s: string): string {
  return s
    .replace(/\\P/gi, " ")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "")
    .replace(/\\[~\\{}]/g, (m) => m.slice(1))
    .replace(/[{}]/g, "")
    .replace(/%%[cdp]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------------------------------------- geometry */

type Pt = [number, number];
type Xf = (p: Pt) => Pt;
const identity: Xf = (p) => p;

/** Entities whose points are stored in their Object Coordinate System (LINE, POINT, MTEXT and 3D polylines are WCS). */
function usesOcs(type: string, flags: number): boolean {
  return (
    type === "ARC" || type === "CIRCLE" || type === "LWPOLYLINE" || type === "INSERT" || type === "TEXT" ||
    (type === "POLYLINE" && (flags & 8) === 0)
  );
}

/**
 * OCS → WCS (plan) for an entity's extrusion direction (210/220/230), by the DXF arbitrary
 * axis algorithm. MIRROR in AutoCAD writes extrusion (0,0,-1), which flips X; reading such
 * points as WCS puts mirrored arcs, polylines and blocks on the wrong side of the origin.
 * Identity for the usual (0,0,1). The elevation term is dropped: exact for extrusions along ±Z.
 */
function ocsOf(info: Info): Xf {
  const nx = info.num.get(210) ?? 0;
  const ny = info.num.get(220) ?? 0;
  const nz = info.num.get(230) ?? 1;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0) || (nx === 0 && ny === 0 && nz > 0)) return identity;
  const n = [nx / len, ny / len, nz / len] as const;
  const cross = (a: readonly number[], b: readonly number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const unit = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return v.map((c) => c / l);
  };
  const ax = unit(cross(Math.abs(n[0]) < 1 / 64 && Math.abs(n[1]) < 1 / 64 ? [0, 1, 0] : [0, 0, 1], n));
  const ay = unit(cross(n, ax));
  return (p) => [p[0] * ax[0]! + p[1] * ay[0]!, p[0] * ax[1]! + p[1] * ay[1]!];
}

function insertTransform(parent: Xf, base: Pt, ins: Pt, sx: number, sy: number, rotDeg: number): Xf {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (p) => {
    const x = (p[0] - base[0]) * sx;
    const y = (p[1] - base[1]) * sy;
    return parent([ins[0] + x * c - y * s, ins[1] + x * s + y * c]);
  };
}

function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP_RAD));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Points strictly between p1 and p2 along the arc a DXF bulge describes (bulge = tan(θ/4), + = CCW). */
function bulgeArc(p1: Pt, p2: Pt, bulge: number): Pt[] {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const d = Math.hypot(dx, dy);
  if (d === 0 || bulge === 0) return [];
  const h = (d / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const cx = (p1[0] + p2[0]) / 2 - (h * dy) / d;
  const cy = (p1[1] + p2[1]) / 2 + (h * dx) / d;
  const r = Math.hypot(p1[0] - cx, p1[1] - cy);
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const pts = arcPoints(cx, cy, r, a0, 4 * Math.atan(bulge));
  return pts.slice(1, -1);
}

/** Vertices with arc segments expanded. */
function withArcs(points: Pt[], bulges: number[], closed: boolean): Pt[] {
  if (!bulges.some((b) => b)) return points;
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    out.push(points[i]!);
    const next = i + 1 < n ? points[i + 1] : closed ? points[0] : undefined;
    if (next && bulges[i]) out.push(...bulgeArc(points[i]!, next, bulges[i]!));
  }
  return out;
}

function closeRing(points: Pt[]): Pt[] {
  const f = points[0]!;
  const l = points[points.length - 1]!;
  return f[0] === l[0] && f[1] === l[1] ? points : [...points, f];
}

function isClosedByVertices(points: Pt[]): boolean {
  if (points.length < 4) return false;
  const f = points[0]!;
  const l = points[points.length - 1]!;
  return f[0] === l[0] && f[1] === l[1];
}

function distToFeature(p: Pt, g: Geometry): number {
  const segDist = (a: number[], b: number[]) => {
    const vx = b[0]! - a[0]!;
    const vy = b[1]! - a[1]!;
    const len = vx * vx + vy * vy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]!) * vx + (p[1] - a[1]!) * vy) / len)) : 0;
    return Math.hypot(p[0] - (a[0]! + t * vx), p[1] - (a[1]! + t * vy));
  };
  const line = (pts: number[][]) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(pts[i - 1]!, pts[i]!));
    return pts.length === 1 ? Math.hypot(p[0] - pts[0]![0]!, p[1] - pts[0]![1]!) : best;
  };
  if (g.type === "Point") return Math.hypot(p[0] - g.coordinates[0], p[1] - g.coordinates[1]);
  if (g.type === "LineString") return line(g.coordinates);
  if (g.type === "Polygon") {
    const ring = g.coordinates[0] as number[][];
    return pointInRing(p, ring) ? 0 : line(ring);
  }
  return Infinity;
}

function pointInRing(p: Pt, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------------------------------------------------------------- asset keys */

const normTag = (t: string) => t.toUpperCase().replace(/[\s_-]/g, "");

export function normalizeKey(value: string, mode: AssetKeyConfig["normalize"]): string {
  if (mode === "exact") return value;
  const t = value.trim().toUpperCase();
  return mode === "alnum-upper" ? t.replace(/[^\p{L}\p{N}]/gu, "") : t;
}

interface Candidate {
  layer: string;
  geometry: Geometry;
  handle?: string;
  xdata: { app: string; value: string }[];
  attribs: Record<string, string>;
}

interface Label {
  layer: string;
  text: string;
  at: Pt;
}

/* ---------------------------------------------------------------- main */

export function parseDxf(text: string, filename: string, profile: MappingProfile): ParsedDwg {
  const { entities, blocks, insunits, truncated } = readSections(toPairs(text));
  const keys = resolveAssetKeys(profile);
  const pattern = keys.pattern ? safeRegExp(keys.pattern) : null;

  const candidates: Candidate[] = [];
  const labels: Label[] = [];
  const skipped: Record<string, number> = {};
  const layerStats = new Map<string, ParsedDwgLayer>();
  let paperSpaceSkipped = 0;

  const classOf = (layer: string): InfraFeatureClass => findLayerMapping(profile, layer)?.infraFeatureClass ?? "unmapped";
  const count = (layer: string, type: string) => {
    const s = layerStats.get(layer) ?? { name: layer, entityCount: 0, types: {} };
    s.entityCount += 1;
    s.types[type] = (s.types[type] ?? 0) + 1;
    layerStats.set(layer, s);
  };

  const blockHasGeometry = memo((name: string, depth: number): boolean => {
    const b = blocks.get(name.toUpperCase());
    if (!b || depth > MAX_BLOCK_DEPTH) return false;
    return group(b.entities).some(({ e }) => {
      const info = readInfo(e);
      if (e.type === "INSERT") return blockHasGeometry(info.str.get(2) ?? "", depth + 1);
      return GEOMETRY_CLASSES.includes(classOf(info.layer));
    });
  });

  interface Ctx {
    xf: Xf;
    /** Layer of the enclosing INSERT, for entities drawn on layer "0" inside a block. */
    byBlockLayer?: string;
    attribs: Record<string, string>;
    xdata: { app: string; value: string }[];
    depth: number;
  }

  const walk = (items: Item[], ctx: Ctx) => {
    for (const { e, children } of items) {
      const info = readInfo(e);
      if (info.paperSpace) {
        paperSpaceSkipped += 1;
        continue;
      }
      const layer = info.layer === "0" && ctx.byBlockLayer ? ctx.byBlockLayer : info.layer;
      const xdata = [...info.xdata, ...ctx.xdata];
      const add = (geometry: Geometry, attribs = ctx.attribs) => {
        count(layer, e.type);
        candidates.push({ layer, geometry, handle: info.handle, xdata, attribs });
      };
      // OCS points go to WCS first (mirrored objects), then through the enclosing blocks.
      const ocs = usesOcs(e.type, info.flags) ? ocsOf(info) : identity;
      const toWcs: Xf = ocs === identity ? ctx.xf : (p) => ctx.xf(ocs(p));
      const line = (pts: Pt[], closed: boolean) => {
        const t = pts.map(toWcs);
        if (t.length < 2) return;
        if ((closed && t.length >= 3) || isClosedByVertices(t)) add({ type: "Polygon", coordinates: [closeRing(t)] });
        else add({ type: "LineString", coordinates: t });
      };

      switch (e.type) {
        case "LINE": {
          const end: Pt = [info.num.get(11) ?? NaN, info.num.get(21) ?? NaN];
          line([info.points[0]!, end].filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1])) as Pt[], false);
          break;
        }
        case "LWPOLYLINE": {
          const closed = (info.flags & 1) === 1;
          line(withArcs(info.points, info.bulges, closed), closed);
          break;
        }
        case "POLYLINE": {
          if (info.flags & (16 | 64)) {
            skipped["POLYLINE (mesh)"] = (skipped["POLYLINE (mesh)"] ?? 0) + 1;
            break;
          }
          const pts: Pt[] = [];
          const bulges: number[] = [];
          for (const v of children) {
            const vi = readInfo(v);
            if (vi.flags & 16) continue; // spline frame control point
            if (vi.points[0]) {
              bulges[pts.length] = vi.num.get(42) ?? 0;
              pts.push(vi.points[0]);
            }
          }
          const closed = (info.flags & 1) === 1;
          line(withArcs(pts, bulges, closed), closed);
          break;
        }
        case "ARC": {
          const c = info.points[0];
          const r = info.num.get(40);
          if (!c || !r) break;
          const a0 = ((info.num.get(50) ?? 0) * Math.PI) / 180;
          let a1 = ((info.num.get(51) ?? 360) * Math.PI) / 180;
          if (a1 <= a0) a1 += 2 * Math.PI;
          line(arcPoints(c[0], c[1], r, a0, a1 - a0), false);
          break;
        }
        case "CIRCLE": {
          const c = info.points[0];
          const r = info.num.get(40);
          if (!c || !r) break;
          line(arcPoints(c[0], c[1], r, 0, 2 * Math.PI), true);
          break;
        }
        case "POINT":
          if (info.points[0]) add({ type: "Point", coordinates: ctx.xf(info.points[0]) });
          break;
        case "TEXT":
        case "MTEXT": {
          const content = plainText(info.str.get(1) ?? "");
          if (content && info.points[0]) labels.push({ layer, text: content, at: toWcs(info.points[0]) });
          count(layer, e.type);
          break;
        }
        case "INSERT": {
          const name = info.str.get(2) ?? "";
          const block = blocks.get(name.toUpperCase());
          const ins = info.points[0] ?? [0, 0];
          const attribs: Record<string, string> = { ...ctx.attribs };
          for (const a of children) {
            const ai = readInfo(a);
            const tag = ai.str.get(2);
            if (tag) attribs[tag] = plainText(ai.str.get(1) ?? "");
          }
          const cls = classOf(layer);
          const expand =
            block && ctx.depth < MAX_BLOCK_DEPTH && (GEOMETRY_CLASSES.includes(cls) || blockHasGeometry(name, 0));
          if (!expand) {
            // A symbol (tree, pole, manhole, title block…): one point carrying its attributes.
            add({ type: "Point", coordinates: toWcs(ins) }, attribs);
            break;
          }
          const xf = insertTransform(toWcs, block.base, ins, info.num.get(41) ?? 1, info.num.get(42) ?? 1, info.num.get(50) ?? 0);
          walk(group(block.entities), { xf, byBlockLayer: layer, attribs, xdata, depth: ctx.depth + 1 });
          break;
        }
        default:
          if (!IGNORED.has(e.type)) skipped[e.type] = (skipped[e.type] ?? 0) + 1;
      }
    }
  };

  walk(group(entities), { xf: identity, attribs: {}, xdata: [], depth: 0 });

  // A plotted sheet: nothing mapped in model space (or it was cut off), but the design drawing was
  // bound into the file as an xref. Read each bound xref that has mapped layers, at its own
  // coordinates: an xref's base point is the origin, so its coordinates are the designer's own.
  // Title blocks and logos are bound xrefs too, but carry no mapped layers, so they are left out.
  const extractedXrefs: string[] = [];
  const unmappedXrefs: string[] = [];
  const hasMappedGeometry = candidates.some((c) => c.geometry.type !== "Point" && GEOMETRY_CLASSES.includes(classOf(c.layer)));
  if (!hasMappedGeometry) {
    for (const b of [...blocks.values()].filter(isBoundXref)) {
      if (!blockHasGeometry(b.name, 0)) {
        unmappedXrefs.push(b.name);
        continue;
      }
      extractedXrefs.push(b.name);
      walk(group(b.entities), { xf: identity, attribs: {}, xdata: [], depth: 1 });
    }
  }

  /* -------- resolve asset keys and build features */
  const keyStats = { xdata: 0, attribute: 0, text: 0, missing: 0 };
  const okValue = (v: string) => v.trim() !== "" && (!pattern || pattern.test(v.trim()));
  const apps = keys.xdataApps.map((a) => a.toUpperCase());
  const tags = new Set(keys.attributeTags.map(normTag));
  const usableLabels = labels.filter(
    (l) =>
      (keys.textLayers.length ? keys.textLayers.some((r) => matchesLayer(r, l.layer)) : Boolean(pattern)) &&
      okValue(l.text),
  );

  const features: DomainFeature[] = candidates.map((c) => {
    const mapping = findLayerMapping(profile, c.layer);
    const attributes: DomainFeature["attributes"] = { layer: c.layer };
    for (const [tag, v] of Object.entries(c.attribs)) if (v) attributes[tag.toLowerCase()] = v;

    const joinAttr = mapping?.joinKeyAttribute;
    if (joinAttr) {
      let key: string | undefined;
      const x = c.xdata.find((d) => (apps.includes("*") || apps.includes(d.app.toUpperCase())) && okValue(d.value));
      if (x) {
        key = x.value.trim();
        keyStats.xdata += 1;
      }
      if (key === undefined) {
        const entry =
          Object.entries(c.attribs).find(([t, v]) => tags.has(normTag(t)) && okValue(v)) ??
          (pattern ? Object.entries(c.attribs).find(([, v]) => okValue(v)) : undefined);
        if (entry) {
          key = entry[1].trim();
          keyStats.attribute += 1;
        }
      }
      if (key === undefined && usableLabels.length) {
        let best: Label | undefined;
        let bestD = keys.textMaxDistance;
        for (const l of usableLabels) {
          const d = distToFeature(l.at, c.geometry);
          if (d <= bestD) {
            bestD = d;
            best = l;
          }
        }
        if (best) {
          key = best.text.trim();
          keyStats.text += 1;
        }
      }
      if (key !== undefined) attributes[joinAttr] = key;
      else keyStats.missing += 1;
    }

    return {
      id: nanoid(8),
      infraFeatureClass: mapping?.infraFeatureClass ?? "unmapped",
      geometry: c.geometry,
      attributes,
      provenance: { sourceFile: filename, sourceLayer: c.layer, sourceEntityId: c.handle },
    };
  });

  const notes = [
    extractedXrefs.length
      ? `Read ${features.length} feature(s); model space had nothing mapped, so bound xref(s) ${extractedXrefs.map((n) => `"${n}"`).join(", ")} were read at their own coordinates`
      : `Read ${features.length} feature(s) from model space (${blocks.size} block definition(s) available)`,
  ];
  if (!hasMappedGeometry && !extractedXrefs.length && unmappedXrefs.length) {
    notes.push(
      `Bound xref(s) found but none has a mapped layer: ${unmappedXrefs.map((n) => `"${n}"`).join(", ")}. ` +
        `Map their layers (by their own names, without the "<xref>$0$" prefix) to read them.`,
    );
  }
  if (truncated) notes.push("The DXF ends before its EOF marker: the file was cut off and the end of the drawing is missing");
  if (keyStats.xdata + keyStats.attribute + keyStats.text) {
    notes.push(`Asset ids found: ${keyStats.xdata} from XDATA, ${keyStats.attribute} from block attributes, ${keyStats.text} from nearby text`);
  }

  return {
    layers: [...layerStats.values()].sort((a, b) => b.entityCount - a.entityCount),
    features,
    format: "dxf",
    notes,
    skippedEntities: skipped,
    paperSpaceSkipped,
    insunits,
    keyStats,
    ...(truncated ? { truncated } : {}),
    ...(extractedXrefs.length ? { extractedXrefs } : {}),
  };
}

function safeRegExp(source: string): RegExp {
  try {
    return new RegExp(source, "iu");
  } catch {
    throw new Error(`Asset id pattern is not a valid regular expression: ${source}`);
  }
}

function memo<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const m = new Map<string, R>();
  return (...a: A) => {
    const k = JSON.stringify(a);
    if (!m.has(k)) m.set(k, fn(...a));
    return m.get(k)!;
  };
}
