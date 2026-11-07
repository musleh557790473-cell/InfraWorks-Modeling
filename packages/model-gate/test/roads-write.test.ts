import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildSection, type Alignment } from "@infraworks/domain";

import { planRoad } from "../src/roads/plan.js";
import { RoadWriter, restyleRoad } from "../src/roads/write.js";

const TPL = "tpl-cd";
const J = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8");

/** The tables RoadWriter reads and writes, with only the columns it uses, and one template road. */
function model(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table CONSTRAINED_DEFINITIONS (ID integer primary key, GUID text, NAME text, FK_DEFAULT_ASSET_GUID text, REFERENCE_POINT blob);
    create table ROADS (ID integer primary key, GUID text, NAME text, FK_PARENT_GUID text, GEOMETRY blob, MANUAL_STYLE text, MAX_SPEED real, GRADING_DATA text);
    create table H_CONSTRAINTS (ID integer primary key, GUID text, FK_PARENT_TABLE text, FK_PARENT_GUID text, FK_PREV_H_CONSTRAINTS_GUID text, FK_NEXT_H_CONSTRAINTS_GUID text,
      CONSTRAINT_TYPE integer, CONSTRAINT_TYPE_DEFINITION integer, PASSTHROUGH_PT_1 blob, PASSTHROUGH_PT_2 blob, PASSTHROUGH_PT_3 blob);
    create table V_CONSTRAINTS (ID integer primary key, GUID text, FK_PARENT_TABLE text, FK_PARENT_GUID text, FK_PREV_V_CONSTRAINTS_GUID text, FK_NEXT_V_CONSTRAINTS_GUID text,
      CONSTRAINT_TYPE integer, CONSTRAINT_TYPE_DEFINITION integer, GEOMETRY blob, PASSTHROUGH_PT_1 blob, PASSTHROUGH_PT_2 blob, CURVE_TYPE integer, PARAM_1 real);
    create table CONSTRAINED_DEF_GEOM_LOCATIONS (ID integer primary key, GUID text, FK_PARENT_GUID text, TYPE integer, GEOMETRY blob, FK_REFERENCE_H_CONSTRAINTS_GUID text, SUB_ELEMENT integer, PARAM real, STATION real);
    create table CONSTRAINED_DEF_RPSYSTEMS (ID integer primary key, GUID text, FK_PARENT_GUID text, GEOMETRY blob, LENGTH_2D real, JSON_RANGE_HASH blob);
    create table PRIMITIVES (ID integer primary key, GUID text, FK_PARENT_GUID text, PARENT_PART_ID integer, GROUP_URN text, JSON_DATA blob, GEOMETRY blob);
    create table TERRAIN_OPERATIONS (ID integer primary key, GUID text, FK_PARENT_GUID text, GROUP_URN text, TERRAIN_OPERATION blob, GEOMETRY blob, START_POINT_KEY text, END_POINT_KEY text);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_ASSET_GUID text);
    create table INTERSECTION_REGIONS (ID integer primary key, GUID text, FK_INCOMING_ASSET_GUID text, FK_OUTGOING_ASSET_GUID text);
  `);
  const ins = (t: string, row: Record<string, unknown>) => db.prepare(`insert into ${t} (${Object.keys(row).join(",")}) values (${Object.keys(row).map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
  ins("CONSTRAINED_DEFINITIONS", { GUID: TPL, NAME: "TPL" });
  ins("ROADS", { GUID: "tpl-road", NAME: "TPL", FK_PARENT_GUID: TPL, MANUAL_STYLE: JSON.stringify({ lanes: {} }), MAX_SPEED: 30, GRADING_DATA: "{}" });
  ins("H_CONSTRAINTS", { GUID: "tpl-h", FK_PARENT_TABLE: "CONSTRAINED_DEFINITIONS", FK_PARENT_GUID: TPL, CONSTRAINT_TYPE: 3 });
  ins("V_CONSTRAINTS", { GUID: "tpl-v", FK_PARENT_TABLE: "CONSTRAINED_DEFINITIONS", FK_PARENT_GUID: TPL, CONSTRAINT_TYPE: 15 });
  ins("CONSTRAINED_DEF_GEOM_LOCATIONS", { GUID: "tpl-l1", FK_PARENT_GUID: TPL, TYPE: 1 });
  ins("CONSTRAINED_DEF_GEOM_LOCATIONS", { GUID: "tpl-l3", FK_PARENT_GUID: TPL, TYPE: 3 });
  ins("CONSTRAINED_DEF_RPSYSTEMS", { GUID: "tpl-rps", FK_PARENT_GUID: TPL, JSON_RANGE_HASH: Buffer.from(`{"Value": "${"A".repeat(32)}"}`) });
  ins("PRIMITIVES", { GUID: "p1", FK_PARENT_GUID: "tpl-road", GROUP_URN: "urn:rps:tpl-rps", JSON_DATA: J({ type: "multiMorphingCrossSection", crossSections: [[[-4, 0], [4, 0]]] }) });
  ins("PRIMITIVES", { GUID: "p2", FK_PARENT_GUID: "tpl-road", GROUP_URN: "urn:rps:tpl-rps", JSON_DATA: J({ type: "symbolizedPath" }) });
  for (let k = 0; k < 4; k++) ins("TERRAIN_OPERATIONS", { GUID: `t${k}`, FK_PARENT_GUID: "tpl-road", GROUP_URN: "urn:rps:tpl-rps", TERRAIN_OPERATION: J({ gradingComponent: { gradingType: "FixedWidth" } }) });
  ins("TERRAIN_OPERATIONS", { GUID: "t4", FK_PARENT_GUID: "tpl-road", GROUP_URN: "urn:rps:tpl-rps", TERRAIN_OPERATION: J({ type: "CutOut" }) });
  return db;
}
const plan = (name: string) => {
  const al: Alignment = { name, length: 100, segs: [{ a: [0, 0], b: [100, 0], bulge: 0 }] };
  return planRoad(al, [{ s: 0, z: 690, L: 0 }, { s: 100, z: 691, L: 0 }]);
};
const one = (db: DatabaseSync, q: string, ...a: string[]) => db.prepare(q).get(...a) as Record<string, unknown>;

test("a replaced road keeps its GUIDs, so InfraWorks' intersections still point at it (44 roads in Al Qairawan)", () => {
  const db = model(), w = new RoadWriter(db, TPL);
  w.write(plan("R.X"), buildSection("A1"));
  const before = one(db, "select GUID, FK_PARENT_GUID from ROADS where NAME='R.X'");
  // InfraWorks' arms point at the road's definition GUID
  db.prepare("insert into INTERSECTION_ARMS (GUID, FK_ASSET_GUID) values ('arm', ?)").run(String(before.FK_PARENT_GUID));
  w.write(plan("R.X"), buildSection("A2"));
  const after = one(db, "select GUID, FK_PARENT_GUID, MAX_SPEED from ROADS where NAME='R.X'");
  assert.equal(after.GUID, before.GUID);
  assert.equal(after.FK_PARENT_GUID, before.FK_PARENT_GUID);
  assert.equal(one(db, "select count(*) n from ROADS where NAME='R.X'").n, 1);
  assert.equal(one(db, "select count(*) n from CONSTRAINED_DEFINITIONS c join INTERSECTION_ARMS a on a.FK_ASSET_GUID = c.GUID").n, 1, "the arm still finds its road");
  assert.equal(one(db, "select count(*) n from CONSTRAINED_DEFINITIONS where GUID=?", String(after.FK_PARENT_GUID)).n, 1);
});

test("a road InfraWorks split into pieces is not replaced when a later piece carries intersections (RA-1 after a rebuild)", () => {
  const db = model(), w = new RoadWriter(db, TPL);
  w.write(plan("RA-1"), null);
  db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID) values ('piece-2', 'RA-1', 'cd-piece-2')").run();
  db.prepare("insert into INTERSECTION_REGIONS (GUID, FK_INCOMING_ASSET_GUID) values ('reg', 'cd-piece-2')").run();
  assert.throws(() => w.write(plan("RA-1"), null), /2 rows, and 1 piece\(s\) besides the first carry intersections/);
  assert.equal(one(db, "select count(*) n from ROADS where NAME='RA-1'").n, 2, "nothing changed");
});

