// Add a NEW InfraWorks component road by cloning an existing (converted) one as a template,
// with Parsons' exact horizontal elements (straights, arcs) and vertical PVIs / curves.
// Usage: node cdnew.cjs <model.sqlite> <template constrained-def GUID> <road name> <aq_road_alignments.json> <aq-road-pvis.json> [--dry]
// Derived rows (PRIMITIVES, TERRAIN_OPERATIONS) are copied from the template: InfraWorks needs them
// present (copy B lost its road without them) and rebuilds the shape from the constraints (copy A).
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const fs = require("fs");
const [model, TPL, name, alignPath, pviPath, ...flags] = process.argv.slice(2);
const dry = flags.includes("--dry");

// ---------- Parsons geometry
const al = JSON.parse(fs.readFileSync(alignPath, "utf8")).find((r) => r.name === name);
if (!al) throw new Error(`${name}: not in ${alignPath}`);
const pv = JSON.parse(fs.readFileSync(pviPath, "utf8"))[name];
if (!pv) throw new Error(`${name}: no PVIs`);
const pvis = pv.map((p) => ({ s: p.s, z: p.z, L: p.L || 0 }));
if (pvis.some((p) => p.z == null)) throw new Error(`${name}: a PVI has no level`);

// Horizontal elements: straight {a,b} or arc {a,m,b,c,r,a0,th}
const H = al.segs.map((g) => {
  const c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
  if (!g.bulge) return { kind: "line", a: g.a, b: g.b, len: c };
  const th = 4 * Math.atan(g.bulge), r = c / (2 * Math.sin(Math.abs(th) / 2));
  const ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge);
  const cx = (g.a[0] + g.b[0]) / 2 - uy * h, cy = (g.a[1] + g.b[1]) / 2 + ux * h, a0 = Math.atan2(g.a[1] - cy, g.a[0] - cx);
  const m = [cx + r * Math.cos(a0 + th / 2), cy + r * Math.sin(a0 + th / 2)];
  return { kind: "arc", a: g.a, b: g.b, m, cx, cy, r, a0, th, len: r * Math.abs(th) };
});
let acc = 0; for (const e of H) { e.s0 = acc; acc += e.len; }
const total = acc;
const xy = (s) => {
  const e = H.find((q) => s <= q.s0 + q.len + 1e-9) || H.at(-1); const t = Math.min(1, Math.max(0, (s - e.s0) / e.len));
  if (e.kind === "line") return [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
  const a = e.a0 + e.th * t; return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)];
};
if (Math.abs(pvis[0].s) > 1e-3 || Math.abs(pvis.at(-1).s - total) > 0.01) throw new Error(`${name}: PVIs ${pvis[0].s}..${pvis.at(-1).s} vs alignment 0..${total.toFixed(3)}`);
// Profile level with symmetric parabolic vertical curves.
const zAt = (s) => {
  for (let i = 1; i < pvis.length - 1; i++) { const p = pvis[i]; if (!p.L) continue; const s1 = p.s - p.L / 2, s2 = p.s + p.L / 2;
    if (s >= s1 && s <= s2) { const gin = (p.z - pvis[i - 1].z) / (p.s - pvis[i - 1].s), gout = (pvis[i + 1].z - p.z) / (pvis[i + 1].s - p.s); const x = s - s1; return p.z - gin * (p.L / 2) + gin * x + ((gout - gin) / (2 * p.L)) * x * x; } }
  for (let i = 1; i < pvis.length; i++) if (s <= pvis[i].s + 1e-9) { const a = pvis[i - 1], b = pvis[i]; return a.z + ((b.z - a.z) * (s - a.s)) / (b.s - a.s); }
  return pvis.at(-1).z;
};
// 3D centreline: every 5 m, element ends, VC ends.
const st = new Set([0, total]); for (let s = 5; s < total; s += 5) st.add(s); H.forEach((e) => st.add(e.s0));
pvis.forEach((p) => { if (p.L) { st.add(p.s - p.L / 2); st.add(p.s + p.L / 2); } });
const line3d = [...st].filter((s) => s >= 0 && s <= total).sort((a, b) => a - b).map((s) => [...xy(s), zAt(s)]);
console.log(`${name}: ${H.filter((e) => e.kind === "line").length} straights, ${H.filter((e) => e.kind === "arc").length} arcs (R ${H.filter((e) => e.kind === "arc").map((e) => e.r.toFixed(1)).join(", ")}), ${total.toFixed(3)} m; ${pvis.length} PVIs, ${pvis.filter((p) => p.L).length} VCs; z ${line3d[0][2].toFixed(3)} -> ${line3d.at(-1)[2].toFixed(3)}`);
if (dry) process.exit(0);

