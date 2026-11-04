import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { danglingLinks, pruneDanglingIntersections } from "../src/roads/intersections.js";
import { removeRoad } from "../src/roads/write.js";

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