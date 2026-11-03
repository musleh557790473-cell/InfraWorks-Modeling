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
// 3D centreline: every 5 m (2 m on arcs), element ends, VC ends.
const st = new Set([0, total]); for (let s = 5; s < total; s += 5) st.add(s); H.forEach((e) => st.add(e.s0));
H.filter((e) => e.kind === "arc").forEach((e) => { for (let s = e.s0 + 2; s < e.s0 + e.len; s += 2) st.add(s); });
pvis.forEach((p) => { if (p.L) { st.add(p.s - p.L / 2); st.add(p.s + p.L / 2); } });
// stations closer than 1 mm (an element end next to a 5 m tick) give a zero-length segment, an undefined
// direction and NaN edge points (R.1.G.8 drew walls down to nowhere): keep one of them
const sts = [...st].filter((s) => s >= 0 && s <= total).sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1] > 1e-3);
sts[sts.length - 1] = total; // the road still ends exactly at the alignment end
const line3d = sts.map((s) => [...xy(s), zAt(s)]);
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
// ---------- derived rows (the road body InfraWorks draws), computed from this road's own geometry.
// InfraWorks draws PRIMITIVES / TERRAIN_OPERATIONS as stored and rebuilds them only when the road
// is edited, so copying the template's rows drew every new road at the template's place.
// Layout follows the template: one multiMorphingCrossSection per strip (same cross-sections, path =
// centreline with a mirrored ghost point at each end, vertexIndices [0, n-1]), a symbolizedPath for
// the marking, and grading as a ring: start transition, right edge, end transition, left edge (keys
// are the four corners), plus a CutOut polygon.
const bboxBlob = (pts, m) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m;
  const b = Buffer.alloc(96); [3, 0, 1, 5].forEach((v, i) => b.writeUInt32LE(v, 4 * i)); [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].forEach((p, i) => { b.writeDoubleLE(p[0], 16 + 16 * i); b.writeDoubleLE(p[1], 24 + 16 * i); }); return b; };