// ---------- blobs
const ptBlob = (x, y) => { const b = Buffer.alloc(32); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); return b; };
const pt3Blob = (x, y, z) => { const b = ptBlob(x, y); b.writeDoubleLE(z, 24); return b; };
const lineBlob = (pts) => { const b = Buffer.alloc(12 + 24 * pts.length); b.writeUInt32LE(2, 0); b.writeUInt32LE(1, 4); b.writeUInt32LE(pts.length, 8); pts.forEach((p, i) => p.forEach((v, k) => b.writeDoubleLE(v, 12 + 24 * i + 8 * k))); return b; };

// ---------- template rows
const db = new DatabaseSync(model, { enableDoubleQuotedStringLiterals: true });
const all = (q, ...a) => { const s = db.prepare(q); s.setReadBigInts(true); return s.all(...a); };
const one = (q, ...a) => all(q, ...a)[0];
const tCD = one("select * from CONSTRAINED_DEFINITIONS where GUID=?", TPL);
const tRoad = one("select * from ROADS where FK_PARENT_GUID=?", TPL);
const tH = one("select * from H_CONSTRAINTS where FK_PARENT_GUID=? and CONSTRAINT_TYPE=3", TPL);
const tV = one("select * from V_CONSTRAINTS where FK_PARENT_GUID=? and CONSTRAINT_TYPE=15", TPL);
const tLoc = all("select * from CONSTRAINED_DEF_GEOM_LOCATIONS where FK_PARENT_GUID=? order by TYPE", TPL);
const tRps = one("select * from CONSTRAINED_DEF_RPSYSTEMS where FK_PARENT_GUID=?", TPL);
const tPrim = all("select * from PRIMITIVES where FK_PARENT_GUID=?", tRoad.GUID);
const tTop = all("select * from TERRAIN_OPERATIONS where FK_PARENT_GUID=?", tRoad.GUID);
if (one("select count(*) n from ROADS where NAME=?", name).n > 0n) throw new Error(`${name} already exists in the model`);

const insert = (table, tpl, over) => {
  const row = { ...tpl, ...over }; delete row.ID;
  const cols = Object.keys(row);
  db.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
};
const nulls = (tpl, keep) => Object.fromEntries(Object.keys(tpl).filter((k) => !keep.includes(k)).map((k) => [k, null]));

