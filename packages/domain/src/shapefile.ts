import { writeFileSync } from "node:fs";

/**
 * Minimal ESRI Shapefile writer: .shp + .shx + .dbf + .prj + .cpg.
 *
 * InfraWorks does not import GeoJSON; Shapefile is the format every InfraWorks release
 * reads as a file data source. One Shapefile holds one geometry kind, so callers split a
 * layer into point / line / area files.
 *
 * Text attributes are written as UTF-8 and declared in the .cpg, so Arabic names survive.
 * dBASE limits field names to 10 ASCII characters; the writer shortens and de-duplicates
 * them and returns the mapping so the package can document it.
 */

export type ShapeKind = "point" | "line" | "area";

export interface ShpFeature {
  /** Point: [x, y]. Line: one or more parts [[x, y]…]. Area: rings [[x, y]…] (first = outer). */
  kind: ShapeKind;
  parts: number[][][];
  attributes: Record<string, string | number | boolean | null>;
}

export interface ShpField {
  /** Attribute name in the source data. */
  source: string;
  /** Field name in the .dbf (≤ 10 ASCII characters). */
  dbf: string;
  type: "C" | "N";
  length: number;
  decimals: number;
}

export interface ShpWriteResult {
  files: string[];
  fields: ShpField[];
  count: number;
  bbox: [number, number, number, number];
  /** Total plan length of line parts (area rings excluded). */
  length: number;
}

const SHAPE_TYPE: Record<ShapeKind, number> = { point: 1, line: 3, area: 5 };

/* ------------------------------------------------------------------ geometry */

/** Shoelace sum: > 0 for counter-clockwise rings. */
function signedArea(ring: number[][]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j]![0]! * ring[i]![1]!) - (ring[i]![0]! * ring[j]![1]!);
  return s / 2;
}

/** Shapefile rule: outer rings clockwise, holes counter-clockwise; rings closed. */
function orientRings(rings: number[][][]): number[][][] {
  return rings.map((r, i) => {
    const ring = r.length && (r[0]![0] !== r[r.length - 1]![0] || r[0]![1] !== r[r.length - 1]![1]) ? [...r, r[0]!] : r;
    const ccw = signedArea(ring) > 0;
    const wantCcw = i > 0;
    return ccw === wantCcw ? ring : [...ring].reverse();
  });
}

function bboxOf(pts: number[][]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) {
    a = Math.min(a, p[0]!); b = Math.min(b, p[1]!);
    c = Math.max(c, p[0]!); d = Math.max(d, p[1]!);
  }
  return [a, b, c, d];
}

function shapeContent(f: ShpFeature): Buffer {
  if (f.kind === "point") {
    const b = Buffer.alloc(20);
    b.writeInt32LE(1, 0);
    b.writeDoubleLE(f.parts[0]![0]![0]!, 4);
    b.writeDoubleLE(f.parts[0]![0]![1]!, 12);
    return b;
  }
  const parts = f.kind === "area" ? orientRings(f.parts) : f.parts;
  const pts = parts.flat();
  const b = Buffer.alloc(44 + 4 * parts.length + 16 * pts.length);
  b.writeInt32LE(SHAPE_TYPE[f.kind], 0);
  const [x0, y0, x1, y1] = bboxOf(pts);
  b.writeDoubleLE(x0, 4); b.writeDoubleLE(y0, 12); b.writeDoubleLE(x1, 20); b.writeDoubleLE(y1, 28);
  b.writeInt32LE(parts.length, 36);
  b.writeInt32LE(pts.length, 40);
  let off = 44, start = 0;
  for (const p of parts) {
    b.writeInt32LE(start, off);
    off += 4;
    start += p.length;
  }
  for (const p of pts) {
    b.writeDoubleLE(p[0]!, off);
    b.writeDoubleLE(p[1]!, off + 8);
    off += 16;
  }
  return b;
}

function mainHeader(fileBytes: number, kind: ShapeKind, bbox: [number, number, number, number]): Buffer {
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE(fileBytes / 2, 24); // file length in 16-bit words
  h.writeInt32LE(1000, 28);
  h.writeInt32LE(SHAPE_TYPE[kind], 32);
  bbox.forEach((v, i) => h.writeDoubleLE(v, 36 + i * 8));
  return h; // Z and M ranges stay 0
}

/* ------------------------------------------------------------------ dbf */

function asciiName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

