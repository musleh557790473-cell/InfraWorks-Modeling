import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_MAPPING_PROFILE,
  convertDwgToDxf,
  createFileStore,
  findOdaConverter,
  parseCadInput,
  parseDxf,
  readCsvTable,
  readXlsxTable,
  runBuildPipeline,
  scanProjectCad,
  suggestFeatureClass,
} from "../src/index.js";
import ExcelJS from "exceljs";
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
    0, "SPLINE", 8, "WATER", 10, 673000, 20, 2735000,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "t.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.features.length, 1);
  assert.equal(parsed.features[0]!.geometry.type, "Polygon");
  assert.equal((parsed.features[0]!.geometry.coordinates[0] as unknown[]).length, 4, "3 vertices + closing point");
  assert.deepEqual(parsed.skippedEntities, { SPLINE: 1 });
});

test("ARC and bulged LWPOLYLINE become curves, not chords", () => {
  const text = dxf(
    0, "SECTION", 2, "ENTITIES",
    0, "ARC", 8, "WATER", 10, 673000, 20, 2735000, 40, 50, 50, 0, 51, 90,
    // semicircle via bulge 1 from (0,0) to (100,0) → passes through (50,-50) (bulge + = CCW)
    0, "LWPOLYLINE", 8, "ROADS", 90, 2, 70, 0, 10, 673000, 20, 2735000, 42, 1, 10, 673100, 20, 2735000,
    0, "ENDSEC", 0, "EOF",
  );
  const [arc, road] = parseDxf(text, "t.dxf", DEFAULT_MAPPING_PROFILE).features;
  const a = arc!.geometry.coordinates as number[][];
  assert.ok(a.length > 10);
  assert.ok(Math.abs(Math.hypot(a[5]![0]! - 673000, a[5]![1]! - 2735000) - 50) < 1e-6, "points on the circle");
  const r = road!.geometry.coordinates as number[][];
  const lowest = Math.min(...r.map((p) => p[1]!));
  assert.ok(Math.abs(lowest - (2735000 - 50)) < 0.5, `bulge arc dips to the radius (got ${lowest})`);
});

