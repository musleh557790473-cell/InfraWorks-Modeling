// Check each road's chainage direction against Parsons' grading surface: the profile (PVIs) laid along
// the alignment should follow the surface at a steady offset (the pavement, ~0.6-0.8 m). When the
// profile fits clearly better from the other end, the alignment was chained from the wrong end
// (R.0.D.15, R.5.G.1: road rising 6 m where the surface falls 6 m): reverse it.
// Usage: node orient.cjs <aq_road_alignments.json> <aq-road-pvis.json> <surface.xml> [--write]
const fs = require("fs");
const { loadSurface, at, reverseSegs } = require("./tin.cjs");
const [alignPath, pviPath, xmlPath, ...flags] = process.argv.slice(2);
const roads = JSON.parse(fs.readFileSync(alignPath, "utf8")), pvis = JSON.parse(fs.readFileSync(pviPath, "utf8"));
const zs = loadSurface(xmlPath);
const prof = (pv, s) => { for (let i = 1; i < pv.length; i++) if (s <= pv[i].s + 1e-9) { const a = pv[i - 1], b = pv[i]; return a.z + ((b.z - a.z) * (s - a.s)) / (b.s - a.s); } return pv.at(-1).z; };
// spread of (profile - surface) around its median: small when the profile follows the surface
function spread(segs, pv, L) {
  const d = [];
  for (let s = Math.min(15, L / 4); s <= L - Math.min(15, L / 4); s += 5) { const q = at(segs, s); if (!q) continue; const t = zs(q.p[0], q.p[1]); if (t != null) d.push(prof(pv, s) - t); }
  if (d.length < 3) return null;
  const m = d.slice().sort((a, b) => a - b)[d.length >> 1];
  return d.reduce((a, v) => a + Math.abs(v - m), 0) / d.length;
}
const flipped = [], report = [];
for (const r of roads) {
  const pv = pvis[r.name]; if (!pv || pv.some((p) => p.z == null)) continue;
  const fwd = spread(r.segs, pv, r.length), rev = spread(reverseSegs(r.segs), pv, r.length);
  if (fwd == null || rev == null) continue;
  const flip = fwd > 0.3 && rev < fwd / 3;
  report.push(`${r.name}\t${fwd.toFixed(3)}\t${rev.toFixed(3)}${flip ? "\tREVERSED" : fwd > 0.3 ? "\tCHECK" : ""}`);
  if (flip) { flipped.push(r.name); if (flags.includes("--write")) r.segs = reverseSegs(r.segs); }
}
console.log("road\tspread as chained\tspread reversed (m)"); report.filter((l) => /REVERSED|CHECK/.test(l)).forEach((l) => console.log(l));
console.log(report.length, "roads checked;", flipped.length, "chained from the wrong end:", flipped.join(" "));
if (flags.includes("--write") && flipped.length) { fs.writeFileSync(alignPath, JSON.stringify(roads)); console.log("rewrote", alignPath); }
