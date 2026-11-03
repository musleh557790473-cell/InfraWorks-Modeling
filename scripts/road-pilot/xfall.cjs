// Which side each local road's one-way crossfall falls to, read from Parsons' grading TIN (LandXML).
// Samples the surface 3.0 m left and right of the centreline every 5 m (away from the ends).
// Usage: node xfall.cjs <surface.xml> <aq_road_alignments.json> <aq_road_sections.json> <out.json> [surface name]
const fs = require("fs");
const [xmlPath, alignPath, secPath, outPath, surfName = "Al_Qairawan_Mass Grading"] = process.argv.slice(2);
const s = fs.readFileSync(xmlPath, "utf8"), b = s.slice(s.indexOf(`<Surface name="${surfName}"`));
const P = new Map(); for (const m of b.matchAll(/<P id="(\d+)">([^<]+)<\/P>/g)) { const [n, e, z] = m[2].trim().split(/\s+/).map(Number); P.set(m[1], [e, n, z]); } // northing easting z
const CELL = 20, grid = new Map(), key = (i, j) => `${i},${j}`;
for (const m of b.matchAll(/<F(?: [^>]*)?>([^<]+)<\/F>/g)) {
  const t = m[1].trim().split(/\s+/).map((i) => P.get(i)); if (t.some((v) => !v)) continue;
  const xs = t.map((v) => v[0]), ys = t.map((v) => v[1]);
  for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
    for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
}
function zAt(x, y) {
  for (const [a, b2, c] of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) || []) {
    const d = (b2[1] - c[1]) * (a[0] - c[0]) + (c[0] - b2[0]) * (a[1] - c[1]);
    const l1 = ((b2[1] - c[1]) * (x - c[0]) + (c[0] - b2[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a[2] + l2 * b2[2] + l3 * c[2];
  }
  return null;
}
// point and unit direction at station st on chained segments (straights + bulge arcs), as in rowclass.cjs
function at(segs, st) {
  for (const g of segs) {
    const c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); let len = c, th = 0, r = 0;
    if (g.bulge) { th = 4 * Math.atan(g.bulge); r = c / (2 * Math.sin(Math.abs(th) / 2)); len = r * Math.abs(th); }
    if (st <= len + 1e-9) {
      const t = st / len;
      if (!g.bulge) return { p: [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t], u: [(g.b[0] - g.a[0]) / c, (g.b[1] - g.a[1]) / c] };
      const ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge);
      const cx = (g.a[0] + g.b[0]) / 2 - uy * h, cy = (g.a[1] + g.b[1]) / 2 + ux * h, a = Math.atan2(g.a[1] - cy, g.a[0] - cx) + th * t, sg = Math.sign(th);
      return { p: [cx + r * Math.cos(a), cy + r * Math.sin(a)], u: [-Math.sin(a) * sg, Math.cos(a) * sg] };
    }
    st -= len;
  }
  return null;
}
const roads = JSON.parse(fs.readFileSync(alignPath, "utf8")), secs = JSON.parse(fs.readFileSync(secPath, "utf8"));
const OFF = 3.0, out = {}, hist = {};
for (const r of roads) {
  const type = secs[r.name]?.type; if (!type) continue;
  const slopes = [];
  for (let st = Math.min(15, r.length / 4); st <= r.length - Math.min(15, r.length / 4); st += 5) {
    const q = at(r.segs, st); if (!q) continue; const n = [-q.u[1], q.u[0]]; // n = left of the chainage direction
    const zl = zAt(q.p[0] + n[0] * OFF, q.p[1] + n[1] * OFF), zr = zAt(q.p[0] - n[0] * OFF, q.p[1] - n[1] * OFF), zc = zAt(q.p[0], q.p[1]);
    if (zl != null && zr != null && zc != null) slopes.push({ x: (zl - zr) / (2 * OFF), sym: (zl + zr) / 2 - zc });
  }
  const med = (a) => { const v = a.slice().sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };
  const x = med(slopes.map((v) => v.x)), sym = med(slopes.map((v) => v.sym));
  const right = slopes.filter((v) => v.x > 0.01).length, left = slopes.filter((v) => v.x < -0.01).length;
  // one-way fall only when most samples agree; a crowned road shows sym < 0 and x near 0
  const side = slopes.length < 3 ? "no data" : right >= 0.8 * slopes.length ? "right" : left >= 0.8 * slopes.length ? "left" : Math.abs(x) < 0.005 && sym < -0.01 ? "crown" : "mixed";
  // the side used for the model: the median sample's sign when it is a clear one-way fall (>= 1 %)
  const fall = x != null && Math.abs(x) >= 0.01 ? (x > 0 ? "right" : "left") : null;
  out[r.name] = { type, side, fall,xfall: x == null ? null : +x.toFixed(4), crown: sym == null ? null : +sym.toFixed(3), samples: slopes.length, right, left };
  const k = `${type.startsWith("A") ? "local" : "collector"} ${side}`; hist[k] = (hist[k] || 0) + 1;
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(hist, null, 1));
for (const [n, v] of Object.entries(out).slice(0, 15)) console.log("  ", n, JSON.stringify(v));
