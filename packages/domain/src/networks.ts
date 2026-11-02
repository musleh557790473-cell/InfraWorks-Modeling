import { matchesAny } from "./areas.js";
import { findLayerMapping, stripBoundXrefPrefix } from "./layers.js";
import type { DomainFeature, LayerMapping, MappingProfile } from "./types.js";

/** A text label as the reader found it, in drawing coordinates. */
export interface SizeLabel {
  layer: string;
  text: string;
  at: number[];
}

/** What the size step found, per rule, for the build report. */
export interface PipeStats {
  layer: string;
  pipes: number;
  fromLayer: number;
  fromLabel: number;
  /** Of fromLabel: carried along the network from a labelled neighbour. */
  carried?: number;
  /** Given the rule's fixed size (a documented duct, or a display size). */
  fixed?: number;
  unsized: number;
}

type Pt = number[];
const CELL = 25;

/**
 * "200" → [200]; "2000x1500" → [2000, 1500]; values under 10 are metres already ("1.5x1.5"),
 * everything else millimetres.
 */
export function parseSize(groups: (string | undefined)[]): { mm: number[] } | null {
  const vals = groups.filter((g): g is string => g !== undefined && g !== "").map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return null;
  return { mm: vals.slice(0, 2).map((v) => (v < 10 ? v * 1000 : v)) };
}

function sizeAttributes(mm: number[]): Record<string, string | number> {
  const [a, b] = mm;
  return {
    diameter_mm: a!,
    size_mm: b !== undefined && b !== a ? `${a}x${b}` : `${a}`,
    size_m: a! / 1000,
    size_y_m: (b ?? a!) / 1000,
  };
}

function safeRegExp(source: string): RegExp {
  try {
    return new RegExp(source, "i");
  } catch {
    throw new Error(`Pipe size pattern is not a valid regular expression: ${source}`);
  }
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / l2)) : 0;
  return Math.hypot(p[0]! - (a[0]! + t * dx), p[1]! - (a[1]! + t * dy));
}

function linesOf(f: DomainFeature): Pt[][] {
  const g = f.geometry;
  if (g.type === "LineString") return [g.coordinates as Pt[]];
  if (g.type === "MultiLineString") return g.coordinates as Pt[][];
  // A closed cable ring is read as a polygon and ships as a line: size and depth it like one.
  if (g.type === "Polygon") return g.coordinates as Pt[][];
  return [];
}

/**
 * Give each pipe on a rule with `size` its size: from its layer name first, otherwise from the
 * nearest size label within reach. Pipes that get neither keep no size and are counted.
 */
