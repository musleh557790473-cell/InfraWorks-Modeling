// Build one 3D centreline per Parsons road (pieces chained from the 0+000 tick, arcs kept from
// bulges, Z = PGL from the profile FG line) and write a PolyLineZ shapefile for InfraWorks.
// Usage: node alignments.cjs <10200 dxf> <profiles.json> <roads package shp base (has NAME)> <out dir>
const fs = require("fs"), path = require("path");
const [dxf, profPath, pkgBase, outDir] = process.argv.slice(2);
const BLOCK = "Xref Road Layout Al Qairawan";

// --- read centrelines (with bulges) and chainage labels from the layout block
const L = fs.readFileSync(dxf, "latin1").split(/\r?\n/).map((x) => x.trim());
const s0 = L.indexOf("BLOCKS"), e0 = L.indexOf("ENTITIES");
let blk = null; const plines = [], chain0 = [], nameLabels = [], chainLabels = [];
for (let i = s0 + 1; i < e0; i += 2) {
  if (L[i] !== "0") continue; const t = L[i + 1];
  if (t === "BLOCK") { let j = i + 2; while (L[j] !== "0") { if (L[j] === "2") { blk = L[j + 1]; break; } j += 2; } continue; }
  if (t === "ENDBLK") { blk = null; continue; }
  if (blk !== BLOCK) continue;
  let j = i + 2, layer = "", v = [], cur = null, txt = "", x = 0, y = 0;
  while (j < e0 && L[j] !== "0") { const c = L[j], val = L[j + 1];
    if (c === "8") layer = val;
    else if (c === "10") { cur = { x: +val, y: 0, b: 0 }; v.push(cur); x = +val; }
    else if (c === "20") { if (cur) cur.y = +val; y = +val; }
    else if (c === "42" && cur) cur.b = +val;
    else if (c === "1") txt += val;
    j += 2; }
  if (t === "LWPOLYLINE" && layer.endsWith("RD_PR_CNRL")) plines.push(v);
  if (t === "MTEXT" && layer.endsWith("RD_C_CHAIN_TEXT") && /(^|;)0\+000(\.0+)?\}?$/.test(txt.replace(/\{|\}/g, ""))) chain0.push([x, y]);
  if (t === "MTEXT" && layer.endsWith("RD_C_CHAIN_TEXT")) { const m = txt.replace(/\\[A-Za-z][^;]*;|[{}]/g, "").match(/(\d+)\+(\d+\.\d+)$/); if (m) chainLabels.push({ x, y, s: +m[1] * 1000 + +m[2] }); }
  if ((t === "MTEXT" || t === "TEXT") && layer.endsWith("0-Alignment Name")) nameLabels.push({ x, y, t: txt.replace(/\\[A-Za-z][^;]*;|[{}]/g, "").trim() });
}

// --- names from the roads package (same vertices, NAME field)
const shp = fs.readFileSync(pkgBase + ".shp"), dbfB = fs.readFileSync(pkgBase + ".dbf");
const nrec = dbfB.readUInt32LE(4), hl = dbfB.readUInt16LE(8), rl = dbfB.readUInt16LE(10);
const fields = []; for (let o = 32; dbfB[o] !== 0x0d; o += 32) fields.push({ name: dbfB.toString("latin1", o, o + 11).replace(/\0.*/, ""), len: dbfB[o + 16] });
const names = []; for (let i = 0; i < nrec; i++) { let o = hl + i * rl + 1; const r = {}; for (const f of fields) { r[f.name] = dbfB.toString("utf8", o, o + f.len).trim(); o += f.len; } names.push(r.NAME || r.ROAD_NAME || ""); }
const starts = []; { let o = 100; while (o < shp.length) { const len = shp.readInt32BE(o + 4) * 2, c = o + 8; const np = shp.readInt32LE(c + 40), p0 = c + 44 + 4 * shp.readInt32LE(c + 36); starts.push([shp.readDoubleLE(p0), shp.readDoubleLE(p0 + 8)]); o = c + len; } }
const nameOf = (v) => { let best = -1, d = 0.05; starts.forEach((p, k) => { const dd = Math.hypot(p[0] - v[0].x, p[1] - v[0].y); if (dd < d) { d = dd; best = k; } }); return best >= 0 ? names[best] : ""; };

