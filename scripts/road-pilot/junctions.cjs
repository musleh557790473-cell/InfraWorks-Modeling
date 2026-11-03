// Level check at junctions: where two road centrelines cross or one ends on another in plan, both
// roads should have (about) the same level. Large steps point to a reversed or misread profile.
// Usage: node junctions.cjs <model.sqlite> [min step m, default 0.3] [--road <name>]
const { DatabaseSync } = require("node:sqlite");
const args = process.argv.slice(2), model = args[0], minStep = +(args[1] && !args[1].startsWith("--") ? args[1] : 0.3);
const only = args.includes("--road") ? args[args.indexOf("--road") + 1] : null;
const db = new DatabaseSync(model, { readOnly: true });
const roads = db.prepare("select NAME, GEOMETRY from ROADS where NAME like 'R%'").all().map((r) => {
  const g = Buffer.from(r.GEOMETRY), n = g.readUInt32LE(8), p = [];
  for (let i = 0; i < n; i++) p.push([g.readDoubleLE(12 + 24 * i), g.readDoubleLE(20 + 24 * i), g.readDoubleLE(28 + 24 * i)]);
  return { name: r.NAME, p };
});
// nearest point of polyline q to point x (plan), with interpolated z
function near(q, x) {
  let best = null;
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1], b = q[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (!L2) continue;
    const t = Math.max(0, Math.min(1, ((x[0] - a[0]) * dx + (x[1] - a[1]) * dy) / L2));
    const px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x[0] - px, x[1] - py);
    if (!best || d < best.d) best = { d, z: a[2] + (b[2] - a[2]) * t };
  }
  return best;
}
const out = [];
for (const r of roads) for (const end of [0, r.p.length - 1]) { // road ends that sit on another road's centreline
  const x = r.p[end];
  for (const o of roads) { if (o === r) continue; const m = near(o.p, x); if (m && m.d < 1.0) out.push({ a: r.name, at: end ? "end" : "start", b: o.name, za: x[2], zb: m.z, step: x[2] - m.z }); }
}
const bad = out.filter((j) => Math.abs(j.step) >= minStep && (!only || j.a === only || j.b === only)).sort((p, q) => Math.abs(q.step) - Math.abs(p.step));
console.log(out.length, "junctions (road end on another centreline);", bad.length, `with a step >= ${minStep} m`);
for (const j of bad) console.log(`  ${j.a} ${j.at} ${j.za.toFixed(3)} on ${j.b} ${j.zb.toFixed(3)}: step ${j.step.toFixed(2)} m`);
