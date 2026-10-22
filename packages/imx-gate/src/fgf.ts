/**
 * Minimal reader for FDO FGF binary geometry, the format Civil 3D writes into the
 * GEOMETRY columns of an .imx file.
 *
 * Layout (all little-endian):
 *   int32 geometryType
 *     1 Point         : int32 dim, coords
 *     2 LineString    : int32 dim, int32 numPoints, coords...
 *     3 Polygon       : int32 dim, int32 numRings, (int32 numPoints, coords...) * numRings
 *     4 MultiPoint    : int32 count, sub-geometry * count
 *     5 MultiLineString
 *     6 MultiPolygon
 *     7 MultiGeometry
 *   dim: 0 = XY, 1 = XYZ, 2 = XYM, 3 = XYZM
 *
 * Verified against Civil 3D 2026 IMX exports (NEOM PKG 4, LDIP Namar).
 */

export type FgfPoint = number[];

export interface FgfGeometry {
  type: "Point" | "LineString" | "Polygon" | "MultiPoint" | "MultiLineString" | "MultiPolygon" | "MultiGeometry";
  /** Flat list of every coordinate in the geometry, in order. */
  points: FgfPoint[];
  /** For line-like geometry, one entry per part. */
  parts: FgfPoint[][];
}

const TYPE_NAMES: Record<number, FgfGeometry["type"]> = {
  1: "Point",
  2: "LineString",
  3: "Polygon",
  4: "MultiPoint",
  5: "MultiLineString",
  6: "MultiPolygon",
  7: "MultiGeometry",
};

function componentCount(dim: number): number {
  switch (dim) {
    case 0:
      return 2; // XY
    case 1:
      return 3; // XYZ
    case 2:
      return 3; // XYM
    case 3:
      return 4; // XYZM
    default:
      throw new Error(`FGF: unknown dimensionality ${dim}`);
  }
}

class Cursor {
  constructor(
    readonly buf: Buffer,
    public off = 0,
  ) {}

  i32(): number {
    const v = this.buf.readInt32LE(this.off);
    this.off += 4;
    return v;
  }

  coords(n: number, nc: number): FgfPoint[] {
    const out: FgfPoint[] = [];
    for (let i = 0; i < n; i++) {
      const p: FgfPoint = [];
      for (let c = 0; c < nc; c++) {
        p.push(this.buf.readDoubleLE(this.off));
        this.off += 8;
      }
      out.push(p);
    }
    return out;
  }
}

function readGeometry(c: Cursor, acc: FgfGeometry): void {
  const t = c.i32();
  const name = TYPE_NAMES[t];
  if (!name) throw new Error(`FGF: unknown geometry type ${t} at byte ${c.off - 4}`);
  if (!acc.type) acc.type = name;

  switch (t) {
    case 1: {
      const nc = componentCount(c.i32());
      const pts = c.coords(1, nc);
      acc.points.push(...pts);
      acc.parts.push(pts);
      return;
    }
    case 2: {
      const nc = componentCount(c.i32());
      const n = c.i32();
      const pts = c.coords(n, nc);
      acc.points.push(...pts);
      acc.parts.push(pts);
      return;
    }
    case 3: {
      const nc = componentCount(c.i32());
      const rings = c.i32();
      for (let r = 0; r < rings; r++) {
        const n = c.i32();
        const pts = c.coords(n, nc);
        acc.points.push(...pts);
        acc.parts.push(pts);
      }
      return;
    }
    case 4:
    case 5:
    case 6:
    case 7: {
      const count = c.i32();
      for (let i = 0; i < count; i++) readGeometry(c, acc);
      return;
    }
    default:
      throw new Error(`FGF: unhandled geometry type ${t}`);
  }
}

/** Parse an FGF blob. Throws on malformed input; callers treat that as a finding. */
export function parseFgf(blob: Buffer): FgfGeometry {
  const acc: FgfGeometry = { type: undefined as unknown as FgfGeometry["type"], points: [], parts: [] };
  const c = new Cursor(blob);
  readGeometry(c, acc);
  if (c.off !== blob.length) {
    throw new Error(`FGF: ${blob.length - c.off} trailing byte(s) after geometry`);
  }
  return acc;
}

/** Plan length of a part, in source units. */
export function partLength2d(pts: FgfPoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    total += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  }
  return total;
}
