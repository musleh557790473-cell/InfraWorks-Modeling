/**
 * A Parsons road as InfraWorks component-road geometry: horizontal elements (straights, arcs of at
 * most 90 degrees), PVIs with parabolic vertical curves, and the 3D centreline InfraWorks caches.
 */
import type { Alignment, Pvi } from "@infraworks/domain";

export type XY = [number, number];
export type XYZ = [number, number, number];

export type HElement =
  | { kind: "line"; a: XY; b: XY; len: number; s0: number }
  | { kind: "arc"; a: XY; b: XY; m: XY; cx: number; cy: number; r: number; a0: number; th: number; len: number; s0: number };

export interface RoadPlan {
  name: string;
  H: HElement[];
  total: number;
  pvis: { s: number; z: number; L: number }[];
  /** 3D centreline: every 5 m (2 m on arcs), element ends, curve ends */
  line: XYZ[];
  /** plan point at a station */
  xy: (s: number) => XY;
  notes: string[];
}

/**
 * `ends` sets the level of the first / last PVI (a road end tied to the road it ends on, when the two
 * profiles disagree by a few centimetres there and InfraWorks builds that junction badly: 298 / 299).
 */
export function planRoad(al: Alignment, pv: Pvi[], ends: { startZ?: number; endZ?: number } = {}): RoadPlan {
  const name = al.name, notes: string[] = [];
  const pvis = pv.map((p) => ({ s: p.s, z: p.z as number, L: p.L || 0 }));
  if (pvis.some((p) => p.z == null)) throw new Error(`${name}: a PVI has no level`);
  const H: HElement[] = [];
  for (const g of al.segs) {
    const c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    if (!g.bulge) { H.push({ kind: "line", a: g.a, b: g.b, len: c, s0: 0 }); continue; }
    const th = 4 * Math.atan(g.bulge), r = c / (2 * Math.sin(Math.abs(th) / 2));
    const ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge);
    const cx = (g.a[0] + g.b[0]) / 2 - uy * h, cy = (g.a[1] + g.b[1]) / 2 + ux * h, a0 = Math.atan2(g.a[1] - cy, g.a[0] - cx);
    const P = (t: number): XY => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    // InfraWorks stores an arc by start / mid / end: an arc over 90 degrees is split into equal arcs of
    // at most 90, or a roundabout drawn as one arc with start and end ~1 cm apart is undefined (RA-2: length 0)
    const n = Math.abs(th) <= Math.PI / 2 + 1e-9 ? 1 : Math.ceil(Math.abs(th) / (Math.PI / 2)), dt = th / n;
    for (let k = 0; k < n; k++) {
      const t0 = a0 + dt * k;
      H.push({ kind: "arc", a: k ? P(t0) : g.a, b: k === n - 1 ? g.b : P(t0 + dt), m: P(t0 + dt / 2), cx, cy, r, a0: t0, th: dt, len: r * Math.abs(dt), s0: 0 });
    }
  }
  let acc = 0;
  for (const e of H) { e.s0 = acc; acc += e.len; }
  const total = acc;
  const xy = (s: number): XY => {
    const e = H.find((q) => s <= q.s0 + q.len + 1e-9) ?? H[H.length - 1]!;
    const t = Math.min(1, Math.max(0, (s - e.s0) / e.len));
    if (e.kind === "line") return [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
    const a = e.a0 + e.th * t;
    return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)];
  };
  // PVIs past the road end come from the next profile on the same sheet (R.2.G.6, R.5.G.5): drop them
  // when one PVI sits at the end. A first PVI up to 0.30 m after 0 (R.0.C.3 at 0.254): extend the first
  // tangent back to 0 at its own grade.
  const endIdx = pvis.findIndex((p) => Math.abs(p.s - total) <= 0.01);
  if (endIdx >= 0 && pvis[pvis.length - 1]!.s > total + 0.01) {
    const n0 = pvis.length; pvis.splice(endIdx + 1);
    notes.push(`${n0 - pvis.length} PVI(s) past the end dropped (another road's profile)`);
  }
  const p0 = pvis[0]!, p1 = pvis[1];
  if (p0.s > 1e-3 && p0.s <= 0.3 && p1 && !p0.L) {
    const g = (p1.z - p0.z) / (p1.s - p0.s), z0 = p0.z - g * p0.s;
    notes.push(`first PVI at ${p0.s} m, tangent extended to 0 (z ${z0.toFixed(3)})`);
    pvis.unshift({ s: 0, z: z0, L: 0 });
  }
  if (Math.abs(pvis[0]!.s) > 1e-3 || Math.abs(pvis[pvis.length - 1]!.s - total) > 0.01) throw new Error(`${name}: PVIs ${pvis[0]!.s}..${pvis[pvis.length - 1]!.s} vs alignment 0..${total.toFixed(3)}`);
  for (const [k, z] of [[0, ends.startZ], [pvis.length - 1, ends.endZ]] as const) {
    if (z == null) continue;
    const p = pvis[k]!;
    notes.push(`${k ? "end" : "start"} level ${p.z.toFixed(3)} -> ${z.toFixed(3)} (tied to the road it ends on)`);
    pvis[k] = { ...p, z };
  }
  const zAt = (s: number): number => {
    for (let i = 1; i < pvis.length - 1; i++) {
      const p = pvis[i]!; if (!p.L) continue;
      const s1 = p.s - p.L / 2, s2 = p.s + p.L / 2;
      if (s >= s1 && s <= s2) {
        const gin = (p.z - pvis[i - 1]!.z) / (p.s - pvis[i - 1]!.s), gout = (pvis[i + 1]!.z - p.z) / (pvis[i + 1]!.s - p.s), x = s - s1;
        return p.z - gin * (p.L / 2) + gin * x + ((gout - gin) / (2 * p.L)) * x * x;
      }
    }
    for (let i = 1; i < pvis.length; i++) if (s <= pvis[i]!.s + 1e-9) { const a = pvis[i - 1]!, b = pvis[i]!; return a.z + ((b.z - a.z) * (s - a.s)) / (b.s - a.s); }
    return pvis[pvis.length - 1]!.z;
  };
  const st = new Set([0, total]);
  for (let s = 5; s < total; s += 5) st.add(s);
  H.forEach((e) => st.add(e.s0));
  H.forEach((e) => { if (e.kind === "arc") for (let s = e.s0 + 2; s < e.s0 + e.len; s += 2) st.add(s); });
  pvis.forEach((p) => { if (p.L) { st.add(p.s - p.L / 2); st.add(p.s + p.L / 2); } });
  // stations closer than 1 mm (an element end next to a 5 m tick) give a zero-length segment, an
  // undefined direction and NaN edge points (R.1.G.8 drew walls down to nowhere): keep one of them
  const sts = [...st].filter((s) => s >= 0 && s <= total).sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1]! > 1e-3);
  sts[sts.length - 1] = total;
  return { name, H, total, pvis, line: sts.map((s) => [...xy(s), zAt(s)] as XYZ), xy, notes };
}