export function sizePipes(
  features: DomainFeature[],
  labels: SizeLabel[],
  profile: Pick<MappingProfile, "layers">,
): { features: DomainFeature[]; notes: string[]; stats: PipeStats[] } {
  const rules = profile.layers.filter((l) => l.size);
  if (!rules.length) return { features, notes: [], stats: [] };

  const byRule = new Map<LayerMapping, PipeStats>();
  const out = features.map((f) => {
    const layer = f.provenance.sourceLayer ?? "";
    const rule = findLayerMapping(profile, layer);
    if (!rule?.size || !linesOf(f).length) return f;
    const st = byRule.get(rule) ?? { layer: rule.outputLayer ?? rule.dwgLayer, pipes: 0, fromLayer: 0, fromLabel: 0, unsized: 0 };
    byRule.set(rule, st);
    st.pipes += 1;
    if (rule.size.fromLayer) {
      const m = safeRegExp(rule.size.fromLayer).exec(stripBoundXrefPrefix(layer));
      const size = m ? parseSize(m.slice(1)) : null;
      if (size) {
        st.fromLayer += 1;
        return { ...f, attributes: { ...f.attributes, ...sizeAttributes(size.mm), size_from: "layer" } };
      }
    }
    if (rule.size.fixed && !rule.size.fromLabel) {
      st.fixed = (st.fixed ?? 0) + 1;
      return { ...f, attributes: { ...f.attributes, ...sizeAttributes([rule.size.fixed.mm]), size_from: "fixed", size_src: rule.size.fixed.source } };
    }
    return f;
  });

  // Label pass: index the size labels once per rule, then take the nearest within reach.
  for (const rule of rules) {
    const opt = rule.size!.fromLabel;
    if (!opt) continue;
    const pattern = safeRegExp(opt.pattern);
    const grid = new Map<string, { at: Pt; mm: number[] }[]>();
    for (const l of labels) {
      if (!matchesAny(opt.labels, l.layer)) continue;
      const m = pattern.exec(l.text);
      const size = m ? parseSize(m.slice(1)) : null;
      if (!size) continue;
      const k = `${Math.floor(l.at[0]! / CELL)},${Math.floor(l.at[1]! / CELL)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push({ at: l.at, mm: size.mm });
    }
    const reach = Math.ceil(opt.maxDistance / CELL);
    for (let i = 0; i < out.length; i++) {
      const f = out[i]!;
      if (f.attributes.size_mm !== undefined) continue;
      if (findLayerMapping(profile, f.provenance.sourceLayer ?? "") !== rule) continue;
      const lines = linesOf(f);
      if (!lines.length) continue;
      let best: { d: number; mm: number[] } | null = null;
      const seen = new Set<string>();
      for (const line of lines) for (const p of line) {
        const cx = Math.floor(p[0]! / CELL);
        const cy = Math.floor(p[1]! / CELL);
        for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++) {
          const k = `${x},${y}`;
          if (seen.has(k)) continue;
          seen.add(k);
          for (const c of grid.get(k) ?? []) {
            let d = Infinity;
            for (const ln of lines) for (let j = 0; j + 1 < ln.length; j++) d = Math.min(d, segDist(c.at, ln[j]!, ln[j + 1]!));
            if (d <= opt.maxDistance && (!best || d < best.d)) best = { d, mm: c.mm };
          }
        }
      }
      if (best) {
        out[i] = { ...f, attributes: { ...f.attributes, ...sizeAttributes(best.mm), size_from: "label" } };
        byRule.get(rule)!.fromLabel += 1;
      }
    }
  }

  // A run is labelled once but drawn as several pieces: carry a size along the network to an
  // unsized pipe whose sized neighbours (same rule, sharing an end within 1 cm) all agree.
  for (const rule of rules) {
    if (!rule.size!.fromLabel) continue;
    const idx = out.map((f, i) => (findLayerMapping(profile, f.provenance.sourceLayer ?? "") === rule && linesOf(f).length ? i : -1)).filter((i) => i >= 0);
    const key = (p: Pt) => `${Math.round(p[0]! * 100)},${Math.round(p[1]! * 100)}`;
    const ends = new Map<number, string[]>();
    const at = new Map<string, number[]>();
    for (const i of idx) {
      const ls = linesOf(out[i]!);
      const ks = [key(ls[0]![0]!), key(ls[ls.length - 1]!.at(-1)!)];
      ends.set(i, ks);
      for (const k of ks) (at.get(k) ?? at.set(k, []).get(k)!).push(i);
    }
    let carried = 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (const i of idx) {
        if (out[i]!.attributes.size_mm !== undefined) continue;
        const sizes = new Set<string>();
        let mm: number[] | null = null;
        for (const k of ends.get(i)!) for (const j of at.get(k) ?? []) {
          const s = out[j]!.attributes;
          if (j === i || s.size_mm === undefined) continue;
          sizes.add(String(s.size_mm));
          mm = [Number(s.size_m) * 1000, Number(s.size_y_m) * 1000];
        }
        if (sizes.size !== 1 || !mm) continue;
        out[i] = { ...out[i]!, attributes: { ...out[i]!.attributes, ...sizeAttributes(mm[0] === mm[1] ? [mm[0]!] : mm), size_from: "network" } };
        carried += 1;
        changed = true;
      }
    }
    const st = byRule.get(rule);
    if (st) st.fromLabel += carried;
    if (st) st.carried = carried;
  }

  const stats = [...byRule.values()].map((s) => ({ ...s, unsized: s.pipes - s.fromLayer - s.fromLabel - (s.fixed ?? 0) }));
  const notes = stats.map(
    (s) =>
      `${s.layer}: ${s.pipes} pipe(s), size from the layer name for ${s.fromLayer}, from a label for ${s.fromLabel}` +
      (s.fixed ? `, fixed for ${s.fixed}` : "") +
      `, none for ${s.unsized}`,
  );
  return { features: out, notes, stats };
}

/** What the depth step did, per rule, for the build report. */
export interface DepthStats {
  layer: string;
  features: number;
  /** Given a depth. The rest (a pipe without a size, a node with no pipe end near it) keep none. */
  placed: number;
  rule: string;
  source: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Depths from the project's documents, for networks whose drawings carry none. InfraWorks places a
 * pipe on the terrain plus an offset at each end (ELEV_FROM / ELEV_TO), and a connector on the
 * terrain lowered by ELEVATION_OFFSET and rising by HEIGHT:
 * - `coverM`: soil over the pipe crown, so its centre lies cover + half its size below the ground;
 * - `centreM`: a cable's burial depth to its centre;
 * - `fromPipes`: a manhole reaches the invert of the deepest pipe with a vertex within that many
 *   metres (cover + size), so it spans invert to rim. Al Qairawan draws some runs through their
 *   manholes as one polyline, so inner vertices count as well as ends.
 */
export function depthNetworks(
  features: DomainFeature[],
  profile: Pick<MappingProfile, "layers">,
): { features: DomainFeature[]; notes: string[]; stats: DepthStats[] } {
  const rules = profile.layers.filter((l) => l.depth);
  if (!rules.length) return { features, notes: [], stats: [] };
  const byRule = new Map<LayerMapping, DepthStats>();
  const statOf = (rule: LayerMapping, how: string) =>
    byRule.get(rule) ?? byRule.set(rule, { layer: rule.outputLayer ?? rule.dwgLayer, features: 0, placed: 0, rule: how, source: rule.depth!.source }).get(rule)!;

  // Lines first: pipes and cables.
  const out = features.map((f) => {
    const rule = findLayerMapping(profile, f.provenance.sourceLayer ?? "");
    const d = rule?.depth;
    if (!rule || !d || !linesOf(f).length || (d.coverM === undefined && d.centreM === undefined)) return f;
    const st = statOf(rule, d.coverM !== undefined ? `cover ${d.coverM} m over the crown` : `${d.centreM} m to the centre`);
    st.features += 1;
    const size = Number(f.attributes.size_m);
    let offset: number | null = null;
    if (d.coverM !== undefined) offset = Number.isFinite(size) && size > 0 ? -(d.coverM + size / 2) : null;
    else offset = -d.centreM!;
    if (offset === null) return f;
    st.placed += 1;
    const o = round3(offset);
    return {
      ...f,
      attributes: {
        ...f.attributes,
        ...(d.coverM !== undefined ? { cover_m: d.coverM } : { centre_m: d.centreM! }),
        depth_src: d.source,
        off_start_m: o,
        off_end_m: o,
      },
    };
  });

  // Then nodes: the invert of the deepest pipe ending near each.
  const ends: { at: Pt; invert: number; network: unknown }[] = [];
  for (const f of out) {
    const cover = Number(f.attributes.cover_m);
    const size = Number(f.attributes.size_m);
    if (!Number.isFinite(cover) || !Number.isFinite(size)) continue;
    // Every vertex, not only the ends: a run may be drawn through its manholes as one polyline.
    for (const line of linesOf(f)) for (const p of line) ends.push({ at: p, invert: cover + size, network: f.attributes.network });
  }
  const grid = new Map<string, typeof ends>();
  for (const e of ends) {
    const k = `${Math.floor(e.at[0]! / CELL)},${Math.floor(e.at[1]! / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(e);
  }
  for (let i = 0; i < out.length; i++) {
    const f = out[i]!;
    const rule = findLayerMapping(profile, f.provenance.sourceLayer ?? "");
    const reach = rule?.depth?.fromPipes;
    if (!rule || reach === undefined || f.geometry.type !== "Point") continue;
    const st = statOf(rule, `invert of the deepest pipe within ${reach} m`);
    st.features += 1;
    const p = f.geometry.coordinates as Pt;
    const cx = Math.floor(p[0]! / CELL);
    const cy = Math.floor(p[1]! / CELL);
    const r = Math.ceil(reach / CELL);
    let depth = 0;
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const e of grid.get(`${x},${y}`) ?? []) {
        if (e.network !== f.attributes.network) continue;
        if (Math.hypot(e.at[0]! - p[0]!, e.at[1]! - p[1]!) <= reach) depth = Math.max(depth, e.invert);
      }
    }
    if (!depth) continue;
    st.placed += 1;
    out[i] = { ...f, attributes: { ...f.attributes, depth_m: round3(depth), depth_src: rule.depth!.source, off_base_m: round3(-depth) } };
  }

  const stats = [...byRule.values()];
  const notes = stats.map((s) => `${s.layer}: depth for ${s.placed} of ${s.features} (${s.rule}; ${s.source})`);
  return { features: out, notes, stats };
}
