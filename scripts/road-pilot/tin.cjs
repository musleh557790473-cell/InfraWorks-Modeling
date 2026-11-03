// Shared helpers: Parsons' LandXML surface (point lookup on a 20 m grid) and the point / direction at a
// station on chained alignment segments (straights + bulge arcs).
const fs = require("fs");
function loadSurface(xmlPath, surfName = "Al_Qairawan_Mass Grading") {
  const s = fs.readFileSync(xmlPath, "utf8"), b = s.slice(s.indexOf(`<Surface name="${surfName}"`));
  const P = new Map(); for (const m of b.matchAll(/<P id="(\d+)">([^<]+)<\/P>/g)) { const [n, e, z] = m[2].trim().split(/\s+/).map(Number); P.set(m[1], [e, n, z]); } // northing easting z
  const CELL = 20, grid = new Map(), key = (i, j) => `${i},${j}`;
  for (const m of b.matchAll(/<F(?: [^>]*)?>([^<]+)<\/F>/g)) {
    const t = m[1].trim().split(/\s+/).map((i) => P.get(i)); if (t.some((v) => !v)) continue;
    const xs = t.map((v) => v[0]), ys = t.map((v) => v[1]);
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
      for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  }
  return (x, y) => {
    for (const [a, b2, c] of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) || []) {
      const d = (b2[1] - c[1]) * (a[0] - c[0]) + (c[0] - b2[0]) * (a[1] - c[1]);
      const l1 = ((b2[1] - c[1]) * (x - c[0]) + (c[0] - b2[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a[2] + l2 * b2[2] + l3 * c[2];
    }
    return null;
  };
}
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
// the same alignment chained from its other end (segments reversed, arcs turn the other way)
const reverseSegs = (segs) => segs.slice().reverse().map((g) => ({ ...g, a: g.b, b: g.a, ...(g.bulge ? { bulge: -g.bulge } : {}) }));
module.exports = { loadSurface, at, reverseSegs };
