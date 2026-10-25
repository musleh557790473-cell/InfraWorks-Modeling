import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";
import AdmZip from "adm-zip";
import { createFileStore, runBuildPipeline } from "@infraworks/domain";

import { runModelGate } from "../src/gate.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const UTM38N =
  'PROJCS["UTM84-38N",GEOGCS["LL84",DATUM["WGS84"]],PROJECTION["Transverse_Mercator"],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],PARAMETER["central_meridian",45],UNIT["Meter",1]]';
const UTM37N = UTM38N.replace("UTM84-38N", "UTM84-37N").replace('"central_meridian",45', '"central_meridian",39');
const WGS84 = 'GEOGCS["WGS 84",DATUM["WGS_1984"]]';

/* ---------------------------------------------------------------- FGF writer (XY) */

function fgf(type: string, coords: unknown): Buffer {
  const parts: Buffer[] = [];
  const i32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    parts.push(b);
  };
  const pts = (list: number[][]) => {
    for (const p of list) {
      const b = Buffer.alloc(16);
      b.writeDoubleLE(p[0]!, 0);
      b.writeDoubleLE(p[1]!, 8);
      parts.push(b);
    }
  };
  if (type === "Point") {
    i32(1); i32(0); pts([coords as number[]]);
  } else if (type === "LineString") {
    const c = coords as number[][];
    i32(2); i32(0); i32(c.length); pts(c);
  } else if (type === "Polygon") {
    const rings = coords as number[][][];
    i32(3); i32(0); i32(rings.length);
    for (const r of rings) { i32(r.length); pts(r); }
  } else throw new Error(type);
  return Buffer.concat(parts);
}

/* ---------------------------------------------------------------- fixtures */

let packagePath = "";
const work = mkdtempSync(join(tmpdir(), "g3-"));

test.before(async () => {
  const store = createFileStore(join(work, "store"));
  const p = store.createProject("G3 fixture", 32638);
  store.addUpload({ projectId: p.id, filename: "sample.dxf", kind: "dxf", path: join(fixtures, "sample.dxf"), size: 0 });
  store.addUpload({ projectId: p.id, filename: "roads_report.csv", kind: "csv", path: join(fixtures, "roads_report.csv"), size: 0 });
  packagePath = (await runBuildPipeline(store, p.id)).packagePath;
});
test.after(() => rmSync(work, { recursive: true, force: true }));

const TABLE: Record<string, string> = {
  road_centerline: "ROADS",
  coverage: "COVERAGES",
  water: "WATER_AREAS",
  parcel: "PARCELS",
  annotation: "POIS",
};

interface Damage {
  modelWkt?: string;
  skipLayer?: string;
  sourceCs?: Record<string, string>;
  shift?: Record<string, [number, number]>;
  truncateRoads?: boolean;
}

/** An InfraWorks-shaped model that imported the package — faithfully, unless told otherwise. */
function makeModel(name: string, d: Damage = {}): string {
  const path = join(work, name);
  const db = new Database(path);
  db.exec(`
    create table SCHEMA_VERSION (ID integer primary key, VERSION text);
    create table spatial_ref_sys (srid integer, sr_name text, auth_name text, auth_srid integer, srtext text, sr_xytol real, sr_ztol real);
    create table DATA_SOURCES (ID integer primary key, GUID text, NAME text, DESCRIPTION text, DATA_PROVIDER_GUID text,
      CONNECTION_STRING text, TARGET_CLASS_NAME text, DATE_OF_IMPORT text, SOURCE_CS text, POS_CS text, CONFIG text);
    create table ALIGNMENT_REGIONS (ID integer primary key, GUID text, NAME text, GEOMETRY blob);
    create table ALIGNMENT_CROSS_SECTIONS (ID integer primary key, GUID text, FK_REGION_GUID text, REGION_DISTANCE_2D real, GEOMETRY blob);
  `);
  for (const t of Object.values(TABLE)) {
    db.exec(`create table ${t} (ID integer primary key, GUID text, NAME text, GEOMETRY blob, DATA_SOURCE_ID text, EXTERNAL_ID text)`);
  }
  db.prepare("insert into SCHEMA_VERSION values (1, '17.18.0')").run();
  const wkt = d.modelWkt ?? UTM38N;
  db.prepare("insert into spatial_ref_sys values (1, ?, null, null, ?, null, null)").run(/"([^"]+)"/.exec(wkt)![1], wkt);

  const zip = new AdmZip(packagePath);
  const manifest = JSON.parse(zip.getEntry("manifest.json")!.getData().toString("utf8"));
  let id = 0;
  for (const layer of manifest.layers.filter((l: { format: string }) => l.format === "geojson")) {
    if (layer.infraFeatureClass === d.skipLayer) continue;
    const file = layer.path.split("/").pop();
    const guid = `ds-${++id}`;
    db.prepare(
      "insert into DATA_SOURCES (GUID, NAME, CONNECTION_STRING, TARGET_CLASS_NAME, SOURCE_CS) values (?,?,?,?,?)",
    ).run(guid, file, `C:/Imports/pkg/layers/${file}`, TABLE[layer.infraFeatureClass], d.sourceCs?.[layer.infraFeatureClass] ?? UTM38N);
    const gj = JSON.parse(zip.getEntry(layer.path)!.getData().toString("utf8"));
    const [dx, dy] = d.shift?.[layer.infraFeatureClass] ?? [0, 0];
    const mv = (c: unknown): unknown => (typeof (c as number[])[0] === "number" ? [(c as number[])[0]! + dx, (c as number[])[1]! + dy] : (c as unknown[]).map(mv));
    for (const feat of gj.features) {
      let coords = mv(feat.geometry.coordinates);
      if (d.truncateRoads && layer.infraFeatureClass === "road_centerline") {
        const c = coords as number[][];
        coords = [c[0], [(c[0]![0]! + c[1]![0]!) / 2, (c[0]![1]! + c[1]![1]!) / 2]]; // half the road
      }
      db.prepare(`insert into ${TABLE[layer.infraFeatureClass]} (GUID, GEOMETRY, DATA_SOURCE_ID) values (?,?,?)`).run(
        feat.id,
        fgf(feat.geometry.type, coords),
        guid,
      );
    }
  }
  db.close();
  return path;
}

