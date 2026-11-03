/** Plan geometry of road centrelines: straights and bulge arcs (DXF LWPOLYLINE segments). */

export type P2 = [number, number];
export type P3 = [number, number, number];

/** One segment of a centreline piece: a straight (bulge 0) or an arc (DXF bulge = tan(angle / 4)). */
export interface Seg {
  a: P2;
  b: P2;
  bulge: number;
}

export const dist = (p: readonly number[], q: readonly number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);
export const near = (p: P2, q: P2, tol = 0.05): boolean => dist(p, q) < tol;
export const first = <T>(a: readonly T[]): T => a[0]!;
export const last = <T>(a: readonly T[]): T => a[a.length - 1]!;

/** Arc parameters of a bulge segment: centre, radius, start angle, signed sweep. */
export function arcOf(g: Seg): { cx: number; cy: number; r: number; a0: number; th: number } {
  const th = 4 * Math.atan(g.bulge), c = dist(g.a, g.b), r = c / (2 * Math.sin(Math.abs(th) / 2));
  const ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge);
  const cx = (g.a[0] + g.b[0]) / 2 - uy * h, cy = (g.a[1] + g.b[1]) / 2 + ux * h;
  return { cx, cy, r, a0: Math.atan2(g.a[1] - cy, g.a[0] - cx), th };
}

export function segLen(g: Seg): number {
  const c = dist(g.a, g.b);
  if (!g.bulge) return c;
  const th = 4 * Math.atan(Math.abs(g.bulge));
  return (c / (2 * Math.sin(th / 2))) * th;
}

export const pieceLen = (s: readonly Seg[]): number => s.reduce((a, g) => a + segLen(g), 0);

/** The same piece walked from its other end (segments reversed, arcs turn the other way). */
export const reverseSegs = (segs: readonly Seg[]): Seg[] => segs.slice().reverse().map((g) => ({ a: g.b, b: g.a, bulge: -g.bulge }));

/** Point and unit direction at station `st` along chained segments; null past the end. */
export function at(segs: readonly Seg[], st: number): { p: P2; u: P2 } | null {
  for (const g of segs) {
    const c = dist(g.a, g.b);
    const len = g.bulge ? segLen(g) : c;
    if (st <= len + 1e-9) {
      const t = st / len;
      if (!g.bulge) return { p: [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t], u: [(g.b[0] - g.a[0]) / c, (g.b[1] - g.a[1]) / c] };
      const { cx, cy, r, a0, th } = arcOf(g), a = a0 + th * t, sg = Math.sign(th);
      return { p: [cx + r * Math.cos(a), cy + r * Math.sin(a)], u: [-Math.sin(a) * sg, Math.cos(a) * sg] };
    }
    st -= len;
  }
  return null;
}

/**
 * Cut chained segments at station `len` (keeps the start). A road whose profile stops short of its
 * centreline piece ends where the profile ends (R.3.G.11: 2.000 m; R.0.D.5: plan 0+416.889, profile 0+375).
 */
export function trimTo(segs: readonly Seg[], len: number): Seg[] {
  const out: Seg[] = [];
  let acc = 0;
  for (const g of segs) {
    const l = segLen(g);
    if (acc + l <= len + 1e-9) { out.push(g); acc += l; continue; }
    const f = (len - acc) / l;
    if (f <= 1e-9) break;
    if (!g.bulge) out.push({ a: g.a, b: [g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f], bulge: 0 });
    else {
      const { cx, cy, r, a0, th } = arcOf(g), a1 = a0 + th * f;
      out.push({ a: g.a, b: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], bulge: Math.tan((th * f) / 4) });
    }
    break;
  }
  return out;
}

/** Nearest point of a 3D polyline to x (in plan), with its interpolated level. */
export function nearestOn(q: readonly P3[], x: readonly number[]): { d: number; z: number } | null {
  let best: { d: number; z: number } | null = null;
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1]!, b = q[i]!, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((x[0]! - a[0]) * dx + (x[1]! - a[1]) * dy) / l2));
    const d = Math.hypot(x[0]! - a[0] - dx * t, x[1]! - a[1] - dy * t);
    if (!best || d < best.d) best = { d, z: a[2] + (b[2] - a[2]) * t };
  }
  return best;
}