db.exec("BEGIN");
const gCD = randomUUID(), gRoad = randomUUID(), gRps = randomUUID();
const start = line3d[0], end = line3d.at(-1);
insert("CONSTRAINED_DEFINITIONS", tCD, { GUID: gCD, NAME: name, FK_DEFAULT_ASSET_GUID: gRoad, REFERENCE_POINT: pt3Blob(...start) });
insert("ROADS", tRoad, { GUID: gRoad, NAME: name, FK_PARENT_GUID: gCD, GEOMETRY: lineBlob(line3d) });
// Horizontal chain
const hG = H.map(() => randomUUID());
const hBase = { ...nulls(tH, ["FK_PARENT_TABLE"]) };
H.forEach((e, i) => insert("H_CONSTRAINTS", hBase, {
  GUID: hG[i], FK_PARENT_TABLE: tH.FK_PARENT_TABLE, FK_PARENT_GUID: gCD,
  FK_PREV_H_CONSTRAINTS_GUID: hG[i - 1] ?? null, FK_NEXT_H_CONSTRAINTS_GUID: hG[i + 1] ?? null,
  CONSTRAINT_TYPE: e.kind === "line" ? 3 : 4, CONSTRAINT_TYPE_DEFINITION: e.kind === "line" ? 0 : 2,
  PASSTHROUGH_PT_1: ptBlob(...e.a), PASSTHROUGH_PT_2: ptBlob(...(e.kind === "line" ? e.b : e.m)), PASSTHROUGH_PT_3: e.kind === "arc" ? ptBlob(...e.b) : null,
}));
// Vertical chain: tangents PVI->PVI, curve rows (18) at PVIs with L > 0
const chain = [];
for (let i = 0; i + 1 < pvis.length; i++) {
  if (i > 0 && pvis[i].L > 0) { const gin = (pvis[i].z - pvis[i - 1].z) / (pvis[i].s - pvis[i - 1].s), gout = (pvis[i + 1].z - pvis[i].z) / (pvis[i + 1].s - pvis[i].s); chain.push({ type: 18, curve: gout > gin ? 4096 : 4097, L: pvis[i].L }); }
  chain.push({ type: 15, p: pvis[i], q: pvis[i + 1] });
}
chain.forEach((c) => (c.g = randomUUID()));
const vBase = { ...nulls(tV, ["FK_PARENT_TABLE"]) };
chain.forEach((c, k) => insert("V_CONSTRAINTS", vBase, {
  GUID: c.g, FK_PARENT_TABLE: tV.FK_PARENT_TABLE, FK_PARENT_GUID: gCD,
  FK_PREV_V_CONSTRAINTS_GUID: chain[k - 1]?.g ?? null, FK_NEXT_V_CONSTRAINTS_GUID: chain[k + 1]?.g ?? null,
  CONSTRAINT_TYPE: c.type, CONSTRAINT_TYPE_DEFINITION: 0,
  ...(c.type === 15
    ? { GEOMETRY: lineBlob([[...xy(c.p.s), c.p.z], [...xy(c.q.s), c.q.z]]), PASSTHROUGH_PT_1: ptBlob(c.p.s, c.p.z), PASSTHROUGH_PT_2: ptBlob(c.q.s, c.q.z) }
    : { CURVE_TYPE: c.curve, PARAM_1: c.L }),
}));
// Start / end locations
for (const l of tLoc) {
  const isEnd = Number(l.TYPE) === 3, p = isEnd ? end : start;
  const g = Buffer.alloc(36); g.writeUInt32LE(2, 0); g.writeUInt32LE(1, 4); g.writeUInt32LE(1, 8); g.writeDoubleLE(p[0], 12); g.writeDoubleLE(p[1], 20); g.writeDoubleLE(0, 28);
  insert("CONSTRAINED_DEF_GEOM_LOCATIONS", l, { GUID: randomUUID(), FK_PARENT_GUID: gCD, GEOMETRY: g,
    FK_REFERENCE_H_CONSTRAINTS_GUID: isEnd ? hG.at(-1) : hG[0], SUB_ELEMENT: isEnd ? H.length : 1, PARAM: isEnd ? 1 : 0, STATION: isEnd ? total : 0 });
}
insert("CONSTRAINED_DEF_RPSYSTEMS", tRps, { GUID: gRps, FK_PARENT_GUID: gCD, GEOMETRY: lineBlob(line3d), LENGTH_2D: total });
// Derived rows, copied (keys remapped consistently)
const keyMap = new Map(); const remap = (k) => (k == null ? k : keyMap.get(k) || keyMap.set(k, randomUUID()).get(k));
const urn = (u) => (u == null ? u : String(u).replace(tRps.GUID, gRps));
tPrim.forEach((p) => insert("PRIMITIVES", p, { GUID: randomUUID(), FK_PARENT_GUID: gRoad, GROUP_URN: urn(p.GROUP_URN) }));
tTop.forEach((t) => insert("TERRAIN_OPERATIONS", t, { GUID: randomUUID(), FK_PARENT_GUID: gRoad, GROUP_URN: urn(t.GROUP_URN), START_POINT_KEY: remap(t.START_POINT_KEY), END_POINT_KEY: remap(t.END_POINT_KEY) }));
db.exec("COMMIT");
console.log(`written: definition ${gCD}, road ${gRoad}; ${H.length} H, ${chain.length} V rows, ${tPrim.length} primitives, ${tTop.length} terrain operations copied`);
