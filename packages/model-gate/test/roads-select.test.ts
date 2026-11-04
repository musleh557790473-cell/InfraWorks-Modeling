import assert from "node:assert/strict";
import test from "node:test";

import { roadsToWrite } from "../src/roads/select.js";

test("roundabouts are not written as roads unless asked (they become InfraWorks intersections)", () => {
  const roads = [{ name: "R.0.D.1" }, { name: "RA-1" }, { name: "R.0.D.2" }, { name: "RA-2" }];
  const ra = new Set(["RA-1", "RA-2"]);
  const d = roadsToWrite(roads, ra);
  assert.deepEqual(d.write.map((r) => r.name), ["R.0.D.1", "R.0.D.2"]);
  assert.deepEqual(d.skipped.map((s) => s.name), ["RA-1", "RA-2"]);
  assert.deepEqual(roadsToWrite(roads, ra, { roundaboutsAsRoads: true }).write.map((r) => r.name), ["R.0.D.1", "RA-1", "R.0.D.2", "RA-2"]);
  assert.deepEqual(roadsToWrite(roads, ra, { only: ["RA-1", "R.0.D.2"] }).write.map((r) => r.name), ["R.0.D.2"]);
});
