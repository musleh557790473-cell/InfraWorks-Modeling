import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_MAPPING_PROFILE,
  createFileStore,
  parseCadInput,
  parseDxf,
  runBuildPipeline,
} from "../src/index.js";
import type { ValidationReport } from "../src/index.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const tmp = () => mkdtempSync(join(tmpdir(), "iw-domain-"));

/** Build a DXF from [code, value] pairs. */
function dxf(...pairs: (string | number)[]): string {
  const lines: string[] = [];
  for (const v of pairs) lines.push(String(v));
  return lines.join("\n") + "\n";
}

function newProject(files: { name: string; path: string; kind: "dxf" | "dwg" | "csv" }[]) {
  const store = createFileStore(tmp());
  const project = store.createProject("test", 32638);
  for (const f of files) {
    store.addUpload({ projectId: project.id, filename: f.name, kind: f.kind, path: f.path, size: 0 });
  }
  return { store, project };
}

async function build(store: ReturnType<typeof createFileStore>, id: string): Promise<ValidationReport> {
  try {
    return (await runBuildPipeline(store, id)).validation;
  } catch (err) {
    const v = (err as { validation?: ValidationReport }).validation;
    if (!v) throw err;
    return v;
  }
}

const codes = (v: ValidationReport) => v.issues.map((i) => i.code);

/* ------------------------------------------------------------------ DXF reader */

