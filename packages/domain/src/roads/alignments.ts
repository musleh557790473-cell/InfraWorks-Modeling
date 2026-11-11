/**
 * One plan alignment per Parsons road from the road layout (ROD-DWG-10200, block "Xref Road Layout
 * <district>"): centreline pieces (RD_PR_CNRL, with bulge arcs), 0+000 ticks and station labels
 * (RD_C_CHAIN_TEXT) and road-name labels ("0-Alignment Name"). The profile decides: a chain is kept
 * only when its length equals the road's profile length (1 cm).
 */
import { cleanText, type DxfEnt } from "./dxf-block.js";
import { dist, first, last, near, pieceLen, reverseSegs, trimTo, type P2, type Seg } from "./geometry.js";
import type { ProfileView } from "./profiles.js";

export interface Alignment {
  name: string;
  /** plan length = profile length (m) */
  length: number;
  /** segments from station 0 */
  segs: Seg[];
}

export interface AlignmentResult {
  roads: Alignment[];
  report: string[];
}

/** Names from an earlier roads package: the start vertex of each named centreline. */
export interface NamedStart {
  name: string;
  start: P2;
}

const stripCodes = (t: string) => t.replace(/\\[A-Za-z][^;]*;|[{}]/g, "").trim();

export function buildAlignments(layout: DxfEnt[], views: ProfileView[], packageNames: NamedStart[] = []): AlignmentResult {
  // Al Qairawan draws centrelines on RD_PR_CNRL, Al Narjis on RD_CL (one of them a LINE); "RD_CL
  // External Road" are roads outside the site, with no profile.
  const plines = layout.filter((o) => (o.type === "LWPOLYLINE" || (o.type === "LINE" && o.end)) && (o.layer.endsWith("RD_PR_CNRL") || o.layer === "RD_CL"));
  const chainTexts = layout.filter((o) => o.type === "MTEXT" && o.layer.endsWith("RD_C_CHAIN_TEXT"));
  const chain0: P2[] = chainTexts.filter((o) => /(^|;)0\+000(\.0+)?\}?$/.test(o.txt.replace(/\{|\}/g, ""))).map((o) => [o.x[0]!, o.y[0]!]);
  const chainLabels = chainTexts.flatMap((o) => { const m = stripCodes(o.txt).match(/(\d+)\+(\d+\.\d+)$/); return m ? [{ x: o.x[0]!, y: o.y[0]!, s: +m[1]! * 1000 + +m[2]! }] : []; });
  const nameLabels = layout.filter((o) => (o.type === "MTEXT" || o.type === "TEXT") && o.layer.endsWith("0-Alignment Name")).map((o) => ({ x: o.x[0]!, y: o.y[0]!, t: stripCodes(o.txt) }));

  const segsOf = (o: DxfEnt): Seg[] => o.type === "LINE" ? [{ a: [o.x[0]!, o.y[0]!], b: o.end!, bulge: 0 }] : o.x.slice(0, -1).map((x, k) => ({ a: [x, o.y[k]!], b: [o.x[k + 1]!, o.y[k + 1]!], bulge: o.bulge[k] ?? 0 }));
  const nameOf = (o: DxfEnt): string => {
    let best = "", d = 0.05;
    for (const p of packageNames) { const dd = Math.hypot(p.start[0] - o.x[0]!, p.start[1] - o.y[0]!); if (dd < d) { d = dd; best = p.name; } }
    return best;
  };
  const tickDist = (p: P2) => (chain0.length ? Math.min(...chain0.map((c) => dist(c, p))) : Infinity);
  const profOf = (n: string) => views.filter((p) => p.name === n && p.pts.length).flatMap((p) => p.pts).sort((a, b) => a[0] - b[0]);

  const byName = new Map<string, Seg[][]>();
  const unnamed: Seg[][] = [];
  for (const o of plines) { const n = nameOf(o); if (n) { if (!byName.has(n)) byName.set(n, []); byName.get(n)!.push(segsOf(o)); } else unnamed.push(segsOf(o)); }
  // roads with a profile but no piece named in the package (R.0.D.1, RA-1 ... 11 in Al Qairawan):
  // an empty piece list, pass 2 starts them on their name-labelled pieces
  for (const n of new Set(views.map((p) => p.name))) if (!byName.has(n)) byName.set(n, []);

  // a closed piece (a loop road) opened at its vertex nearest a 0+000 tick
  const openLoop = (s: Seg[]): Seg[] => {
    if (!near(first(s).a, last(s).b)) return s;
    let k = 0;
    s.forEach((g, i) => { if (tickDist(g.a) < tickDist(s[k]!.a)) k = i; });
    return [...s.slice(k), ...s.slice(0, k)];
  };
  // a piece's identity, the same whichever way it is walked
  const pk = (s: Seg[]) => [first(s).a, last(s).b].map((p) => p.map((v) => v.toFixed(3)).join(",")).sort().join("|") + ":" + s.length;

  interface Chain { segs: Seg[]; len: number; nOwn: number; used: number; keys: string[] }
  // depth-first over pieces from the end nearest a 0+000 tick; a chain matches when its length equals
  // the profile length; among matches, the one using most of the road's own pieces
  const chainTo = (own: Seg[][], plen: number, others: Seg[][] = unnamed, nStarts = 2): Chain | null => {
    const pool = [...own.map((s) => ({ s: openLoop(s), own: true, k: pk(s) })), ...others.map((s) => ({ s, own: false, k: pk(s) }))];
    const starts = own.flatMap((s) => { const o = openLoop(s); return [first(o).a, last(o).b]; }).sort((p, q) => tickDist(p) - tickDist(q));
    let best: Chain | null = null;
    const dfs = (at: P2, used: number[], segs: Seg[], len: number, depth: number) => {
      if (Math.abs(len - plen) < 0.01) {
        const nOwn = used.filter((i) => pool[i]!.own).length;
        if (!best || nOwn > best.nOwn) best = { segs: segs.slice(), len, nOwn, used: used.length, keys: used.map((i) => pool[i]!.k) };
        return;
      }
      if (len > plen + 0.01 || depth > 8) return;
      pool.forEach((p, i) => {
        if (used.includes(i)) return;
        let s = p.s;
        if (near(first(s).a, at)) { /* as drawn */ } else if (near(last(s).b, at)) s = reverseSegs(s); else return;
        used.push(i); dfs(last(s).b, used, [...segs, ...s], len + pieceLen(s), depth + 1); used.pop();
      });
    };
    for (const st of starts.slice(0, nStarts)) { dfs(st, [], [], 0, 0); if (best) return best; }
    return null;
  };
  const labelsOf = (n: string) => nameLabels.filter((o) => o.t === n);
  const pieceDist = (o: { x: number; y: number }, s: Seg[]) => Math.min(...s.map((g) => {
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((o.x - g.a[0]) * dx + (o.y - g.a[1]) * dy) / l2)) : 0;
    return Math.hypot(o.x - g.a[0] - dx * t, o.y - g.a[1] - dy * t);
  }));

  const chained = new Map<string, { c: Chain; how: string }>(), usedKeys = new Set<string>(), allPieces = plines.map(segsOf);
  // pass 1: own pieces (by package name) and unnamed ones
  for (const [name, pieces] of byName) {
    const fg = profOf(name); if (!fg.length) continue;
    const c = chainTo(pieces, last(fg)[0]);
    if (c) { chained.set(name, { c, how: "" }); c.keys.forEach((k) => usedKeys.add(k)); }
  }
  for (const [name, pieces] of byName) {
    const fg = profOf(name); if (!fg.length || chained.has(name)) continue;
    const plen = last(fg)[0], free = allPieces.filter((s) => !usedKeys.has(pk(s)));
    // pass 2: any free piece, starting on a piece that carries the road's name label (the package had
    // named R.0.D.13's piece RA-6)
    const labelled = free.filter((s) => labelsOf(name).some((o) => pieceDist(o, s) < 6));
    const starts = [...labelled, ...pieces.filter((s) => !usedKeys.has(pk(s)) && !labelled.includes(s))];
    const c = starts.length ? chainTo(starts, plen, free.filter((s) => !starts.includes(s)), 4) : null;
    if (c) { chained.set(name, { c, how: "matched by profile length over all free pieces" }); c.keys.forEach((k) => usedKeys.add(k)); continue; }
    // pass 3: one own piece longer than the profile by <= 2.5 m, cut at the profile end
    if (pieces.length === 1) {
      const s = openLoop(pieces[0]!), L = pieceLen(s), o = tickDist(first(s).a) <= tickDist(last(s).b) ? s : reverseSegs(s);
      if (L > plen && L - plen <= 2.5) {
        const t = trimTo(o, plen);
        chained.set(name, { c: { segs: t, len: pieceLen(t), used: 1, nOwn: 1, keys: [pk(pieces[0]!)] }, how: `piece ${L.toFixed(3)} m cut to the profile end (${(L - plen).toFixed(3)} m)` });
        continue;
      }
    }
    // pass 3b: walk the free pieces from the labelled start while the way on is unique; when the plan's
    // own end-station label equals the walk's length (the alignment is confirmed) and the profile stops
    // before it (R.0.D.5: plan 0+416.889, profile 0+375.000), the road ends where the profile ends
    if (starts.length) {
      const st0 = starts[0]!, o0 = tickDist(first(st0).a) <= tickDist(last(st0).b) ? openLoop(st0) : reverseSegs(openLoop(st0));
      const walk = [...o0], keys = [pk(st0)];
      let at = last(walk).b;
      for (;;) {
        const nx = free.filter((s) => !keys.includes(pk(s)) && (near(first(s).a, at) || near(last(s).b, at)));
        if (nx.length !== 1) break;
        const s = near(first(nx[0]!).a, at) ? nx[0]! : reverseSegs(nx[0]!);
        walk.push(...s); keys.push(pk(nx[0]!)); at = last(s).b;
      }
      const L = pieceLen(walk), endLabel = chainLabels.find((c) => Math.hypot(c.x - at[0], c.y - at[1]) < 8 && Math.abs(c.s - L) < 0.01);
      if (L > plen + 0.01 && (endLabel || L - plen <= 2.5)) {
        const t = trimTo(walk, plen);
        chained.set(name, { c: { segs: t, len: pieceLen(t), used: keys.length, nOwn: 0, keys }, how: `${keys.length} piece(s), ${L.toFixed(3)} m${endLabel ? ` (end label 0+${endLabel.s.toFixed(3)})` : ""}, cut to the profile end ${plen.toFixed(3)} m` });
        keys.forEach((k) => usedKeys.add(k));
      }
    }
  }
  const roads: Alignment[] = [], report: string[] = [];
  for (const [name, pieces] of byName) {
    const fg = profOf(name); if (!fg.length) { report.push(`${name}: no profile`); continue; }
    const plen = last(fg)[0], got = chained.get(name);
    if (!got) { report.push(`${name}: no chain of its pieces (${pieces.length}, ${pieces.reduce((a, s) => a + pieceLen(s), 0).toFixed(3)} m) and free pieces matches the profile ${plen.toFixed(3)} m`); continue; }
    const c = got.c, extra = c.used - c.nOwn, unusedOwn = pieces.length - c.nOwn;
    const note = [got.how, !got.how && extra ? `${extra} unnamed piece(s) added` : "", !got.how && unusedOwn ? `${unusedOwn} own piece(s) left out` : ""].filter(Boolean).join(", ");
    report.push(`${name}: plan ${c.len.toFixed(3)} profile ${plen.toFixed(3)} diff ${(c.len - plen).toFixed(3)} ${note}`);
    if (Math.abs(c.len - plen) < 0.01) roads.push({ name, length: c.len, segs: c.segs });
  }
  return { roads, report };
}

/** Road-name labels of the layout, cleaned (for reports and checks). */
export const layoutNames = (layout: DxfEnt[]): string[] =>
  [...new Set(layout.filter((o) => (o.type === "MTEXT" || o.type === "TEXT") && o.layer.endsWith("0-Alignment Name")).map((o) => cleanText(o.txt)))];
