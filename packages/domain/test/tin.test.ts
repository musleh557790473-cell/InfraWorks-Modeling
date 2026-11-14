import assert from "node:assert/strict";
import test from "node:test";

import { loadLandXmlSurface, planOverlapM2, readDxfFaces, readIfcFaces, splitByFacing, toLandXml, type Tri } from "../src/index.js";

// One 3DFACE quad (a 10 x 10 m square sloping 1 m in x) and one triangle given with its 4th corner = 3rd.
const face = (pts: number[][]) =>
  ["0", "3DFACE", "8", "C-TOPO", ...pts.flatMap((p, k) => [`1${k}`, String(p[0]), `2${k}`, String(p[1]), `3${k}`, String(p[2])])];
const dxf = [
  "0", "SECTION", "2", "ENTITIES",
  ...face([[0, 0, 100], [10, 0, 101], [10, 10, 101], [0, 10, 100]]),
  ...face([[10, 0, 101], [20, 0, 102], [10, 10, 101], [10, 10, 101]]),
  "0", "ENDSEC", "0", "EOF",
].join("\n");

test("readDxfFaces: 3DFACE quads split in two, triangles kept whole", () => {
  const t = readDxfFaces(dxf);
  assert.equal(t.length, 3);
  assert.deepEqual(t[2], [[10, 0, 101], [20, 0, 102], [10, 10, 101]]);
});

test("readDxfFaces: a TIN inside an exploded viewport block (Namar 60 % ROD-MOD) is placed by its INSERT", () => {
  const blockDxf = [
    "0", "SECTION", "2", "BLOCKS",
    "0", "BLOCK", "8", "0", "2", "AecObjExplode_X_Vport_72", "70", "0", "10", "0", "20", "0", "30", "0",
    ...face([[0, 0, 100], [10, 0, 101], [10, 10, 101], [10, 10, 101]]),
    "0", "ENDBLK",
    "0", "BLOCK", "8", "0", "2", "Logo", "10", "0", "20", "0", "30", "0",
    "0", "ENDBLK",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "0", "INSERT", "8", "0", "2", "AecObjExplode_X_Vport_72", "10", "657000", "20", "2714000", "30", "0", "50", "90",
    "0", "INSERT", "8", "0", "2", "Logo", "10", "5", "20", "5", "30", "0",
    "0", "ENDSEC", "0", "EOF",
  ].join("\n");
  const t = readDxfFaces(blockDxf);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]!.map((q) => q.map((v) => Math.round(v * 1000) / 1000)), [[657000, 2714000, 100], [657000, 2714010, 101], [656990, 2714010, 101]], "rotated 90 degrees and moved");
});

// An IFC thin solid as Civil 3D exports a surface (Namar MOD-00003): top face up, a copy 1 mm lower
// facing down, and an edge wall.
const ifc = [
  "#1=IFCCARTESIANPOINT((657000.,2714000.,760.));",
  "#2=IFCCARTESIANPOINT((657010.,2714000.,760.));",
  "#3=IFCCARTESIANPOINT((657000.,2714010.,761.));",
  "#4=IFCCARTESIANPOINT((657000.,2714000.,759.999));",
  "#5=IFCCARTESIANPOINT((657010.,2714000.,759.999));",
  "#6=IFCCARTESIANPOINT((657000.,2714010.,760.999));",
  "#10=IFCPOLYLOOP((#1,#2,#3));",
  "#11=IFCPOLYLOOP((#4,#6,#5));",
  "#12=IFCPOLYLOOP((#1,#4,#5,#2));",
  "#13=IFCPOLYLOOP((#1,#2,#3));",
].join("\n");

test("readIfcFaces + splitByFacing: the up faces of an IFC solid are the surface", () => {
  const g = splitByFacing(readIfcFaces(ifc));
  assert.equal(g.up.length, 1, "duplicate loop #13 counted once");
  assert.equal(g.down.length, 1);
  assert.equal(g.vertical.length, 2, "the wall quad fans into two triangles");
  assert.equal(g.up[0]![0][2], 760);
});

test("planOverlapM2: shared edges are not overlap, a stacked face is", () => {
  const t = readDxfFaces(dxf);
  assert.equal(planOverlapM2(t), 0);
  const extra: Tri = [[0, 0, 100], [10, 0, 101], [0, 10, 100]];
  assert.ok(planOverlapM2([...t, extra]) > 40, "a 50 m2 triangle laid over the square");
});

test("toLandXml: northing easting z, shared points, loads back with loadLandXmlSurface", () => {
  const r = toLandXml(readDxfFaces(dxf), { surface: "Test & Grading", source: "test", date: new Date("2026-11-11T00:00:00Z") });
  assert.equal(r.points, 5);
  assert.equal(r.faces, 3);
  assert.match(r.xml, /<P id="2">0\.0000 10\.0000 101\.0000<\/P>/);
  assert.match(r.xml, /epsgCode="32638"/);
  assert.match(r.xml, /Surface name="Test &amp; Grading"/);
  const z = loadLandXmlSurface(r.xml, "Test &amp; Grading");
  assert.ok(Math.abs(z(5, 2)! - 100.5) < 1e-9);
  assert.ok(Math.abs(z(15, 2)! - 101.5) < 1e-9);
  assert.equal(z(30, 30), null);
});

test("toLandXml: faces collapsing below 1 mm are dropped", () => {
  const sliver: Tri = [[0, 0, 0], [0.0001, 0, 0], [5, 5, 0]];
  assert.equal(toLandXml([sliver], { surface: "s", source: "t" }).faces, 0);
});