test("blocks are expanded with their insert's position, rotation and layer; attributes give the id", () => {
  const text = dxf(
    0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 6, 0, "ENDSEC",
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "PLOT", 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 0, 20, 0, 10, 10, 20, 0, 10, 10, 20, 10, 10, 0, 20, 10,
    0, "ATTDEF", 8, "0", 2, "PLOT_NO", 1, "",
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "PARCELS", 66, 1, 2, "PLOT", 10, 673000, 20, 2735000, 50, 90,
    0, "ATTRIB", 8, "PARCELS", 2, "PLOT_NO", 1, "P-7", 10, 673001, 20, 2735001,
    0, "SEQEND",
    0, "TEXT", 8, "TITLE", 67, 1, 1, "paper space", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "t.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.insunits, 6);
  assert.equal(parsed.paperSpaceSkipped, 1);
  assert.equal(parsed.features.length, 1);
  const plot = parsed.features[0]!;
  assert.equal(plot.infraFeatureClass, "parcel", "layer-0 entity takes the insert's layer");
  assert.equal(plot.attributes.parcel_id, "P-7");
  const ring = plot.geometry.coordinates[0] as number[][];
  // rotated 90°: block (10,0) lands at (673000, 2735010)
  assert.ok(ring.some((p) => Math.abs(p[0]! - 673000) < 1e-6 && Math.abs(p[1]! - 2735010) < 1e-6));
  assert.equal(parsed.keyStats.attribute, 1);
});

test("asset ids from nearby text labels, found by pattern and label layer", () => {
  const profile = {
    ...DEFAULT_MAPPING_PROFILE,
    assetKeys: { ...DEFAULT_MAPPING_PROFILE.assetKeys, pattern: "^RD-[0-9]+$", textLayers: ["*LABEL*"], textMaxDistance: 5 },
  };
  const text = dxf(
    0, "SECTION", 2, "ENTITIES",
    0, "LINE", 8, "ROADS", 10, 673000, 20, 2735000, 11, 673100, 21, 2735000,
    0, "LINE", 8, "ROADS", 10, 673000, 20, 2735100, 11, 673100, 21, 2735100,
    0, "TEXT", 8, "RD-LABELS", 1, "RD-1", 10, 673050, 20, 2735002,
    0, "MTEXT", 8, "RD-LABELS", 1, "{\\fArial;RD-2}", 10, 673050, 20, 2735097,
    0, "TEXT", 8, "RD-LABELS", 1, "not an id", 10, 673050, 20, 2735001,
    0, "TEXT", 8, "OTHER", 1, "RD-9", 10, 673050, 20, 2735000.5,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "t.dxf", profile);
  assert.deepEqual(parsed.features.map((f) => f.attributes.asset_id), ["RD-1", "RD-2"]);
  assert.equal(parsed.keyStats.text, 2);
});

test("wildcard layer rules map another team's layer names", () => {
  const profile = {
    ...DEFAULT_MAPPING_PROFILE,
    layers: [{ dwgLayer: "*ROAD*CNTR*", infraFeatureClass: "road_centerline" as const, joinKeyAttribute: "asset_id" }],
  };
  const text = dxf(0, "SECTION", 2, "ENTITIES", 0, "LINE", 8, "C-ROAD-CNTR-N", 10, 0, 20, 0, 11, 1, 21, 1, 0, "ENDSEC", 0, "EOF");
  assert.equal(parseDxf(text, "t.dxf", profile).features[0]!.infraFeatureClass, "road_centerline");
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

/* ------------------------------------------------------------------ DWG */

const HAS_ODA = findOdaConverter() !== null;

test("a real DWG converts with ODA and builds with zero blocking issues", { skip: !HAS_ODA && "ODA File Converter not installed" }, async () => {
  const { store, project } = newProject([
    { name: "sample.dwg", path: join(fixtures, "sample.dwg"), kind: "dwg" },
    { name: "roads_report.csv", path: join(fixtures, "roads_report.csv"), kind: "csv" },
  ]);
  const result = await runBuildPipeline(store, project.id, undefined, { engines: ["oda"] });
  assert.equal(result.validation.blockingCount, 0, JSON.stringify(result.validation.issues));
  assert.equal(result.collection.features.filter((f) => f.attributes.road_name).length, 5, "all 5 roads joined");
});

test("another team's DWG: wildcard rules, ids from labels and block attributes, paper space ignored", { skip: !HAS_ODA && "ODA File Converter not installed" }, async () => {
  const { store, project } = newProject([{ name: "team-b.dwg", path: join(fixtures, "team-b.dwg"), kind: "dwg" }]);
  const profile = {
    id: "team-b",
    name: "Team B",
    layers: [
      { dwgLayer: "*ROAD-CNTR*", infraFeatureClass: "road_centerline" as const, joinKeyAttribute: "asset_id" },
      { dwgLayer: "*PROP-PLOT*", infraFeatureClass: "parcel" as const, joinKeyAttribute: "parcel_id" },
      { dwgLayer: "*TOPO-WATR*", infraFeatureClass: "water" as const },
    ],
    reportJoins: [],
    assetKeys: { ...DEFAULT_MAPPING_PROFILE.assetKeys, pattern: "^(RD|P)-[0-9]{3}$", textLayers: ["*ROAD-TEXT*"] },
  };
  const scan = await scanProjectCad(store, project.id, profile, { engines: ["oda"] });
  assert.equal(scan.converter, "oda");
  assert.deepEqual(scan.keyStats, { xdata: 0, attribute: 3, text: 3, missing: 0 });
  assert.ok(!scan.layers.some((l) => l.layer === "C-ANNO-TTLB"), "title block on paper space is not read");
  // a text-only layer is a label layer: never suggested as geometry
  assert.equal(scan.layers.find((l) => l.layer === "C-ROAD-TEXT")?.infraFeatureClass, "unmapped");
  assert.equal(scan.layers.find((l) => l.layer === "C-TOPO-WATR")?.source, "profile");
});

test("ezdwg is used when it is the only engine", { skip: !process.env.EZDWG_PYTHONPATH && !process.env.EZDWG_PYTHON && "set EZDWG_PYTHONPATH or EZDWG_PYTHON to run" }, async () => {
  const out = join(tmp(), "ez.dxf");
  const res = await convertDwgToDxf(join(fixtures, "sample.dwg"), out, { engines: ["ezdwg"] });
  assert.equal(res.engine, "ezdwg");
  const parsed = parseCadInput(out, "ez.dxf", DEFAULT_MAPPING_PROFILE);
  assert.ok(parsed.features.length > 0);
});

test("a file that is not a DWG fails conversion and blocks the build", async () => {
  const dir = tmp();
  const fake = join(dir, "fake.dwg");
  writeFileSync(fake, "this is not a drawing");
  const { store, project } = newProject([{ name: "fake.dwg", path: fake, kind: "dwg" }]);
  const v = await build(store, project.id);
  assert.ok(codes(v).includes("CAD_CONVERSION_FAILED"));
});

test("drawing units other than metres are flagged for a UTM project", async () => {
  const dir = tmp();
  const path = join(dir, "feet.dxf");
  writeFileSync(path, dxf(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 2, 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES",
    0, "LINE", 8, "WATER", 10, 673000, 20, 2735000, 11, 673100, 21, 2735000, 0, "ENDSEC", 0, "EOF"));
  const { store, project } = newProject([{ name: "feet.dxf", path, kind: "dxf" }]);
  const v = await build(store, project.id);
  assert.ok(codes(v).includes("DRAWING_UNITS_NOT_METRES"));
});

/* ------------------------------------------------------------------ reports */

async function writeXlsx(path: string) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Cover").addRow(["Roads schedule"]);
  const ws = wb.addWorksheet("Roads");
  ws.addRow([]);
  ws.addRow(["Road No", "Name", "Lanes"]);
  ws.addRow(["rd-001 ", "Spine", 2]);
  ws.addRow(["RD-002", "Collector", 2]);
  await wb.xlsx.writeFile(path);
}

test("Excel report: chosen sheet, header found below blank rows, ids compared ignoring case and spaces", async () => {
  const dir = tmp();
  const xlsx = join(dir, "schedule.xlsx");
  await writeXlsx(xlsx);
  const table = await readXlsxTable(xlsx, "Roads");
  assert.deepEqual(table.columns, ["Road No", "Name", "Lanes"]);
  assert.deepEqual(table.sheets, ["Cover", "Roads"]);

  const { store, project } = newProject([
    { name: "sample.dxf", path: join(fixtures, "sample.dxf"), kind: "dxf" },
    { name: "schedule.xlsx", path: xlsx, kind: "xlsx" as "csv" },
  ]);
  store.setMappingProfile(project.id, {
    ...DEFAULT_MAPPING_PROFILE,
    reportJoins: [{ reportFile: "schedule.xlsx", sheet: "Roads", joinKeyColumn: "Road No", featureJoinAttribute: "asset_id" }],
  });
  const v = await build(store, project.id);
  const partial = v.issues.find((i) => i.code === "REPORT_JOIN_PARTIAL");
  assert.equal(v.blockingCount, 0, JSON.stringify(v.issues));
  assert.equal(partial, undefined, "both rows joined, including the lower-case one");

  // the report's spelling becomes the feature's id
  const res = await runBuildPipeline(store, project.id);
  const ids = res.collection.features.map((f) => f.attributes.asset_id).filter(Boolean);
  assert.ok(ids.includes("rd-001") && ids.includes("RD-002"), JSON.stringify(ids));
});

test("CSV saved by Arabic Excel (Windows-1256, semicolons) is decoded", () => {
  const dir = tmp();
  const path = join(dir, "ar.csv");
  const text = "رقم الطريق;اسم الطريق\nRD-001;طريق الملك\n";
  const bytes = Buffer.from(
    [...text].map((ch) => {
      const map: Record<string, number> = { ر: 0xd1, ق: 0xde, م: 0xe3, " ": 0x20, ا: 0xc7, ل: 0xe1, ط: 0xd8, ي: 0xed, س: 0xd3, ك: 0xdf };
      return map[ch] ?? ch.charCodeAt(0);
    }),
  );
  writeFileSync(path, bytes);
  const t = readCsvTable(path);
  assert.equal(t.encoding, "windows-1256");
  assert.deepEqual(t.columns, ["رقم الطريق", "اسم الطريق"]);
  assert.equal(t.rows[0]!["اسم الطريق"], "طريق الملك");
});

test("a join column that does not exist fails with the real column names", async () => {
  const { store, project } = newProject([
    { name: "sample.dxf", path: join(fixtures, "sample.dxf"), kind: "dxf" },
    { name: "roads_report.csv", path: join(fixtures, "roads_report.csv"), kind: "csv" },
  ]);
  store.setMappingProfile(project.id, {
    ...DEFAULT_MAPPING_PROFILE,
    reportJoins: [{ reportFile: "roads_report.csv", joinKeyColumn: "ID", featureJoinAttribute: "asset_id" }],
  });
  await assert.rejects(runBuildPipeline(store, project.id), /no column "ID".*asset_id/);
});

/* ------------------------------------------------------------------ team profiles */

test("team profiles are saved, listed after the default, and the default cannot be overwritten", () => {
  const store = createFileStore(tmp());
  store.saveProfile({ ...DEFAULT_MAPPING_PROFILE, id: "parsons", name: "Parsons", team: "Parsons" });
  assert.deepEqual(store.listProfiles().map((p) => p.id), ["ldip-default", "parsons"]);
  assert.throws(() => store.saveProfile(DEFAULT_MAPPING_PROFILE), /cannot be overwritten/);
  assert.equal(store.deleteProfile("parsons"), true);
  assert.deepEqual(store.listProfiles().map((p) => p.id), ["ldip-default"]);
});

test("layer names are suggested in English NCS style and in Arabic", () => {
  assert.equal(suggestFeatureClass("C-ROAD-CNTR"), "road_centerline");
  assert.equal(suggestFeatureClass("V-PROP-LINE"), "parcel");
  assert.equal(suggestFeatureClass("محور الطريق"), "road_centerline");
  assert.equal(suggestFeatureClass("حدود القطع"), "parcel");
  assert.equal(suggestFeatureClass("XREF-FRAME"), "unmapped");
  // symbols and road edges are not roads or pipes (seen on Autodesk's Existing Basemap)
  assert.equal(suggestFeatureClass("V-ROAD-SIGN"), "annotation");
  assert.equal(suggestFeatureClass("V-STRM-MHOL"), "annotation");
  assert.equal(suggestFeatureClass("V-ROAD-CURB-BACK"), "unmapped");
  assert.equal(suggestFeatureClass("V-SSWR-PIPE"), "pipeline");
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
