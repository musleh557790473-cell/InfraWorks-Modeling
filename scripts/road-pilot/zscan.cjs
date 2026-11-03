// Find road rows with levels far from the road's own range (spikes, curtains, floating bodies).
// Usage: node zscan.cjs <model.sqlite>
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
db.setReadBigInts?.(true);
const lineZ = (blob) => { const b = Buffer.from(blob); const n = b.readUInt32LE(8); const z = []; for (let i = 0; i < n; i++) z.push(b.readDoubleLE(12 + i * 24 + 16)); return z; };
const zsOf = (v, out = []) => { if (Array.isArray(v)) { if (v.length === 3 && v.every((x) => typeof x === "number")) out.push(v[2]); else v.forEach((x) => zsOf(x, out)); } else if (v && typeof v === "object") Object.values(v).forEach((x) => zsOf(x, out)); return out; };
const roads = db.prepare("select GUID, NAME, GEOMETRY from ROADS where NAME like 'R.%'").all();
const bad = [];
for (const r of roads) {
  const z = lineZ(r.GEOMETRY), lo = Math.min(...z), hi = Math.max(...z);
  const issues = [];
  if (hi - lo > 30 || lo < 600 || hi > 800) issues.push(`centreline z ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  for (const p of db.prepare("select JSON_DATA from PRIMITIVES where FK_PARENT_GUID=?").all(r.GUID)) {
    const s = Buffer.from(p.JSON_DATA).toString("utf8"); if (s.includes("NaN") || s.includes("null")) { issues.push("NaN in primitive"); break; } const j = JSON.parse(s); const pz = zsOf(j.path || []);
    if (pz.length && (Math.min(...pz) < lo - 1 || Math.max(...pz) > hi + 1)) { issues.push(`prim ${j.type} z ${Math.min(...pz).toFixed(2)}..${Math.max(...pz).toFixed(2)}`); break; }
  }
  for (const t of db.prepare("select TERRAIN_OPERATION from TERRAIN_OPERATIONS where FK_PARENT_GUID=?").all(r.GUID)) {
    const s = Buffer.from(t.TERRAIN_OPERATION).toString("utf8"); if (s.includes("NaN")) { issues.push("NaN in terrain operation"); break; } const j = JSON.parse(s); const tz = zsOf(j.footprint?.coordinates || []);
    if (tz.length && (Math.min(...tz) < lo - 1 || Math.max(...tz) > hi + 1)) { issues.push(`${j.type} z ${Math.min(...tz).toFixed(2)}..${Math.max(...tz).toFixed(2)}`); break; }
  }
  if (issues.length) bad.push(`${r.NAME}: ${issues.join("; ")}`);
}
console.log(roads.length, "roads,", bad.length, "with level problems"); bad.forEach((l) => console.log("  ", l));
