/**
 * Parsons road profiles (ROD-DWG-40000, block "Xref Al Qairawan Profiles"): one profile view per road
 * (long roads split over two), each with a title (RD_C_PROF_TITL), station labels (RD_C_PROF_STN-MAJR),
 * a level grid (RD_C_PROF_TEXT-GRID), the finished-grade line FG (RD_C_PROF_FG) and PVI / curve labels
 * (RD_C_PROF_LABL). Horizontal scale 1, vertical exaggeration 10 in Al Qairawan.
 */
import { cleanText, type DxfEnt } from "./dxf-block.js";

export interface ProfileView {
  name: string;
  tx: number;
  ty: number;
  datum: number;
  k: number;
  ve: number;
  s0: number | undefined;
  send: number | undefined;
  smaxLabel: number;
  nfg: number;
  /** PGL row labels checked against the FG line, and the largest difference (m) */
  nchk: number;
  maxd: number | null;
  /** FG line as [station, level] */
  pts: [number, number][];
}

interface Txt { x: number; y: number; t: string }
const texts = (ents: DxfEnt[], layer: string, para = " "): Txt[] =>
  ents.filter((o) => o.layer === layer && o.txt).map((o) => ({ x: o.x[0]!, y: o.y[0]!, t: cleanText(o.txt, para) }));

/**
 * The label window of a profile view: from its title to the next title on the row (x), from the
 * station row up to the next title above. The last view of a row searched 2 km sideways and could take
 * a title of the next zone column as its top, leaving a window too short for the level grid (R.3.G.4,
 * R.10.G.1): then the title straight above is used.
 */
function windowOf(names: Txt[], n: Txt, sideways: number): { next: Txt | undefined; rowY: number; top: number } {
  // titles of one row may differ by a few metres in height (Namar RD-29 stands 2.6 m above RD-28)
  const next = names.filter((o) => Math.abs(o.y - n.y) < 5 && o.x > n.x + 1).sort((a, b) => a.x - b.x)[0];
  const rowY = n.y - 16;
  const right = next ? next.x : n.x + sideways;
  let above = names.filter((o) => o.x < right - 20 && o.x > n.x - 200 && o.y > n.y + 1).sort((a, b) => a.y - b.y)[0];
  if (above && above.y - 20 < rowY + 50) above = names.filter((o) => Math.abs(o.x - n.x) < 100 && o.y > n.y + 1).sort((a, b) => a.y - b.y)[0];
  return { next, rowY, top: above ? above.y - 20 : rowY + 500 };
}

