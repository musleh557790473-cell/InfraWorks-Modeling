// Build one 3D centreline per Parsons road (pieces chained from the 0+000 tick, arcs kept from
// bulges, Z = PGL from the profile FG line) and write a PolyLineZ shapefile for InfraWorks.
// Usage: node alignments.cjs <10200 dxf> <profiles.json> <roads package shp base (has NAME)> <out dir>
const fs = require("fs"), path = require("path");
const [dxf, profPath, pkgBase, outDir] = process.argv.slice(2);
const BLOCK = "Xref Road Layout Al Qairawan";

// --- read centrelines (with bulges) and chainage labels from the layout block
const L = fs.readFileSync(dxf, "latin1").split(/\r?\n/).map((x) => x.trim());
const s0 = L.indexOf("BLOCKS"), e0 = L.indexOf("ENTITIES");
let blk = null; const plines = [], chain0 = [];
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
const roads = [], report = [];
for (const [name, pieces] of byName) {
  const fg = profOf(name); if (!fg.length) { report.push(`${name}: no profile`); continue; }
  const ends = pieces.flatMap((s) => [s[0].a, s.at(-1).b]);
  const free = ends.filter((p) => ends.filter((q) => near(p, q)).length === 1);
  const start = free.sort((p, q) => Math.min(...chain0.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1]))) - Math.min(...chain0.map((c) => Math.hypot(c[0] - q[0], c[1] - q[1]))))[0];
  if (!start) { report.push(`${name}: no free end (a loop?)`); continue; }
  const left = pieces.slice(); let at = start; const segs = [];
  while (left.length) { const k = left.findIndex((s) => near(s[0].a, at) || near(s.at(-1).b, at)); if (k < 0) break; let s = left.splice(k, 1)[0]; if (!near(s[0].a, at)) s = rev(s); segs.push(...s); at = s.at(-1).b; }
  const len = segs.reduce((a, g) => a + segLen(g), 0), plen = fg.at(-1)[0];
  const note = left.length ? `${left.length} piece(s) not connected` : "";
  report.push(`${name}: plan ${len.toFixed(3)} profile ${plen.toFixed(3)} diff ${(len - plen).toFixed(3)} ${note}`);
  // vertices with station and PGL
  const zAt = (st) => { for (let i = 1; i < fg.length; i++) if (st <= fg[i][0] + 1e-9) { const a = fg[i - 1], b = fg[i]; return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (st - a[0])) / (b[0] - a[0]); } return fg.at(-1)[1]; };
  const pts = [[...segs[0].a, zAt(0)]]; let st = 0;
  for (const g of segs) { const ps = densify(g, 2); let prev = pts.at(-1); for (const p of ps) { st += Math.hypot(p[0] - prev[0], p[1] - prev[1]); pts.push([p[0], p[1], zAt(st)]); prev = p; } }
  // Only roads that chain fully and whose plan length equals the profile length (1 cm): stations are exact.
  if (!left.length && Math.abs(len - plen) < 0.01) roads.push({ name, pts, len, plen, connected: true });
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
const diffs = roads.map((r) => Math.abs(r.len - r.plen));
console.log(`written ${roads.length} roads (max length diff ${Math.max(...diffs).toFixed(4)} m); left out ${report.length - roads.length}: see aq_road_alignments_report.txt`);
