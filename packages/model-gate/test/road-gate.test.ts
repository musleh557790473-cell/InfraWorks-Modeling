import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { DxfEnt } from "@infraworks/domain";

import { drawnRoadNames, roadModelFindings } from "../src/roads/road-gate.js";
import { lineBlob } from "../src/roads/write.js";

const name = (t: string): DxfEnt => ({ type: "MTEXT", layer: "Xref Road Layout Al Qairawan$0$0-Alignment Name", x: [0], y: [0], bulge: [], txt: `\\Fisocp.shx|c0;\\C256;${t}` });
const point = (x: number, y: number) => { const b = Buffer.alloc(24); b.writeUInt32LE(1, 0); b.writeUInt32LE(0, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); return b; };

function model(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table CONSTRAINED_DEFINITIONS (ID integer primary key, GUID text);
    create table ROADS (ID integer primary key, GUID text, NAME text, DESCRIPTION text, FK_PARENT_GUID text, GEOMETRY blob);
    create table INTERSECTIONS (ID integer primary key, GUID text, REFERENCE_POINTS blob, INTERSECTION_TYPE integer);
    create table INTERSECTION_ARMS (ID integer primary key, GUID text, FK_PARENT_GUID text, FK_ASSET_GUID text, ARM_INDEX integer, BLEND_POINT_ENTRY_OFFSET real, STATUS integer);
    create table INTERSECTION_REGIONS (ID integer primary key, GUID text, FK_PARENT_GUID text, GEOMETRY blob, FK_INCOMING_ASSET_GUID text, FK_OUTGOING_ASSET_GUID text, CURB_RETURN_RADIUS real, CURB_RETURN_TYPE integer, INPUT_CURB_RETURN_TYPE integer, MANUALLY_CHANGED integer);
    create table ROUNDABOUTS (ID integer primary key, GUID text, FK_PARENT_GUID text, STANDARD_NAME text, INSCRIBED_CIRCLE_DIAMETER real, ISLAND_DIAMETER real, APRON_WIDTH real, LANES integer);
  `);
  db.exec("insert into CONSTRAINED_DEFINITIONS (GUID) values ('cd-A'), ('cd-B')");
  db.prepare("insert into ROADS (GUID, NAME, DESCRIPTION, FK_PARENT_GUID, GEOMETRY) values ('ra', 'R.0.D.4', 'Parsons: R.0.D.3 0+000.000-0+782.663; R.0.D.4 0+782.663-1+436.094', 'cd-A', ?), ('rb', 'R.6.G.18', null, 'cd-B', ?)")
    .run(lineBlob([[-100, 0, 0], [100, 0, 0]]), lineBlob([[0, 0, 0], [0, 100, 0]]));
  db.prepare("insert into INTERSECTIONS (ID, GUID, REFERENCE_POINTS, INTERSECTION_TYPE) values (1, 'j', ?, 0)").run(point(0, 0));
  db.exec("insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, ARM_INDEX, BLEND_POINT_ENTRY_OFFSET, STATUS) values ('a1', 'j', 'cd-A', null, null, null), ('a2', 'j', 'cd-A', null, null, null), ('a3', 'j', 'cd-B', null, null, null)");
  db.prepare("insert into INTERSECTION_REGIONS (GUID, FK_PARENT_GUID, GEOMETRY, FK_INCOMING_ASSET_GUID, FK_OUTGOING_ASSET_GUID, CURB_RETURN_RADIUS, CURB_RETURN_TYPE, INPUT_CURB_RETURN_TYPE, MANUALLY_CHANGED) values ('g1', 'j', ?, 'cd-A', 'cd-B', 10, 2, 2, 1)").run(lineBlob([[8, 8, 0], [12, 12, 0]]));
  return db;
}
const layout: DxfEnt[] = [name("R.0.D.3"), name("R.0.D.3"), name("R.0.D.4"), name("R.6.G.18"), name("RA-5")];
const by = (fs: { ruleId: string; severity: string; message: string }[]) => Object.fromEntries(fs.map((x) => [x.ruleId, x]));

test("drawn road names come from the 0-Alignment Name texts, formatting codes stripped, each once", () => {
  assert.deepEqual(drawnRoadNames(layout), ["R.0.D.3", "R.0.D.4", "R.6.G.18", "RA-5"]);
});

test("a sound road model passes G3-020..025 (merged pairs count through their Description; RA rings are not roads)", () => {
  const r = by(roadModelFindings(model(), layout));
  assert.deepEqual(Object.entries(r).map(([k, v]) => [k, v.severity]), [["G3-020", "info"], ["G3-021", "info"], ["G3-022", "info"], ["G3-023", "info"], ["G3-024", "info"], ["G3-025", "info"], ["G3-026", "info"]]);
  assert.match(r["G3-020"]!.message, /All 3 drawn roads/);
  assert.match(r["G3-025"]!.message, /1 corners: 0 at the drawn radius, 0 differ, 1 without a drawn arc/);
});

test("G3-026: a road through a roundabout centre without an arm there blocks (RA-3 lost R.0.D.11, 9 Nov)", () => {
  const db = model();
  // the junction becomes a roundabout; R.0.D.4 (cd-A) passes through its centre, R.6.G.18 (cd-B) starts there
  db.exec("update INTERSECTIONS set INTERSECTION_TYPE = 1 where ID = 1");
  db.exec("insert into ROUNDABOUTS (GUID, FK_PARENT_GUID, STANDARD_NAME, INSCRIBED_CIRCLE_DIAMETER, ISLAND_DIAMETER, APRON_WIDTH, LANES) values ('ro', 'j', 's', 54.95, 24, 0.975, 2)");
  db.exec("update INTERSECTION_ARMS set ARM_INDEX = rowid, BLEND_POINT_ENTRY_OFFSET = 60, STATUS = 0");
  assert.equal(by(roadModelFindings(db, layout))["G3-026"]!.severity, "info");
  db.exec("delete from INTERSECTION_ARMS where FK_ASSET_GUID = 'cd-B'");
  const r = by(roadModelFindings(db, layout))["G3-026"]!;
  assert.equal(r.severity, "blocking");
  assert.match(r.message, /junction 1 R\.6\.G\.18/);
  // a road far from the centre is not expected there
  db.prepare("insert into ROADS (GUID, NAME, FK_PARENT_GUID, GEOMETRY) values ('rc', 'R.9.G.9', 'cd-C', ?)").run(lineBlob([[0, 50, 0], [100, 50, 0]]));
  assert.doesNotMatch(by(roadModelFindings(db, layout))["G3-026"]!.message, /R\.9\.G\.9/);
});

test("a drawn road missing from the model blocks; a dangling link blocks; leftovers, unbuilt arms and undrawn kerbs warn", () => {
  const db = model();
  const r = by(roadModelFindings(db, [...layout, name("R.9.G.9")]));
  assert.equal(r["G3-020"]!.severity, "blocking");
  assert.match(r["G3-020"]!.message, /1 of 4 drawn roads .*R\.9\.G\.9/);
  // a link to a deleted road, a roundabout without its row, an arm without a blend point
  db.exec("delete from CONSTRAINED_DEFINITIONS where GUID = 'cd-B'");
  db.exec("insert into INTERSECTIONS (ID, GUID, REFERENCE_POINTS, INTERSECTION_TYPE) values (2, 'r', x'00', 1)");
  db.exec("insert into INTERSECTION_ARMS (GUID, FK_PARENT_GUID, FK_ASSET_GUID, ARM_INDEX, BLEND_POINT_ENTRY_OFFSET, STATUS) values ('z1', 'r', 'cd-A', 1, 0, 1), ('lost', 'gone', 'cd-A', 1, 50, 0)");
  const r2 = by(roadModelFindings(db, layout));
  assert.equal(r2["G3-021"]!.severity, "blocking");
  assert.equal(r2["G3-022"]!.severity, "warning");
  assert.match(r2["G3-022"]!.message, /1 intersection\(s\) left on a deleted road, 1 arm/);
  assert.equal(r2["G3-023"]!.severity, "blocking");
  assert.match(r2["G3-023"]!.message, /junction 2: roundabout type without a ROUNDABOUTS row/);
  assert.equal(r2["G3-024"]!.severity, "warning");
  assert.match(r2["G3-024"]!.message, /junction 2 arm 1 \(offset 0, status 1\)/);
});
