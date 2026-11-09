import assert from "node:assert/strict";
import test from "node:test";

import { buildSection, type Alignment } from "@infraworks/domain";

import { junctionSteps, parseTieEnds, tieLevels } from "../src/roads/checks.js";
import { planRoad } from "../src/roads/plan.js";
import { bodyRows } from "../src/roads/write.js";

const flat = (len: number) => [{ s: 0, z: 690, L: 0 }, { s: len, z: 690, L: 0 }];

test("a roundabout drawn as one near-closed arc is split into quarter arcs (RA-2 had length 0.0 m)", () => {
  // one arc of ~360 degrees, start and end 1 cm apart (bulge = tan(theta / 4))
  const th = 2 * Math.PI - 0.0005, r = 20.2, c = 2 * r * Math.sin(th / 2);
  const al: Alignment = { name: "RA-2", length: r * th, segs: [{ a: [0, 0], b: [c, 0], bulge: Math.tan(th / 4) }] };
  const p = planRoad(al, flat(r * th));
  assert.equal(p.H.length, 4);
  assert.ok(p.H.every((e) => e.kind === "arc" && Math.abs(e.th) <= Math.PI / 2 + 1e-9));
  assert.ok(Math.abs(p.total - r * th) < 1e-9);
});

test("stations 1 mm apart are merged, so no zero-length segment gives NaN edges (R.1.G.8)", () => {
  // an element end at 4.9995 m, next to the 5 m tick
  const al: Alignment = { name: "R.1.G.8", length: 45, segs: [{ a: [0, 0], b: [4.9995, 0], bulge: 0 }, { a: [4.9995, 0], b: [45, 0], bulge: 0 }] };
  const p = planRoad(al, flat(45));
  for (let i = 1; i < p.line.length; i++) assert.ok(Math.hypot(p.line[i]![0] - p.line[i - 1]![0], p.line[i]![1] - p.line[i - 1]![1]) > 1e-3);
  const tpl = (type: string) => ({ JSON_DATA: Buffer.from(JSON.stringify({ type }), "utf8") });
  const body = bodyRows([tpl("multiMorphingCrossSection"), tpl("symbolizedPath")], p.line, buildSection("A1"));
  assert.ok([...body.rightEdge, ...body.leftEdgeRev, ...body.startT].flat().every((v) => isFinite(v)));
});

test("PVIs past the road end (next profile on the sheet) are dropped; a first PVI at 0.254 m is extended to 0", () => {
  const al: Alignment = { name: "R.X", length: 100, segs: [{ a: [0, 0], b: [100, 0], bulge: 0 }] };
  const p = planRoad(al, [{ s: 0.254, z: 683.613, L: 0 }, { s: 50, z: 684, L: 0 }, { s: 100, z: 685, L: 0 }, { s: 336.2, z: 690, L: 0 }]);
  // the printed PVI stays; a PVI at 0 on the first tangent's own grade is added before it
  assert.deepEqual(p.pvis.map((q) => q.s), [0, 0.254, 50, 100]);
  assert.ok(Math.abs(p.pvis[0]!.z - (683.613 - ((684 - 683.613) / (50 - 0.254)) * 0.254)) < 1e-9);
  assert.equal(p.notes.length, 2);
  assert.throws(() => planRoad(al, [{ s: 0, z: 680, L: 0 }, { s: 90, z: 681, L: 0 }]), /PVIs 0\.\.90 vs alignment 0\.\.100/);
});

test("--tie-ends: a road end a few cm off the road it ends on takes that road's level (pits 298 / 299)", () => {
  const roads = [
    { name: "R.0.D.11", guid: "t", line: [[0, 0, 688.0], [100, 0, 688.2]] as [number, number, number][] },
    { name: "R.4.G.2", guid: "a", line: [[50, -60, 689], [50, 0, 688.141]] as [number, number, number][] },
    { name: "R.5.G.1", guid: "b", line: [[50, 0, 688.141], [50, 60, 689]] as [number, number, number][] },
  ];
  const t = tieLevels(roads, parseTieEnds("R.4.G.2@R.0.D.11, R.5.G.1@R.0.D.11"));
  assert.ok(Math.abs(t.get("R.4.G.2")!.endZ! - 688.1) < 1e-9 && t.get("R.4.G.2")!.startZ === undefined);
  assert.ok(Math.abs(t.get("R.5.G.1")!.startZ! - 688.1) < 1e-9);
  assert.throws(() => tieLevels(roads, parseTieEnds("R.0.D.11@R.4.G.2")), /no end on/);
  assert.throws(() => tieLevels(roads, parseTieEnds("R.4.G.2@R.0.D.11"), 0.01), /more than 0.01 m/);
  assert.throws(() => parseTieEnds("R.4.G.2"), /ROAD@ROAD_IT_ENDS_ON/);
  // planRoad takes the tied level on the end PVI and the 3D line ends there
  const al: Alignment = { name: "R.4.G.2", length: 60, segs: [{ a: [50, -60], b: [50, 0], bulge: 0 }] };
  const p = planRoad(al, [{ s: 0, z: 689, L: 0 }, { s: 60, z: 688.141, L: 0 }], { endZ: 688.1 });
  assert.equal(p.pvis.at(-1)!.z, 688.1);
  assert.equal(p.line.at(-1)![2], 688.1);
  assert.equal(p.pvis[0]!.z, 689);
  assert.match(p.notes.join(), /end level 688.141 -> 688.100/);
});

test("junction steps: a road end on another road's centreline reports the level step", () => {
  const roads = [
    { name: "R.A", guid: "a", line: [[0, 0, 690], [100, 0, 690]] as [number, number, number][] },
    { name: "R.B", guid: "b", line: [[50, 0, 690.53], [50, 80, 691]] as [number, number, number][] },
  ];
  const s = junctionSteps(roads);
  assert.equal(s.length, 1);
  assert.equal(s[0]!.road, "R.B");
  assert.ok(Math.abs(s[0]!.step - 0.53) < 1e-9);
});
