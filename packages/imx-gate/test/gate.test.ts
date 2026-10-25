import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { lintJson, repairJson } from "../src/jsonlint.js";
import { parseFgf, partLength2d } from "../src/fgf.js";
import { runGate } from "../src/gate.js";
import { repairImx } from "../src/repair.js";

/* ---------------------------------------------------------------- fixtures */

/** FGF LineString, XYZ, from an array of [x,y,z]. */
function fgfLine(points: [number, number, number][]): Buffer {
  const b = Buffer.alloc(12 + points.length * 24);
  b.writeInt32LE(2, 0); // LineString
  b.writeInt32LE(1, 4); // XYZ
  b.writeInt32LE(points.length, 8);
  let off = 12;
  for (const p of points) {
    b.writeDoubleLE(p[0], off);
    b.writeDoubleLE(p[1], off + 8);
    b.writeDoubleLE(p[2], off + 16);
    off += 24;
  }
  return b;
}

function crossSection(slope: number | "inf"): string {
  const value = slope === "inf" ? "inf" : String(slope);
  const formatted = slope === "inf" ? "Infinity" : String(slope);
  return `{"version":"1.0.0","assemblyId":"A1","assemblyName":"ASM","regionGuid":"R1","subassemblies":[{"id":"S1","name":"CUTB","points":[{"location":[20.1,-0.93]},{"location":[20.1,-0.93]}],"links":[{"pointIndices":[0,1]}],"params":{"doubleParams":[{"name":"Link Slope","value": ${value},"formattedValue":"${formatted}"}]}}]}`;
}

interface FixtureOpts {
  badSectionAt?: number;
  epsgZone?: number;
  sections?: number;
  regionLength?: number;
  falseNorthing?: number;
}

function makeImx(dir: string, name: string, o: FixtureOpts = {}): string {
  const sections = o.sections ?? 10;
  const regionLength = o.regionLength ?? 90;
  const zone = o.epsgZone ?? 36;
  const cm = zone * 6 - 183;
  const path = join(dir, name);
  const db = new Database(path);

  db.exec(`
    create table IMX_VERSION (ID integer primary key, VERSION text, COMMIT_ID text, FINGERPRINT_ID text);
    create table spatial_ref_sys (srid text, sr_name text, auth_name text, auth_srid text, srtext text, sr_xytol text, sr_ztol text);
    create table ROADS (ID integer primary key, NAME text, DESCRIPTION text, GUID text, EXTERNAL_ID text, TAG text, GEOMETRY blob, DEFINITION_ID text);
    create table SURFACES (ID integer primary key, NAME text, GEOMETRY blob);
    create table COVERAGES (ID integer primary key, NAME text, GEOMETRY blob);
    create table CONSTRAINED_DEF_CORRIDOR_REGIONS (
      ID integer primary key, NAME text, GUID text, DEFINITION_ID text, PROFILE_ID text,
      CORRIDOR_ID text, CORRIDOR_NAME text, BASELINE_NAME text,
      START_DISTANCE_2D real, END_DISTANCE_2D real, JSON_ASSEMBLY_DATA text);
    create table CONSTRAINED_DEF_CORRIDOR_SECTIONS (
      ID integer primary key, REGION_ID text, DISTANCE_2D real,
      SECTION_COORDINATES_3D blob, JSON_CROSS_SECTION text);
  `);

  db.prepare("insert into IMX_VERSION values (1, '2.1', null, 'TEST')").run();
  db.prepare("insert into spatial_ref_sys values (?,?,?,?,?,?,?)").run(
    "1",
    "Default",
    `UTM84-${zone}N`,
    null,
    `PROJCS["UTM84-${zone}N",PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",${cm}.0000000]${
      o.falseNorthing !== undefined ? `,PARAMETER["false_northing",${o.falseNorthing}]` : ""
    }]`,
    null,
    null,
  );

  const line = fgfLine([
    [700000, 3120000, 40],
    [700000 + regionLength, 3120000, 41],
  ]);
  db.prepare("insert into ROADS (ID,NAME,GEOMETRY,DEFINITION_ID) values (1,'NB',?, 'D1')").run(line);
  db.prepare("insert into SURFACES (ID,NAME,GEOMETRY) values (1,'EG',?)").run(line);

  db.prepare(
    `insert into CONSTRAINED_DEF_CORRIDOR_REGIONS
       (ID,NAME,GUID,DEFINITION_ID,CORRIDOR_NAME,BASELINE_NAME,START_DISTANCE_2D,END_DISTANCE_2D,JSON_ASSEMBLY_DATA)
     values (1,'REGION_A','R1','D1','COR','BL',0,?,?)`,
  ).run(regionLength, '{"version":"1.0.0","alignmentName":"ALN","corridorOutOfDate":false,"baselineOutOfDate":false}');

  const ins = db.prepare(
    "insert into CONSTRAINED_DEF_CORRIDOR_SECTIONS (ID,REGION_ID,DISTANCE_2D,SECTION_COORDINATES_3D,JSON_CROSS_SECTION) values (?,?,?,?,?)",
  );
  const step = regionLength / (sections - 1);
  for (let i = 0; i < sections; i++) {
    const station = i * step;
    const bad = o.badSectionAt !== undefined && i === o.badSectionAt;
    ins.run(i + 1, "R1", station, line, crossSection(bad ? "inf" : -0.3));
  }
  db.close();
  return path;
}

