import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { armsFromRoads, danglingLinks, deleteIntersection, fixBlendLevels, pruneDanglingIntersections, readJunctions, repointLinks, roundaboutDiameter, splitLinks, writeRoundabout } from "../src/roads/intersections.js";
import { lineBlob, removeRoad } from "../src/roads/write.js";

/** Roads A, B, C and a deleted ring R (its definition is gone), with InfraWorks-style rows. */
function model(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table CONSTRAINED_DEFINITIONS (ID integer primary key, GUID text);
    create table ROADS (ID integer primary key, GUID text, NAME text, FK_PARENT_GUID text);
    create table INTERSECTIONS (ID integer primary key, GUID text);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_ASSET_GUID text);
    create table INTERSECTION_REGIONS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_INCOMING_ASSET_GUID text, FK_OUTGOING_ASSET_GUID text);
  `);
  for (const n of ["A", "B", "C"]) {
    db.prepare("insert into CONSTRAINED_DEFINITIONS (GUID) values (?)").run(`cd-${n}`);
    db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID) values (?, ?, ?)").run(`road-${n}`, n, `cd-${n}`);
  }
  const junction = (g: string, arms: string[], regions: [string, string][]) => {
    db.prepare("insert into INTERSECTIONS (GUID) values (?)").run(g);
    arms.forEach((a, k) => db.prepare("insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID) values (?, ?, ?)").run(`${g}-a${k}`, g, a));
    regions.forEach(([a, b], k) => db.prepare("insert into INTERSECTION_REGIONS (GUID, FK_PARENT_GUID, FK_INCOMING_ASSET_GUID, FK_OUTGOING_ASSET_GUID) values (?, ?, ?, ?)").run(`${g}-r${k}`, g, a, b));
  };
  // Al Qairawan intersections 7, 8, 10, 11: a through road crossing the deleted ring RA-1
  junction("ring-x", ["cd-A", "cd-A", "cd-R", "cd-R"], [["cd-A", "cd-R"], ["cd-R", "cd-A"], ["cd-A", "cd-R"], ["cd-R", "cd-A"]]);
  // a cross of A, B and the ring: InfraWorks would turn it into a T, not guessed here
  junction("cross", ["cd-A", "cd-B", "cd-B", "cd-R"], [["cd-A", "cd-B"], ["cd-B", "cd-R"]]);
  // a sound T junction of B and C
  junction("tee", ["cd-B", "cd-B", "cd-C"], [["cd-B", "cd-C"], ["cd-C", "cd-B"]]);
  db.prepare("insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID) values ('lost', 'gone', 'cd-C')").run();
  return db;
}
const n = (db: DatabaseSync, q: string) => Number((db.prepare(q).get() as { n: number }).n);

test("an intersection left with one road after its other road was deleted goes, with its arms and regions (RA-1: 24 links)", () => {
  const db = model();
  assert.equal(danglingLinks(db), 2 + 4 + 1 + 1, "ring-x: 2 arms and 4 region ends; cross: 1 arm, 1 region end");
  const r = pruneDanglingIntersections(db);
  assert.deepEqual(r.removed.map((i) => [i.guid, i.roads, i.arms, i.regions]), [["ring-x", ["A"], 4, 4]]);
  assert.equal(n(db, "select count(*) n from INTERSECTIONS where GUID='ring-x'"), 0);
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS where FK_PARENT_GUID='ring-x'"), 0);
  assert.equal(n(db, "select count(*) n from INTERSECTION_REGIONS where FK_PARENT_GUID='ring-x'"), 0);
  assert.equal(r.orphans, 1);
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS where GUID='lost'"), 0, "an arm without an intersection goes too");
});

test("an intersection still joining two roads is left as it is and listed for a rebuild in InfraWorks", () => {
  const db = model();
  const r = pruneDanglingIntersections(db);
  assert.deepEqual(r.kept.map((i) => [i.guid, i.roads]), [["cross", ["A", "B"]]]);
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS where FK_PARENT_GUID='cross'"), 4);
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS where FK_PARENT_GUID='tee'"), 3, "a sound junction is not touched");
  assert.equal(danglingLinks(db), 2, "only the kept cross still points at the ring");
});

test("--dry reports without writing", () => {
  const db = model();
  const r = pruneDanglingIntersections(db, { dry: true });
  assert.equal(r.removed.length, 1);
  assert.equal(n(db, "select count(*) n from INTERSECTIONS"), 3);
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS"), 12);
});

test("deleting a ring removes all its rows, and the intersections left with one road go (Al Qairawan RA-1: 7 tables)", () => {
  const db = model();
  db.exec(`
    create table H_CONSTRAINTS (ID integer primary key, GUID text, FK_PARENT_GUID text);
    create table V_CONSTRAINTS (ID integer primary key, GUID text, FK_PARENT_GUID text);
    create table CONSTRAINED_DEF_GEOM_LOCATIONS (ID integer primary key, GUID text, FK_PARENT_GUID text);
    create table CONSTRAINED_DEF_RPSYSTEMS (ID integer primary key, GUID text, FK_PARENT_GUID text);
    create table PRIMITIVES (ID integer primary key, GUID text, FK_PARENT_GUID text);
    create table TERRAIN_OPERATIONS (ID integer primary key, GUID text, FK_PARENT_GUID text);
  `);
  // the ring is still there: its definition, road and child rows
  db.prepare("insert into CONSTRAINED_DEFINITIONS (GUID) values ('cd-R')").run();
  db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID) values ('road-R', 'RA-1', 'cd-R')").run();
  for (const t of ["H_CONSTRAINTS", "V_CONSTRAINTS", "CONSTRAINED_DEF_GEOM_LOCATIONS", "CONSTRAINED_DEF_RPSYSTEMS"]) db.prepare(`insert into ${t} (GUID, FK_PARENT_GUID) values ('x', 'cd-R')`).run();
  for (const t of ["PRIMITIVES", "TERRAIN_OPERATIONS"]) db.prepare(`insert into ${t} (GUID, FK_PARENT_GUID) values ('x', 'road-R')`).run();
  db.prepare("insert into H_CONSTRAINTS (GUID, FK_PARENT_GUID) values ('keep', 'cd-A')").run();
  assert.equal(danglingLinks(db), 0, "the ring is still there: every link finds its road");
  assert.equal(removeRoad(db, "RA-1"), 8);
  for (const t of ["H_CONSTRAINTS", "V_CONSTRAINTS", "CONSTRAINED_DEF_GEOM_LOCATIONS", "CONSTRAINED_DEF_RPSYSTEMS", "PRIMITIVES", "TERRAIN_OPERATIONS"]) {
    assert.equal(n(db, `select count(*) n from ${t} where FK_PARENT_GUID in ('cd-R', 'road-R')`), 0, t);
  }
  assert.equal(n(db, "select count(*) n from H_CONSTRAINTS where GUID='keep'"), 1, "other roads untouched");
  const r = pruneDanglingIntersections(db);
  assert.deepEqual(r.removed.map((i) => i.guid), ["ring-x"]);
  assert.equal(danglingLinks(db), 2, "the cross with A and B is listed, not guessed");
});
test("a roundabout is an intersection of type 1 with one ROUNDABOUTS row (Al Qairawan junction 4 converted in InfraWorks)", () => {
  const db = model();
  db.exec(`
    alter table INTERSECTIONS add column INTERSECTION_TYPE integer;
    create table ROUNDABOUTS (ID integer primary key, GUID text, FK_PARENT_TABLE text, FK_PARENT_GUID text, STANDARD_NAME text, LANES integer,
      ISLAND_DIAMETER real, APRON_WIDTH real, INSCRIBED_CIRCLE_DIAMETER real);
    update INTERSECTIONS set INTERSECTION_TYPE = 0;
    update INTERSECTIONS set INTERSECTION_TYPE = 1 where GUID in ('tee', 'cross');
    insert into ROUNDABOUTS (GUID, FK_PARENT_TABLE, FK_PARENT_GUID, STANDARD_NAME, LANES, ISLAND_DIAMETER, APRON_WIDTH, INSCRIBED_CIRCLE_DIAMETER)
      values ('ra', 'INTERSECTIONS', 'tee', 'FHWA 2010: Rural Double Lane Roundabout', 1, 27, 2, 45.45);
  `);
  const js = readJunctions(db);
  const tee = js.find((j) => j.guid === "tee")!;
  assert.equal(tee.type, "roundabout");
  assert.deepEqual(tee.roundabout, { inscribedCircleDiameter: 45.45, islandDiameter: 27, apronWidth: 2, lanes: 1, standard: "FHWA 2010: Rural Double Lane Roundabout" });
  assert.deepEqual(tee.roads, ["B", "C"]);
  assert.equal(tee.problem, undefined);
  assert.equal(js.find((j) => j.guid === "cross")!.problem, "roundabout type without a ROUNDABOUTS row");
  assert.equal(js.find((j) => j.guid === "ring-x")!.type, "intersection");
});
test("a road merged into another keeps its intersection links, moved to the merged road", () => {
  const db = model();
  assert.equal(repointLinks(db, "cd-B", "cd-A"), 4 + 2 + 2, "4 arms, 2 incoming and 2 outgoing region ends");
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS where FK_ASSET_GUID='cd-B'"), 0);
  assert.equal(n(db, "select count(*) n from INTERSECTION_REGIONS where 'cd-B' in (FK_INCOMING_ASSET_GUID, FK_OUTGOING_ASSET_GUID)"), 0);
});
test("a roundabout written into the file as InfraWorks stores one: type 1, one ROUNDABOUTS row, arms numbered anticlockwise (RA-2, Parsons' 40.4 m)", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table CONSTRAINED_DEFINITIONS (ID integer primary key, GUID text);
    create table ROADS (ID integer primary key, GUID text, NAME text, FK_PARENT_GUID text, GEOMETRY blob);
    create table INTERSECTIONS (ID integer primary key, GUID text, REFERENCE_POINTS blob, INTERSECTION_TYPE integer);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_ASSET_GUID text, APPROACH_DIRECTION_MATCHES_ASSET integer,
      ARM_INDEX integer, ENTRY_LANES_AT_YIELD integer, EXIT_LANES_AT_YIELD integer, STATUS integer);
    create table ROUNDABOUTS (ID integer primary key, GUID text, GEOMETRY blob, FK_PARENT_TABLE text, FK_PARENT_GUID text, EXTERNAL_STANDARD_GUID text, STANDARD_NAME text,
      STANDARD_SOURCE text, LOCATION_OFFSET blob, LANES integer, LANE_DETAILS text, ISLAND_DIAMETER real, APRON_WIDTH real, INSCRIBED_CIRCLE_DIAMETER real,
      TILTED_PLANE_BEARING real, TILTED_PLANE_CROSSFALL real, STATUS integer);
  `);
  // through road west -> east, a side road leaving north
  db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID, GEOMETRY) values ('ra', 'A', 'cd-A', ?), ('rb', 'B', 'cd-B', ?)").run(lineBlob([[-100, 0, 0], [0, 0, 0], [100, 0, 0]]), lineBlob([[0, 0, 0], [0, 100, 0]]));
  const rp = Buffer.alloc(32); rp.writeUInt32LE(1, 0); rp.writeUInt32LE(1, 4);
  db.prepare("insert into INTERSECTIONS (ID, GUID, REFERENCE_POINTS, INTERSECTION_TYPE) values (41, 'j', ?, 0)").run(rp);
  db.exec(`insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, APPROACH_DIRECTION_MATCHES_ASSET) values
    ('west', 'j', 'cd-A', 1), ('east', 'j', 'cd-A', 0), ('north', 'j', 'cd-B', 0)`);
  assert.throws(() => writeRoundabout(db, 41, { inscribedCircleDiameter: 40.4, islandDiameter: 20, apronWidth: 2, lanes: 1, laneWidth: 8.2 }), /InfraWorks keeps the standard's one lane of 7.225 m/);
  assert.throws(() => writeRoundabout(db, 41, { inscribedCircleDiameter: 40.4, islandDiameter: 24, apronWidth: 2, lanes: 1, laneWidth: 7.225 }), /= 42.45 m, not the circle 40.4 m/);
  const idx = writeRoundabout(db, 41, { inscribedCircleDiameter: 40.4, islandDiameter: 24, apronWidth: 0.975, lanes: 1, laneWidth: 7.225 });
  assert.deepEqual(Object.fromEntries(idx), { west: 1, east: 2, north: 3 }, "anticlockwise from the west, as InfraWorks numbered junction 4");
  assert.equal(n(db, "select INTERSECTION_TYPE n from INTERSECTIONS where ID=41"), 1);
  const r = db.prepare("select * from ROUNDABOUTS").get() as Record<string, unknown>;
  assert.equal(r.FK_PARENT_GUID, "j");
  assert.equal(r.INSCRIBED_CIRCLE_DIAMETER, 40.4);
  assert.equal(r.ISLAND_DIAMETER, 24);
  assert.equal(r.APRON_WIDTH, 0.975);
  assert.equal(r.LANE_DETAILS, '{"version":"1.0.0","lanes":[{"id":1,"width":7.225}]}');
  const box = Buffer.from(r.GEOMETRY as Uint8Array);
  assert.deepEqual([box.readUInt32LE(0), box.readDoubleLE(16), box.readDoubleLE(24), box.readDoubleLE(48)], [3, -20.2, -20.2, 20.2], "the circle's square around the centre");
  // written again with other sizes: the same row is updated, not a second one
  writeRoundabout(db, 41, { inscribedCircleDiameter: 40.45, islandDiameter: 22, apronWidth: 2, lanes: 1, laneWidth: 7.225 });
  assert.equal(n(db, "select count(*) n from ROUNDABOUTS"), 1);
  assert.equal(n(db, "select ISLAND_DIAMETER n from ROUNDABOUTS"), 22);
  assert.equal(Buffer.from((db.prepare("select GEOMETRY g from ROUNDABOUTS").get() as { g: Uint8Array }).g).readDoubleLE(16), -20.225);
});

