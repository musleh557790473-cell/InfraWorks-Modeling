import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import AdmZip from "adm-zip";
import { createFileStore, runBuildPipeline } from "@infraworks/domain";

import { runModelGate } from "../src/gate.js";
import { fillNames } from "../src/names.js";
import { makeSewerModel } from "../../domain/test/sewer-model.js";

const UTM38N =
  'PROJCS["UTM84-38N",GEOGCS["LL84",DATUM["WGS84"]],PROJECTION["Transverse_Mercator"],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],PARAMETER["central_meridian",45],UNIT["Meter",1]]';

function fgf(type: string, coords: unknown): Buffer {
  const parts: Buffer[] = [];
  const i32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
  const pts = (list: number[][]) => { for (const p of list) { const b = Buffer.alloc(16); b.writeDoubleLE(p[0]!, 0); b.writeDoubleLE(p[1]!, 8); parts.push(b); } };
  if (type === "Point") { i32(1); i32(0); pts([coords as number[]]); }
  else { const c = coords as number[][]; i32(2); i32(0); i32(c.length); pts(c); }
  return Buffer.concat(parts);
}

const work = mkdtempSync(join(tmpdir(), "g3-sewer-"));
let packagePath = "";

test.before(async () => {
  const model = join(work, "Al Qairawan.stsw.sqlite");
  makeSewerModel(model);
  const store = createFileStore(join(work, "store"));
  const p = store.createProject("sewer", 32638);
  store.addUpload({ projectId: p.id, filename: "Al Qairawan.stsw.sqlite", kind: "hydraulic", path: model, size: 0 });
  packagePath = (await runBuildPipeline(store, p.id)).packagePath;
});

const IW_TABLE: Record<string, string> = { pipeline: "PIPELINES", pipe_connector: "PIPE_CONNECTORS" };

/** An InfraWorks model that imported the sewer package with Type only: geometry in, no columns mapped. */
function importedModel(name: string): string {
  const path = join(work, name);
  const db = new Database(path);
  db.exec(`
    create table SCHEMA_VERSION (ID integer primary key, VERSION text);
    create table spatial_ref_sys (srid integer, sr_name text, auth_name text, auth_srid integer, srtext text, sr_xytol real, sr_ztol real);
    create table DATA_SOURCES (ID integer primary key, GUID text, NAME text, DESCRIPTION text, DATA_PROVIDER_GUID text,
      CONNECTION_STRING text, TARGET_CLASS_NAME text, DATE_OF_IMPORT text, SOURCE_CS text, POS_CS text, CONFIG text);
    create table ALIGNMENT_REGIONS (ID integer primary key, GUID text, NAME text, GEOMETRY blob);
    create table ALIGNMENT_CROSS_SECTIONS (ID integer primary key, GUID text, FK_REGION_GUID text, REGION_DISTANCE_2D real, GEOMETRY blob);
    create table ROADS (ID integer primary key, GUID text, NAME text, GEOMETRY blob, DATA_SOURCE_ID text, EXTERNAL_ID text);
    create table PIPELINES (ID integer primary key, GUID text, NAME text, GEOMETRY blob, DATA_SOURCE_ID text, EXTERNAL_ID text,
      SIZE_X real, SIZE_Y real, PIPE_MATERIAL text, UTILITY_TYPE integer, NETWORKNAME text);
    create table PIPE_CONNECTORS (ID integer primary key, GUID text, NAME text, GEOMETRY blob, DATA_SOURCE_ID text, EXTERNAL_ID text,
      SIZE_X real, SIZE_Y real, HEIGHT real, UTILITY_TYPE integer, NETWORKNAME text);
  `);
  db.prepare("insert into SCHEMA_VERSION values (1, '17.18.0')").run();
  db.prepare("insert into spatial_ref_sys values (1, 'UTM84-38N', null, null, ?, null, null)").run(UTM38N);
  const zip = new AdmZip(packagePath);
  const manifest = JSON.parse(zip.getEntry("manifest.json")!.getData().toString("utf8"));
  let id = 0;
  for (const layer of manifest.layers.filter((l: { format: string }) => l.format === "shp")) {
    const guid = `ds-${++id}`;
    const file = layer.path.split("/").pop();
    db.prepare("insert into DATA_SOURCES (GUID, NAME, CONNECTION_STRING, TARGET_CLASS_NAME, SOURCE_CS, CONFIG) values (?,?,?,?,?,?)").run(
      guid, layer.name, `DefaultFileLocation="C:/pkg/shp/${file}";`, IW_TABLE[layer.infraFeatureClass], UTM38N,
      JSON.stringify({ propertyMappings: { EXTERNAL_ID: { expression: "FeatId" } } }),
    );
    const gj = JSON.parse(zip.getEntry(layer.geojson)!.getData().toString("utf8"));
    gj.features.forEach((feat: { id: string; geometry: { type: string; coordinates: unknown } }, i: number) => {
      db.prepare(`insert into ${IW_TABLE[layer.infraFeatureClass]} (GUID, GEOMETRY, DATA_SOURCE_ID, EXTERNAL_ID) values (?,?,?,?)`).run(
        `${guid}-${i}`, fgf(feat.geometry.type, feat.geometry.coordinates), guid, String(i + 1),
      );
    });
  }
  db.close();
  return path;
}

