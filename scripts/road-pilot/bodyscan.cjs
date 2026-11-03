// A road's body rows (PRIMITIVES paths, TERRAIN_OPERATIONS footprints): point counts and the range of
// distances from a centre (default: the centroid of the road's own centreline), read-only.
// Usage: node bodyscan.cjs <model.sqlite> <road name>
const { DatabaseSync } = require("node:sqlite");
const [model, name] = process.argv.slice(2);
const db = new DatabaseSync(model, { readOnly: true });
const r = db.prepare("select GUID, GEOMETRY from ROADS where NAME=?").get(name);
const g = Buffer.from(r.GEOMETRY), n = g.readUInt32LE(8), cl = [];
for (let i = 0; i < n; i++) cl.push([g.readDoubleLE(12 + 24 * i), g.readDoubleLE(20 + 24 * i), g.readDoubleLE(28 + 24 * i)]);
const c = [cl.reduce((a, p) => a + p[0], 0) / n, cl.reduce((a, p) => a + p[1], 0) / n];
const d = (p) => Math.hypot(p[0] - c[0], p[1] - c[1]);
const rng = (pts) => { const v = pts.map(d); return `${pts.length} pts, ${Math.min(...v).toFixed(1)}..${Math.max(...v).toFixed(1)} m from centre`; };
const pts3 = (v, out = []) => { if (Array.isArray(v)) { if (v.length >= 2 && v.every((x) => typeof x === "number")) out.push(v); else v.forEach((x) => pts3(x, out)); } return out; };
console.log(name, "centreline", rng(cl), "first", cl[0].map((v) => v.toFixed(2)).join(","), "last", cl.at(-1).map((v) => v.toFixed(2)).join(","));
for (const p of db.prepare("select JSON_DATA from PRIMITIVES where FK_PARENT_GUID=?").all(r.GUID)) { const j = JSON.parse(Buffer.from(p.JSON_DATA).toString("utf8")); console.log("  prim", j.type, rng(pts3(j.path || []))); }
for (const t of db.prepare("select TERRAIN_OPERATION from TERRAIN_OPERATIONS where FK_PARENT_GUID=? order by ID").all(r.GUID)) {
  const j = JSON.parse(Buffer.from(t.TERRAIN_OPERATION).toString("utf8")); const ps = pts3(j.footprint.coordinates);
  console.log("  terrain", j.type, j.gradingComponent?.gradingType || "", rng(ps), "first", ps[0].slice(0, 2).map((v) => v.toFixed(1)).join(","), "last", ps.at(-1).slice(0, 2).map((v) => v.toFixed(1)).join(","));
}