/** Short, unique dBASE field names (≤ 10 ASCII characters). */
export function dbfFieldNames(sources: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  let n = 0;
  for (const s of sources) {
    let base = asciiName(s).slice(0, 10) || `FIELD_${++n}`;
    let name = base;
    for (let i = 2; used.has(name); i++) {
      const suffix = `_${i}`;
      name = base.slice(0, 10 - suffix.length) + suffix;
    }
    used.add(name);
    out.set(s, name);
  }
  return out;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function planFields(features: ShpFeature[]): ShpField[] {
  const keys: string[] = [];
  for (const f of features) for (const k of Object.keys(f.attributes)) if (!keys.includes(k)) keys.push(k);
  const names = dbfFieldNames(keys);
  return keys.map((k) => {
    const values = features.map((f) => f.attributes[k]).filter((v) => v !== null && v !== undefined && v !== "");
    const numeric = values.length > 0 && values.every((v) => typeof v === "number" ? Number.isFinite(v) : NUMERIC.test(String(v).trim()));
    if (numeric) {
      const decimals = Math.min(8, Math.max(0, ...values.map((v) => (String(v).split(".")[1] ?? "").length)));
      return { source: k, dbf: names.get(k)!, type: "N", length: 19, decimals };
    }
    const longest = Math.max(1, ...values.map((v) => Buffer.byteLength(String(v), "utf8")));
    return { source: k, dbf: names.get(k)!, type: "C", length: Math.min(254, longest), decimals: 0 };
  });
}

/** UTF-8 bytes cut to `max` without splitting a character. */
function utf8Fit(s: string, max: number): Buffer {
  let b = Buffer.from(s, "utf8");
  if (b.length <= max) return b;
  let end = max;
  while (end > 0 && (b[end]! & 0xc0) === 0x80) end--; // step back off a continuation byte
  return b.subarray(0, end);
}

function dbf(features: ShpFeature[], fields: ShpField[]): Buffer {
  const headerLen = 32 + 32 * fields.length + 1;
  const recordLen = 1 + fields.reduce((s, f) => s + f.length, 0);
  const buf = Buffer.alloc(headerLen + recordLen * features.length + 1, 0x20);
  buf.fill(0, 0, headerLen);
  const now = new Date();
  buf.writeUInt8(0x03, 0);
  buf.writeUInt8(now.getFullYear() - 1900, 1);
  buf.writeUInt8(now.getMonth() + 1, 2);
  buf.writeUInt8(now.getDate(), 3);
  buf.writeUInt32LE(features.length, 4);
  buf.writeUInt16LE(headerLen, 8);
  buf.writeUInt16LE(recordLen, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    buf.write(f.dbf, o, 10, "ascii");
    buf.write(f.type, o + 11, 1, "ascii");
    buf.writeUInt8(f.length, o + 16);
    buf.writeUInt8(f.decimals, o + 17);
  });
  buf.writeUInt8(0x0d, headerLen - 1);

  features.forEach((feat, r) => {
    let o = headerLen + r * recordLen;
    buf.write(" ", o++, "ascii"); // not deleted
    for (const f of fields) {
      const v = feat.attributes[f.source];
      if (f.type === "N") {
        const text = v === null || v === undefined || v === "" ? "" : Number(v).toFixed(f.decimals);
        buf.write(text.padStart(f.length).slice(-f.length), o, "ascii");
      } else {
        const bytes = utf8Fit(v === null || v === undefined ? "" : String(v), f.length);
        bytes.copy(buf, o);
      }
      o += f.length;
    }
  });
  buf.writeUInt8(0x1a, buf.length - 1);
  return buf;
}

/* ------------------------------------------------------------------ prj */

const GCS_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** ESRI WKT for the EPSG codes the package supports, or null (then the CRS is set by hand). */
export function esriWkt(epsg: number): string | null {
  const north = epsg >= 32601 && epsg <= 32660;
  const south = epsg >= 32701 && epsg <= 32760;
  if (north || south) {
    const zone = epsg - (north ? 32600 : 32700);
    const cm = zone * 6 - 183;
    return (
      `PROJCS["WGS_1984_UTM_Zone_${zone}${north ? "N" : "S"}",${GCS_WGS84},PROJECTION["Transverse_Mercator"],` +
      `PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${north ? "0.0" : "10000000.0"}],` +
      `PARAMETER["Central_Meridian",${cm.toFixed(1)}],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`
    );
  }
  if (epsg === 4326) return GCS_WGS84;
  if (epsg === 3857) {
    return (
      `PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",${GCS_WGS84},PROJECTION["Mercator_Auxiliary_Sphere"],` +
      `PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],` +
      `PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]`
    );
  }
  return null;
}

/* ------------------------------------------------------------------ write */

/** Write `<basePath>.shp/.shx/.dbf/.cpg` (+ `.prj` when the EPSG is known). All features must share one kind. */
export function writeShapefile(basePath: string, kind: ShapeKind, features: ShpFeature[], epsg: number): ShpWriteResult {
  if (features.some((f) => f.kind !== kind)) throw new Error(`writeShapefile: all features must be ${kind}`);
  const contents = features.map(shapeContent);
  const allPts = features.flatMap((f) => f.parts.flat());
  const bbox: [number, number, number, number] = allPts.length ? bboxOf(allPts) : [0, 0, 0, 0];

  const shpLen = 100 + contents.reduce((s, c) => s + 8 + c.length, 0);
  const shp = Buffer.alloc(shpLen);
  mainHeader(shpLen, kind, bbox).copy(shp, 0);
  const shx = Buffer.alloc(100 + 8 * contents.length);
  mainHeader(shx.length, kind, bbox).copy(shx, 0);

  let off = 100;
  contents.forEach((c, i) => {
    shx.writeInt32BE(off / 2, 100 + i * 8);
    shx.writeInt32BE(c.length / 2, 104 + i * 8);
    shp.writeInt32BE(i + 1, off);
    shp.writeInt32BE(c.length / 2, off + 4);
    c.copy(shp, off + 8);
    off += 8 + c.length;
  });

  const fields = planFields(features);
  const files: string[] = [];
  const put = (ext: string, data: Buffer | string) => {
    writeFileSync(`${basePath}.${ext}`, data);
    files.push(`${basePath}.${ext}`);
  };
  put("shp", shp);
  put("shx", shx);
  put("dbf", dbf(features, fields));
  put("cpg", "UTF-8");
  const wkt = esriWkt(epsg);
  if (wkt) put("prj", wkt);

  let length = 0;
  if (kind === "line") {
    for (const f of features) for (const p of f.parts) for (let i = 1; i < p.length; i++) length += Math.hypot(p[i]![0]! - p[i - 1]![0]!, p[i]![1]! - p[i - 1]![1]!);
  }
  return { files, fields, count: features.length, bbox, length };
}
