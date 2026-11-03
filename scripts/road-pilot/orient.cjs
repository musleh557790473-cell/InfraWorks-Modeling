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
// Junctions: a road end lying on another road's centreline should share its level. Each road as a
// 3D polyline (every 2 m) from its current chaining; a candidate reversal must not break a junction
// (R.13.G.5: the surface said reverse, but its end met R.13.G.6 at exactly the same level).
const poly = (segs, pv, L) => { const p = []; for (let s = 0; s <= L + 1e-9; s += Math.min(2, L)) { const q = at(segs, Math.min(s, L)); if (q) p.push([...q.p, prof(pv, Math.min(s, L))]); } return p; };
const lines = new Map(roads.filter((r) => pvis[r.name] && !pvis[r.name].some((p) => p.z == null)).map((r) => [r.name, poly(r.segs, pvis[r.name], r.length)]));
function zNear(q, x) {
  let best = null;
  for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (!L2) continue;
    const t = Math.max(0, Math.min(1, ((x[0] - a[0]) * dx + (x[1] - a[1]) * dy) / L2)), d = Math.hypot(x[0] - a[0] - dx * t, x[1] - a[1] - dy * t);
    if (!best || d < best.d) best = { d, z: a[2] + (b[2] - a[2]) * t }; }
  return best;
}
// summed level step at this road's two ends against the roads they sit on (null: no junction)
function junctionStep(name, segs, pv, L) {
  const p = poly(segs, pv, L); let sum = 0, n = 0;
  for (const x of [p[0], p.at(-1)]) for (const [o, q] of lines) { if (o === name) continue; const m = zNear(q, x); if (m && m.d < 1.0) { sum += Math.abs(x[2] - m.z); n++; } }
  return n ? sum : null;
}
const flipped = [], report = [];
for (const r of roads) {
  const pv = pvis[r.name]; if (!pv || pv.some((p) => p.z == null)) continue;
  const fwd = spread(r.segs, pv, r.length), rev = spread(reverseSegs(r.segs), pv, r.length);
  if (fwd == null || rev == null) continue;
  const jf = junctionStep(r.name, r.segs, pv, r.length), jr = junctionStep(r.name, reverseSegs(r.segs), pv, r.length);
  const surfaceSays = fwd > 0.3 && rev < fwd / 3, junctionsAgree = jf == null || jr <= jf + 0.05;
  const flip = surfaceSays && junctionsAgree;
  report.push(`${r.name}\t${fwd.toFixed(3)}\t${rev.toFixed(3)}\tjunctions ${jf == null ? "-" : jf.toFixed(2)} / ${jr == null ? "-" : jr.toFixed(2)}${flip ? "\tREVERSED" : surfaceSays ? "\tKEPT (junctions)" : fwd > 0.3 ? "\tCHECK" : ""}`);
  if (flip) { flipped.push(r.name); if (flags.includes("--write")) r.segs = reverseSegs(r.segs); }
}
console.log("road\tspread as chained\tspread reversed (m)\tjunction steps as chained / reversed (m)"); report.filter((l) => /REVERSED|CHECK|KEPT/.test(l)).forEach((l) => console.log(l));
console.log(report.length, "roads checked;", flipped.length, "chained from the wrong end:", flipped.join(" "));
if (flags.includes("--write") && flipped.length) { fs.writeFileSync(alignPath, JSON.stringify(roads)); console.log("rewrote", alignPath); }
