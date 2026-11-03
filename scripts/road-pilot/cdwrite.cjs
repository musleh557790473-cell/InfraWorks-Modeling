// Replace the vertical profile of one InfraWorks component road with given PVIs, and name it.
// Usage: node cdwrite.cjs <model.sqlite> <constrained-def GUID> <name> '<[[station, elev, vcLength], ...]>' [--drop-derived]
// Works on a straight-only horizontal alignment (one or more H straights); writes V tangents
// (CONSTRAINT_TYPE 15) between PVIs and a vertical curve row (18, CURVE_TYPE 4096 sag / 4097 crest,
// PARAM_1 = length) at every PVI with a length > 0. Write to a copy of the model only.
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const [model, G, name, pviJson, ...flags] = process.argv.slice(2);
const pvis = JSON.parse(pviJson);
const db = new DatabaseSync(model, { enableDoubleQuotedStringLiterals: true });

const pt = (b) => { b = Buffer.from(b); return [b.readDoubleLE(8), b.readDoubleLE(16)]; };
const ptBlob = (x, y) => { const b = Buffer.alloc(32); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); return b; };
const segBlob = (a, c) => { const b = Buffer.alloc(60); b.writeUInt32LE(2, 0); b.writeUInt32LE(1, 4); b.writeUInt32LE(2, 8); [...a, ...c].forEach((v, i) => b.writeDoubleLE(v, 12 + 8 * i)); return b; };
const order = (rows, prev, next) => { const by = new Map(rows.map((r) => [r.GUID, r])); let cur = rows.find((r) => !r[prev] || !by.has(r[prev])); const out = []; while (cur) { out.push(cur); cur = by.get(cur[next]); } return out; };

// Horizontal: chain of straights -> station to XY.
const H = order(db.prepare("select * from H_CONSTRAINTS where FK_PARENT_GUID=?").all(G), "FK_PREV_H_CONSTRAINTS_GUID", "FK_NEXT_H_CONSTRAINTS_GUID");
if (H.some((h) => h.CONSTRAINT_TYPE !== 3)) throw new Error("only straight alignments are handled so far");
const segs = []; let s0 = 0;
for (const h of H) { const a = pt(h.PASSTHROUGH_PT_1), b = pt(h.PASSTHROUGH_PT_2); const L = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ a, b, s0, L }); s0 += L; }
const xy = (s) => { const g = segs.find((q) => s <= q.s0 + q.L + 1e-6) || segs.at(-1); const t = (s - g.s0) / g.L; return [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t]; };
const total = s0;
if (Math.abs(pvis[0][0]) > 1e-3 || Math.abs(pvis.at(-1)[0] - total) > 0.01) throw new Error(`PVIs span ${pvis[0][0]}..${pvis.at(-1)[0]}, alignment is 0..${total.toFixed(3)}`);

const tpl = db.prepare("select * from V_CONSTRAINTS where FK_PARENT_GUID=? and CONSTRAINT_TYPE=15").get(G);
db.exec("BEGIN");
db.prepare("delete from V_CONSTRAINTS where FK_PARENT_GUID=?").run(G);
// Chain: T0, [C1], T1, [C2], ... ; tangent i runs PVI i -> PVI i+1; curve at PVI i (interior) when L > 0.
const chain = [];
for (let i = 0; i + 1 < pvis.length; i++) {
  if (i > 0 && pvis[i][2] > 0) {
    const gin = (pvis[i][1] - pvis[i - 1][1]) / (pvis[i][0] - pvis[i - 1][0]);
    const gout = (pvis[i + 1][1] - pvis[i][1]) / (pvis[i + 1][0] - pvis[i][0]);
    chain.push({ type: 18, curve: gout > gin ? 4096 : 4097, L: pvis[i][2] });
  }
  chain.push({ type: 15, p: pvis[i], q: pvis[i + 1] });
}
chain.forEach((c) => (c.guid = randomUUID()));
const ins = db.prepare(`insert into V_CONSTRAINTS (GUID, GEOMETRY, FK_PARENT_TABLE, FK_PARENT_GUID, FK_PREV_V_CONSTRAINTS_GUID, FK_NEXT_V_CONSTRAINTS_GUID,
  CONSTRAINT_TYPE, CONSTRAINT_TYPE_DEFINITION, CURVE_TYPE, PASSTHROUGH_PT_1, PASSTHROUGH_PT_2, PARAM_1) values (?,?,?,?,?,?,?,?,?,?,?,?)`);
chain.forEach((c, k) => {
  const prev = chain[k - 1]?.guid ?? null, next = chain[k + 1]?.guid ?? null;
  if (c.type === 15) {
    const A = [...xy(c.p[0]), c.p[1]], B = [...xy(c.q[0]), c.q[1]];
    ins.run(c.guid, segBlob(A, B), tpl.FK_PARENT_TABLE, G, prev, next, 15, 0, null, ptBlob(c.p[0], c.p[1]), ptBlob(c.q[0], c.q[1]), null);
  } else ins.run(c.guid, null, tpl.FK_PARENT_TABLE, G, prev, next, 18, 0, c.curve, null, null, c.L);
});
const road = db.prepare("select GUID from ROADS where FK_PARENT_GUID=?").get(G).GUID;
db.prepare("update ROADS set NAME=? where GUID=?").run(name, road);
// ROADS.NAME alone does not show in the properties panel (copy A): name the definition too.
db.prepare("update CONSTRAINED_DEFINITIONS set NAME=? where GUID=?").run(name, G);
if (flags.includes("--drop-derived")) {
  for (const t of ["PRIMITIVES", "TERRAIN_OPERATIONS"]) console.log("deleted", t, db.prepare(`delete from ${t} where FK_PARENT_GUID=?`).run(road).changes);
}
db.exec("COMMIT");
console.log(`${name}: ${chain.filter((c) => c.type === 15).length} tangents, ${chain.filter((c) => c.type === 18).length} vertical curves, alignment ${total.toFixed(3)} m`);