test("G3-012 names the empty columns of a sewer imported with Type only; model-names fills them and G3 comes back clean", () => {
  const model = importedModel("sewer.sqlite");
  const before = runModelGate(model, { packagePath });
  assert.equal(before.ok, true, JSON.stringify(before.findings.filter((f) => f.severity === "blocking")));
  const w = before.findings.filter((f) => f.ruleId === "G3-012");
  assert.ok(w.some((f) => /sewer_pipes\.shp: empty in the model: SIZE_X \(not mapped; SIZE_M has 2\).*PIPE_MATERIAL/.test(f.message)), JSON.stringify(before.findings));
  assert.ok(w.some((f) => /sewer_manholes\.shp: empty in the model: .*HEIGHT \(not mapped; DEPTH_M has 3\)/.test(f.message)), "the outfall has no depth");

  const out = join(work, "sewer (names).sqlite");
  const r = fillNames(model, packagePath, out);
  const pipes = r.layers.find((l) => l.table === "PIPELINES")!;
  const byCol = Object.fromEntries(pipes.columns.map((c) => [c.column, c.filled]));
  assert.deepEqual(byCol, { NAME: 2, SIZE_X: 2, SIZE_Y: 2, PIPE_MATERIAL: 2, NETWORKNAME: 2 });

  const after = runModelGate(out, { packagePath });
  assert.ok(!after.findings.some((f) => f.ruleId === "G3-012" || f.ruleId === "G3-010"), JSON.stringify(after.findings));
  const db = new Database(out, { readonly: true });
  const co1 = db.prepare("select NAME, SIZE_X, PIPE_MATERIAL, NETWORKNAME from PIPELINES where NAME = 'CO-1'").get() as Record<string, unknown>;
  assert.deepEqual(co1, { NAME: "CO-1", SIZE_X: 0.2, PIPE_MATERIAL: "HDPE CORRUGATED", NETWORKNAME: "Sewer - Al Qairawan" });
  const mh = db.prepare("select HEIGHT, SIZE_X from PIPE_CONNECTORS where NAME = 'MH-1'").get() as Record<string, unknown>;
  assert.deepEqual(mh, { HEIGHT: 2, SIZE_X: 1.2 });
  const cfg = JSON.parse((db.prepare("select CONFIG from DATA_SOURCES where TARGET_CLASS_NAME = 'PIPELINES'").get() as { CONFIG: string }).CONFIG);
  assert.equal(cfg.propertyMappings.PIPE_MATERIAL.expression, "MATERIAL");
  db.close();
});