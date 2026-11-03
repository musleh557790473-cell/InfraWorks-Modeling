// Road centreline level against Parsons' grading surface: roads standing far above or below it
// (floating bodies, deep cut walls) and roads off the surface.
// Usage: node roadtin.cjs <model.sqlite> <surface.xml> [surface name] [road names to print point by point]
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const [model, xmlPath, surfName = "Al_Qairawan_Mass Grading"] = process.argv.slice(2);
const s = fs.readFileSync(xmlPath, "utf8"), b = s.slice(s.indexOf(`<Surface name="${surfName}"`));
const P = new Map(); for (const m of b.matchAll(/<P id="(\d+)">([^<]+)<\/P>/g)) { const [n, e, z] = m[2].trim().split(/\s+/).map(Number); P.set(m[1], [e, n, z]); }
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
const db = new DatabaseSync(model, { readOnly: true }); const detail = process.argv.slice(5);
const rows = [];
for (const r of db.prepare("select NAME, GEOMETRY from ROADS where NAME like 'R.%'").all()) {
  const g = Buffer.from(r.GEOMETRY), n = g.readUInt32LE(8); let off = 0, max = 0, cnt = 0;
  for (let i = 0; i < n; i++) { const x = g.readDoubleLE(12 + 24 * i), y = g.readDoubleLE(20 + 24 * i), z = g.readDoubleLE(28 + 24 * i);
    const t = zAt(x, y); if (detail.includes(r.NAME)) console.log(r.NAME, i, z.toFixed(2), t == null ? "-" : t.toFixed(2), t == null ? "" : (z - t).toFixed(2)); if (t == null) { off++; continue; } cnt++; if (Math.abs(z - t) > Math.abs(max)) max = z - t; }
  rows.push({ name: r.NAME, pts: n, off, max: +max.toFixed(2) });
}
const bad = rows.filter((r) => r.off > 0 || Math.abs(r.max) > 0.5).sort((a, b) => Math.abs(b.max) - Math.abs(a.max));
console.log(rows.length, "roads;", bad.length, "off the surface or > 0.5 m from it");
for (const r of bad) console.log("  ", r.name, `max road - surface ${r.max} m`, r.off ? `(${r.off}/${r.pts} points off the surface)` : "");
