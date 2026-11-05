import assert from "node:assert/strict";
import test from "node:test";

import { mergeRoads, missingDrawnRoads, parseMerges, partsDescription, partsFromDescription } from "../src/roads/merge.js";

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