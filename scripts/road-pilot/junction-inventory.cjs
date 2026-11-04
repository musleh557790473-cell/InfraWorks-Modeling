// Junction inventory from Parsons' layout (via the dry-run alignments): every place where a road end
// lies on another centreline (T / arm) or two centrelines cross away from their ends (X), grouped by
// location, with the angles; roundabouts (RA-*) with their arms. Then the kerb return radii: arcs on
// -RD_Edges near each junction. Read-only.
const fs = require("fs");
const D = require("C:/dev/InfraWorks-Modeling/packages/domain/dist/index.js");
const [dxf, dir, out] = process.argv.slice(2);
const al = JSON.parse(fs.readFileSync(dir + "/road-alignments.json", "utf8"));
const ents = D.readDxfBlock(fs.readFileSync(dxf, "latin1"), "Xref Road Layout Al Qairawan");
const poly = (r) => { const o = []; for (let s = 0; s <= r.length + 1e-9; s += 1) { const q = D.pointAtStation(r.segs, Math.min(s, r.length)); o.push({ p: q.p, u: q.u, s: Math.min(s, r.length) }); } return o; };
const P = new Map(al.map((r) => [r.name, poly(r)]));
const nearOn = (q, x) => { let b = null; for (let i = 1; i < q.length; i++) { const a = q[i - 1].p, c = q[i].p, dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) continue; const t = Math.max(0, Math.min(1, ((x[0] - a[0]) * dx + (x[1] - a[1]) * dy) / l2)), d = Math.hypot(x[0] - a[0] - dx * t, x[1] - a[1] - dy * t); if (!b || d < b.d) b = { d, s: q[i - 1].s + (q[i].s - q[i - 1].s) * t, u: q[i - 1].u, p: [a[0] + dx * t, a[1] + dy * t] }; } return b; };
const ang = (u, v) => { let a = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])) * 180 / Math.PI; return a > 90 ? 180 - a : a; };
const hits = [];
// road ends on other centrelines
for (const r of al) { const q = P.get(r.name); for (const [at, e] of [["start", q[0]], ["end", q.at(-1)]]) for (const o of al) { if (o === r) continue; const m = nearOn(P.get(o.name), e.p); if (m && m.d < 1) hits.push({ kind: "end", road: r.name, at, on: o.name, sOn: m.s, p: e.p, angle: ang(e.u, m.u) }); } }
// crossings away from ends (both > 3 m from their ends)
for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
  const A = P.get(al[i].name), B = P.get(al[j].name);
  for (let a = 1; a < A.length; a++) for (let b = 1; b < B.length; b++) {
    const p1 = A[a - 1].p, p2 = A[a].p, p3 = B[b - 1].p, p4 = B[b].p, den = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]); if (Math.abs(den) < 1e-12) continue;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / den, v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / den;
    if (t < 0 || t > 1 || v < 0 || v > 1) continue;
    const sa = A[a - 1].s + t, sb = B[b - 1].s + v;
    if (sa < 3 || sa > al[i].length - 3 || sb < 3 || sb > al[j].length - 3) continue;
    hits.push({ kind: "cross", road: al[i].name, sRoad: sa, on: al[j].name, sOn: sb, p: [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t], angle: ang(A[a - 1].u, B[b - 1].u) });
  }
}
// group hits within 15 m into junctions
const J = [];
for (const h of hits) { let j = J.find((x) => Math.hypot(x.p[0] - h.p[0], x.p[1] - h.p[1]) < 15); if (!j) { j = { p: h.p, hits: [] }; J.push(j); } j.hits.push(h); }
for (const j of J) {
  const roads = new Set(j.hits.flatMap((h) => [h.road, h.on]));
  j.roads = [...roads];
  j.ra = j.roads.filter((n) => n.startsWith("RA-"));
  const ends = j.hits.filter((h) => h.kind === "end").length, cross = j.hits.filter((h) => h.kind === "cross").length;
  j.type = j.ra.length ? "roundabout arm" : cross ? (roads.size > 2 ? "X+" : "X") : roads.size === 2 ? "T" : `${roads.size}-way`;
  j.angles = [...new Set(j.hits.map((h) => Math.round(h.angle)))];
}
// kerb returns: arcs on -RD_Edges with a centre-of-arc point within 25 m of a junction
const arcs = [];
for (const e of ents.filter((e) => e.layer === "-RD_Edges" && e.type === "LWPOLYLINE")) for (let k = 0; k < e.x.length - 1; k++) {
  const b = e.bulge[k]; if (!b) continue; const g = { a: [e.x[k], e.y[k]], b: [e.x[k + 1], e.y[k + 1]], bulge: b };
  const th = 4 * Math.atan(b), c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), r = c / (2 * Math.sin(Math.abs(th) / 2));
  arcs.push({ mid: [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2], r, deg: Math.abs(th) * 180 / Math.PI });
}
for (const j of J) j.kerbRadii = arcs.filter((a) => Math.hypot(a.mid[0] - j.p[0], a.mid[1] - j.p[1]) < 25 && a.r < 40 && a.deg > 30).map((a) => +a.r.toFixed(2)).sort((a, b) => a - b);
const hist = (f) => J.reduce((m, j) => { const k = f(j); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log("junctions", J.length, JSON.stringify(hist((j) => j.type)));
const radii = J.flatMap((j) => j.kerbRadii), rh = {}; radii.forEach((r) => (rh[r.toFixed(1)] = (rh[r.toFixed(1)] || 0) + 1));
console.log("kerb return radii (arcs > 30 deg, r < 40 m, within 25 m):", JSON.stringify(Object.entries(rh).sort((a, b) => b[1] - a[1]).slice(0, 12)));
console.log("junctions without a kerb arc:", J.filter((j) => !j.kerbRadii.length).length);
const angs = {}; J.forEach((j) => j.angles.forEach((a) => { const k = a >= 85 ? "85-90" : a >= 70 ? "70-85" : a >= 45 ? "45-70" : "<45"; angs[k] = (angs[k] || 0) + 1; }));
console.log("angles:", JSON.stringify(angs));
fs.writeFileSync(out, JSON.stringify(J.map((j) => ({ type: j.type, at: j.p.map((v) => +v.toFixed(2)), roads: j.roads, angles: j.angles, kerbRadii: j.kerbRadii, hits: j.hits.map((h) => ({ kind: h.kind, road: h.road, at: h.at, on: h.on, sOn: +h.sOn.toFixed(2) })) })), null, 1));
console.log("written", out);