// --- geometry helpers: a piece is a list of segments {a, b, bulge}
const segsOf = (v) => v.slice(0, -1).map((p, k) => ({ a: [p.x, p.y], b: [v[k + 1].x, v[k + 1].y], bulge: p.b }));
const rev = (segs) => segs.slice().reverse().map((g) => ({ a: g.b, b: g.a, bulge: -g.bulge }));
const segLen = (g) => { const c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); if (!g.bulge) return c; const th = 4 * Math.atan(Math.abs(g.bulge)); return (c / (2 * Math.sin(th / 2))) * th; };
const densify = (g, step) => { // points along a segment (excluding start)
  if (!g.bulge) return [g.b];
  const th = 4 * Math.atan(g.bulge), c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), r = c / (2 * Math.sin(Math.abs(th) / 2));
  const mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2, ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c;
  const h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge); const cx = mx - uy * h, cy = my + ux * h;
  const a0 = Math.atan2(g.a[1] - cy, g.a[0] - cx); const n = Math.max(2, Math.ceil((r * Math.abs(th)) / step));
  const out = []; for (let k = 1; k <= n; k++) { const a = a0 + (th * k) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out;
};

// --- chain pieces per name
const byName = new Map();
plines.forEach((v) => { const n = nameOf(v); if (!n) return; (byName.get(n) || byName.set(n, []).get(n)).push(segsOf(v)); });
const prof = JSON.parse(fs.readFileSync(profPath, "utf8"));
const profOf = (n) => prof.filter((p) => p.name === n && p.pts && p.pts.length).flatMap((p) => p.pts).sort((a, b) => a[0] - b[0]);
const near = (p, q, tol = 0.05) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol;
// Pieces without a name in the roads package (61 of 332 in Al Qairawan) and pieces carrying a
// neighbour's name made roads too short or too long. Each road is now chained from its 0+000 end
// through its own pieces and unnamed ones, and a chain is accepted only when its length equals the
// profile length (1 cm): the profile, not a guess, decides which pieces belong to the road.
const unnamed = []; plines.forEach((v) => { if (!nameOf(v)) unnamed.push(segsOf(v)); });
const pieceLen = (s) => s.reduce((a, g) => a + segLen(g), 0);
const tickDist = (p) => Math.min(...chain0.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])));
// a closed piece (start = end, a loop road) opened at its vertex nearest a 0+000 tick
function openLoop(s) {
  if (!near(s[0].a, s.at(-1).b)) return s;
  let k = 0; s.forEach((g, i) => { if (tickDist(g.a) < tickDist(s[k].a)) k = i; });
  return [...s.slice(k), ...s.slice(0, k)];
}
// a piece's identity, the same whichever way it is walked
const pk = (s) => [s[0].a, s.at(-1).b].map((p) => p.map((v) => v.toFixed(3)).join(",")).sort().join("|") + ":" + s.length;
function chainTo(own, plen, others = unnamed, nStarts = 2) {
  const pool = [...own.map((s) => ({ s: openLoop(s), own: true, k: pk(s) })), ...others.map((s) => ({ s, own: false, k: pk(s) }))];
  const starts = own.flatMap((s) => { const o = openLoop(s); return [o[0].a, o.at(-1).b]; }).sort((p, q) => tickDist(p) - tickDist(q));
  let best = null;
  const dfs = (at, used, segs, len, depth) => {
    if (Math.abs(len - plen) < 0.01) { const nOwn = used.filter((i) => pool[i].own).length; if (!best || nOwn > best.nOwn) best = { segs: segs.slice(), len, nOwn, used: used.slice(), keys: used.map((i) => pool[i].k) }; return; }
    if (len > plen + 0.01 || depth > 8) return;
    pool.forEach((p, i) => {
      if (used.includes(i)) return;
      let s = p.s; if (near(s[0].a, at)) {} else if (near(s.at(-1).b, at)) s = rev(s); else return;
      used.push(i); dfs(s.at(-1).b, used, [...segs, ...s], len + pieceLen(s), depth + 1); used.pop();
    });
  };
  for (const st of starts.slice(0, nStarts)) { dfs(st, [], [], 0, 0); if (best) return best; } // the end nearest a 0+000 tick first
  return null;
}
// a road's profile may stop short of its centreline piece (R.3.G.11: 2.000 m, R.10.G.4: 0.059 m):
// end the road where Parsons' profile ends (stations run from the 0+000 end, so the far end is cut)
function trimTo(segs, plen) {
  const out = []; let acc = 0;
  for (const g of segs) {
    const l = segLen(g);
    if (acc + l <= plen + 1e-9) { out.push(g); acc += l; continue; }
    const f = (plen - acc) / l; if (f <= 1e-9) break;
    if (!g.bulge) out.push({ a: g.a, b: [g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f], bulge: 0 });
    else { const th = 4 * Math.atan(g.bulge), c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), r = c / (2 * Math.sin(Math.abs(th) / 2));
      const ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge);
      const cx = (g.a[0] + g.b[0]) / 2 - uy * h, cy = (g.a[1] + g.b[1]) / 2 + ux * h, a0 = Math.atan2(g.a[1] - cy, g.a[0] - cx), a1 = a0 + th * f;
      out.push({ a: g.a, b: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], bulge: Math.tan((th * f) / 4) }); }
    break;
  }
  return out;
}
const labelsOf = (n) => nameLabels.filter((o) => o.t === n);
const pieceDist = (o, s) => Math.min(...s.map((g) => { const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((o.x - g.a[0]) * dx + (o.y - g.a[1]) * dy) / l2)) : 0; return Math.hypot(o.x - g.a[0] - dx * t, o.y - g.a[1] - dy * t); }));
const roads = [], report = [];
// pass 1: own and unnamed pieces; pass 2 (roads still left): any piece no accepted road uses, the road
// starting on a piece that carries its name label ("0-Alignment Name"; the package gave R.0.D.13's
// piece the name RA-6); pass 3: own piece longer than the profile by <= 2.5 m, cut at the profile end
const chained = new Map(), usedKeys = new Set(), allPieces = plines.map(segsOf);
// roads with a profile but no piece named in the package (R.0.D.1, RA-1 ... 11 in Al Qairawan) were
// never tried: give them an empty piece list, pass 2 starts them on their name-labelled pieces
for (const n of new Set(prof.map((p) => p.name))) if (!byName.has(n)) byName.set(n, []);
for (const [name, pieces] of byName) {
  const fg = profOf(name); if (!fg.length) continue;
  const c = chainTo(pieces, fg.at(-1)[0]); if (c) { chained.set(name, { c, how: "" }); c.keys.forEach((k) => usedKeys.add(k)); }
}
for (const [name, pieces] of byName) {
  const fg = profOf(name); if (!fg.length || chained.has(name)) continue;
  const plen = fg.at(-1)[0], free = allPieces.filter((s) => !usedKeys.has(pk(s)));
  const labelled = free.filter((s) => labelsOf(name).some((o) => pieceDist(o, s) < 6));
  const starts = [...labelled, ...pieces.filter((s) => !usedKeys.has(pk(s)) && !labelled.includes(s))];
  const c = starts.length ? chainTo(starts, plen, free.filter((s) => !starts.includes(s)), 4) : null;
  if (c) { chained.set(name, { c, how: "matched by profile length over all free pieces" }); c.keys.forEach((k) => usedKeys.add(k)); continue; }
  if (pieces.length === 1) { const s = openLoop(pieces[0]), L = pieceLen(s);
    const o = tickDist(s[0].a) <= tickDist(s.at(-1).b) ? s : rev(s);
    if (L > plen && L - plen <= 2.5) { const t = trimTo(o, plen); chained.set(name, { c: { segs: t, len: pieceLen(t), used: [0], nOwn: 1, keys: [pk(pieces[0])] }, how: `piece ${L.toFixed(3)} m cut to the profile end (${(L - plen).toFixed(3)} m)` }); continue; } }
  // pass 3b: walk the free pieces from the labelled start while the way on is unique; when the plan's
  // own end-station label equals that walk's length (the alignment is confirmed) and the profile stops
  // before it (R.0.D.5: plan 0+416.889, profile 0+375.000), the road ends where the profile ends
  if (starts.length) {
    const st0 = starts[0], o0 = tickDist(st0[0].a) <= tickDist(st0.at(-1).b) ? openLoop(st0) : rev(openLoop(st0));
    const walk = [...o0], keys = [pk(st0)]; let at = walk.at(-1).b;
    for (;;) { const nx = free.filter((s) => !keys.includes(pk(s)) && (near(s[0].a, at) || near(s.at(-1).b, at))); if (nx.length !== 1) break; const s = near(nx[0][0].a, at) ? nx[0] : rev(nx[0]); walk.push(...s); keys.push(pk(nx[0])); at = s.at(-1).b; }
    const L = pieceLen(walk), endLabel = chainLabels.find((c) => Math.hypot(c.x - at[0], c.y - at[1]) < 8 && Math.abs(c.s - L) < 0.01);
    if (L > plen + 0.01 && (endLabel || L - plen <= 2.5)) { const t = trimTo(walk, plen); chained.set(name, { c: { segs: t, len: pieceLen(t), used: keys, nOwn: 0, keys }, how: `${keys.length} piece(s), ${L.toFixed(3)} m${endLabel ? ` (end label 0+${endLabel.s.toFixed(3)})` : ""}, cut to the profile end ${plen.toFixed(3)} m` }); keys.forEach((k) => usedKeys.add(k)); }
  }
}
for (const [name, pieces] of byName) {
  const fg = profOf(name); if (!fg.length) { report.push(`${name}: no profile`); continue; }
  const plen = fg.at(-1)[0], got = chained.get(name);
  if (!got) { const own = pieces.reduce((a, s) => a + pieceLen(s), 0); report.push(`${name}: no chain of its pieces (${pieces.length}, ${own.toFixed(3)} m) and free pieces matches the profile ${plen.toFixed(3)} m`); continue; }
  const c = got.c, segs = c.segs, len = c.len, left = [];
  const extra = c.used.length - c.nOwn, unusedOwn = pieces.length - c.nOwn;
  const note = [got.how, !got.how && extra ? `${extra} unnamed piece(s) added` : "", !got.how && unusedOwn ? `${unusedOwn} own piece(s) left out` : ""].filter(Boolean).join(", ");
  report.push(`${name}: plan ${len.toFixed(3)} profile ${plen.toFixed(3)} diff ${(len - plen).toFixed(3)} ${note}`);
  // vertices with station and PGL
  const zAt = (st) => { for (let i = 1; i < fg.length; i++) if (st <= fg[i][0] + 1e-9) { const a = fg[i - 1], b = fg[i]; return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (st - a[0])) / (b[0] - a[0]); } return fg.at(-1)[1]; };
  const pts = [[...segs[0].a, zAt(0)]]; let st = 0;
  for (const g of segs) { const ps = densify(g, 2); let prev = pts.at(-1); for (const p of ps) { st += Math.hypot(p[0] - prev[0], p[1] - prev[1]); pts.push([p[0], p[1], zAt(st)]); prev = p; } }
  // Only roads that chain fully and whose plan length equals the profile length (1 cm): stations are exact.
  if (!left.length && Math.abs(len - plen) < 0.01) roads.push({ name, pts, len, plen, connected: true, segs });
}