test("a roundabout is not written with a missing size", () => {
  const db = model();
  db.exec("alter table INTERSECTIONS add column INTERSECTION_TYPE integer; alter table INTERSECTIONS add column REFERENCE_POINTS blob; create table ROUNDABOUTS (ID integer primary key, FK_PARENT_GUID text);");
  const id = n(db, "select ID n from INTERSECTIONS where GUID='tee'");
  assert.throws(() => writeRoundabout(db, id, { inscribedCircleDiameter: 40.4, islandDiameter: 24, apronWidth: 0, lanes: 1, laneWidth: 7.225 }), /apronWidth missing/);
});
test("the circle InfraWorks shows is island + 2 x apron + 2 x lanes (junctions 4 and 41)", () => {
  assert.equal(roundaboutDiameter({ islandDiameter: 27, apronWidth: 2, lanes: 1, laneWidth: 7.225 }), 45.45);
  assert.equal(roundaboutDiameter({ islandDiameter: 24, apronWidth: 2, lanes: 1, laneWidth: 7.225 }), 42.45);
});
test("a removed intersection takes its body with it: left behind, its terrain cut-outs hole the ground (RA-1 ring junctions)", () => {
  const db = model();
  db.exec(`
    create table PRIMITIVES (ID integer primary key, GUID text, FK_PARENT_TABLE text, FK_PARENT_GUID text);
    create table TERRAIN_OPERATIONS (ID integer primary key, GUID text, FK_PARENT_TABLE text, FK_PARENT_GUID text, OPERATION_TYPE text);
    insert into PRIMITIVES (GUID, FK_PARENT_TABLE, FK_PARENT_GUID) values ('p1', 'INTERSECTIONS', 'ring-x'), ('p2', 'INTERSECTIONS', 'tee'), ('p3', 'ROADS', 'road-A'), ('p4', 'INTERSECTIONS', 'gone-earlier');
    insert into TERRAIN_OPERATIONS (GUID, FK_PARENT_TABLE, FK_PARENT_GUID, OPERATION_TYPE) values ('t1', 'INTERSECTIONS', 'ring-x', 'CutOut'), ('t2', 'INTERSECTIONS', 'tee', 'CutOut');
  `);
  const dry = pruneDanglingIntersections(db, { dry: true });
  assert.equal(dry.bodies, 3, "ring-x's strip and cut-out, and a strip whose junction went earlier");
  assert.equal(n(db, "select count(*) n from PRIMITIVES"), 4, "--dry writes nothing");
  pruneDanglingIntersections(db);
  assert.deepEqual((db.prepare("select GUID from PRIMITIVES order by GUID").all() as { GUID: string }[]).map((r) => r.GUID), ["p2", "p3"]);
  assert.deepEqual((db.prepare("select GUID from TERRAIN_OPERATIONS").all() as { GUID: string }[]).map((r) => r.GUID), ["t2"]);
});

