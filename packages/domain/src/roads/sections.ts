/**
 * Parsons typical sections (LDIP-RCRC-SAP-01-AQ-ROD-DWG-30000-001) as InfraWorks component styles,
 * the type of each road from its right-of-way width, and the side of a local road's one-way crossfall.
 *
 * Sources: lane 3.30, kerb 0.30 (ROD-30000-001); kerb upstand 150 mm, carriageway crossfall 2.0 %,
 * sidewalk 2.0 % towards the road, design speed 20 km/h local / 40 km/h collector (design report
 * LDIP-RCRC-SAP-01-AQ-DES-RPT-00001). Median (B1/C1/C2): P.G.L. is the asphalt edge at the median kerb
 * (AICC, from the C1 detail), so the lanes start at the profile level and the median is raised by
 * upstand kerbs; median kerb width taken as the 0.30 road kerb of the same drawing.
 */
import type { DxfEnt } from "./dxf-block.js";
import { at, type P2, type Seg } from "./geometry.js";
import type { Alignment } from "./alignments.js";
import type { SurfaceZ } from "./surface.js";

export type SectionType = "A1" | "A2" | "A3" | "B1" | "C1" | "C2";
export const SECTION_TYPES: Record<SectionType, { kind: "local" | "collector"; row: number; sidewalk: number; median?: number }> = {
  A1: { kind: "local", row: 15, sidewalk: 3.9 },
  A2: { kind: "local", row: 18, sidewalk: 5.4 },
  A3: { kind: "local", row: 20, sidewalk: 6.4 },
  B1: { kind: "collector", row: 25, median: 1.2, sidewalk: 4.6 },
  C1: { kind: "collector", row: 30, median: 4.0, sidewalk: 5.7 },
  C2: { kind: "collector", row: 36, median: 4.0, sidewalk: 8.7 },
};
const LANE = 3.3, SHY = 0.4, KERB_W = 0.3, XFALL = 0.02, SW_FALL = 0.02;
const MAT: Record<string, string> = { lane: "x7F7F7FFF", shy: "x7F7F7FFF", kerb: "xB0B0B0FF", sidewalk: "x909090FF", median: "xA0A0A0FF" };
const ORIGIN = 4294967295;

type Params = Record<string, number>;
type XY = [number, number];
// Component definitions (InfraWorks defaults unless overridden, ProgramData\Autodesk\InfraWorks\
// Resources\LocalLibrary\Styles\ComponentDefinition): local coordinates; an attachment is an index.
const DEF: Record<string, (p: Params) => XY[]> = {
  Lane: (p) => { const s = p.LeftSideFactor ?? 1, W = p.Width!, Y = p.Slope! * W, D = p.Depth ?? 0.2; return [[0, 0], [s * W, Y], [s * W, Y - D], [0, -D]]; },
  Sidewalk: (p) => { const s = p.LeftSideFactor ?? 1, W = p.Width!, Y = p.Slope! * W, D = p.Depth ?? 0.1; return [[0, 0], [s * W, Y], [s * W, Y - D], [0, -D]]; },
  Curb: (p) => {
    const s = p.LeftSideFactor ?? 1, W = p.Width ?? 0.225, Dp = p.Depth ?? 0.45, Db = p.DepthBelow ?? 0.3, H = Dp - Db;
    return [[0, -Db], [0, 0], [0, H], [s * W, H], [s * W, H - (p.BackHeight ?? 0)], [s * W, -Db]];
  },
  "Sloped Median": (p) => { const h = p.Width! / 2, G = (p.Slope ?? -0.03) * h, D = p.Depth ?? 0.2; return [[-h, 0], [0, G], [h, 0], [h, -D], [0, G - D], [-h, -D]]; },
};
const TOP: Record<string, number[]> = { Lane: [0, 1], Sidewalk: [0, 1], Curb: [2, 3], "Sloped Median": [0, 1, 2] };