// --- PolyLineZ shapefile (one part per road) + DBF (NAME, LEN_PLAN, LEN_PROF)
fs.mkdirSync(outDir, { recursive: true });
const recs = roads.map((r, idx) => { const n = r.pts.length, xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]), zs = r.pts.map((p) => p[2]);
  const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], zr = [Math.min(...zs), Math.max(...zs)];
  const cl = 4 + 32 + 4 + 4 + 4 + 16 * n + 16 + 8 * n + 16 + 8 * n; const b = Buffer.alloc(8 + cl); b.writeInt32BE(idx + 1, 0); b.writeInt32BE(cl / 2, 4);
  let o = 8; b.writeInt32LE(13, o); o += 4; bb.forEach((v) => { b.writeDoubleLE(v, o); o += 8; }); b.writeInt32LE(1, o); o += 4; b.writeInt32LE(n, o); o += 4; b.writeInt32LE(0, o); o += 4;
  r.pts.forEach((p) => { b.writeDoubleLE(p[0], o); b.writeDoubleLE(p[1], o + 8); o += 16; }); b.writeDoubleLE(zr[0], o); b.writeDoubleLE(zr[1], o + 8); o += 16; zs.forEach((z) => { b.writeDoubleLE(z, o); o += 8; });
  o += 16; return { b, bb, zr }; });