test("roundabout blend points at height 0 get the road's level there (junctions 9, 41: graded down to 0)", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table ROADS (ID integer primary key, GUID text, NAME text, FK_PARENT_GUID text, GEOMETRY blob);
    create table INTERSECTIONS (ID integer primary key, GUID text, INTERSECTION_TYPE integer);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_ASSET_GUID text, ARM_INDEX integer, BLEND_POINT_ENTRY blob, BLEND_POINT_EXIT blob);
  `);
  db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID, GEOMETRY) values ('ra', 'A', 'cd-A', ?)").run(lineBlob([[0, 0, 680], [100, 0, 690]]));
  db.exec("insert into INTERSECTIONS (ID, GUID, INTERSECTION_TYPE) values (9, 'ra9', 1), (12, 'j12', 0)");
  const pt = (x: number, y: number, z: number) => { const b = Buffer.alloc(32); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); b.writeDoubleLE(z, 24); return b; };
  const ins = db.prepare("insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, ARM_INDEX, BLEND_POINT_ENTRY) values (?, ?, 'cd-A', ?, ?)");
  ins.run("zero", "ra9", 1, pt(80.8, 0, 0));
  ins.run("set", "ra9", 2, pt(20, 0, 682.5));
  ins.run("plain", "j12", 1, pt(50, 0, 0));
  const fixed = fixBlendLevels(db);
  assert.equal(fixed.length, 1, "only the roundabout's zero-height point");
  assert.ok(Math.abs(fixed[0]!.z - 688.08) < 1e-9);
  const z = (g: string) => Buffer.from((db.prepare("select BLEND_POINT_ENTRY b from INTERSECTION_ARMS where GUID=?").get(g) as { b: Uint8Array }).b).readDoubleLE(24);
  assert.ok(Math.abs(z("zero") - 688.08) < 1e-9);
  assert.equal(z("set"), 682.5, "a point with a height is not touched");
  assert.equal(z("plain"), 0, "an intersection that is not a roundabout is not touched");
  db.prepare("insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, ARM_INDEX, BLEND_POINT_ENTRY) values ('far', 'ra9', 'cd-A', 3, ?)").run(pt(50, 30, 0));
  assert.throws(() => fixBlendLevels(db), /30.00 m off its road/);
});
test("a road split back into its parts: each junction's links go to the part it lies on; at the joint the direction decides (RA-2: R.0.C.1 | R.0.C.2)", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table INTERSECTIONS (ID integer primary key, GUID text, REFERENCE_POINTS blob);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_ASSET_GUID text, APPROACH_DIRECTION_MATCHES_ASSET integer);
    create table INTERSECTION_REGIONS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_INCOMING_ASSET_GUID text, SAME_DIRECTION_AS_INCOMING_ASSET integer,
      FK_OUTGOING_ASSET_GUID text, SAME_DIRECTION_AS_OUTGOING_ASSET integer);
  `);
  const rp = (x: number) => { const b = Buffer.alloc(32); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); b.writeDoubleLE(x, 8); return b; };
  // merged road "c2" runs west -> east: c1 part 0..100, c2 part 100..160; junctions at 50 (on c1), 100 (joint), 130 (on c2)
  db.prepare("insert into INTERSECTIONS (ID, GUID, REFERENCE_POINTS) values (39, 'j39', ?), (41, 'j41', ?), (70, 'j70', ?)").run(rp(50), rp(100), rp(130));
  db.exec(`insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, APPROACH_DIRECTION_MATCHES_ASSET) values
    ('a39w', 'j39', 'c2', 1), ('a39e', 'j39', 'c2', 0), ('a41w', 'j41', 'c2', 1), ('a41e', 'j41', 'c2', 0), ('a41n', 'j41', 'side', 0), ('a70', 'j70', 'c2', 1)`);
  db.exec(`insert into INTERSECTION_REGIONS (GUID, FK_PARENT_GUID, FK_INCOMING_ASSET_GUID, SAME_DIRECTION_AS_INCOMING_ASSET, FK_OUTGOING_ASSET_GUID, SAME_DIRECTION_AS_OUTGOING_ASSET) values
    ('r41a', 'j41', 'c2', 1, 'side', 1), ('r41b', 'j41', 'side', 0, 'c2', 1), ('r41c', 'j41', 'c2', 0, 'c2', 0)`);
  const moved = splitLinks(db, "c2", [{ guid: "c1", line: [[0, 0, 0], [100, 0, 0]] }, { guid: "c2", line: [[100, 0, 0], [160, 0, 0]] }]);
  const arm = (g: string) => (db.prepare("select FK_ASSET_GUID a from INTERSECTION_ARMS where GUID=?").get(g) as { a: string }).a;
  const reg = (g: string) => ({ ...(db.prepare("select FK_INCOMING_ASSET_GUID i, FK_OUTGOING_ASSET_GUID o from INTERSECTION_REGIONS where GUID=?").get(g) as { i: string; o: string }) });
  assert.deepEqual([arm("a39w"), arm("a39e")], ["c1", "c1"], "a junction on the first part");
  assert.deepEqual([arm("a41w"), arm("a41e"), arm("a41n")], ["c1", "c2", "side"], "at the joint: approaching along the road = the part that ends there");
  assert.equal(arm("a70"), "c2");
  assert.deepEqual(reg("r41a"), { i: "c1", o: "side" }, "entering along the road comes from the first part");
  assert.deepEqual(reg("r41b"), { i: "side", o: "c2" }, "leaving along the road goes onto the second part");
  assert.deepEqual(reg("r41c"), { i: "c2", o: "c1" }, "entering against the road comes from the second part; leaving against it, onto the first");
  assert.equal(moved.get("c1"), 2 + 1 + 1 + 1);
});
test("roundabout arms built without lanes get the lanes and median of their road (C1: 2 + 2 of 3.3, median 4.0)", async () => {
  const { buildSection } = await import("@infraworks/domain");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table ROADS (ID integer primary key, GUID text, NAME text, FK_PARENT_GUID text, MANUAL_STYLE text);
    create table INTERSECTIONS (ID integer primary key, GUID text, INTERSECTION_TYPE integer);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_ASSET_GUID text, ARM_INDEX integer, LANES text,
      BLEND_POINT_ENTRY_LANES integer, BLEND_POINT_EXIT_LANES integer, BLEND_POINT_ENTRY_WIDTH real, BLEND_POINT_EXIT_WIDTH real, BLEND_POINT_MEDIAN_WIDTH real);
  `);
  const ms = (t: "C1" | "A2") => JSON.stringify({ componentStyle: JSON.stringify(buildSection(t).componentStyle) });
  db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID, MANUAL_STYLE) values ('rc', 'R.0.C.2', 'cd-C', ?), ('ra', 'R.2.F.3', 'cd-A', ?)").run(ms("C1"), ms("A2"));
  db.exec(`insert into INTERSECTIONS (ID, GUID, INTERSECTION_TYPE) values (41, 'ra41', 1), (12, 'j12', 0);
    insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, ARM_INDEX, LANES) values
      ('c', 'ra41', 'cd-C', 1, '{"version": 1}'), ('a', 'ra41', 'cd-A', 2, '{"version": 1,"lanes": [{"id": 1}]}'), ('j', 'j12', 'cd-C', 1, '{"version": 1}');`);
  const set = armsFromRoads(db);
  assert.deepEqual(set.map((s) => [s.id, s.arm, s.road, s.lanes, s.laneWidth, s.median]), [[41, 1, "R.0.C.2", 2, 3.3, 4]]);
  const row = { ...(db.prepare("select * from INTERSECTION_ARMS where GUID='c'").get() as Record<string, unknown>) };
  assert.deepEqual(JSON.parse(String(row.LANES)).lanes.map((l: { travelDirection: number }) => l.travelDirection), [2, 2, 1, 1]);
  assert.deepEqual([row.BLEND_POINT_ENTRY_LANES, row.BLEND_POINT_EXIT_LANES, row.BLEND_POINT_ENTRY_WIDTH, row.BLEND_POINT_MEDIAN_WIDTH], [2, 2, 3.3, 4]);
  assert.equal(String((db.prepare("select LANES l from INTERSECTION_ARMS where GUID='j'").get() as { l: string }).l), '{"version": 1}', "an ordinary junction is not touched");
});
test("a junction is deleted with its arms, regions and body, the others untouched (to let InfraWorks build it afresh)", () => {
  const db = model();
  db.exec(`create table PRIMITIVES (ID integer primary key, GUID text, FK_PARENT_TABLE text, FK_PARENT_GUID text);
    insert into PRIMITIVES (GUID, FK_PARENT_TABLE, FK_PARENT_GUID) values ('p1', 'INTERSECTIONS', 'tee'), ('p2', 'INTERSECTIONS', 'cross');`);
  const id = n(db, "select ID n from INTERSECTIONS where GUID='tee'");
  assert.equal(deleteIntersection(db, id), 3 + 2 + 1 + 1, "3 arms, 2 regions, 1 strip, the junction");
  assert.equal(n(db, "select count(*) n from INTERSECTION_ARMS where FK_PARENT_GUID='tee'"), 0);
  assert.equal(n(db, "select count(*) n from PRIMITIVES where FK_PARENT_GUID='cross'"), 1);
  assert.throws(() => deleteIntersection(db, id), /no intersection/);
});