export interface SectionPart { role: string; id: number; material: string; crossSection: [number, number, number?][] }
export interface Section {
  /** typical section, or "RA" for a roundabout ring */
  type: SectionType | "RA";
  kind: "local" | "collector" | "roundabout";
  /** design speed (km/h); null keeps the template road's speed (none documented) */
  speed: number | null;
  lanes: number;
  parts: SectionPart[];
  /** top boundary points across the section (offset right of the chainage, level) */
  bound: XY[];
  componentStyle: unknown;
  /** offsets of lane marking lines */
  marking: number[];
  width: number;
}

let nextId = 300000000 + Math.floor(Math.random() * 100000000);

/**
 * fall: side a local road's one-way crossfall falls to, looking up-chainage ("right" as the typical
 * section is drawn, or "left"), read per road from the grading surface by crossfallSides().
 */
type Comp = { def: string; params: Params; attach: { point: number; ex_comp: number; ex_point: number } | null; role: string };
const builder = () => {
  const comps: Comp[] = [];
  const add = (def: string, params: Params, attach: Comp["attach"], role: string) => { comps.push({ def, params: { ...params, COMPONENT_ID: nextId++ }, attach, role }); return comps.length - 1; };
  return { comps, add };
};

export function buildSection(type: SectionType, opts: { fall?: "right" | "left" } = {}): Section {
  const T = SECTION_TYPES[type];
  const f = opts.fall === "left" ? -1 : 1;
  const { comps, add } = builder();
  for (const side of [-1, 1]) {
    const L: Params = side < 0 ? { LeftSideFactor: -1 } : {};
    let lastC: number;
    if (T.kind === "local") {
      // one-way crossfall across both lanes (falls to the right of the chainage direction when f = 1)
      lastC = add("Lane", { ...L, Width: LANE, Slope: (side < 0 ? XFALL : -XFALL) * f, Depth: 0.2 }, { point: 0, ex_comp: ORIGIN, ex_point: ORIGIN }, "lane");
    } else {
      // median: flat base at the profile level, then on each edge an upstand kerb facing the lanes and
      // a raised fill to the centre, top 150 mm above the lanes
      if (side < 0) add("Sloped Median", { Width: T.median!, Slope: 0, Depth: 0.2 }, null, "median");
      const inward: Params = side < 0 ? {} : { LeftSideFactor: -1 }, edgePt = side < 0 ? 0 : 2;
      const mk = add("Curb", { ...inward, Width: KERB_W }, { point: 1, ex_comp: 0, ex_point: edgePt }, "kerb");
      add("Sidewalk", { ...inward, Width: T.median! / 2 - KERB_W, Slope: 0, Depth: 0.15 }, { point: 0, ex_comp: mk, ex_point: 4 }, "median");
      lastC = add("Lane", { ...L, Width: SHY, Slope: -XFALL, Depth: 0.2 }, { point: 0, ex_comp: 0, ex_point: edgePt }, "shy");
      lastC = add("Lane", { ...L, Width: LANE, Slope: -XFALL, Depth: 0.2 }, { point: 0, ex_comp: lastC, ex_point: 1 }, "lane");
      lastC = add("Lane", { ...L, Width: LANE, Slope: -XFALL, Depth: 0.2 }, { point: 0, ex_comp: lastC, ex_point: 1 }, "lane");
    }
    const kerb = add("Curb", { ...L, Width: KERB_W }, { point: 1, ex_comp: lastC, ex_point: 1 }, "kerb");
    add("Sidewalk", { ...L, Width: T.sidewalk, Slope: SW_FALL, Depth: 0.1 }, { point: 0, ex_comp: kerb, ex_point: 4 }, "sidewalk");
  }
  const lanes = T.kind === "local" ? 1 : 2;
  return assemble(comps, { type, kind: T.kind, speed: T.kind === "local" ? 20 : 40, lanes, marking: T.kind === "local" ? [0] : [] });
}