/* -------------------------------------------------------------------- tests */

test("FGF reader round-trips a LineString", () => {
  const g = parseFgf(fgfLine([[0, 0, 0], [3, 4, 1]]));
  assert.equal(g.type, "LineString");
  assert.equal(g.points.length, 2);
  assert.equal(partLength2d(g.parts[0]!), 5);
});

test("lintJson reports the non-finite literal", () => {
  const r = lintJson(crossSection("inf"));
  assert.equal(r.valid, false);
  assert.deepEqual(r.literals, ["inf"]);
  assert.equal(lintJson(crossSection(-0.3)).valid, true);
});

test("repairJson produces valid JSON and keeps the geometry arrays", () => {
  const before = crossSection("inf");
  const after = repairJson(before);
  assert.equal(after.repaired, true);
  const parsed = JSON.parse(after.text) as {
    subassemblies: { points: { location: number[] }[]; params: { doubleParams: { value: number }[] } }[];
  };
  assert.equal(parsed.subassemblies[0]!.params.doubleParams[0]!.value, 0);
  assert.deepEqual(parsed.subassemblies[0]!.points[0]!.location, [20.1, -0.93]);
});

test("a clean export passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "imx-"));
  try {
    const file = makeImx(dir, "clean.imx");
    const r = runGate(file, { epsg: 32636 });
    assert.equal(r.ok, true, JSON.stringify(r.findings, null, 2));
    assert.equal(r.stats.regions[0]!.sectionCount, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IMX-002 blocks an export with a non-finite literal, and --repair clears it", () => {
  const dir = mkdtempSync(join(tmpdir(), "imx-"));
  try {
    const file = makeImx(dir, "bad.imx", { badSectionAt: 4 });

    const dry = runGate(file, { epsg: 32636 });
    assert.equal(dry.ok, false);
    assert.ok(dry.findings.some((f) => f.ruleId === "IMX-002" && f.severity === "blocking" && f.repairable));

    const fixed = runGate(file, { epsg: 32636, repair: true });
    assert.equal(fixed.ok, true, JSON.stringify(fixed.findings, null, 2));
    assert.equal(fixed.repairedCount, 1);
    assert.ok(fixed.repairedFile?.endsWith("_FIXED.imx"));
    assert.ok(fixed.findings.some((f) => f.ruleId === "IMX-002" && f.repaired === true));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IMX-009 blocks a zone mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "imx-"));
  try {
    const file = makeImx(dir, "zone.imx", { epsgZone: 36 });
    const r = runGate(file, { epsg: 32638 });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.ruleId === "IMX-009" && f.severity === "blocking"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IMX-006 warns when sections are sampled too far apart", () => {
  const dir = mkdtempSync(join(tmpdir(), "imx-"));
  try {
    const file = makeImx(dir, "sparse.imx", { sections: 3, regionLength: 300 });
    const r = runGate(file, { epsg: 32636, maxStationGapM: 15 });
    assert.ok(r.findings.some((f) => f.ruleId === "IMX-006"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IMX-009 blocks a hemisphere mismatch in the right zone", () => {
  const dir = mkdtempSync(join(tmpdir(), "imx-"));
  try {
    const south = makeImx(dir, "south.imx", { epsgZone: 38, falseNorthing: 10000000 });
    const r = runGate(south, { epsg: 32638 });
    assert.ok(r.findings.some((f) => f.ruleId === "IMX-009" && /hemisphere/.test(f.message)));

    const north = makeImx(dir, "north.imx", { epsgZone: 38, falseNorthing: 0 });
    assert.ok(!runGate(north, { epsg: 32638 }).findings.some((f) => /hemisphere/.test(f.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repair refuses an output path that is the source written differently", () => {
  const dir = mkdtempSync(join(tmpdir(), "imx-"));
  try {
    const file = makeImx(dir, "bad.imx", { badSectionAt: 2 });
    assert.throws(() => repairImx(file, `${dir}/./sub/../bad.imx`), /in place/);
    if (process.platform === "win32") {
      assert.throws(() => repairImx(file, join(dir, "BAD.IMX")), /in place/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