test("restyling a road replaces only its section: other style settings, geometry and GUIDs stay", () => {
  const db = model(), w = new RoadWriter(db, TPL);
  w.write(plan("R.X"), buildSection("A1"));
  const before = one(db, "select GUID, FK_PARENT_GUID, GEOMETRY, MANUAL_STYLE from ROADS where NAME='R.X'");
  const ms = JSON.parse(String(before.MANUAL_STYLE)); ms.somethingInfraWorksSet = 7; db.prepare("update ROADS set MANUAL_STYLE=? where NAME='R.X'").run(JSON.stringify(ms));
  assert.equal(restyleRoad(db, "R.X", buildSection("C1")), true);
  const after = one(db, "select GUID, FK_PARENT_GUID, GEOMETRY, MANUAL_STYLE from ROADS where NAME='R.X'");
  const s = JSON.parse(String(after.MANUAL_STYLE));
  assert.equal(s.somethingInfraWorksSet, 7);
  assert.equal(s.lanes.countForward, 2);
  assert.ok(String(s.componentStyle).includes("Sloped Median"));
  assert.deepEqual([after.GUID, after.FK_PARENT_GUID, Buffer.compare(Buffer.from(after.GEOMETRY as Uint8Array), Buffer.from(before.GEOMETRY as Uint8Array))], [before.GUID, before.FK_PARENT_GUID, 0]);
  assert.equal(restyleRoad(db, "R.NONE", buildSection("C1")), false);
});
test("the template road can be read from another model (the working model's one was rebuilt by InfraWorks)", () => {
  const base = model(), work = model();
  // in the working model InfraWorks rebuilt the template: 4 terrain operations
  work.prepare("delete from TERRAIN_OPERATIONS where GUID='t0'").run();
  assert.throws(() => new RoadWriter(work, TPL).write(plan("R.X"), buildSection("A1")), /expected 5 terrain operations/);
  new RoadWriter(work, TPL, base).write(plan("R.X"), buildSection("A1"));
  assert.equal(one(work, "select count(*) n from ROADS where NAME='R.X'").n, 1);
  assert.equal(one(base, "select count(*) n from ROADS where NAME='R.X'").n, 0, "the base model is only read");
});