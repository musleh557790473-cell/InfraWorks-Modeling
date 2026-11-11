import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";
import AdmZip from "adm-zip";
import { createFileStore, runBuildPipeline } from "@infraworks/domain";

import { nameMapping, runModelGate } from "../src/gate.js";
import { fillNames } from "../src/names.js";
import { DatabaseSync } from "node:sqlite";

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
  /** Connection string per layer file, as InfraWorks wrote it (default C:/Imports/pkg/layers/<file>). */
  conn?: (file: string) => string;
  /** Name left unmapped in Configure, or mapped to another field. Default: Name = the checklist's field. */
  names?: "unmapped" | "other";
  /** Import this feature class's layer twice (a second data source on the same file). */
  twice?: string;
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
  const layers = manifest.layers.filter((l: { format: string; infraFeatureClass: string }) => l.format === "geojson");
  for (const layer of [...layers, ...layers.filter((l: { infraFeatureClass: string }) => l.infraFeatureClass === d.twice)]) {
    if (layer.infraFeatureClass === d.skipLayer) continue;
    const file = layer.path.split("/").pop();
    const guid = `ds-${++id}`;
    db.prepare(
      "insert into DATA_SOURCES (GUID, NAME, CONNECTION_STRING, TARGET_CLASS_NAME, SOURCE_CS, CONFIG) values (?,?,?,?,?,?)",
    ).run(
      guid,
      file,
      d.conn?.(file) ?? `C:/Imports/pkg/layers/${file}`,
      TABLE[layer.infraFeatureClass],
      d.sourceCs?.[layer.infraFeatureClass] ?? UTM38N,
      // As InfraWorks writes Configure: Name mapped to another field, or left out.
      d.names === "other" ? JSON.stringify({ propertyMappings: { EXTERNAL_ID: { expression: "FeatId" }, NAME: { expression: "LAYER" } } }) : JSON.stringify({ propertyMappings: { EXTERNAL_ID: { expression: "FeatId" } } }),
    );
    const gj = JSON.parse(zip.getEntry(layer.path)!.getData().toString("utf8"));
    const nameAttr = manifest.layers.find((l: { format: string; geojson?: string }) => l.format === "shp" && l.geojson === layer.path)?.nameAttribute;
    let n = 0;
    let record = 0;
    const [dx, dy] = d.shift?.[layer.infraFeatureClass] ?? [0, 0];
    const mv = (c: unknown): unknown => (typeof (c as number[])[0] === "number" ? [(c as number[])[0]! + dx, (c as number[])[1]! + dy] : (c as unknown[]).map(mv));
    for (const feat of gj.features) {
      let coords = mv(feat.geometry.coordinates);
      if (d.truncateRoads && layer.infraFeatureClass === "road_centerline") {
        const c = coords as number[][];
        coords = [c[0], [(c[0]![0]! + c[1]![0]!) / 2, (c[0]![1]! + c[1]![1]!) / 2]]; // half the road
      }
      const name = d.names === "unmapped" ? null : d.names === "other" ? `F-${++n}` : nameAttr ? (feat.properties?.[nameAttr] ?? null) : null;
      // EXTERNAL_ID = the Shapefile record number, as InfraWorks maps it (EXTERNAL_ID = FeatId).
      db.prepare(`insert into ${TABLE[layer.infraFeatureClass]} (GUID, NAME, GEOMETRY, DATA_SOURCE_ID, EXTERNAL_ID) values (?,?,?,?,?)`).run(
        feat.id,
        name,
        fgf(feat.geometry.type, coords),
        guid,
        String(++record),
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

test("G3-013 roads now component roads of the same name count as arrived (Al Narjis: 7 of 11 written by model:roads)", () => {
  const path = makeModel("component.sqlite");
  const db = new DatabaseSync(path);
  db.exec("alter table ROADS add column FK_PARENT_GUID text");
  const first = db.prepare("select ID, NAME from ROADS where NAME is not null order by ID limit 1").get() as { ID: number; NAME: string };
  // the planning road's row left its data source; a component road carries the name
  db.prepare("update ROADS set DATA_SOURCE_ID = null, FK_PARENT_GUID = 'cd-1' where ID = ?").run(first.ID);
  db.close();
  const r = runModelGate(path, { packagePath });
  assert.equal(r.ok, true, JSON.stringify(r.findings.filter((x) => x.severity !== "info"), null, 1));
  const roads = r.layers.find((l) => l.infraFeatureClass === "road_centerline")!;
  assert.equal(roads.modelCount, roads.packageCount);
  const info = r.findings.find((x) => x.ruleId === "G3-013")!;
  assert.equal(info.severity, "info");
  assert.ok(info.message.includes(first.NAME));
  assert.ok(!rules(r).includes("G3-005") && !rules(r).includes("G3-007"));
});

test("G3-010 names left unmapped in Configure are a warning that names the field to map", () => {
  const good = runModelGate(makeModel("named.sqlite"), { packagePath });
  const roads = good.layers.find((l) => l.infraFeatureClass === "road_centerline")!;
  assert.equal(roads.names?.field, "NAME");
  assert.equal(roads.names?.matched, roads.names?.package);
  assert.ok(!rules(good).includes("G3-010"));

  const r = runModelGate(makeModel("unnamed.sqlite", { names: "unmapped" }), { packagePath });
  assert.equal(r.ok, true, "a warning: the geometry is fine");
  const w = r.findings.find((x) => x.ruleId === "G3-010" && /road_centerline/.test(x.message))!;
  assert.equal(w.severity, "warning");
  assert.match(w.message, /no feature has a Name in the model.*\(Name is not mapped\).*Name = NAME/);
});

test("G3-010 Name mapped to another field is caught", () => {
  const r = runModelGate(makeModel("misnamed.sqlite", { names: "other" }), { packagePath });
  assert.ok(r.findings.some((x) => x.ruleId === "G3-010" && /Name is mapped to LAYER\. Set Name = NAME/.test(x.message)), JSON.stringify(r.findings));
  assert.equal(nameMapping('{"propertyMappings":{"NAME":{"expression":"ROAD_NAME"}}}'), "ROAD_NAME");
  assert.equal(nameMapping('{"propertyMappings":{}}'), null);
  assert.equal(nameMapping("not json"), null);
});

test("G3-011 a layer imported twice is named, with both data sources", () => {
  const r = runModelGate(makeModel("twice.sqlite", { twice: "parcel" }), { packagePath });
  const w = r.findings.find((x) => x.ruleId === "G3-011")!;
  assert.equal(w.severity, "warning");
  assert.match(w.message, /parcel\.shp is imported 2 times/, w.message);
  assert.ok(!rules(runModelGate(makeModel("once.sqlite"), { packagePath })).includes("G3-011"));
});

test("model-names fills NAME on a copy and records Name = NAME in Configure; the model itself is untouched", () => {
  const model = makeModel("tofill.sqlite", { names: "unmapped" });
  // InfraWorks' own update trigger, with its double-quoted "INVALID" that better-sqlite3 rejects.
  const iw = new DatabaseSync(model, { enableDoubleQuotedStringLiterals: true } as ConstructorParameters<typeof DatabaseSync>[1]);
  iw.exec(`create table __journal_ROADS (id integer);
    create trigger "__ROADS_IDENTITY_CONSTRAINTS_UPDATE" before update on "ROADS" for each row begin
      select case when old.DATA_SOURCE_ID != new.DATA_SOURCE_ID and new.DATA_SOURCE_ID != "INVALID"
        then raise(abort, 'ROADS.DATA_SOURCE_ID must not be changed.') end; end;
    create trigger "__ROADS_update" after update on "ROADS" begin insert into "__journal_ROADS" values(new.rowid); end;`);
  iw.close();

  const out = join(work, "tofill (names).sqlite");
  const r = fillNames(model, packagePath, out);
  const roads = r.layers.find((l) => l.table === "ROADS")!;
  assert.equal(roads.skipped, undefined);
  assert.ok(roads.filled > 0);
  assert.equal(roads.field, "NAME");

  const after = runModelGate(out, { packagePath });
  assert.ok(!rules(after).includes("G3-010"), JSON.stringify(after.findings));
  const row = after.layers.find((l) => l.infraFeatureClass === "road_centerline")!;
  assert.equal(row.names?.matched, row.names?.package);
  const db = new Database(out, { readonly: true });
  const cfg = JSON.parse((db.prepare("select CONFIG from DATA_SOURCES where TARGET_CLASS_NAME = 'ROADS'").get() as { CONFIG: string }).CONFIG);
  assert.equal(cfg.propertyMappings.NAME.expression, "NAME");
  assert.ok((db.prepare("select count(*) n from __journal_ROADS").get() as { n: number }).n > 0, "InfraWorks' change log records the edits");
  db.close();

  assert.ok(rules(runModelGate(model, { packagePath })).includes("G3-010"), "the original keeps no names");
  assert.throws(() => fillNames(model, packagePath, out), /already exists/);
});

test("model-names fills the other roads when one was converted to a component road (it left its data source)", () => {
  const model = makeModel("converted.sqlite", { names: "unmapped" });
  const db = new DatabaseSync(model);
  const first = db.prepare("select ID from ROADS order by ID limit 1").get() as { ID: number };
  // Al Narjis, 10 Nov 2026: Convert to Component Road clears DATA_SOURCE_ID and EXTERNAL_ID.
  db.prepare("update ROADS set DATA_SOURCE_ID = null, EXTERNAL_ID = null where ID = ?").run(first.ID);
  db.close();
  const r = fillNames(model, packagePath, join(work, "converted (names).sqlite"));
  const roads = r.layers.find((l) => l.table === "ROADS")!;
  assert.equal(roads.skipped, undefined);
  assert.equal(roads.missing, 1);
  assert.equal(roads.filled, roads.rows);

  // A repeated record number means another file: left alone.
  const twice = makeModel("repeated.sqlite", { names: "unmapped" });
  const db2 = new DatabaseSync(twice);
  const ids = db2.prepare("select ID from ROADS order by ID limit 2").all() as { ID: number }[];
  db2.prepare("update ROADS set EXTERNAL_ID = (select EXTERNAL_ID from ROADS where ID = ?) where ID = ?").run(ids[0]!.ID, ids[1]!.ID);
  db2.prepare("delete from ROADS where ID = (select max(ID) from ROADS)").run();
  db2.close();
  const r2 = fillNames(twice, packagePath, join(work, "repeated (names).sqlite"));
  assert.match(r2.layers.find((l) => l.table === "ROADS")!.skipped ?? "", /re-import/);
});

test("model-names copies the model's .files folder, and refuses while the model is open (.lock)", () => {
  const model = makeModel("withfiles.sqlite", { names: "unmapped" });
  mkdirSync(join(work, "withfiles.files", "styles"), { recursive: true });
  writeFileSync(join(work, "withfiles.files", "styles", "a.json"), "{}");
  writeFileSync(join(work, "withfiles.lock"), "2026-11-01T10:25:32Z");
  const out = join(work, "withfiles (names).sqlite");
  assert.throws(() => fillNames(model, packagePath, out), /open in InfraWorks/);
  assert.equal(existsSync(out), false, "nothing written");
  rmSync(join(work, "withfiles.lock"));
  const r = fillNames(model, packagePath, out);
  assert.equal(r.filesFolder, join(work, "withfiles (names).files"));
  assert.ok(existsSync(join(work, "withfiles (names).files", "styles", "a.json")));
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
test("G3-003 a layer imported as SHP matches by name, whatever the extension", () => {
  // InfraWorks writes SHP sources as DefaultFileLocation="C:\...\name.shp";
  const shp = (file: string) => `DefaultFileLocation="C:\\Imports\\pkg\\layers_shp\\${file.replace(/\.geojson$/, ".shp")}";`;
  const r = runModelGate(makeModel("shp.sqlite", { conn: shp }), { packagePath });
  assert.equal(r.ok, true, JSON.stringify(r.findings, null, 2));
  assert.ok(r.layers.every((l) => l.modelCount === l.packageCount));
});

test("G3-003 a different file with a similar name is not taken for the layer", () => {
  const other = (file: string) => `C:/Imports/${file.replace(/\.geojson$/, "_old.shp")}`;
  const r = runModelGate(makeModel("other.sqlite", { conn: other }), { packagePath });
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.ruleId === "G3-003" && /road_centerline/.test(f.message)));
});

test("G3-008/G3-009 a real corridor import: new GUIDs pair by name, and a road that did not arrive is named", () => {
  // As NEOM PKG 4 C1-P3: InfraWorks re-issued the region GUID, and the IMX's plain corridor road
  // (no DEFINITION_ID) is absent from the model while the design road arrived.
  const model = makeModel("corridor.sqlite");
  const db = new Database(model);
  db.prepare("insert into ALIGNMENT_REGIONS (GUID, NAME) values ('a33470c2-5faf-4c48-b65b-1d9f3b1ec967', 'TRN_Road_A')").run();
  for (let i = 0; i <= 10; i++) {
    db.prepare("insert into ALIGNMENT_CROSS_SECTIONS (FK_REGION_GUID, REGION_DISTANCE_2D) values ('a33470c2-5faf-4c48-b65b-1d9f3b1ec967', ?)").run(i * 10);
  }
  db.prepare("insert into ROADS (NAME) values ('TRN_NB')").run();
  db.close();

  const imx = join(work, "corridor.imx");
  const x = new Database(imx);
  x.exec(`
    create table IMX_VERSION (ID integer primary key, VERSION text);
    create table ROADS (ID integer primary key, NAME text, DEFINITION_ID text);
    create table CONSTRAINED_DEF_CORRIDOR_REGIONS (ID integer primary key, NAME text, GUID text, DEFINITION_ID text,
      CORRIDOR_NAME text, BASELINE_NAME text, START_DISTANCE_2D real, END_DISTANCE_2D real, JSON_ASSEMBLY_DATA text);
    create table CONSTRAINED_DEF_CORRIDOR_SECTIONS (ID integer primary key, REGION_ID text, DISTANCE_2D real, JSON_CROSS_SECTION text);
  `);
  x.prepare("insert into ROADS (NAME, DEFINITION_ID) values ('TRN_COR', null), ('TRN_NB', 'A1B8')").run();
  x.prepare("insert into CONSTRAINED_DEF_CORRIDOR_REGIONS (NAME, GUID, START_DISTANCE_2D, END_DISTANCE_2D) values ('TRN_Road_A','5179d09d882a45e2523a35a0b658c8c0',0,100)").run();
  for (let i = 0; i <= 10; i++) x.prepare("insert into CONSTRAINED_DEF_CORRIDOR_SECTIONS (REGION_ID, DISTANCE_2D) values ('5179d09d882a45e2523a35a0b658c8c0', ?)").run(i * 10);
  x.close();

  const r = runModelGate(model, { imxPath: imx });
  assert.equal(r.ok, true, JSON.stringify(r.findings, null, 2));
  assert.equal(r.regions[0]?.matchedBy, "name");
  assert.match(r.findings.find((y) => y.ruleId === "G3-008" && y.severity === "info")!.message, /1 of 1 .* matched by name; 1 built/);
  const missing = r.findings.find((y) => y.ruleId === "G3-009");
  assert.equal(missing?.severity, "warning");
  assert.equal(missing?.context?.missing, "TRN_COR");
  assert.match(missing!.message, /plain road, no design definition/);
});
