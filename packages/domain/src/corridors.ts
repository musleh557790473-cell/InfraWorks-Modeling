/**
 * How closely a network follows its utility corridor (Parsons' IUC plan draws one line per network
 * where it runs in the road reserve). Each network line is sampled every `step` metres; a sample is on
 * its corridor when a corridor line lies within `tolerance` metres. Plan only (x, y).
 */
export type Line = readonly (readonly number[])[];

export interface CorridorFit {
  /** sampled network length (m) */
  length: number;
  /** length within the tolerance of a corridor line (m) */
  onCorridor: number;
  /** share on the corridor, 0..1 (0 when nothing was sampled) */
  share: number;
  /** median and 90th percentile distance to the nearest corridor line (m) */
  median: number;
  p90: number;
  /** network lines with no sample on the corridor at all */
  linesOff: number;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

export interface NamedLine {
  /** corridor network name ("Corridor - Water") */
  name: string;
  line: Line;
}

export interface CorridorAssignment {
  /** sampled network length (m) */
  length: number;
  /** length whose nearest corridor line is one of its own (m) */
  own: number;
  /** length whose nearest corridor line is another network's, by that corridor (m) */
  others: Record<string, number>;
  /** length farther than `outside` metres from every corridor line (m) */
  outside: number;
}

const segmentsOf = (lines: readonly NamedLine[]) =>
  lines.flatMap(({ name, line }) => line.slice(1).map((b, i) => {
    const a = line[i]!;
    return { name, ax: a[0]!, ay: a[1]!, bx: b[0]!, by: b[1]!, x0: Math.min(a[0]!, b[0]!), x1: Math.max(a[0]!, b[0]!), y0: Math.min(a[1]!, b[1]!), y1: Math.max(a[1]!, b[1]!) };
  }));
type Seg = ReturnType<typeof segmentsOf>[number];
/** nearest corridor segment to (x, y) among `segs` (optionally skipping one name) within `max` m */
function nearestSeg(segs: readonly Seg[], x: number, y: number, max: number, skip?: string): { d: number; name: string | null } {
  let d = max, name: string | null = null;
  for (const s of segs) {
    if (s.name === skip) continue;
    if (x < s.x0 - d || x > s.x1 + d || y < s.y0 - d || y > s.y1 + d) continue;
    const e = distToSegment(x, y, s.ax, s.ay, s.bx, s.by);
    if (e < d) { d = e; name = s.name; }
  }
  return { d, name };
}

/**
 * Where each metre of a network lies against ALL the corridor lines: in its own place when the nearest
 * corridor line is one of `own`, in another network's place when another corridor line is nearer, or
 * outside when no corridor line lies within `outside` metres. Uses the spacing Parsons drew between
 * the corridors (IUC-30001: 0.40-1.80 m) instead of a fixed tolerance.
 */
export function corridorAssignment(network: readonly Line[], corridors: readonly NamedLine[], own: readonly string[], opts: { step?: number; outside?: number } = {}): CorridorAssignment {
  const step = opts.step ?? 1, outside = opts.outside ?? 2;
  const segs = segmentsOf(corridors);
  const out: CorridorAssignment = { length: 0, own: 0, others: {}, outside: 0 };
  for (const line of network) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!, L = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, near = nearestSeg(segs, a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, outside);
        out.length += L / n;
        if (!near.name) out.outside += L / n;
        else if (own.includes(near.name)) out.own += L / n;
        else out.others[near.name] = (out.others[near.name] ?? 0) + L / n;
      }
    }
  }
  return out;
}

export interface CorridorBand {
  name: string;
  /** half width used (m): half the median distance to the nearest other corridor, capped */
  halfWidth: number;
  /** closed ring around the corridor line */
  ring: number[][];
}

/**
 * Each corridor line widened into a band for display as an area: half the median distance from the line
 * to the nearest corridor line of another network (so neighbouring bands meet and do not overlap, as
 * Parsons spaced them), capped at `maxHalf` (1.0 m) where no neighbour is near. Straight joins (mitre,
 * limited to 2 x the half width).
 */
export function corridorBands(corridors: readonly NamedLine[], opts: { maxHalf?: number; step?: number } = {}): CorridorBand[] {
  const maxHalf = opts.maxHalf ?? 1, step = opts.step ?? 1;
  const segs = segmentsOf(corridors);
  return corridors.filter((c) => c.line.length > 1).map(({ name, line }) => {
    const ds: number[] = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!, n = Math.max(1, Math.round(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / step));
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; ds.push(nearestSeg(segs, a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, 2 * maxHalf, name).d); }
    }
    ds.sort((p, q) => p - q);
    const halfWidth = Math.round(Math.min(maxHalf, (ds[Math.floor(ds.length / 2)] ?? 2 * maxHalf) / 2) * 1000) / 1000;
    // unit normals of each segment, mitred at the vertices
    const nrm = line.slice(1).map((b, i) => { const a = line[i]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l] as const; });
    const offsetAt = (i: number, side: 1 | -1): number[] => {
      const p = line[i]!, n0 = nrm[Math.max(0, i - 1)]!, n1 = nrm[Math.min(nrm.length - 1, i)]!;
      let mx = n0[0] + n1[0], my = n0[1] + n1[1];
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      const cos = mx * n1[0] + my * n1[1], k = Math.min(2, 1 / Math.max(cos, 0.5));
      return [p[0]! + side * mx * halfWidth * k, p[1]! + side * my * halfWidth * k];
    };
    const left = line.map((_, i) => offsetAt(i, 1)), right = line.map((_, i) => offsetAt(i, -1)).reverse();
    return { name, halfWidth, ring: [...left, ...right, left[0]!] };
  });
}

export function corridorFit(network: readonly Line[], corridors: readonly Line[], opts: { tolerance?: number; step?: number } = {}): CorridorFit {
  const tol = opts.tolerance ?? 1.0, step = opts.step ?? 1.0;
  // corridor segments with their boxes, for a quick reject
  const segs = corridors.flatMap((c) => c.slice(1).map((b, i) => {
    const a = c[i]!;
    return { ax: a[0]!, ay: a[1]!, bx: b[0]!, by: b[1]!, x0: Math.min(a[0]!, b[0]!), x1: Math.max(a[0]!, b[0]!), y0: Math.min(a[1]!, b[1]!), y1: Math.max(a[1]!, b[1]!) };
  }));
  const near = (x: number, y: number) => {
    let d = Infinity;
    for (const s of segs) {
      if (x < s.x0 - d || x > s.x1 + d || y < s.y0 - d || y > s.y1 + d) continue;
      d = Math.min(d, distToSegment(x, y, s.ax, s.ay, s.bx, s.by));
    }
    return d;
  };
  const ds: number[] = [];
  let length = 0, onCorridor = 0, linesOff = 0;
  for (const line of network) {
    let any = false;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!, L = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, d = near(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t);
        ds.push(d);
        length += L / n;
        if (d <= tol) { onCorridor += L / n; any = true; }
      }
    }
    if (line.length > 1 && !any) linesOff++;
  }
  const sorted = ds.sort((p, q) => p - q), at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN);
  return { length, onCorridor, share: length ? onCorridor / length : 0, median: at(0.5), p90: at(0.9), linesOff };
}
