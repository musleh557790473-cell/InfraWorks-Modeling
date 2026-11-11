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