const BB = [Math.min(...recs.map((r) => r.bb[0])), Math.min(...recs.map((r) => r.bb[1])), Math.max(...recs.map((r) => r.bb[2])), Math.max(...recs.map((r) => r.bb[3]))];
const ZR = [Math.min(...recs.map((r) => r.zr[0])), Math.max(...recs.map((r) => r.zr[1]))];
const hdr = (bytes) => { const h = Buffer.alloc(100); h.writeInt32BE(9994, 0); h.writeInt32BE(bytes / 2, 24); h.writeInt32LE(1000, 28); h.writeInt32LE(13, 32); BB.forEach((v, i) => h.writeDoubleLE(v, 36 + 8 * i)); h.writeDoubleLE(ZR[0], 68); h.writeDoubleLE(ZR[1], 76); return h; };
const body = Buffer.concat(recs.map((r) => r.b));
fs.writeFileSync(path.join(outDir, "aq_road_alignments.shp"), Buffer.concat([hdr(100 + body.length), body]));
const shx = Buffer.alloc(8 * recs.length); let off = 100; recs.forEach((r, k) => { shx.writeInt32BE(off / 2, 8 * k); shx.writeInt32BE((r.b.length - 8) / 2, 8 * k + 4); off += r.b.length; });
fs.writeFileSync(path.join(outDir, "aq_road_alignments.shx"), Buffer.concat([hdr(100 + shx.length), shx]));
const F = [["NAME", "C", 20], ["LEN_PLAN", "N", 12, 3], ["LEN_PROF", "N", 12, 3], ["CONNECTED", "C", 1]];
const rlen = 1 + F.reduce((a, f) => a + f[2], 0), hlen = 32 + 32 * F.length + 1; const dbf = Buffer.alloc(hlen + rlen * roads.length + 1, 0x20);
dbf.fill(0, 0, hlen); dbf[0] = 3; dbf[1] = 126; dbf[2] = 11; dbf[3] = 3; dbf.writeUInt32LE(roads.length, 4); dbf.writeUInt16LE(hlen, 8); dbf.writeUInt16LE(rlen, 10); dbf[29] = 0x57;
F.forEach((f, i) => { const b = 32 + 32 * i; dbf.write(f[0], b, "latin1"); dbf.write(f[1], b + 11, "latin1"); dbf[b + 16] = f[2]; dbf[b + 17] = f[3] || 0; }); dbf[hlen - 1] = 0x0d;
roads.forEach((r, k) => { let q = hlen + k * rlen + 1; const vals = [r.name.padEnd(20), r.len.toFixed(3).padStart(12), r.plen.toFixed(3).padStart(12), r.connected ? "Y" : "N"]; vals.forEach((v, i) => { dbf.write(v.slice(0, F[i][2]), q, "latin1"); q += F[i][2]; }); });
dbf[dbf.length - 1] = 0x1a; fs.writeFileSync(path.join(outDir, "aq_road_alignments.dbf"), dbf);
fs.copyFileSync(pkgBase + ".prj", path.join(outDir, "aq_road_alignments.prj"));
fs.writeFileSync(path.join(outDir, "aq_road_alignments_report.txt"), report.join("\n") + "\n");
// Exact horizontal elements (straights and bulge arcs, from station 0) for the component-road writer.
fs.writeFileSync(path.join(outDir, "aq_road_alignments.json"), JSON.stringify(roads.map((r) => ({ name: r.name, length: r.len, segs: r.segs }))));
const diffs = roads.map((r) => Math.abs(r.len - r.plen));
console.log(`written ${roads.length} roads (max length diff ${Math.max(...diffs).toFixed(4)} m); left out ${report.length - roads.length}: see aq_road_alignments_report.txt`);
