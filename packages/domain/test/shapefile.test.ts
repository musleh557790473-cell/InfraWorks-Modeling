import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createFileStore, dbfFieldNames, esriWkt, runBuildPipeline, writeShapefile } from "../src/index.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const tmp = () => mkdtempSync(join(tmpdir(), "iw-shp-"));

/* ---------------------------------------------------------------- a small independent reader */

function readShp(base: string) {
  const shp = readFileSync(`${base}.shp`);
  const shx = readFileSync(`${base}.shx`);
  assert.equal(shp.readInt32BE(0), 9994, "shp file code");
  assert.equal(shp.readInt32BE(24) * 2, shp.length, "shp length header");
  assert.equal(shx.readInt32BE(24) * 2, shx.length, "shx length header");
  const type = shp.readInt32LE(32);
  const records: { parts: number[][][] }[] = [];
  let off = 100;
  for (let i = 0; off < shp.length; i++) {
    assert.equal(shp.readInt32BE(off), i + 1, "record number");
    assert.equal(shx.readInt32BE(100 + i * 8) * 2, off, "shx offset");
    const len = shp.readInt32BE(off + 4) * 2;
    const c = off + 8;
    if (type === 1) records.push({ parts: [[[shp.readDoubleLE(c + 4), shp.readDoubleLE(c + 12)]]] });
    else {
      const np = shp.readInt32LE(c + 36);
      const n = shp.readInt32LE(c + 40);
      const starts = Array.from({ length: np }, (_, k) => shp.readInt32LE(c + 44 + 4 * k));
      const pts = Array.from({ length: n }, (_, k) => [shp.readDoubleLE(c + 44 + 4 * np + 16 * k), shp.readDoubleLE(c + 52 + 4 * np + 16 * k)]);
      records.push({ parts: starts.map((s, k) => pts.slice(s, starts[k + 1] ?? n)) });
    }
    off = c + len;
  }
  return { type, records };
}

function readDbf(base: string) {
  const b = readFileSync(`${base}.dbf`);
  const n = b.readUInt32LE(4);
  const headerLen = b.readUInt16LE(8);
  const recordLen = b.readUInt16LE(10);
  const fields: { name: string; type: string; len: number }[] = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    fields.push({ name: b.toString("ascii", o, o + 11).replace(/\0.*$/, ""), type: String.fromCharCode(b[o + 11]!), len: b[o + 16]! });
  }
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < n; r++) {
    let o = headerLen + r * recordLen + 1;
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = b.subarray(o, o + f.len).toString("utf8").trim();
      o += f.len;
    }
    rows.push(row);
  }
  assert.equal(b[b.length - 1], 0x1a, "dbf end marker");
  return { fields, rows };
}

const ccw = (ring: number[][]) => ring.reduce((s, p, i) => s + ring[(i + ring.length - 1) % ring.length]![0]! * p[1]! - p[0]! * ring[(i + ring.length - 1) % ring.length]![1]!, 0) > 0;

/* ---------------------------------------------------------------- writer */

test("polygons: outer ring clockwise and closed, hole counter-clockwise, whatever the input winding", () => {
  const base = join(tmp(), "areas");
  const outerCcw = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const holeCw = [[2, 2], [2, 4], [4, 4], [4, 2], [2, 2]];
  writeShapefile(base, "area", [{ kind: "area", parts: [outerCcw, holeCw], attributes: {} }], 32638);
  const { type, records } = readShp(base);
  assert.equal(type, 5);
  const [outer, hole] = records[0]!.parts;
  assert.equal(ccw(outer!), false, "outer clockwise");
  assert.equal(ccw(hole!), true, "hole counter-clockwise");
  assert.deepEqual(outer![0], outer![outer!.length - 1], "outer ring closed");
});