const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const jpts = (pts) => "[" + pts.map((p) => `[ ${p.map(num).join(", ")} ]`).join(",") + "]";
function derivedRows(tPrim, tTop, line, gradingLimit, sec) {
  const n = line.length, p0 = line[0], p1 = line[1], pn = line[n - 1], pm = line[n - 2];
  const path = [[2 * p0[0] - p1[0], 2 * p0[1] - p1[1], p1[2]], ...line, [2 * pn[0] - pm[0], 2 * pn[1] - pm[1], pm[2]]];
  // left normal at each vertex (average of adjacent segment directions)
  const nrm = line.map((p, i) => { const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [-dy / l, dx / l]; });
  // cross-section offset d > 0 is right of the direction of travel (template: x = +4 lies at -normal)
  const off = (d, dz = 0) => line.map((p, i) => [p[0] - nrm[i][0] * d, p[1] - nrm[i][1] * d, p[2] + dz]);
  if (sec) { // Parsons section: one strip per component, marking lines, edges at the outer top points
    const tStrip = tPrim.find((t) => JSON.parse(Buffer.from(t.JSON_DATA).toString("utf8")).type === "multiMorphingCrossSection");
    const tMark = tPrim.find((t) => JSON.parse(Buffer.from(t.JSON_DATA).toString("utf8")).type === "symbolizedPath");
    const strip = JSON.parse(Buffer.from(tStrip.JSON_DATA).toString("utf8")), mark = JSON.parse(Buffer.from(tMark.JSON_DATA).toString("utf8"));
    const part = (id) => (3n << 56n) | BigInt(id);
    const prims = sec.parts.map((p) => {
      const xs = p.crossSection.map((q) => q[0]);
      const j = { ...strip, path, vertexIndices: [0, n - 1], crossSections: [p.crossSection, p.crossSection], material: p.material, startCapMaterial: p.material, endCapMaterial: p.material };
      return { t: tStrip, part: part(p.id), json: Buffer.from(JSON.stringify(j), "utf8"), geom: bboxBlob([...off(Math.min(...xs)), ...off(Math.max(...xs))], 0.5) };
    });
    const laneId = sec.parts.find((p) => p.role === "lane").id;
    for (const x of sec.marking) { const ln = off(x); prims.push({ t: tMark, part: part(laneId), json: Buffer.from(JSON.stringify({ ...mark, path: [ln[0], ...ln, ln[n - 1]] }), "utf8"), geom: bboxBlob(ln, 0.5) }); }
    const B = sec.bound, left = off(B[0][0], B[0][1]), right = off(B.at(-1)[0], B.at(-1)[1]);
    const startT = B.map(([x, y]) => off(x, y)[0]), endT = B.slice().reverse().map(([x, y]) => off(x, y)[n - 1]);
    return { prims, startT, endT, rightEdge: right, leftEdgeRev: left.slice().reverse(), cut: [...right, ...left.slice().reverse(), right[0]], gradingLimit };
  }
  const prims = tPrim.map((t) => {
    const j = JSON.parse(Buffer.from(t.JSON_DATA).toString("utf8"));
    let geomPts;
    if (j.type === "multiMorphingCrossSection") {
      const xs = j.crossSections.flat().map((q) => q[0]); const lo = Math.min(...xs), hi = Math.max(...xs);
      j.path = path; j.vertexIndices = [0, n - 1]; geomPts = [...off(lo), ...off(hi)];
    } else { j.path = [line[0], ...line, line[n - 1]]; geomPts = line; }
    return { t, json: Buffer.from(JSON.stringify(j), "utf8"), geom: bboxBlob(geomPts, 0.5) };
  });
  // edge offsets from the template's outermost cross-section points
  const allX = tPrim.flatMap((t) => { const j = JSON.parse(Buffer.from(t.JSON_DATA).toString("utf8")); return j.crossSections ? j.crossSections.flat().map((q) => q[0]) : []; });
  const L = Math.min(...allX), R = Math.max(...allX);
  const left = off(L), right = off(R);
  // Transitions run across the road ends through every strip boundary (template: 5 points, left to right at the start).
  const xsUp = [...new Set(allX)].sort((a, b) => a - b);
  const startT = xsUp.map((x) => off(x)[0]);
  const endT = xsUp.slice().reverse().map((x) => off(x)[n - 1]);
  return { prims, startT, endT, rightEdge: right, leftEdgeRev: left.slice().reverse(), cut: [...right, ...left.slice().reverse(), right[0]], gradingLimit };
}
// Rows for one road: PRIMITIVES and TERRAIN_OPERATIONS, ring keys = corners (left-start, right-start, right-end, left-end).
function insertDerived(tPrim, tTop, roadGuid, rpsOld, rpsNew, line, sec) {
  const grading = JSON.parse(String(tRoad.GRADING_DATA || "{}")).gradingComponent || {};
  const d = derivedRows(tPrim, tTop, line, grading.gradingLimit || 5, sec);
  for (const p of d.prims) insert("PRIMITIVES", p.t, { GUID: randomUUID(), FK_PARENT_GUID: roadGuid, ...(p.part != null ? { PARENT_PART_ID: p.part } : {}), GROUP_URN: String(p.t.GROUP_URN).replace(rpsOld, rpsNew), JSON_DATA: p.json, GEOMETRY: p.geom });
  const K = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const bbox3 = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[2]))];
  const gradingJson = (coords, comp) => `{"type": "Grading","footprint": {"type": "LineString","bbox": [ ${bbox3(coords).map(num).join(", ")} ],"coordinates": ${jpts(coords)}},"gradingComponent": ${JSON.stringify(comp)}}`;
  const tByOrder = tTop.slice().sort((a, b) => Number(a.ID) - Number(b.ID)); // template order: start T, end T, right edge, left edge, CutOut
  const [tS, tE, tR, tL, tC] = tByOrder;
  const compOf = (t) => JSON.parse(Buffer.from(t.TERRAIN_OPERATION).toString("utf8")).gradingComponent;
  const m = d.gradingLimit + 2;
  const rows = [
    [tS, gradingJson(d.startT, compOf(tS)), d.startT, K[0], K[1]],
    [tE, gradingJson(d.endT, compOf(tE)), d.endT, K[2], K[3]],
    [tR, gradingJson(d.rightEdge, compOf(tR)), d.rightEdge, K[1], K[2]],
    [tL, gradingJson(d.leftEdgeRev, compOf(tL)), d.leftEdgeRev, K[3], K[0]],
    [tC, `{"type": "CutOut","footprint": {"type": "Polygon","bbox": [ ${bbox3(d.cut).map(num).join(", ")} ],"coordinates": [${jpts(d.cut)}]}}`, d.cut, null, null],
  ];
  for (const [t, json, pts, k1, k2] of rows) insert("TERRAIN_OPERATIONS", t, { GUID: randomUUID(), FK_PARENT_GUID: roadGuid, GROUP_URN: String(t.GROUP_URN).replace(rpsOld, rpsNew),
    TERRAIN_OPERATION: Buffer.from(json, "utf8"), GEOMETRY: bboxBlob(pts, t === tC ? 0 : m), START_POINT_KEY: k1, END_POINT_KEY: k2 });
}

// Parsons section from the ROW classification (--sections aq_road_sections.json); unclassified roads keep the template section.
const secFile = flags.includes("--sections") ? flags[flags.indexOf("--sections") + 1] : null;
const secType = secFile ? JSON.parse(fs.readFileSync(secFile, "utf8"))[name]?.type ?? null : null;
const xfFile = flags.includes("--xfall") ? flags[flags.indexOf("--xfall") + 1] : null; // per-road crossfall side (xfall.cjs)
const fall = xfFile ? JSON.parse(fs.readFileSync(xfFile, "utf8"))[name]?.fall ?? undefined : undefined;
const sec = secType ? require("./sections.cjs").build(secType, { fall }) : null;
const style = (() => { if (!sec) return {}; const s = JSON.parse(String(tRoad.MANUAL_STYLE)); s.componentStyle = JSON.stringify(sec.componentStyle);
  s.lanes = { ...s.lanes, countForward: sec.lanes, countBackward: sec.lanes }; return { MANUAL_STYLE: JSON.stringify(s, null, "\t"), MAX_SPEED: sec.speed }; })();