export function readProfileViews(ents: DxfEnt[]): { views: ProfileView[]; errors: string[] } {
  const titles = texts(ents, "RD_C_PROF_TITL");
  const names = titles.filter((o) => !/^Datum/.test(o.t));
  const datums = titles.filter((o) => /^Datum/.test(o.t));
  const stn = texts(ents, "RD_C_PROF_STN-MAJR").filter((o) => /^\d+\+\d+(\.\d+)?$/.test(o.t)).map((o) => {
    const [a, b] = o.t.split("+");
    return { ...o, s: +a! * 1000 + +b! };
  });
  const grid = texts(ents, "RD_C_PROF_TEXT-GRID").map((o) => ({ x: o.x, y: o.y, v: +o.t })).filter((o) => isFinite(o.v) && o.v > 500);
  const fgt = texts(ents, "RD_C_PROF_TEXT-FG");
  const fg = ents.filter((o) => o.layer === "RD_C_PROF_FG" && o.type === "LWPOLYLINE");
  const views: ProfileView[] = [], errors: string[] = [];
  for (const n of names) {
    const d = datums.find((o) => Math.abs(o.y - (n.y - 6)) < 1 && Math.abs(o.x - (n.x + 14)) < 2);
    const datum = d ? +d.t.replace(/[^\d.]/g, "") : NaN;
    const { next, rowY, top } = windowOf(names, n, 2000);
    const xmax = next ? next.x : Infinity;
    const st = stn.filter((o) => Math.abs(o.y - rowY) < 1 && o.x > n.x && o.x < xmax).sort((a, b) => a.x - b.x);
    const reg = st.filter((o) => Math.abs(o.s / 25 - Math.round(o.s / 25)) < 1e-6);
    if (!reg.length) { errors.push(`${n.t} no stations`); continue; }
    // Scale and origin from all the regular station labels, by median: Namar's first label of each view
    // (0+000, 0+500) stands ~1 m right of its tick while the others sit on theirs (ROD-40000, 10-2026).
    // The last label of a view can stand off its tick too (RD-M-01 0+525 at +561.2, tick at +569.0): the
    // scale is the median step; with only two steps (short views, 0+000..0+050) the second label to the last.
    const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[b.length >> 1]! : NaN; };
    const steps = reg.slice(1).map((o, i) => (o.s - reg[i]!.s) / (o.x - reg[i]!.x)).filter((v) => isFinite(v) && v > 0);
    const ka = reg.length >= 3 ? reg[1]! : reg[0]!, kb = reg[reg.length - 1]!;
    const k = steps.length >= 3 ? med(steps) : reg.length >= 2 && kb.x !== ka.x ? (kb.s - ka.s) / (kb.x - ka.x) : 1;
    const s0 = reg[0]!.s, x0 = med(reg.map((o) => o.x - (o.s - s0) / k));
    const cols: Record<number, { x: number; y: number; v: number }[]> = {};
    for (const o of grid) {
      if (o.y <= rowY || o.y > top) continue;
      if (o.x > x0 + 1 || o.x < x0 - 40) continue;
      (cols[Math.round(o.x)] ??= []).push(o);
    }
    const col = Object.entries(cols).sort((a, b) => +b[0] - +a[0])[0];
    if (!col || col[1].length < 2) { errors.push(`${n.t} no grid`); continue; }
    const gg = col[1].sort((a, b) => a.y - b.y);
    const ve = (gg[gg.length - 1]!.y - gg[0]!.y) / (gg[gg.length - 1]!.v - gg[0]!.v);
    const xEnd = st[st.length - 1]!.x;
    // the FG line only has to stay left of the next view's title (its own line starts ~54 m right of
    // that title); a 20 m margin cut off lines ending close to it (R.14.G.9, R.8.G.4). Up to 50 m past the
    // last station label: Namar's labels stop up to 43 m before the road's end (RD-01: 0+475, road 518 m).
    const f = fg.filter((o) => o.x.every((x) => x >= x0 - s0 / k - 0.5 && x <= xEnd + 50 && x < xmax) && o.y.every((y) => y > rowY && y < top) && o.x[0]! < xmax);
    const viaGrid = Math.abs(ve - 10) < 0.01;
    const zf = (y: number) => (viaGrid ? gg[0]!.v + (y - gg[0]!.y) / ve : datum + (y - (rowY + 5)) / 10);
    const pts = f.flatMap((o) => o.x.map((x, i) => [s0 + (x - x0) * k, zf(o.y[i]!)] as [number, number])).sort((a, b) => a[0] - b[0]);
    // check against the PGL ELEVATION row printed under the view
    const pglHdr = fgt.find((o) => o.t === "PGL ELEVATION" && Math.abs(o.x - (n.x - 0.3)) < 2 && o.y < rowY && o.y > rowY - 60);
    let maxd: number | null = null, nchk = 0;
    if (pglHdr && pts.length) {
      const row = fgt.filter((o) => Math.abs(o.y - pglHdr.y) < 0.5 && o.x > n.x + 5 && o.x < xmax && /^\d+\.\d+$/.test(o.t));
      for (const r of row) {
        const s = s0 + (r.x - 0.6 - x0) * k;
        const z = levelAt(pts, s);
        if (z !== null) { nchk++; const dd = Math.abs(z - +r.t); if (maxd === null || dd > maxd) maxd = dd; }
      }
    }
    views.push({ name: n.t, tx: +n.x.toFixed(1), ty: +n.y.toFixed(1), datum, k: +k.toFixed(4), ve: +ve.toFixed(3), s0: pts[0]?.[0], send: pts[pts.length - 1]?.[0], smaxLabel: st[st.length - 1]!.s, nfg: f.length, nchk, maxd, pts });
  }
  return { views, errors };
}

/** Level of a [station, level] polyline at station s (null outside it). */
export function levelAt(pts: readonly (readonly [number, number])[], s: number): number | null {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (a[0] <= s + 1e-6 && b[0] >= s - 1e-6) return b[0] === a[0] ? a[1] : a[1] + ((b[1] - a[1]) * (s - a[0])) / (b[0] - a[0]);
  }
  return null;
}

export interface Pvi {
  s: number;
  z?: number | null;
  L: number;
  K?: number;
  pvc?: [number, number];
  pvt?: [number, number];
  mis?: number;
  gin?: number;
  gout?: number;
  err?: string;
  fromFG?: boolean;
  pvcFromFG?: boolean;
  gradesFromFG?: boolean;
}

export interface PviResult {
  roads: Record<string, Pvi[]>;
  /** roads with labels of the neighbouring profile dropped, and how many */
  dropped: Record<string, number>;
  issues: string[];
}

const sta = (t: string) => { const m = t.match(/(\d+)\+(\d+(?:\.\d+)?)/); return m ? +m[1]! * 1000 + +m[2]! : NaN; };

/**
 * PVIs and vertical curves per road from the profile labels: fixed points "STA .. | ELEV ..", split
 * STA / ELEV labels, curves "PVI", "VC <L>, K <K>", "PVC .. ELEV", "PVT .. ELEV". A curve's PVI level
 * lies where the tangents through the neighbouring printed levels meet. Every label is checked against
 * the road's own FG line: the neighbouring profile on the same sheet falls inside the label window
 * (R.3.G.6 carried R.2.F.5's PVIs at 294/349/353 m).
 */