/**
 * Roundabout ring (RA-1..RA-7). Parsons draws the RA alignment on the outer carriageway edge
 * (10200: outer edge arcs at the alignment radius 20.2 m, central island CIRCLE r 12.0 on
 * -RD_Edges), so the whole carriageway lies on the island side of the alignment. Width from
 * measureRoundabouts(). Kerbs as in the typical section (ROD-30000-001: 0.30 m, 150 mm upstand) on
 * both edges. Crossfall 0 % (the ring follows its profile): Parsons gives none and the grading
 * surface is a tilted plane across the ring; AICC decision 3 Nov 2026, pending Parsons.
 */
export function buildRoundaboutSection(width: number, island: "left" | "right"): Section {
  if (!(width > 0)) throw new Error(`roundabout width must be positive (got ${width})`);
  const { comps, add } = builder();
  const inS: Params = island === "left" ? { LeftSideFactor: -1 } : {}, outS: Params = island === "left" ? {} : { LeftSideFactor: -1 };
  const lane = add("Lane", { ...inS, Width: width, Slope: 0, Depth: 0.2 }, { point: 0, ex_comp: ORIGIN, ex_point: ORIGIN }, "lane");
  add("Curb", { ...inS, Width: KERB_W }, { point: 1, ex_comp: lane, ex_point: 1 }, "kerb");
  add("Curb", { ...outS, Width: KERB_W }, { point: 1, ex_comp: lane, ex_point: 0 }, "kerb");
  return assemble(comps, { type: "RA", kind: "roundabout", speed: null, lanes: 1, marking: [] });
}