test("dbf: UTF-8 Arabic text kept whole, numbers typed N, .cpg declares UTF-8", () => {
  const base = join(tmp(), "roads");
  const long = "طريق ".repeat(60); // > 254 bytes: must be cut on a character boundary
  writeShapefile(
    base,
    "line",
    [
      { kind: "line", parts: [[[0, 0], [3, 4]]], attributes: { name: "طريق الملك", lanes: "2", note: long } },
      { kind: "line", parts: [[[0, 0], [0, 1]]], attributes: { name: "B", lanes: 4, note: null } },
    ],
    32638,
  );
  const { fields, rows } = readDbf(base);
  assert.deepEqual(fields.map((f) => `${f.name}:${f.type}`), ["NAME:C", "LANES:N", "NOTE:C"]);
  assert.equal(rows[0]!.NAME, "طريق الملك");
  assert.equal(rows[1]!.LANES, "4");
  assert.ok(!rows[0]!.NOTE!.includes("�"), "no broken character at the cut");
  assert.ok(Buffer.byteLength(rows[0]!.NOTE!, "utf8") <= 254);
  assert.equal(readFileSync(`${base}.cpg`, "utf8"), "UTF-8");
});

test("field names: ≤ 10 ASCII characters, unique, Arabic names get FIELD_n", () => {
  const m = dbfFieldNames(["design_speed_kph", "design_speed_limit", "اسم الطريق", "asset id"]);
  assert.deepEqual([...m.values()], ["DESIGN_SPE", "DESIGN_S_2", "FIELD_1", "ASSET_ID"]);
});

test(".prj: ESRI WKT for UTM north and south, none for an unknown EPSG", () => {
  assert.match(esriWkt(32638)!, /WGS_1984_UTM_Zone_38N.*"Central_Meridian",45\.0.*"False_Northing",0\.0|WGS_1984_UTM_Zone_38N.*"False_Northing",0\.0.*"Central_Meridian",45\.0/);
  assert.match(esriWkt(32736)!, /Zone_36S.*"False_Northing",10000000\.0/);
  assert.equal(esriWkt(2264), null);
});

/* ---------------------------------------------------------------- package */

test("the package carries one Shapefile per class and geometry kind, and a checklist that names them", async () => {
  const dir = tmp();
  const dxf = join(dir, "mixed.dxf");
  // WATER as a line and as a closed area → water_line.shp + water_area.shp
  writeFileSync(
    dxf,
    [
      "0", "SECTION", "2", "ENTITIES",
      "0", "LINE", "8", "WATER", "10", "673000", "20", "2735000", "11", "673100", "21", "2735000",
      "0", "LWPOLYLINE", "8", "WATER", "90", "3", "70", "1", "10", "673000", "20", "2735100", "10", "673050", "20", "2735100", "10", "673050", "20", "2735150",
      "0", "LINE", "8", "ROADS", "10", "673000", "20", "2735200", "11", "673100", "21", "2735200", "1001", "INFRAWORKS", "1000", "RD-001",
      "0", "ENDSEC", "0", "EOF",
    ].join("\n") + "\n",
  );
  const store = createFileStore(join(dir, "store"));
  const p = store.createProject("mixed", 32638);
  store.addUpload({ projectId: p.id, filename: "mixed.dxf", kind: "dxf", path: dxf, size: 0 });
  store.addUpload({ projectId: p.id, filename: "roads_report.csv", kind: "csv", path: join(fixtures, "roads_report.csv"), size: 0 });
  await runBuildPipeline(store, p.id).catch(() => undefined); // partial join is a warning, not a failure
  const staging = join(store.artifactDir, readdirSync(store.artifactDir).find((d) => d.startsWith(`pkg-${p.id}`))!);

  const manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8"));
  const shp = manifest.layers.filter((l: { format: string }) => l.format === "shp");
  assert.deepEqual(
    shp.map((l: { name: string; infraWorksType: string }) => `${l.name}:${l.infraWorksType}`).sort(),
    ["road_centerline:Roads", "water_area:Water Areas", "water_line:Streams"],
  );
  for (const ext of ["shp", "shx", "dbf", "prj", "cpg"]) assert.ok(existsSync(join(staging, "shp", `water_area.${ext}`)), ext);
  assert.equal(readShp(join(staging, "shp", "road_centerline")).records.length, 1);
  assert.equal(readDbf(join(staging, "shp", "road_centerline")).rows[0]!.ASSET_ID, "RD-001");

  const checklist = readFileSync(join(staging, "IMPORT_CHECKLIST.txt"), "utf8");
  assert.match(checklist, /Add File Data Source → SHP/);
  assert.match(checklist, /water_area\.shp → Type: Water Areas/);
  assert.match(checklist, /cannot import the GeoJSON/);
  assert.ok(existsSync(join(staging, "shp", "field_names.csv")));
});