test("sample.dxf: closed polylines become polygons, points are kept, asset ids come from XDATA", () => {
  const parsed = parseCadInput(join(fixtures, "sample.dxf"), "sample.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.format, "dxf");

  const roads = parsed.features.filter((f) => f.infraFeatureClass === "road_centerline");
  assert.deepEqual(
    roads.map((f) => f.attributes.asset_id),
    ["RD-001", "RD-002", "RD-003", "RD-004", "RD-005"],
  );

  const coverage = parsed.features.find((f) => f.infraFeatureClass === "coverage")!;
  assert.equal(coverage.geometry.type, "Polygon");
  const ring = coverage.geometry.coordinates[0] as number[][];
  assert.deepEqual(ring[0], ring[ring.length - 1], "ring is closed");

  const annotation = parsed.features.find((f) => f.infraFeatureClass === "annotation")!;
  assert.equal(annotation.geometry.type, "Point");
});

test("entities inside BLOCKS are not treated as model-space features", () => {
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "B1", 0, "LINE", 8, "ROADS", 10, 0, 20, 0, 11, 1, 21, 1, 0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "LINE", 8, "ROADS", 10, 673000, 20, 2735000, 11, 673100, 21, 2735000,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "t.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.features.length, 1);
});

test("old-style POLYLINE reads its VERTEX entities; unsupported types are counted", () => {
  const text = dxf(
    0, "SECTION", 2, "ENTITIES",
    0, "POLYLINE", 8, "PARCELS", 66, 1, 70, 1, 10, 0, 20, 0,
    0, "VERTEX", 8, "PARCELS", 10, 673000, 20, 2735000,
    0, "VERTEX", 8, "PARCELS", 10, 673100, 20, 2735000,
    0, "VERTEX", 8, "PARCELS", 10, 673100, 20, 2735100,
    0, "SEQEND",
    0, "CIRCLE", 8, "WATER", 10, 673000, 20, 2735000, 40, 5,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "t.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.features.length, 1);
  assert.equal(parsed.features[0]!.geometry.type, "Polygon");
  assert.equal((parsed.features[0]!.geometry.coordinates[0] as unknown[]).length, 4, "3 vertices + closing point");
  assert.deepEqual(parsed.skippedEntities, { CIRCLE: 1 });
});

test("a DXF handle is never used as an asset id", () => {
  const text = dxf(
    0, "SECTION", 2, "ENTITIES",
    0, "LINE", 5, "1A", 8, "ROADS", 10, 673000, 20, 2735000, 11, 673100, 21, 2735000,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "t.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.features[0]!.attributes.asset_id, undefined);
});

/* ------------------------------------------------------------------ pipeline */

test("sample.dxf + roads_report.csv builds with zero blocking issues and a CRS-tagged package", async () => {
  const { store, project } = newProject([
    { name: "sample.dxf", path: join(fixtures, "sample.dxf"), kind: "dxf" },
    { name: "roads_report.csv", path: join(fixtures, "roads_report.csv"), kind: "csv" },
  ]);
  const result = await runBuildPipeline(store, project.id);
  assert.equal(result.validation.blockingCount, 0, JSON.stringify(result.validation.issues));
  assert.ok(!codes(result.validation).includes("REPORT_JOIN_PARTIAL"));

  const road = result.collection.features.find((f) => f.attributes.asset_id === "RD-001")!;
  assert.equal(road.attributes.road_name, "Al Narjis Spine");

  const staging = readdirSync(store.artifactDir).find((d) => d.startsWith(`pkg-${project.id}`))!;
  const gj = JSON.parse(readFileSync(join(store.artifactDir, staging, "layers/road_centerline.geojson"), "utf8"));
  assert.equal(gj.crs.properties.name, "urn:ogc:def:crs:EPSG::32638");
});

test("binary DWG yields synthetic geometry, which is blocking", async () => {
  const { store, project } = newProject([
    { name: "sample.dwg", path: join(fixtures, "sample.dwg"), kind: "dwg" },
    { name: "roads_report.csv", path: join(fixtures, "roads_report.csv"), kind: "csv" },
  ]);
  const v = await build(store, project.id);
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes("CAD_GEOMETRY_SYNTHETIC"));
});

test("a drawing in local coordinates is blocked for a UTM project", async () => {
  const dir = tmp();
  const path = join(dir, "local.dxf");
  writeFileSync(
    path,
    dxf(0, "SECTION", 2, "ENTITIES", 0, "LINE", 8, "WATER", 10, 0, 20, 0, 11, 100, 21, 50, 0, "ENDSEC", 0, "EOF"),
  );
  const { store, project } = newProject([{ name: "local.dxf", path, kind: "dxf" }]);
  const v = await build(store, project.id);
  assert.ok(codes(v).includes("COORDS_OUTSIDE_CRS"));
});

test("joins count report rows, not features: two features on one row is 1 of 2 rows", async () => {
  const dir = tmp();
  const cad = join(dir, "two.dxf");
  const line = (id: string) => [0, "LINE", 8, "ROADS", 10, 673000, 20, 2735000, 11, 673100, 21, 2735000, 1001, "INFRAWORKS", 1000, id];
  writeFileSync(cad, dxf(0, "SECTION", 2, "ENTITIES", ...line("RD-001"), ...line("RD-001"), 0, "ENDSEC", 0, "EOF"));
  const csv = join(dir, "roads_report.csv");
  writeFileSync(csv, "asset_id,road_name\nRD-001,A\nRD-002,B\n");
  const { store, project } = newProject([
    { name: "two.dxf", path: cad, kind: "dxf" },
    { name: "roads_report.csv", path: csv, kind: "csv" },
  ]);
  const v = await build(store, project.id);
  const partial = v.issues.find((i) => i.code === "REPORT_JOIN_PARTIAL");
  assert.equal(partial?.context?.joined, "1");
  assert.equal(partial?.context?.total, "2");
});

test("the latest CAD upload is the one built", async () => {
  const dir = tmp();
  const old = join(dir, "old.dxf");
  writeFileSync(old, dxf(0, "SECTION", 2, "ENTITIES", 0, "LINE", 8, "ROADS", 10, 0, 20, 0, 11, 1, 21, 1, 0, "ENDSEC", 0, "EOF"));
  const { store, project } = newProject([
    { name: "old.dxf", path: old, kind: "dxf" },
    { name: "sample.dxf", path: join(fixtures, "sample.dxf"), kind: "dxf" },
  ]);
  const v = await build(store, project.id);
  assert.ok(!codes(v).includes("COORDS_OUTSIDE_CRS"), "old local-coordinate drawing was ignored");
});

/* ------------------------------------------------------------------ store */

test("a second store on the same folder sees new jobs (API and worker are separate processes)", () => {
  const dir = tmp();
  const api = createFileStore(dir);
  const worker = createFileStore(dir);
  const project = api.createProject("p");
  const job = api.createJob(project.id);
  assert.equal(worker.getJob(job.id)?.status, "queued");
  assert.equal(worker.getProject(project.id)?.status, "building");
});