function assemble(comps: Comp[], o: { type: Section["type"]; kind: Section["kind"]; speed: number | null; lanes: number; marking: number[] }): Section {
  // place every component (attachments always point to earlier components)
  const placed: (Comp & { pts: XY[] })[] = [];
  comps.forEach((c, i) => {
    const local = DEF[c.def]!(c.params);
    let dx = 0, dy = 0;
    if (c.attach && c.attach.ex_comp !== ORIGIN) { const host = placed[c.attach.ex_comp]!.pts[c.attach.ex_point]!, me = local[c.attach.point]!; dx = host[0] - me[0]; dy = host[1] - me[1]; }
    placed[i] = { ...c, pts: local.map(([x, y]) => [x + dx, y + dy] as XY) };
  });
  // InfraWorks' cached cross-section rings: ascending x, codes 202 (first), 2 ... 3 (top), 201, closing point
  const ring = (pts0: XY[]): [number, number, number?][] => {
    const pts = pts0.filter((p, k) => pts0.findIndex((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) === k);
    const xs = pts.map((p) => p[0]), lo = Math.min(...xs), hi = Math.max(...xs);
    const sameX = (p: XY) => pts.filter((q) => Math.abs(q[0] - p[0]) < 1e-9);
    const upper = pts.filter((p) => (p[1] >= Math.min(...sameX(p).map((q) => q[1])) && sameX(p).length === 1) || p[1] === Math.max(...sameX(p).map((q) => q[1])));
    const ups = upper.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const bl: XY = [lo, Math.min(...pts.filter((p) => Math.abs(p[0] - lo) < 1e-9).map((p) => p[1]))];
    const br: XY = [hi, Math.min(...pts.filter((p) => Math.abs(p[0] - hi) < 1e-9).map((p) => p[1]))];
    return [[...bl, 202], ...ups.map((p, k) => [...p, k === ups.length - 1 ? 3 : 2] as [number, number, number]), [...br, 201], bl];
  };
  const parts = placed.map((c) => ({ role: c.role, id: c.params.COMPONENT_ID!, material: MAT[c.role]!, crossSection: ring(c.pts) }));
  // top boundary points across the section: the highest top at each offset
  const tops: XY[] = [];
  placed.forEach((c) => TOP[c.def]!.forEach((k) => tops.push(c.pts[k]!)));
  const hi = new Map<string, XY>();
  for (const p of tops) { const k = p[0].toFixed(4); if (!hi.has(k) || p[1] > hi.get(k)![1]) hi.set(k, p); }
  const bound = [...hi.values()].sort((a, b) => a[0] - b[0]);
  const references = placed.map((c) => ({
    def: `ComponentDefinition/${c.def}`, material: MAT[c.role], description: c.role,
    classification: c.role === "sidewalk" ? "Sidewalk" : c.role === "kerb" ? "Curb" : c.role === "median" ? "Greenspace" : "Roadway",
    ...(c.attach ? { attachment: c.attach } : {}),
    paramOverrides: Object.entries(c.params).map(([name, value]) => ({ name, value })),
  }));
  const lanes = o.lanes;
  const componentStyle = { styleType: "Component", showMarking: true, revision: 1, references, migrationInfo: { MANUAL_STYLE: "", LANES_FORWARD: lanes, LANES_BACKWARD: lanes } };
  return { type: o.type, kind: o.kind, speed: o.speed, lanes, parts, bound, componentStyle, marking: o.marking, width: bound[bound.length - 1]![0] - bound[0]![0] };
}

export interface Roundabout {
  name: string;
  centre: P2;
  /** radius of the RA alignment */
  radius: number;
  /** central island CIRCLE on -RD_Edges */
  island: number;
  /** concentric outer edge arcs on -RD_Edges (radius carrying the most arc angle) */
  outer: number;
  /** arc angle (degrees) of the outer edge drawn between the arms */
  outerDeg: number;
  width: number;
  /** side of the island looking along the chainage */
  side: "left" | "right";
}

/**
 * Circulatory width of each roundabout from the road edges Parsons draws around it (AICC decision,
 * 3 Nov 2026: no roundabout detail in the drawings, take it from the drawn edges). A roundabout is a
 * road whose alignment is one closed arc; its island is the concentric CIRCLE on -RD_Edges, its outer
 * edge the concentric arcs (LWPOLYLINE bulges or ARCs) on -RD_Edges between the arms. Al Qairawan:
 * RA-1..RA-7 island 12.0, outer edge 20.2 = alignment radius, width 8.2 m.
 */
export function measureRoundabouts(layout: DxfEnt[], roads: Alignment[], tol = 0.05): { roundabouts: Roundabout[]; problems: string[] } {
  const arcOfBulge = (a: P2, b: P2, bulge: number) => {
    const th = 4 * Math.atan(bulge), c = Math.hypot(b[0] - a[0], b[1] - a[1]), r = c / (2 * Math.sin(th / 2));
    const h = r * Math.cos(th / 2), ux = (b[0] - a[0]) / c, uy = (b[1] - a[1]) / c;
    return { cx: (a[0] + b[0]) / 2 - uy * h, cy: (a[1] + b[1]) / 2 + ux * h, r: Math.abs(r), deg: (Math.abs(th) * 180) / Math.PI };
  };
  const edges = layout.filter((e) => e.layer.endsWith("RD_Edges"));
  const out: Roundabout[] = [], problems: string[] = [];
  for (const rd of roads) {
    const segs = rd.segs as Seg[];
    if (segs.length !== 1 || !segs[0]!.bulge) continue;
    const s = segs[0]!, a = arcOfBulge(s.a, s.b, s.bulge);
    if (a.deg < 359) continue; // not a closed ring
    const near = (x: number, y: number) => Math.hypot(x - a.cx, y - a.cy) < tol;
    const islands = edges.filter((e) => e.type === "CIRCLE" && e.r != null && near(e.x[0]!, e.y[0]!)).map((e) => e.r!);
    const arcs = new Map<string, number>();
    const addArc = (r: number, deg: number) => { if (Math.abs(r - a.r) > 3) return; const k = r.toFixed(3); arcs.set(k, (arcs.get(k) ?? 0) + deg); };
    for (const e of edges) {
      if (e.type === "ARC" && e.r != null && near(e.x[0]!, e.y[0]!)) addArc(e.r, 0); // angle not read: counts only when no bulge arcs
      if (e.type !== "LWPOLYLINE") continue;
      for (let i = 0; i + 1 < e.x.length; i++) {
        if (!e.bulge[i]) continue;
        const q = arcOfBulge([e.x[i]!, e.y[i]!], [e.x[i + 1]!, e.y[i + 1]!], e.bulge[i]!);
        if (near(q.cx, q.cy)) addArc(q.r, q.deg);
      }
    }
    const best = [...arcs.entries()].sort((x, y) => y[1] - x[1])[0];
    if (islands.length !== 1 || !best) { problems.push(`${rd.name}: island circles ${islands.length}, outer edge arcs ${arcs.size}`); continue; }
    const outer = +best[0], island = islands[0]!;
    out.push({ name: rd.name, centre: [a.cx, a.cy], radius: a.r, island, outer, outerDeg: best[1], width: +(outer - island).toFixed(3), side: s.bulge > 0 ? "left" : "right" });
    if (Math.abs(outer - a.r) > tol) problems.push(`${rd.name}: outer edge ${outer} is not on the alignment (R ${a.r.toFixed(3)})`);
  }
  return { roundabouts: out, problems };
}

export interface SectionClass {
  type: SectionType | null;
  oneSided?: true;
  mixed?: true;
  votes: Record<string, number>;
  samples: number;
  oneSidedSamples: number;
  edge: string | null;
}

/**
 * Section type of each road from its right-of-way width (RD_ROW) measured across the centreline every
 * 2 m (away from the ends), by majority of exact type widths. When only one ROW line is drawn (road on
 * the site edge or along open space), that side doubled (flagged oneSided). A local road whose
 * sidewalk changes along it (R.1.E.1: A3 428 samples, A1 130) takes the majority (flagged mixed).
 */
export function classifySections(layout: DxfEnt[], roads: Alignment[]): Record<string, SectionClass> {
  const segsOf = (layer: string) => layout.filter((e) => e.layer === layer && e.x.length > 1).flatMap((e) => e.x.slice(1).map((x, i) => [e.x[i]!, e.y[i]!, x, e.y[i + 1]!] as [number, number, number, number]));
  const ROW = segsOf("RD_ROW"), EDGE = segsOf("-RD_Edges");
  const TYPES = (Object.entries(SECTION_TYPES) as [SectionType, { row: number }][]).map(([t, v]) => [v.row, t] as const);
  // nearest crossing of the normal line with a segment set, on each side (within 30 m)
  const cross = (segs: [number, number, number, number][], p: P2, u: P2) => {
    const n = [-u[1], u[0]] as P2; let L: number | null = null, R: number | null = null;
    for (const [x1, y1, x2, y2] of segs) {
      const dx = x2 - x1, dy = y2 - y1, den = n[0] * dy - n[1] * dx; if (Math.abs(den) < 1e-12) continue;
      const t = ((x1 - p[0]) * dy - (y1 - p[1]) * dx) / den, v = ((x1 - p[0]) * n[1] - (y1 - p[1]) * n[0]) / den;
      if (v < -1e-9 || v > 1 + 1e-9 || Math.abs(t) > 30) continue;
      if (t > 0.5 && (L == null || t < L)) L = t;
      if (t < -0.5 && (R == null || -t < R)) R = -t;
    }
    return L != null && R != null ? { L, R, w: L + R as number | null } : L != null || R != null ? { L, R, w: null } : null;
  };
  const out: Record<string, SectionClass> = {};
  for (const r of roads) {
    const ws: number[] = [], ws1: number[] = [], es: number[] = [];
    for (let s = Math.min(12, r.length / 4); s <= r.length - Math.min(12, r.length / 4); s += 2) {
      const q = at(r.segs as Seg[], s); if (!q) continue;
      const a = cross(ROW, q.p, q.u);
      if (a && a.w != null) ws.push(a.w); else if (a) ws1.push(2 * (a.L ?? a.R!));
      const e = cross(EDGE, q.p, q.u); if (e && e.w != null) es.push(e.w);
    }
    const vote = (list: number[]) => {
      const v: Record<string, number> = {};
      for (const x of list) { const t = TYPES.find((t) => Math.abs(t[0] - x) < 0.05); if (t) v[t[1]] = (v[t[1]] || 0) + 1; }
      const rk = Object.entries(v).sort((a, b) => b[1] - a[1]);
      return { v, rk, ok: !!rk.length && rk[0]![1] >= 5 && (!rk[1] || rk[1][1] < 0.25 * rk[0]![1]) };
    };
    let { v: votes, rk: ranked, ok } = vote(ws), oneSided = false, mixed = false;
    if (!ok) { const o = vote(ws1); if (o.ok) { ({ v: votes, rk: ranked, ok } = o); oneSided = true; } }
    if (!ok && ranked.length >= 2 && ranked[0]![1] >= 5 && ranked[0]![1] > ranked[1]![1] && ranked.slice(0, 2).every(([t]) => t.startsWith("A"))) { ok = true; mixed = true; }
    const ev: Record<string, number> = {};
    for (const x of es) { const k = x.toFixed(1); ev[k] = (ev[k] || 0) + 1; }
    out[r.name] = { type: ok ? (ranked[0]![0] as SectionType) : null, ...(oneSided ? { oneSided: true as const } : {}), ...(mixed ? { mixed: true as const } : {}), votes, samples: ws.length, oneSidedSamples: ws1.length, edge: Object.entries(ev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
  }
  return out;
}

export interface Crossfall {
  type: SectionType;
  side: "right" | "left" | "crown" | "mixed" | "no data";
  /** side used for the model: the median sample's sign when it is a clear one-way fall (>= 1 %) */
  fall: "right" | "left" | null;
  xfall: number | null;
  crown: number | null;
  samples: number;
  right: number;
  left: number;
}

/**
 * Side of each road's crossfall from Parsons' grading surface, sampled 3 m each side of the
 * centreline every 5 m. The typical section does not say which side a local road's one-way fall
 * goes to; the surface carries it at exactly 2 %.
 */
export function crossfallSides(roads: Alignment[], sections: Record<string, SectionClass>, surface: SurfaceZ): Record<string, Crossfall> {
  const OFF = 3.0, out: Record<string, Crossfall> = {};
  for (const r of roads) {
    const type = sections[r.name]?.type; if (!type) continue;
    const slopes: { x: number; sym: number }[] = [];
    for (let st = Math.min(15, r.length / 4); st <= r.length - Math.min(15, r.length / 4); st += 5) {
      const q = at(r.segs, st); if (!q) continue;
      const n = [-q.u[1], q.u[0]]; // left of the chainage direction
      const zl = surface(q.p[0] + n[0]! * OFF, q.p[1] + n[1]! * OFF), zr = surface(q.p[0] - n[0]! * OFF, q.p[1] - n[1]! * OFF), zc = surface(q.p[0], q.p[1]);
      if (zl != null && zr != null && zc != null) slopes.push({ x: (zl - zr) / (2 * OFF), sym: (zl + zr) / 2 - zc });
    }
    const med = (a: number[]) => { const v = a.slice().sort((p, q) => p - q); return v.length ? v[v.length >> 1]! : null; };
    const x = med(slopes.map((v) => v.x)), sym = med(slopes.map((v) => v.sym));
    const right = slopes.filter((v) => v.x > 0.01).length, left = slopes.filter((v) => v.x < -0.01).length;
    const side: Crossfall["side"] = slopes.length < 3 ? "no data" : right >= 0.8 * slopes.length ? "right" : left >= 0.8 * slopes.length ? "left" : x != null && Math.abs(x) < 0.005 && sym! < -0.01 ? "crown" : "mixed";
    const fall = x != null && Math.abs(x) >= 0.01 ? (x > 0 ? "right" : "left") : null;
    out[r.name] = { type, side, fall, xfall: x == null ? null : +x.toFixed(4), crown: sym == null ? null : +sym.toFixed(3), samples: slopes.length, right, left };
  }
  return out;
}
