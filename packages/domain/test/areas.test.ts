import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AssetKeyConfig, createFileStore, parseDxf, runBuildPipeline } from "../src/index.js";
import type { MappingProfile } from "../src/index.js";

const X = 657000;
const Y = 2747000;
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";
/** LWPOLYLINE from local points (metres from X, Y); closed sets flag 70 = 1. */
const poly = (layer: string, pts: number[][], closed = true) => [
  0, "LWPOLYLINE", 8, layer, 90, pts.length, 70, closed ? 1 : 0,
  ...pts.flatMap(([x, y]) => [10, X + x!, 20, Y + y!]),
];
const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];

const PROFILE: MappingProfile = {
  id: "t",
  name: "t",
  layers: [
    { dwgLayer: "RD_CL", infraFeatureClass: "road_centerline" },
    { dwgLayer: "Boundary", infraFeatureClass: "coverage", outputLayer: "road_reserve", subtract: ["RD_ROW"] },
    { dwgLayer: "RD_ROW", infraFeatureClass: "coverage", outputLayer: "blocks" },
  ],
  reportJoins: [],
  assetKeys: AssetKeyConfig.parse({}),
};

/** Shapefile area records as rings, read independently of the writer. */
function shpRings(base: string): number[][][][] {
  const b = readFileSync(`${base}.shp`);
  const out: number[][][][] = [];
  for (let off = 100; off < b.length; ) {
    const len = b.readInt32BE(off + 4) * 2;
    const c = off + 8;
    const np = b.readInt32LE(c + 36);
    const n = b.readInt32LE(c + 40);
    const starts = Array.from({ length: np }, (_, k) => b.readInt32LE(c + 44 + 4 * k));
    const pts = Array.from({ length: n }, (_, k) => [b.readDoubleLE(c + 44 + 4 * np + 16 * k), b.readDoubleLE(c + 52 + 4 * np + 16 * k)]);
    out.push(starts.map((s, k) => pts.slice(s, starts[k + 1] ?? n)));
    off = c + len;
  }
  return out;
}
const clockwise = (r: number[][]) => r.reduce((s, p, i) => s + (r[(i + 1) % r.length]![0]! - p[0]!) * (r[(i + 1) % r.length]![1]! + p[1]!), 0) > 0;

async function build(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "iw-areas-"));
  const path = join(dir, "t.dxf");
  writeFileSync(path, text);
  const store = createFileStore(dir);
  const project = store.createProject("t", 32638);
  store.setMappingProfile(project.id, PROFILE);
  store.addUpload({ projectId: project.id, filename: "t.dxf", kind: "dxf", path, size: 0 });
  const r = await runBuildPipeline(store, project.id);
  const staging = join(store.artifactDir, readdirSync(store.artifactDir).find((d) => d.startsWith(`pkg-${project.id}`))!);
  return { r, staging, manifest: JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8")) };
}

test("road reserve = site boundary minus the blocks, each in its own Shapefile; open lines stay out", async () => {
  const { r, staging, manifest } = await build(
    dxf(
      0, "SECTION", 2, "ENTITIES",
      ...poly("Boundary", square(0, 0, 100)),
      ...poly("RD_ROW", square(10, 10, 30)),
      ...poly("RD_ROW", square(60, 60, 30)),
      ...poly("RD_ROW", [[0, 50], [100, 50]], false), // an open right-of-way edge
      0, "LINE", 8, "RD_CL", 10, X, 20, Y + 50, 11, X + 100, 21, Y + 50,
      0, "ENDSEC", 0, "EOF",
    ),
  );
  const shp = manifest.layers.filter((l: { format: string }) => l.format === "shp");
  assert.deepEqual(
    shp.map((l: { name: string; featureCount: number; infraWorksType: string }) => `${l.name}:${l.featureCount}:${l.infraWorksType}`).sort(),
    ["blocks:2:Coverage Areas", "road_centerline:1:Roads", "road_reserve:1:Coverage Areas"],
  );
  const [reserve] = shpRings(join(staging, "shp", "road_reserve"));
  assert.equal(reserve!.length, 3, "outer ring + two holes");
  assert.equal(clockwise(reserve![0]!), true, "outer ring clockwise");
  assert.ok(reserve!.slice(1).every((h) => !clockwise(h)), "holes counter-clockwise");
  assert.ok(r.validation.issues.some((i) => i.code === "AREA_NOT_CLOSED"));
  assert.equal(r.validation.ok, true);
});

test("a block that splits the site gives a multi-part reserve whose parts are both outer rings", async () => {
  const { staging } = await build(
    dxf(0, "SECTION", 2, "ENTITIES", ...poly("Boundary", square(0, 0, 100)), ...poly("RD_ROW", [[-5, 40], [105, 40], [105, 60], [-5, 60]]), 0, "ENDSEC", 0, "EOF"),
  );
  const records = shpRings(join(staging, "shp", "road_reserve"));
  assert.equal(records.length, 1, "one feature");
  assert.equal(records[0]!.length, 2, "two parts");
  assert.ok(records[0]!.every(clockwise), "both parts are outer rings, not holes");
});

test("an area drawn open with ends 5 mm apart closes; a road with the same gap stays a line", () => {
  const nearly = [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0.005]];
  const text = dxf(0, "SECTION", 2, "ENTITIES", ...poly("RD_ROW", nearly, false), ...poly("RD_CL", nearly, false), 0, "ENDSEC", 0, "EOF");
  const parsed = parseDxf(text, "t.dxf", PROFILE);
  const kind = (layer: string) => parsed.features.find((f) => f.provenance.sourceLayer === layer)!.geometry.type;
  assert.equal(kind("RD_ROW"), "Polygon");
  assert.equal(kind("RD_CL"), "LineString");
});
