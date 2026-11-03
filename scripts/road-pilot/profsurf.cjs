// Profile minus grading surface along given roads (every 10 m), from the alignments and PVIs files:
// a steady ~0.5-0.8 m means the chain and profile fit; a drift or jump shows where they do not.
// Usage: node profsurf.cjs <aq_road_alignments.json> <aq-road-pvis.json> <surface.xml> <road> [road ...]
const fs = require("fs");
const { loadSurface, at } = require("./tin.cjs");
const [alignPath, pviPath, xmlPath, ...names] = process.argv.slice(2);
const roads = JSON.parse(fs.readFileSync(alignPath, "utf8")), pvis = JSON.parse(fs.readFileSync(pviPath, "utf8")), zs = loadSurface(xmlPath);
const prof = (pv, s) => { for (let i = 1; i < pv.length; i++) if (s <= pv[i].s + 1e-9) { const a = pv[i - 1], b = pv[i]; return a.z + ((b.z - a.z) * (s - a.s)) / (b.s - a.s); } return pv.at(-1).z; };
for (const n of names) {
  const r = roads.find((q) => q.name === n), pv = pvis[n]; if (!r || !pv) { console.log(n, "missing"); continue; }
  const row = []; for (let s = 0; s <= r.length; s += 10) { const q = at(r.segs, s); const t = q && zs(q.p[0], q.p[1]); row.push(`${s}:${t == null ? "-" : (prof(pv, s) - t).toFixed(2)}`); }
  console.log(n, r.length.toFixed(1), "m, PVIs", pv.map((p) => `${p.s.toFixed(0)}/${p.z == null ? "?" : p.z.toFixed(2)}`).join(" "));
  console.log("  ", row.join(" "));
}