const rules = (r: ReturnType<typeof runModelGate>) => r.findings.filter((f) => f.severity !== "info").map((f) => f.ruleId);

/* ---------------------------------------------------------------- tests */

test("a faithful import passes", () => {
  const r = runModelGate(makeModel("good.sqlite"), { packagePath });
  assert.equal(r.ok, true, JSON.stringify(r.findings, null, 2));
  assert.equal(r.schemaVersion, "17.18.0");
  assert.ok(r.layers.every((l) => l.modelCount === l.packageCount));
  assert.ok(r.layers.every((l) => (l.centreOffset ?? 0) < 1e-6));
});

test("G3-003 a layer that was never imported is blocking", () => {
  const r = runModelGate(makeModel("missing.sqlite", { skipLayer: "parcel" }), { packagePath });
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.ruleId === "G3-003" && /parcel/.test(f.message)));
});

test("G3-004 a layer read as WGS 84 degrees is blocking", () => {
  const r = runModelGate(makeModel("geo.sqlite", { sourceCs: { water: WGS84 } }), { packagePath });
  assert.ok(r.findings.some((f) => f.ruleId === "G3-004" && f.severity === "blocking" && /water/.test(f.message)));
});

test("G3-006 a shifted layer is blocking with its offset", () => {
  const r = runModelGate(makeModel("shift.sqlite", { shift: { parcel: [3, 4] } }), { packagePath });
  const f = r.findings.find((x) => x.ruleId === "G3-006");
  assert.ok(f, JSON.stringify(r.findings));
  assert.equal(f.context?.offset, "5.000");
});

test("G3-007 roads that arrive shorter than sent are caught", () => {
  const r = runModelGate(makeModel("short.sqlite", { truncateRoads: true }), { packagePath });
  const f = r.findings.find((x) => x.ruleId === "G3-007");
  assert.ok(f);
  assert.equal(f.severity, "blocking", "50 % loss is over the 10 % blocking line");
});

test("G3-002 a model in another UTM zone is blocking", () => {
  const r = runModelGate(makeModel("zone.sqlite", { modelWkt: UTM37N }), { packagePath });
  assert.ok(rules(r).includes("G3-002"));
});

test("G3-008 a design road InfraWorks stopped building is caught against the IMX", () => {
  const model = makeModel("regions.sqlite");
  const db = new Database(model);
  db.prepare("insert into ALIGNMENT_REGIONS (GUID, NAME) values ('R1', 'REGION_A')").run();
  for (let i = 0; i < 4; i++) {
    db.prepare("insert into ALIGNMENT_CROSS_SECTIONS (FK_REGION_GUID, REGION_DISTANCE_2D) values ('R1', ?)").run(i * 10);
  }
  db.close();

  const imx = join(work, "export.imx");
  const x = new Database(imx);
  x.exec(`
    create table IMX_VERSION (ID integer primary key, VERSION text);
    create table CONSTRAINED_DEF_CORRIDOR_REGIONS (ID integer primary key, NAME text, GUID text, DEFINITION_ID text,
      CORRIDOR_NAME text, BASELINE_NAME text, START_DISTANCE_2D real, END_DISTANCE_2D real, JSON_ASSEMBLY_DATA text);
    create table CONSTRAINED_DEF_CORRIDOR_SECTIONS (ID integer primary key, REGION_ID text, DISTANCE_2D real, JSON_CROSS_SECTION text);
  `);
  x.prepare("insert into CONSTRAINED_DEF_CORRIDOR_REGIONS (NAME, GUID, START_DISTANCE_2D, END_DISTANCE_2D) values ('REGION_A','R1',0,100)").run();
  for (let i = 0; i <= 10; i++) x.prepare("insert into CONSTRAINED_DEF_CORRIDOR_SECTIONS (REGION_ID, DISTANCE_2D) values ('R1', ?)").run(i * 10);
  x.close();

  const r = runModelGate(model, { imxPath: imx });
  const f = r.findings.find((y) => y.ruleId === "G3-008" && y.severity === "blocking");
  assert.ok(f, JSON.stringify(r.findings));
  assert.equal(f.context?.missingM, "70.0", "built to 30 m of 100 m");
});

test("the real package ZIP and its unpacked folder give the same answer", () => {
  const dir = join(work, "unzipped");
  new AdmZip(packagePath).extractAllTo(dir, true);
  const model = makeModel("same.sqlite");
  const a = runModelGate(model, { packagePath });
  const b = runModelGate(model, { packagePath: dir });
  assert.deepEqual(a.layers, b.layers);
  assert.ok(readFileSync(join(dir, "manifest.json"), "utf8").includes("notForIssue"));
});
