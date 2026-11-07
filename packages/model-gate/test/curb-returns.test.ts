import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { DxfEnt } from "@infraworks/domain";

import { curbReturnsFromDrawing, junctionCentre, kerbArcs } from "../src/roads/curb-returns.js";
import { lineBlob } from "../src/roads/write.js";

/** An LWPOLYLINE on -RD_Edges whose middle segment is a quarter arc of radius r around (cx, cy), in the given quadrant (bearing of its centre from the junction). */
function kerbArc(cx: number, cy: number, r: number, sweepDeg = 90): DxfEnt {
  // chord of a CCW arc from angle 0 to sweep, around (cx, cy); bulge = tan(sweep / 4)
  const t = (sweepDeg * Math.PI) / 180;
  return { type: "LWPOLYLINE", layer: "Xref Road Layout Al Qairawan$0$-RD_Edges", x: [cx + r + 5, cx + r, cx + r * Math.cos(t), cx + r * Math.cos(t) - 5 * Math.sin(t)], y: [cy, cy, cy + r * Math.sin(t), cy + r * Math.sin(t) + 5 * Math.cos(t)], bulge: [0, Math.tan(t / 4), 0, 0], txt: "" };
}
const point = (x: number, y: number) => { const b = Buffer.alloc(24); b.writeUInt32LE(1, 0); b.writeUInt32LE(0, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); return b; };
const multiPoint = (x: number, y: number) => { const p = point(x, y); const b = Buffer.alloc(8 + p.length); b.writeUInt32LE(4, 0); b.writeUInt32LE(1, 4); p.copy(b, 8); return b; };

test("a bulge segment gives the arc's true centre, radius and sweep; an ARC entity its centre and radius", () => {
  const [a] = kerbArcs([kerbArc(100, 200, 12)]);
  assert.ok(a && Math.abs(a.cx - 100) < 1e-6 && Math.abs(a.cy - 200) < 1e-6 && Math.abs(a.r - 12) < 1e-6 && Math.abs(a.deg - 90) < 1e-6, JSON.stringify(a));
  const [b] = kerbArcs([{ type: "ARC", layer: "L$0$-RD_Edges", x: [5], y: [6], bulge: [], txt: "", r: 20 }]);
  assert.deepEqual([b!.cx, b!.cy, b!.r, Number.isNaN(b!.deg)], [5, 6, 20, true]);
  assert.equal(kerbArcs([{ type: "LWPOLYLINE", layer: "RD_ROW", x: [0, 1], y: [0, 1], bulge: [0, 0.5], txt: "" }]).length, 0, "other layers are not kerbs");
});

test("the junction centre is read from a Point or a MultiPoint reference point (junctions 51, 300, 303)", () => {
  assert.deepEqual(junctionCentre(point(10, 20)), [10, 20]);
  assert.deepEqual(junctionCentre(multiPoint(10, 20)), [10, 20]);
});

test("each corner takes the drawn arc in its quadrant; corners without one keep InfraWorks' radius; fillets and compound curves are told apart", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table INTERSECTIONS (ID integer primary key, GUID text, REFERENCE_POINTS blob, INTERSECTION_TYPE integer);
    create table INTERSECTION_REGIONS (ID integer primary key, FK_PARENT_GUID text, GEOMETRY blob, CURB_RETURN_RADIUS real, CURB_RETURN_TYPE integer, INPUT_CURB_RETURN_TYPE integer, MANUALLY_CHANGED integer);
  `);
  // a cross at (1000, 2000): corners NE, SE, SW, NW as short lines 10 m out; a roundabout elsewhere is skipped
  db.prepare("insert into INTERSECTIONS values (13, 'j', ?, 0), (41, 'ra', ?, 1)").run(point(1000, 2000), point(5000, 5000));
  const corner = (id: number, dx: number, dy: number) => db.prepare("insert into INTERSECTION_REGIONS values (?, 'j', ?, 9, 2, -1, 0)").run(id, lineBlob([[1000 + dx * 8, 2000 + dy * 8, 0], [1000 + dx * 12, 2000 + dy * 12, 0]]));
  corner(1, 1, 1); corner(2, 1, -1); corner(3, -1, -1); corner(4, -1, 1);
  db.prepare("insert into INTERSECTION_REGIONS values (5, 'ra', ?, 9, 2, -1, 0)").run(lineBlob([[5010, 5010, 0], [5012, 5012, 0]]));
  const layout: DxfEnt[] = [
    kerbArc(1000 + 20, 2000 + 20, 12), // NE: r 12, centre 28 m out
    kerbArc(1000 + 15, 2000 - 15, 10), // SE: r 10
    kerbArc(1000 + 16, 2000 - 16, 1), // SE: a 1 m fillet, ignored
    kerbArc(1000 - 15, 2000 - 15, 14), kerbArc(1000 - 17, 2000 - 13, 13.9, 60), // SW: compound 14 / 13.9
    // NW: nothing drawn
    kerbArc(1000 + 25, 2000 + 25, 9, 10), // NE: a 10 degree arc is not a kerb return
    kerbArc(5020, 5020, 20), // the roundabout's entry, not touched
  ];
  const dry = curbReturnsFromDrawing(db, layout, { dry: true });
  assert.deepEqual(dry.map((r) => [r.region, r.drawn, r.others, r.status]), [[1, 12, [], "set"], [2, 10, [], "set"], [3, 14, [13.9], "ambiguous"], [4, null, [], "no drawn arc"]]);
  assert.equal(db.prepare("select CURB_RETURN_RADIUS r from INTERSECTION_REGIONS where ID = 1").get()!.r, 9, "dry: nothing written");
  curbReturnsFromDrawing(db, layout);
  const rows = db.prepare("select ID, CURB_RETURN_RADIUS r, CURB_RETURN_TYPE t, INPUT_CURB_RETURN_TYPE it, MANUALLY_CHANGED m from INTERSECTION_REGIONS order by ID").all() as { ID: number; r: number; t: number; it: number; m: number }[];
  assert.deepEqual(rows.map((x) => [x.ID, x.r, x.t, x.it, x.m]), [[1, 12, 2, 2, 1], [2, 10, 2, 2, 1], [3, 14, 2, 2, 1], [4, 9, 2, -1, 0], [5, 9, 2, -1, 0]]);
  // written again: nothing changes
  assert.deepEqual(curbReturnsFromDrawing(db, layout).map((r) => r.status), ["unchanged", "unchanged", "unchanged", "no drawn arc"]);
  // limited to another junction: nothing looked at
  assert.deepEqual(curbReturnsFromDrawing(db, layout, { only: [99] }), []);
});
