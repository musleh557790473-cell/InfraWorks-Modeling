/**
 * Areas from a network of separate lines: plots drawn as single LINE segments, as on Parsons'
 * baseplans. The lines are snapped, split where they cross or end on one another, stripped of
 * dangling ends, and the faces they enclose are traced. A group of lines lying inside another
 * group's face becomes a hole in that face.
 */

type P = [number, number];

export interface PolygonizeResult {
  /** One polygon per enclosed face: outer ring counter-clockwise, then holes; rings closed. */
  polygons: P[][][];
  /** Line pieces that enclose nothing (dangling ends, stray lines), dropped. */
  dangles: number;
  /** Faces smaller than minArea (slivers between near-duplicate lines), dropped. */
  slivers: number;
  /** Line ends joined across a drafting gap (closeGaps). */
  gapsClosed: number;
}

export interface PolygonizeOptions {
  /** Endpoints closer than this are one point, and a line ending this close to another meets it. */
  tolerance?: number;
  /** Faces smaller than this (m²) are dropped. */
  minArea?: number;
  /**
   * Drafting gaps: a line end that meets nothing is joined to the nearest other line within this
   * distance (a short connector; nothing else moves). 0 = off.
   */
  closeGaps?: number;
}

export function polygonize(lines: number[][][], opts: PolygonizeOptions = {}): PolygonizeResult {
  const tol = opts.tolerance ?? 0.01;
  const minArea = opts.minArea ?? 1;
  const gap = opts.closeGaps ?? 0;

  /* -------- vertices, snapped within tol (hash grid of cell tol) */
  const vx: P[] = [];
  const grid = new Map<string, number[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  const vertex = (p: number[]): number => {
    const cx = Math.floor(p[0]! / tol);
    const cy = Math.floor(p[1]! / tol);
    let best = -1;
    let bestD = tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(vx[id]![0] - p[0]!, vx[id]![1] - p[1]!);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    if (best >= 0) return best;
    vx.push([p[0]!, p[1]!]);
    const k = cell(p[0]!, p[1]!);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(vx.length - 1);
    return vx.length - 1;
  };

  /* -------- segments */
  const segs: { a: number; b: number; cuts: number[] }[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = vertex(line[i - 1]!);
      const b = vertex(line[i]!);
      if (a !== b) segs.push({ a, b, cuts: [] });
    }
  }

  /* -------- noding: split at crossings and where one segment ends on another */
  const CELL = 25;
  const index = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const [ax, ay] = vx[s.a]!;
    const [bx, by] = vx[s.b]!;
    for (let x = Math.floor((Math.min(ax, bx) - tol) / CELL); x <= Math.floor((Math.max(ax, bx) + tol) / CELL); x++) {
      for (let y = Math.floor((Math.min(ay, by) - tol) / CELL); y <= Math.floor((Math.max(ay, by) + tol) / CELL); y++) {
        const k = `${x},${y}`;
        (index.get(k) ?? index.set(k, []).get(k)!).push(i);
      }
    }
  });
  const onInterior = (s: { a: number; b: number }, v: number): boolean => {
    if (v === s.a || v === s.b) return false;
    const [ax, ay] = vx[s.a]!;
    const [bx, by] = vx[s.b]!;
    const [px, py] = vx[v]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t <= 0 || t >= 1) return false;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= tol;
  };
  const seen = new Set<string>();
  for (const ids of index.values()) {
    for (let m = 0; m < ids.length; m++) {
      for (let n = m + 1; n < ids.length; n++) {
        const i = Math.min(ids[m]!, ids[n]!);
        const j = Math.max(ids[m]!, ids[n]!);
        const key = `${i},${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = segs[i]!;
        const r = segs[j]!;
        // T-junctions and collinear overlaps: an endpoint of one lies on the other.
        for (const v of [r.a, r.b]) if (onInterior(s, v)) s.cuts.push(v);
        for (const v of [s.a, s.b]) if (onInterior(r, v)) r.cuts.push(v);
        // Proper crossing away from all endpoints.
        const x = crossing(vx[s.a]!, vx[s.b]!, vx[r.a]!, vx[r.b]!);
        if (x) {
          const v = vertex(x);
          if (v !== s.a && v !== s.b) s.cuts.push(v);
          if (v !== r.a && v !== r.b) r.cuts.push(v);
        }
      }
    }
  }

  /* -------- edges (deduplicated), then prune dangling ends */
  const adj = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    if (u === v) return;
    (adj.get(u) ?? adj.set(u, new Set()).get(u)!).add(v);
    (adj.get(v) ?? adj.set(v, new Set()).get(v)!).add(u);
  };
  for (const s of segs) {
    const [ax, ay] = vx[s.a]!;
    const [bx, by] = vx[s.b]!;
    const t = (v: number) => (vx[v]![0] - ax) * (bx - ax) + (vx[v]![1] - ay) * (by - ay);
    const chain = [s.a, ...[...new Set(s.cuts)].sort((p, q) => t(p) - t(q)), s.b];
    for (let k = 1; k < chain.length; k++) link(chain[k - 1]!, chain[k]!);
  }
  const unlink = (u: number, v: number) => {
    adj.get(u)?.delete(v);
    adj.get(v)?.delete(u);
  };

  /* -------- close drafting gaps: join each loose end to the nearest other edge within `gap` */
  let gapsClosed = 0;
  if (gap > tol) {
    const G = Math.max(gap * 4, 1);
    const edgeIndex = new Map<string, [number, number][]>();
    const addEdge = (u: number, v: number) => {
      const [ax, ay] = vx[u]!;
      const [bx, by] = vx[v]!;
      for (let x = Math.floor((Math.min(ax, bx) - gap) / G); x <= Math.floor((Math.max(ax, bx) + gap) / G); x++) {
        for (let y = Math.floor((Math.min(ay, by) - gap) / G); y <= Math.floor((Math.max(ay, by) + gap) / G); y++) {
          const k = `${x},${y}`;
          (edgeIndex.get(k) ?? edgeIndex.set(k, []).get(k)!).push([u, v]);
        }
      }
    };
    for (const [u, ns] of adj) for (const v of ns) if (u < v) addEdge(u, v);
    const loose = [...adj.keys()].filter((v) => adj.get(v)!.size === 1);
    for (const v of loose) {
      if (adj.get(v)?.size !== 1) continue;
      const [px, py] = vx[v]!;
      let best: { u: number; w: number; t: number; d: number } | undefined;
      for (const [u, w] of edgeIndex.get(`${Math.floor(px / G)},${Math.floor(py / G)}`) ?? []) {
        if (u === v || w === v || !adj.get(u)?.has(w)) continue;
        const [ax, ay] = vx[u]!;
        const [bx, by] = vx[w]!;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d <= gap && (!best || d < best.d)) best = { u, w, t, d };
      }
      if (!best) continue;
      const [ax, ay] = vx[best.u]!;
      const [bx, by] = vx[best.w]!;
      const q: P = [ax + best.t * (bx - ax), ay + best.t * (by - ay)];
      let target: number;
      if (Math.hypot(q[0] - ax, q[1] - ay) <= tol) target = best.u;
      else if (Math.hypot(q[0] - bx, q[1] - by) <= tol) target = best.w;
      else {
        vx.push(q);
        target = vx.length - 1;
        unlink(best.u, best.w);
        link(best.u, target);
        link(target, best.w);
        addEdge(best.u, target);
        addEdge(target, best.w);
      }
      if (target === v || adj.get(v)!.has(target)) continue;
      link(v, target);
      addEdge(v, target);
      gapsClosed++;
    }
  }

  let dangles = 0;
  const stack = [...adj.keys()].filter((v) => adj.get(v)!.size <= 1);
  while (stack.length) {
    const v = stack.pop()!;
    const ns = adj.get(v);
    if (!ns || ns.size > 1) continue;
    for (const u of ns) {
      adj.get(u)!.delete(v);
      dangles++;
      if (adj.get(u)!.size <= 1) stack.push(u);
    }
    adj.delete(v);
  }

  /* -------- faces: leftmost-turn walks; bounded faces come out counter-clockwise */
  const order = new Map<number, number[]>();
  for (const [v, ns] of adj) {
    const [x0, y0] = vx[v]!;
    order.set(v, [...ns].sort((p, q) => Math.atan2(vx[p]![1] - y0, vx[p]![0] - x0) - Math.atan2(vx[q]![1] - y0, vx[q]![0] - x0)));
  }
  const used = new Set<string>();
  const faces: { ring: P[]; area: number; comp: number }[] = [];
  const comp = new Map<number, number>();
  let nComp = 0;
  for (const start of adj.keys()) {
    if (comp.has(start)) continue;
    const todo = [start];
    comp.set(start, nComp);
    while (todo.length) for (const u of adj.get(todo.pop()!)!) if (!comp.has(u)) (comp.set(u, nComp), todo.push(u));
    nComp++;
  }
  for (const [u0, ns] of order) {
    for (const v0 of ns) {
      if (used.has(`${u0},${v0}`)) continue;
      const ring: P[] = [];
      let u = u0;
      let v = v0;
      for (let guard = 0; guard < 1_000_000 && !used.has(`${u},${v}`); guard++) {
        used.add(`${u},${v}`);
        ring.push(vx[u]!);
        const around = order.get(v)!;
        const back = around.indexOf(u);
        const w = around[(back - 1 + around.length) % around.length]!;
        u = v;
        v = w;
      }
      faces.push({ ring, area: signedArea(ring), comp: comp.get(u0)! });
    }
  }

  /* -------- bounded faces; each group's outer boundary becomes a hole in the face around it */
  let slivers = 0;
  const bounded = faces.filter((f) => {
    if (f.area <= 0) return false;
    if (f.area < minArea) slivers++;
    return f.area >= minArea;
  });
  const outers = faces.filter((f) => f.area < 0);
  const polygons = bounded.map((f) => ({ face: f, holes: [] as P[][], box: boxOf(f.ring) }));
  for (const o of outers) {
    const p = o.ring[0]!;
    let host: (typeof polygons)[number] | undefined;
    for (const c of polygons) {
      if (c.face.comp === o.comp) continue;
      if (p[0] < c.box[0] || p[0] > c.box[2] || p[1] < c.box[1] || p[1] > c.box[3]) continue;
      if (!inRing(p, c.face.ring)) continue;
      if (!host || c.face.area < host.face.area) host = c;
    }
    if (host) host.holes.push([...o.ring].reverse());
  }

  return {
    polygons: polygons.map((c) => [c.face.ring, ...c.holes].map((r) => [...r, r[0]!])),
    dangles,
    slivers,
    gapsClosed,
  };
}

function crossing(a: P, b: P, c: P, d: P): P | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

function signedArea(ring: P[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return s / 2;
}

function boxOf(ring: P[]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  }
  return b;
}

function inRing(p: P, ring: P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}