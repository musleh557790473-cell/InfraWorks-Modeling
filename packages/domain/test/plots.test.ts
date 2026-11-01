import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PARSONS_LDIP_ROADS_PROFILE, createFileStore, parseDxf, polygonize, runBuildPipeline } from "../src/index.js";
import type { ValidationReport } from "../src/index.js";

const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";
const ring = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const area = (r: number[][]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]!; return s + p[0]! * q[1]! - q[0]! * p[1]!; }, 0) / 2);

/* ------------------------------------------------------------------ polygonize */

test("polygonize: lines meeting in T-junctions and crossings enclose faces; loose ends are dropped", () => {
  const split = polygonize([ring(0, 0, 10, 10), [[4, 0], [4, 10]], [[10, 5], [13, 5]]]);
  assert.equal(split.polygons.length, 2);
  assert.deepEqual(split.polygons.map((p) => area(p[0]!)).sort((a, b) => a - b), [40, 60]);
  assert.equal(split.dangles, 1, "the stray line sticking out is left out");

  const grid = polygonize([ring(0, 0, 10, 10), [[5, -1], [5, 11]], [[-1, 5], [11, 5]]]);
  assert.equal(grid.polygons.length, 4, "two crossing lines make four faces");
});

test("polygonize: a group of lines inside a face becomes a hole in it, and a face of its own", () => {
  const r = polygonize([ring(0, 0, 10, 10), ring(4, 4, 6, 6)]);
  assert.equal(r.polygons.length, 2);
  const outer = r.polygons.find((p) => p.length === 2)!;
  assert.equal(area(outer[0]!) - area(outer[1]!), 96);
});

test("polygonize: drafting gaps are closed only when asked, and only up to the given distance", () => {
  // The dividing line stops 0.3 m short of the top edge.
  const lines = [ring(0, 0, 20, 10), [[8, 0], [8, 9.7]]];
  assert.equal(polygonize(lines).polygons.length, 1);
  const closed = polygonize(lines, { closeGaps: 0.5 });
  assert.equal(closed.polygons.length, 2);
  assert.equal(closed.gapsClosed, 1);
  assert.equal(polygonize(lines, { closeGaps: 0.2 }).polygons.length, 1, "0.3 m is more than 0.2 m");
});

test("polygonize: endpoints within 1 cm are one point; slivers below minArea are dropped", () => {
  const r = polygonize([[[0, 0], [10, 0], [10, 10]], [[10.004, 10.003], [0, 10], [0, 0.006]]]);
  assert.equal(r.polygons.length, 1);
  const thin = polygonize([ring(0, 0, 10, 10), [[0, 5], [10, 5]], [[0, 5.05], [10, 5.05]]], { minArea: 1 });
  assert.equal(thin.slivers, 1);
  assert.equal(thin.polygons.length, 2);
});

/* ------------------------------------------------------------------ plots from a baseplan */

const E = 657000;
const N = 2747000;
/** A Parsons-style baseplan bound into the sheet: plots as single LINEs, numbers as TEXT inside. */
function baseplan(labels: [string, number, number][]) {
  const L = "Xref Al Qairawan Baseplan$0$MP-PLT-LIN";
  const T = "Xref Al Qairawan Baseplan$0$MP-PLT-TXT";
  const line = (x0: number, y0: number, x1: number, y1: number) => [0, "LINE", 8, L, 10, E + x0, 20, N + y0, 11, E + x1, 21, N + y1];
  return dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "Xref Al Qairawan Baseplan", 10, 0, 20, 0,
    ...line(0, 0, 40, 0), ...line(40, 0, 40, 20), ...line(40, 20, 0, 20), ...line(0, 20, 0, 0),
    ...line(20, 0, 20, 19.7), // stops 0.3 m short of the top line: a drafting gap
    ...line(30, 0, 30, 20),
    ...labels.flatMap(([t, x, y]) => [0, "TEXT", 8, T, 1, t, 10, E + x, 20, N + y, 40, 2]),
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Xref Al Qairawan Baseplan", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
}

test("plots drawn as separate lines become numbered parcels; a plot with no number of its own takes none", () => {
  // 1002 sits 1 m from the empty third plot (30..40): within textMaxDistance, but not inside it.
  const parsed = parseDxf(baseplan([["1001", 10, 10], ["1002", 29, 10]]), "10100.dxf", PARSONS_LDIP_ROADS_PROFILE);
  const plots = parsed.features.filter((f) => f.outputLayer === "plots");
  assert.equal(plots.length, 3, "the 0.3 m gap is closed, so the 0..20 and 20..30 plots are separate");
  assert.ok(plots.every((f) => f.geometry.type === "Polygon" && f.infraFeatureClass === "parcel"));
  const idAt = (x: number) =>
    plots.find((f) => (f.geometry.coordinates[0] as number[][]).some((p) => Math.abs(p[0]! - (E + x)) < 1e-6))?.attributes.parcel_id;
  assert.equal(plots.filter((f) => f.attributes.parcel_id === "1001").length, 1);
  assert.equal(plots.filter((f) => f.attributes.parcel_id === "1002").length, 1);
  assert.equal(plots.filter((f) => f.attributes.parcel_id === undefined).length, 1);
  assert.equal(idAt(40), undefined, "the plot at the east end has no number");
  assert.ok(parsed.notes.some((n) => /plots: 3 area\(s\) built from 6 line\(s\) on "MP-PLT-LIN"; 1 drafting gap/.test(n)), parsed.notes.join(" | "));
});

test("two numbers in one plot are reported: a dividing line is probably missing", () => {
  const parsed = parseDxf(baseplan([["1001", 5, 10], ["1009", 15, 10]]), "10100.dxf", PARSONS_LDIP_ROADS_PROFILE);
  assert.ok(parsed.notes.some((n) => /1 area\(s\) hold more than one label/.test(n)));
});

test("the same plot number on two plots raises ASSET_ID_DUPLICATE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iw-plots-"));
  const path = join(dir, "10100.dxf");
  writeFileSync(path, baseplan([["1001", 10, 10], ["1001", 25, 10], ["1003", 35, 10]]));
  const store = createFileStore(dir);
  const project = store.createProject("plots", 32638);
  store.setMappingProfile(project.id, PARSONS_LDIP_ROADS_PROFILE);
  store.addUpload({ projectId: project.id, filename: "10100.dxf", kind: "dxf", path, size: 0 });
  let v: ValidationReport;
  try {
    v = (await runBuildPipeline(store, project.id)).validation;
  } catch (err) {
    v = (err as { validation: ValidationReport }).validation;
  }
  const dup = v.issues.find((i) => i.code === "ASSET_ID_DUPLICATE");
  assert.ok(dup, JSON.stringify(v.issues));
  assert.match(dup.message, /1001 \(plots, 2×\)/);
  assert.equal(dup.severity, "warning");
});