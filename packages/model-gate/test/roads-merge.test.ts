import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseSync } from "node:sqlite";

import { extendToCentre, mergeRoads, missingDrawnRoads, parseMerges, partsDescription, partsFromDescription, setDescription } from "../src/roads/merge.js";

const part = (name: string, a: [number, number], b: [number, number], pv: [number, number, number][]) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { al: { name, length: len, segs: [{ a, b, bulge: 0 }] }, pv: pv.map(([s, z, L]) => ({ s, z, L })) };
};

test("two roads meeting end to end at a roundabout centre become one road through it (RA-2: R.0.C.1 + R.0.C.2)", () => {
  const c1 = part("R.0.C.1", [0, 0], [100, 0], [[0, 680, 0], [50, 681, 30], [100, 681.825, 0]]);
  const c2 = part("R.0.C.2", [100, 0], [160, 0], [[0, 681.825, 0], [11.6, 682.107, 0], [60, 683.83, 0]]);
  const m = mergeRoads("R.0.C.2", [c1, c2]);
  assert.equal(m.al.name, "R.0.C.2");
  assert.equal(m.al.length, 160);
  assert.equal(m.al.segs.length, 2);
  assert.deepEqual(m.pv.map((p) => [p.s, p.z, p.L]), [[0, 680, 0], [50, 681, 30], [100, 681.825, 0], [111.6, 682.107, 0], [160, 683.83, 0]], "the joint PVI once, the second road's stations shifted");
});

test("a merge is refused at a gap, a road drawn the other way, a level step or a curve at the joint", () => {
  const c1 = part("A", [0, 0], [100, 0], [[0, 680, 0], [100, 681, 0]]);
  assert.throws(() => mergeRoads("A", [c1, part("B", [101, 0], [160, 0], [[0, 681, 0], [59, 682, 0]])]), /does not start where A ends/);
  assert.throws(() => mergeRoads("A", [c1, part("B", [160, 0], [100, 0], [[0, 682, 0], [60, 681, 0]])]), /drawn the other way/);
  assert.throws(() => mergeRoads("A", [c1, part("B", [100, 0], [160, 0], [[0, 681.1, 0], [60, 682, 0]])]), /level step/);
  assert.throws(() => mergeRoads("A", [part("A", [0, 0], [100, 0], [[0, 680, 0], [100, 681, 20]]), part("B", [100, 0], [160, 0], [[0, 681, 0], [60, 682, 0]])]), /vertical curve at the joint/);
});

test("Namar RA-01: two arms stopping on the ring are joined straight through its centre, levels kept at both ends", () => {
  const ring = { c: [120, 0] as [number, number], r: 20 };
  const m1 = part("RD-M-01", [0, 0], [100, 0], [[0, 770, 0], [100, 766.6, 0]]);
  const m2 = part("RD-M-02", [140, 0], [240, 0], [[0, 765.94, 0], [100, 763, 0]]);
  const m = mergeRoads("RD-M-01", [m1, m2], [ring]);
  assert.equal(m.al.length, 240);
  assert.deepEqual(m.al.segs.map((s) => [s.a, s.b]), [[[0, 0], [100, 0]], [[100, 0], [120, 0]], [[120, 0], [140, 0]], [[140, 0], [240, 0]]]);
  assert.deepEqual(m.pv.map((p) => [p.s, p.z]), [[0, 770], [100, 766.6], [140, 765.94], [240, 763]], "the crossing grades straight between the two ring ends");
  assert.throws(() => mergeRoads("RD-M-01", [m1, m2]), /does not start where/, "without the ring the gap is refused");
  assert.throws(() => mergeRoads("RD-M-01", [m1, part("X", [141, 5], [240, 0], [[0, 765, 0], [99, 763, 0]])], [ring]), /does not start where/, "an end off the ring is not bridged");
});

test("Namar RA-01: --to-centre carries a road from the ring to its centre at the through road's level", () => {
  const ring = { c: [120, 0] as [number, number], r: 20 };
  const x = extendToCentre(part("RD-13", [120, 120], [120, 20], [[0, 770, 0], [100, 765.762, 0]]), [ring], 766.27);
  assert.equal(x.at, "end");
  assert.equal(x.dist, 20);
  assert.equal(x.al.length, 120);
  assert.deepEqual(x.al.segs.at(-1), { a: [120, 20], b: [120, 0], bulge: 0 });
  assert.deepEqual(x.pv.at(-1), { s: 120, z: 766.27, L: 0 });
  const y = extendToCentre(part("RD-32", [120, -20], [120, -120], [[0, 766.786, 0], [100, 770, 0]]), [ring], 766.27);
  assert.equal(y.at, "start");
  assert.deepEqual(y.pv.map((p) => [p.s, p.z]), [[0, 766.27], [20, 766.786], [120, 770]]);
  assert.throws(() => extendToCentre(part("Z", [0, 50], [0, 100], [[0, 1, 0], [50, 2, 0]]), [ring], 766), /no end on a roundabout ring/);
});

test("--merge NAME=ROAD1+ROAD2, the name being one of the roads", () => {
  assert.deepEqual(parseMerges("R.0.C.2=R.0.C.1+R.0.C.2"), [{ name: "R.0.C.2", parts: ["R.0.C.1", "R.0.C.2"] }]);
  assert.throws(() => parseMerges("X=R.0.C.1+R.0.C.2"), /NAME being one of the roads/);
  assert.deepEqual(parseMerges(""), []);
});
test("a merged road records the drawn roads it holds, with their stations, so none is lost (RA-2)", () => {
  const d = partsDescription([{ name: "R.0.C.1", length: 780.422 }, { name: "R.0.C.2", length: 450.855 }]);
  assert.equal(d, "Parsons: R.0.C.1 0+000.000-0+780.422; R.0.C.2 0+780.422-1+231.277");
  assert.deepEqual(partsFromDescription(d), ["R.0.C.1", "R.0.C.2"]);
  assert.deepEqual(partsFromDescription("some note"), []);
  const roads = [{ NAME: "R.0.C.2", DESCRIPTION: d }, { NAME: "R.0.D.5", DESCRIPTION: null }];
  assert.deepEqual(missingDrawnRoads(roads, ["R.0.C.1", "R.0.C.2", "R.0.D.5", "R.0.D.6"]), ["R.0.D.6"]);
});
test("a road's description goes to the road and its definition (the Stack showed none with the road row alone)", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`create table CONSTRAINED_DEFINITIONS (GUID text, DESCRIPTION text); create table ROADS (NAME text, FK_PARENT_GUID text, DESCRIPTION text);
    insert into CONSTRAINED_DEFINITIONS values ('cd', null), ('other', null); insert into ROADS values ('R.0.C.2', 'cd', null);`);
  assert.equal(setDescription(db, "R.0.C.2", "Parsons: x"), 1);
  assert.deepEqual(db.prepare("select GUID, DESCRIPTION from CONSTRAINED_DEFINITIONS order by GUID").all().map((r) => ({ ...r })), [{ GUID: "cd", DESCRIPTION: "Parsons: x" }, { GUID: "other", DESCRIPTION: null }]);
});