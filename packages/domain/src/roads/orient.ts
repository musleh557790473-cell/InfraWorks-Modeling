/**
 * Chainage direction and loop starts, checked against Parsons' grading surface and the levels at
 * junctions. The profile laid along the alignment should follow the surface at a steady offset (the
 * pavement); a road end lying on another road's centreline should share its level.
 */
import { at, first, last, nearestOn, reverseSegs, type P3, type Seg } from "./geometry.js";
import type { Alignment } from "./alignments.js";
import type { Pvi } from "./profiles.js";
import type { SurfaceZ } from "./surface.js";

export interface OrientResult {
  /** names of roads reversed (chained from the wrong end) */
  reversed: string[];
  /** loop roads given a new start, with the fit before and after (m) */
  restarted: { name: string; before: number; after: number }[];
  /** one line per road: spread as chained / reversed, junction steps, decision */
  report: string[];
}

type Levelled = { s: number; z: number }[];
const levelled = (pv: Pvi[] | undefined): Levelled | null => (pv && pv.every((p) => p.z != null) ? (pv as Levelled) : null);
const prof = (pv: Levelled, s: number) => {
  for (let i = 1; i < pv.length; i++) if (s <= pv[i]!.s + 1e-9) { const a = pv[i - 1]!, b = pv[i]!; return a.z + ((b.z - a.z) * (s - a.s)) / (b.s - a.s); }
  return last(pv).z;
};

/** Mutates the alignments in place (segments reversed or rotated). */
export function orientRoads(roads: Alignment[], pvis: Record<string, Pvi[]>, surface: SurfaceZ): OrientResult {
  // spread of (profile - surface) around its median: small when the profile follows the surface
  const spread = (segs: Seg[], pv: Levelled, L: number): number | null => {
    const d: number[] = [];
    for (let s = Math.min(15, L / 4); s <= L - Math.min(15, L / 4); s += 5) {
      const q = at(segs, s); if (!q) continue;
      const t = surface(q.p[0], q.p[1]); if (t != null) d.push(prof(pv, s) - t);
    }
    if (d.length < 3) return null;
    const m = d.slice().sort((a, b) => a - b)[d.length >> 1]!;
    return d.reduce((a, v) => a + Math.abs(v - m), 0) / d.length;
  };
  const poly = (segs: Seg[], pv: Levelled, L: number): P3[] => {
    const p: P3[] = [];
    for (let s = 0; s <= L + 1e-9; s += Math.min(2, L)) { const q = at(segs, Math.min(s, L)); if (q) p.push([q.p[0], q.p[1], prof(pv, Math.min(s, L))]); }
    return p;
  };
  const lines = new Map<string, P3[]>();
  for (const r of roads) { const pv = levelled(pvis[r.name]); if (pv) lines.set(r.name, poly(r.segs, pv, r.length)); }
  // summed level step at this road's two ends against the roads they sit on (null: no junction)
  const junctionStep = (name: string, segs: Seg[], pv: Levelled, L: number): number | null => {
    const p = poly(segs, pv, L); let sum = 0, n = 0;
    for (const x of [first(p), last(p)]) for (const [o, q] of lines) {
      if (o === name) continue;
      const m = nearestOn(q, x); if (m && m.d < 1.0) { sum += Math.abs(x[2] - m.z); n++; }
    }
    return n ? sum : null;
  };
  // Loop roads (start = end): the 0+000 tick nearest a vertex may belong to a neighbour, so try every
  // vertex as the start, both ways, and keep the one whose profile follows the surface (R.2.G.5);
  // among starts that fit about as well, the one matching the roads ending on the loop (R.1.G.23)
  const closed = (segs: Seg[]) => Math.hypot(first(segs).a[0] - last(segs).b[0], first(segs).a[1] - last(segs).b[1]) < 0.05;
  const restarted: OrientResult["restarted"] = [];
  for (const r of roads) {
    const pv = levelled(pvis[r.name]); if (!pv || !closed(r.segs)) continue;
    const now = spread(r.segs, pv, r.length); if (now == null || now <= 0.3) continue;
    const cands: { s: Seg[]; v: number; j?: number }[] = [];
    for (let k = 0; k < r.segs.length; k++) {
      const s = [...r.segs.slice(k), ...r.segs.slice(0, k)];
      for (const c of [s, reverseSegs(s)]) { const v = spread(c, pv, r.length); if (v != null) cands.push({ s: c, v }); }
    }
    let best: { s: Seg[]; v: number; j?: number } = { s: r.segs, v: now };
    for (const c of cands) if (c.v < best.v) best = c;
    const step = (s: Seg[]) => { const q = poly(s, pv, r.length); let sum = 0; for (const [o, l] of lines) { if (o === r.name) continue; for (const x of [first(l), last(l)]) { const m = nearestOn(q, x); if (m && m.d < 1.0) sum += Math.abs(x[2] - m.z); } } return sum; };
    const close = cands.filter((c) => c.v < best.v + 0.05);
    if (close.length > 1) { close.forEach((c) => (c.j = step(c.s))); const bj = close.sort((a, b) => a.j! - b.j!)[0]!; if (bj.j! < step(best.s) - 0.05) best = bj; }
    if (best.v < 0.3 && best.v < now / 3) { restarted.push({ name: r.name, before: now, after: best.v }); r.segs = best.s; lines.set(r.name, poly(r.segs, pv, r.length)); }
  }
  // A reversal changes the junction evidence of the roads meeting the reversed one (R.10.G.2 was
  // kept while R.0.D.1 was still backwards, then clearly reversed): repeat until nothing changes.
  const reversed: string[] = [];
  let report: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    report = [];
    const before = reversed.length;
    for (const r of roads) {
      const pv = levelled(pvis[r.name]); if (!pv) continue;
      const fwd = spread(r.segs, pv, r.length), rev = spread(reverseSegs(r.segs), pv, r.length);
      if (fwd == null || rev == null) continue;
      const jf = junctionStep(r.name, r.segs, pv, r.length), jr = junctionStep(r.name, reverseSegs(r.segs), pv, r.length);
      // the surface says reverse (R.0.D.15: road rising 6 m where the surface falls 6 m) unless that
      // breaks a junction (R.13.G.5); junctions alone decide when clear (R.4.G.6: end levels swapped)
      const surfaceSays = fwd > 0.3 && rev < fwd / 3, junctionsAgree = jf == null || (jr ?? 0) <= jf + 0.05;
      const junctionsSay = jf != null && jr != null && jf > 0.3 && jr < 0.05;
      const flip = (surfaceSays && junctionsAgree) || junctionsSay;
      report.push(`${r.name}\t${fwd.toFixed(3)}\t${rev.toFixed(3)}\tjunctions ${jf == null ? "-" : jf.toFixed(2)} / ${jr == null ? "-" : jr.toFixed(2)}${flip ? "\tREVERSED" : surfaceSays ? "\tKEPT (junctions)" : fwd > 0.3 ? "\tCHECK" : ""}`);
      if (flip) { reversed.push(r.name); r.segs = reverseSegs(r.segs); lines.set(r.name, poly(r.segs, pv, r.length)); }
    }
    if (reversed.length === before) break;
  }
  return { reversed, restarted, report };
}