export function assemblePvis(ents: DxfEnt[], views: ProfileView[]): PviResult {
  const lab = texts(ents, "RD_C_PROF_LABL", " | ");
  const names = texts(ents, "RD_C_PROF_TITL", " | ").filter((o) => !/^Datum/.test(o.t));
  type Fixed = { s: number; z: number; split?: boolean };
  type Curve = { s: number; L: number | undefined; K: number | undefined; pvc?: { s: number; z: number }; pvt?: { s: number; z: number } };
  const out: Record<string, { fixed: Fixed[]; curves: Curve[] }[]> = {};
  for (const n of names) {
    const { next, rowY, top } = windowOf(names, n, 3000);
    const xmax = next ? next.x : n.x + 3000;
    const L = lab.filter((o) => o.x > n.x && o.x < xmax && o.y > rowY && o.y < top);
    const fixed: Fixed[] = L.filter((o) => /^STA .*\| ELEV/.test(o.t)).map((o) => ({ s: sta(o.t), z: +o.t.split("ELEV")[1]! }));
    const lone = L.filter((o) => /^STA [\d+.]+$/.test(o.t)), elev = L.filter((o) => /^ELEV [\d.]+$/.test(o.t));
    for (const s of lone) {
      const e = elev.filter((o) => Math.abs(o.y - s.y) < 0.6 && Math.abs(o.x - s.x) < 30).sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
      if (e) fixed.push({ s: sta(s.t), z: +e.t.slice(5), split: true });
    }
    // "PVC 0+045.188 ELEV 673.594" in one label, or (Al Narjis, a label EXPORTTOAUTOCAD split into
    // TEXTs) "PVC 0+045.188" with "ELEV 673.594" beside it on the same line, ~6 m to the right
    const levelOf = (o: Txt) => {
      if (o.t.includes("ELEV")) return +o.t.split("ELEV")[1]!;
      const e = elev.filter((q) => Math.abs(q.y - o.y) < 0.6 && q.x > o.x && q.x - o.x < 30).sort((a, b) => a.x - b.x)[0];
      return e ? +e.t.slice(5) : NaN;
    };
    const pvc = L.filter((o) => /^PVC/.test(o.t)).map((o) => ({ s: sta(o.t), z: levelOf(o), x: o.x, y: o.y }));
    const pvt = L.filter((o) => /^PVT/.test(o.t)).map((o) => ({ s: sta(o.t), z: levelOf(o), x: o.x, y: o.y }));
    const pvi = L.filter((o) => /^PVI/.test(o.t)).map((o) => ({ s: sta(o.t), x: o.x, y: o.y }));
    const vc = L.filter((o) => /^VC/.test(o.t)).map((o) => ({ L: +o.t.match(/VC\s*([\d.]+)/)![1]!, K: +o.t.match(/K\s*([\d.]+)/)![1]!, x: o.x, y: o.y }));
    const curves: Curve[] = pvi.map((p) => {
      const v = vc.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      const c = v ? pvc.find((q) => Math.abs(q.s - (p.s - v.L / 2)) < 0.01) : undefined;
      const t = v ? pvt.find((q) => Math.abs(q.s - (p.s + v.L / 2)) < 0.01) : undefined;
      return { s: p.s, L: v && v.L, K: v && v.K, pvc: c, pvt: t };
    });
    (out[n.t] ??= []).push({ fixed, curves });
  }
  const roads: Record<string, Pvi[]> = {}, dropped: Record<string, number> = {};
  for (const [name, vs] of Object.entries(out)) {
    const pts: Pvi[] = [];
    for (const v of vs) {
      v.fixed.forEach((f) => pts.push({ s: f.s, z: f.z, L: 0 }));
      v.curves.forEach((c) => {
        if (!c.pvc || !c.pvt) { pts.push({ s: c.s, z: null, L: c.L!, err: "no PVC/PVT" }); return; }
        pts.push({ s: c.s, L: c.L!, K: c.K!, pvc: [c.pvc.s, c.pvc.z], pvt: [c.pvt.s, c.pvt.z] });
      });
    }
    pts.sort((a, b) => a.s - b.s);
    let u: Pvi[] = [];
    for (const p of pts) { const q = u.find((o) => Math.abs(o.s - p.s) < 0.001); if (!q) u.push(p); else if (p.L && !q.L) Object.assign(q, p); }
    const fg = views.filter((p) => p.name === name).flatMap((v) => v.pts).sort((a, b) => a[0] - b[0]);
    const zfg = (s: number) => levelAt(fg, s);
    // a curve without printed PVC / PVT labels (R.14.G.11, R.7.G.8): their levels read on the FG line
    for (const p of u) if (p.L && p.err === "no PVC/PVT" && fg.length) {
      const a = zfg(p.s - p.L / 2), b = zfg(p.s + p.L / 2);
      if (a != null && b != null) { p.pvc = [+(p.s - p.L / 2).toFixed(3), +a.toFixed(3)]; p.pvt = [+(p.s + p.L / 2).toFixed(3), +b.toFixed(3)]; p.pvcFromFG = true; delete p.err; delete p.z; }
    }
    if (fg.length) {
      const ok = (s: number, z: number) => { const f = zfg(s); return f == null || Math.abs(f - z) <= 0.05; };
      const lo = fg[0]![0] - 0.01, hi = fg[fg.length - 1]![0] + 0.01, n0 = u.length;
      u = u.filter((p) => p.s >= lo && p.s <= hi && (p.L ? (!p.pvc || ok(p.pvc[0], p.pvc[1])) && (!p.pvt || ok(p.pvt[0], p.pvt[1])) : p.z == null || ok(p.s, p.z)));
      if (u.length < n0) dropped[name] = n0 - u.length;
      if (!u.some((p) => Math.abs(p.s - fg[0]![0]) < 0.01 && p.z != null)) u.unshift({ s: +fg[0]![0].toFixed(3), z: +fg[0]![1].toFixed(3), L: 0, fromFG: true });
      if (!u.some((p) => Math.abs(p.s - fg[fg.length - 1]![0]) < 0.01 && p.z != null)) u.push({ s: +fg[fg.length - 1]![0].toFixed(3), z: +fg[fg.length - 1]![1].toFixed(3), L: 0, fromFG: true });
    }
    u.sort((a, b) => a.s - b.s);
    const before = (i: number): [number, number] | null => { for (let k = i - 1; k >= 0; k--) { const q = u[k]!; if (q.pvt) return [q.pvt[0], q.pvt[1]]; if (q.z != null && !q.L) return [q.s, q.z]; } return null; };
    const after = (i: number): [number, number] | null => { for (let k = i + 1; k < u.length; k++) { const q = u[k]!; if (q.pvc) return [q.pvc[0], q.pvc[1]]; if (q.z != null && !q.L) return [q.s, q.z]; } return null; };
    for (let i = 0; i < u.length; i++) {
      const p = u[i]!;
      if (!p.pvc || !p.pvt) continue;
      const a = before(i), b = after(i);
      if (!a || !b) { p.err = "no anchor"; continue; }
      const gin = (p.pvc[1] - a[1]) / (p.pvc[0] - a[0]), gout = (b[1] - p.pvt[1]) / (b[0] - p.pvt[0]);
      const z1 = p.pvc[1] + gin * (p.s - p.pvc[0]), z2 = p.pvt[1] + gout * (p.s - p.pvt[0]);
      p.z = +((z1 + z2) / 2).toFixed(4); p.mis = Math.abs(z1 - z2); p.gin = gin; p.gout = gout;
      // neighbouring anchors are not always the tangent points (a grade break without a label between,
      // R.0.C.1): take the grades of the FG line just outside the curve (2 m), kept if they agree better
      if (p.mis > 0.005 && fg.length) {
        const fa = zfg(p.pvc[0] - 2), fb = zfg(p.pvt[0] + 2), fc = zfg(p.pvc[0]), fd = zfg(p.pvt[0]);
        if (fa != null && fb != null && fc != null && fd != null) {
          const gi = (fc - fa) / 2, go = (fb - fd) / 2, y1 = p.pvc[1] + gi * (p.s - p.pvc[0]), y2 = p.pvt[1] + go * (p.s - p.pvt[0]);
          if (Math.abs(y1 - y2) < p.mis) { p.z = +((y1 + y2) / 2).toFixed(4); p.mis = Math.abs(y1 - y2); p.gin = gi; p.gout = go; p.gradesFromFG = true; }
        }
      }
    }
    roads[name] = u;
  }
  const issues: string[] = [];
  for (const [name, u] of Object.entries(roads)) {
    const fg = views.filter((p) => p.name === name).map((v) => v.pts);
    for (const p of u) {
      if (p.z == null) { issues.push(`${name} ${p.s} ${p.err || "no level"}`); continue; }
      if (p.L) { if ((p.mis ?? 0) > 0.005) issues.push(`${name} PVI ${p.s}: tangents disagree by ${p.mis!.toFixed(3)}`); continue; }
      if (p.fromFG) continue;
      const f = fg.map((pts) => levelAt(pts, p.s)).find((z) => z != null);
      if (f != null && Math.abs(f - p.z) > 0.005) issues.push(`${name} ${p.s}: label ${p.z} vs FG ${f.toFixed(3)}`);
    }
  }
  return { roads, dropped, issues };
}