console.log(`${name}: section ${secType ?? "template (unclassified)"}${sec ? `, ${sec.width} m, ${sec.speed} km/h` : ""}`);
let existing = one("select count(*) n from ROADS where NAME=?", name).n > 0n;
const rewrite = flags.includes("--rewrite"); // delete the road (definition, constraints, body) and write it again
if (existing && !flags.includes("--regen") && !rewrite) throw new Error(`${name} already exists in the model`);
if (existing && rewrite) {
  db.exec("BEGIN");
  for (const r of all("select GUID, FK_PARENT_GUID from ROADS where NAME=?", name)) {
    if (r.FK_PARENT_GUID === TPL) throw new Error(`${name} is the template road`);
    for (const t of ["PRIMITIVES", "TERRAIN_OPERATIONS"]) db.prepare(`delete from ${t} where FK_PARENT_GUID=?`).run(r.GUID);
    for (const t of ["H_CONSTRAINTS", "V_CONSTRAINTS", "CONSTRAINED_DEF_GEOM_LOCATIONS", "CONSTRAINED_DEF_RPSYSTEMS", "ROADS"]) db.prepare(`delete from ${t} where FK_PARENT_GUID=?`).run(r.FK_PARENT_GUID);
    db.prepare("delete from CONSTRAINED_DEFINITIONS where GUID=?").run(r.FK_PARENT_GUID);
  }
  db.exec("COMMIT"); existing = false; console.log(`${name}: old road deleted`);
}

const insert = (table, tpl, over) => {
  const row = { ...tpl, ...over }; delete row.ID;
  const cols = Object.keys(row);
  db.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
};
const nulls = (tpl, keep) => Object.fromEntries(Object.keys(tpl).filter((k) => !keep.includes(k)).map((k) => [k, null]));

db.exec("BEGIN");
if (existing) { // --regen: recompute only the body of a road already in the model
  const road = one("select GUID, FK_PARENT_GUID from ROADS where NAME=?", name);
  const rps = one("select GUID from CONSTRAINED_DEF_RPSYSTEMS where FK_PARENT_GUID=?", road.FK_PARENT_GUID);
  db.prepare("delete from PRIMITIVES where FK_PARENT_GUID=?").run(road.GUID);
  db.prepare("delete from TERRAIN_OPERATIONS where FK_PARENT_GUID=?").run(road.GUID);
  insertDerived(tPrim, tTop, road.GUID, tRps.GUID, rps.GUID, line3d, sec);
  db.prepare("update ROADS set GEOMETRY=? where GUID=?").run(lineBlob(line3d), road.GUID);
  if (sec) db.prepare("update ROADS set MANUAL_STYLE=?, MAX_SPEED=? where GUID=?").run(style.MANUAL_STYLE, style.MAX_SPEED, road.GUID);
  db.prepare("update CONSTRAINED_DEF_RPSYSTEMS set GEOMETRY=? where GUID=?").run(lineBlob(line3d), rps.GUID);
  db.exec("COMMIT"); console.log(`${name}: body recomputed`); process.exit(0);
}
const gCD = randomUUID(), gRoad = randomUUID(), gRps = randomUUID();
const start = line3d[0], end = line3d.at(-1);
insert("CONSTRAINED_DEFINITIONS", tCD, { GUID: gCD, NAME: name, FK_DEFAULT_ASSET_GUID: gRoad, REFERENCE_POINT: pt3Blob(...start) });
insert("ROADS", tRoad, { GUID: gRoad, NAME: name, FK_PARENT_GUID: gCD, GEOMETRY: lineBlob(line3d), ...style });
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
// JSON_RANGE_HASH is InfraWorks' cache key for the derived rows: copied as is, it says the template's
// cached shapes are valid (copy D: the new road was not drawn). Zero the hash values to force a rebuild.
const staleHash = Buffer.from(Buffer.from(tRps.JSON_RANGE_HASH).toString("utf8").replace(/"Value": "[0-9A-F]{32}"/g, `"Value": "${"0".repeat(32)}"`), "utf8");
insert("CONSTRAINED_DEF_RPSYSTEMS", tRps, { GUID: gRps, FK_PARENT_GUID: gCD, GEOMETRY: lineBlob(line3d), LENGTH_2D: total, JSON_RANGE_HASH: staleHash });
insertDerived(tPrim, tTop, gRoad, tRps.GUID, gRps, line3d, sec);
db.exec("COMMIT");
console.log(`written: definition ${gCD}, road ${gRoad}; ${H.length} H, ${chain.length} V rows, ${tPrim.length} primitives, ${tTop.length} terrain operations computed`);
