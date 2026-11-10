import assert from "node:assert/strict";
import test from "node:test";

import {
  applySectionDecisions, parseSectionDecisions, type SectionClass,
  assemblePvis, buildAlignments, buildRoundaboutSection, buildSection, classifySections, crossfallSides, measureRoundabouts, orientRoads, pieceLen, readDxfBlock, readProfileViews, trimTo,
  type Alignment, type DxfEnt, type ProfileView, type Seg,
} from "../src/index.js";

// ---------- small builders
const pline = (layer: string, pts: [number, number][], bulges: number[] = []): DxfEnt => ({ type: "LWPOLYLINE", layer, x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), bulge: pts.map((_, i) => bulges[i] ?? 0), txt: "" });
const mtext = (layer: string, x: number, y: number, txt: string): DxfEnt => ({ type: "MTEXT", layer, x: [x], y: [y], bulge: [0], txt });
const view = (name: string, len: number, z0 = 680, grade = 0): ProfileView => ({ name, tx: 0, ty: 0, datum: 678, k: 1, ve: 10, s0: 0, send: len, smaxLabel: len, nfg: 1, nchk: 0, maxd: null, pts: [[0, z0], [len, z0 + grade * len]] });
const straight = (name: string, len: number): Alignment => ({ name, length: len, segs: [{ a: [0, 0], b: [len, 0], bulge: 0 }] });

test("DXF block reader keeps bulges per vertex and drops the xref layer prefix", () => {
  const dxf = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", "Xref Road Layout X", "0", "LWPOLYLINE", "8", "Xref Road Layout X$0$RD_PR_CNRL", "10", "0", "20", "0", "42", "0.5", "10", "10", "20", "0",
    "0", "ENDBLK", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"].join("\n");
  const [e] = readDxfBlock(dxf, "Xref Road Layout X");
  assert.equal(e!.layer, "RD_PR_CNRL");
  assert.deepEqual(e!.bulge, [0.5, 0]);
});

test("trimTo cuts an arc at the profile end (R.0.D.5: plan 0+416.889, profile 0+375)", () => {
  const half: Seg[] = [{ a: [0, 0], b: [20, 0], bulge: 1 }]; // half circle, radius 10, length 10*pi
  const t = trimTo(half, 10);
  assert.ok(Math.abs(pieceLen(t) - 10) < 1e-9);
  assert.ok(Math.abs(Math.hypot(t[0]!.b[0] - 10, t[0]!.b[1]) - 10) < 1e-9, "cut point stays on the circle");
});

test("alignments: an unnamed piece joins a road when the profile length says so (61 of 332 pieces had no name)", () => {
  const layout = [pline("RD_PR_CNRL", [[0, 0], [60, 0]]), pline("RD_PR_CNRL", [[60, 0], [100, 0]]), pline("RD_PR_CNRL", [[60, 0], [60, 30]]), mtext("RD_C_CHAIN_TEXT", 0, 2, "0+000")];
  const r = buildAlignments(layout, [view("R.1", 100)], [{ name: "R.1", start: [0, 0] }]);
  assert.equal(r.roads.length, 1);
  assert.ok(Math.abs(r.roads[0]!.length - 100) < 1e-9, "the 40 m piece, not the 30 m one");
  assert.match(r.report[0]!, /1 unnamed piece\(s\) added/);
});

test("alignments: a road with no package name starts on its name-labelled piece (R.0.D.13's piece was named RA-6)", () => {
  const layout = [pline("RD_PR_CNRL", [[0, 0], [80, 0]]), mtext("RD_C_CHAIN_TEXT", 0, 2, "0+000"), mtext("0-Alignment Name", 40, 3, "R.2")];
  const r = buildAlignments(layout, [view("R.2", 80)], []);
  assert.equal(r.roads[0]?.name, "R.2");
  assert.match(r.report[0]!, /matched by profile length over all free pieces/);
});

test("alignments: a confirmed alignment longer than its profile is cut at the profile end", () => {
  // the plan labels its end 0+416.889; Parsons' profile stops at 0+375.000
  const layout = [pline("RD_PR_CNRL", [[0, 0], [200, 0]]), pline("RD_PR_CNRL", [[200, 0], [416.889, 0]]), mtext("RD_C_CHAIN_TEXT", 0, 2, "0+000"),
    mtext("RD_C_CHAIN_TEXT", 416.889, 2, "0+416.889"), mtext("0-Alignment Name", 50, 3, "R.0.D.5")];
  const r = buildAlignments(layout, [view("R.0.D.5", 375)], []);
  assert.ok(Math.abs(r.roads[0]!.length - 375) < 1e-6);
  assert.match(r.report.join("\n"), /end label 0\+416\.889\), cut to the profile end 375\.000/);
});

test("alignments: a loop road is opened at its vertex nearest the 0+000 tick", () => {
  const sq: [number, number][] = [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]];
  const layout = [pline("RD_PR_CNRL", sq), mtext("RD_C_CHAIN_TEXT", 50, 52, "0+000")];
  const r = buildAlignments(layout, [view("R.L", 200)], [{ name: "R.L", start: [0, 0] }]);
  assert.deepEqual(r.roads[0]!.segs[0]!.a, [50, 50]);
});

// ---------- profiles: a synthetic view (horizontal scale 1, vertical x10, datum 678)
function profileEnts(opts: { nextTitleAt?: number; neighbourPvi?: boolean; curveLabels?: boolean }): DxfEnt[] {
  const t0 = { x: 0, y: 100 }, rowY = t0.y - 16, x0 = 54, yOf = (z: number) => rowY + 5 + (z - 678) * 10;
  const e: DxfEnt[] = [mtext("RD_C_PROF_TITL", t0.x, t0.y, "R.P"), mtext("RD_C_PROF_TITL", t0.x + 14, t0.y - 6, "Datum: 678.000")];
  for (let s = 0; s <= 100; s += 25) e.push(mtext("RD_C_PROF_STN-MAJR", x0 + s, rowY, `0+${String(s).padStart(3, "0")}`));
  for (const z of [679, 680, 681, 682]) e.push(mtext("RD_C_PROF_TEXT-GRID", x0 - 2, yOf(z), z.toFixed(3)));
  // FG: 680.0 at 0, 681.0 at 50 (vertical curve 20 m there), 680.5 at 100
  const fg: [number, number][] = [];
  for (let s = 0; s <= 100; s += 1) {
    const zt = s <= 50 ? 680 + s / 50 : 681 - (s - 50) / 100;
    const x = s - 40, z = x >= 0 && x <= 20 ? 680.8 + 0.02 * x + ((-0.01 - 0.02) / 40) * x * x : zt;
    fg.push([x0 + s, yOf(z)]);
  }
  e.push(pline("RD_C_PROF_FG", fg));
  e.push(mtext("RD_C_PROF_LABL", x0 + 0.5, yOf(680) + 3, "STA 0+000.000\\PELEV 680.000"));
  e.push(mtext("RD_C_PROF_LABL", x0 + 100.5, yOf(680.5) + 3, "STA 0+100.000\\PELEV 680.500"));
  e.push(mtext("RD_C_PROF_LABL", x0 + 50, yOf(681) + 8, "PVI 0+050.000"));
  e.push(mtext("RD_C_PROF_LABL", x0 + 50, yOf(681) + 10, "VC 20.000, K 667"));
  if (opts.curveLabels !== false) {
    e.push(mtext("RD_C_PROF_LABL", x0 + 40, yOf(680.8) + 3, "PVC 0+040.000\\PELEV 680.800"));
    e.push(mtext("RD_C_PROF_LABL", x0 + 60, yOf(680.9) + 3, "PVT 0+060.000\\PELEV 680.900"));
  }
  if (opts.neighbourPvi) e.push(mtext("RD_C_PROF_LABL", x0 + 99, yOf(681) + 12, "STA 0+294.200\\PELEV 690.670"));
  if (opts.nextTitleAt != null) e.push(mtext("RD_C_PROF_TITL", opts.nextTitleAt, t0.y, "R.NEXT"));
  return e;
}

test("profile views: an FG line ending close to the next view's title is kept (R.14.G.9, R.8.G.4)", () => {
  // the next title 10 m right of the FG end: a 20 m margin used to drop the whole line
  const { views } = readProfileViews(profileEnts({ nextTitleAt: 54 + 100 + 10 }));
  const v = views.find((q) => q.name === "R.P")!;
  assert.ok(v.pts.length > 50);
  assert.ok(Math.abs(v.pts[0]![1] - 680) < 1e-9 && Math.abs(v.pts[v.pts.length - 1]![1] - 680.5) < 1e-9);
});

test("PVIs: a neighbouring profile's label inside the window is dropped (R.3.G.6 carried R.2.F.5's PVIs)", () => {
  const ents = profileEnts({ neighbourPvi: true });
  const { views } = readProfileViews(ents);
  const r = assemblePvis(ents, views);
  assert.equal(r.dropped["R.P"], 1);
  assert.deepEqual(r.roads["R.P"]!.map((p) => p.s), [0, 50, 100]);
  assert.ok(Math.abs(r.roads["R.P"]![1]!.z! - 681) < 1e-3, "curve PVI level from the tangents");
  assert.deepEqual(r.issues, []);
});

test("PVIs: PVC / PVT labels split into TEXTs with their ELEV beside them are read (Al Narjis ROAD-03's sag)", () => {
  // EXPORTTOAUTOCAD left "PVC 0+045.188" and "ELEV 673.594" as two TEXTs on one line, ~6 m apart:
  // read as NaN, the curve was dropped and ROAD-03 went straight 0.97 m above ROAD-05's end
  const ents = profileEnts({ curveLabels: false });
  const t = (x: number, y: number, txt: string): DxfEnt => ({ ...mtext("RD_C_PROF_LABL", x, y, txt), type: "TEXT" });
  const x0 = 54, yOf = (z: number) => 100 - 16 + 5 + (z - 678) * 10;
  ents.push(t(x0 + 40, yOf(680.8) + 3, "PVC 0+040.000"), t(x0 + 45.8, yOf(680.8) + 3, "ELEV 680.800"));
  ents.push(t(x0 + 60, yOf(680.9) + 3, "PVT 0+060.000"), t(x0 + 65.8, yOf(680.9) + 3, "ELEV 680.900"));
  const { views } = readProfileViews(ents);
  const p = assemblePvis(ents, views).roads["R.P"]!.find((q) => q.L)!;
  assert.deepEqual([p.pvc, p.pvt], [[40, 680.8], [60, 680.9]]);
  assert.equal(p.pvcFromFG, undefined, "levels from the labels, not the FG line");
});

test("DXF reader: blocks joined with |, and model space with each insert placed (Al Narjis' exploded profile views)", () => {
  const dxf = ["0", "SECTION", "2", "BLOCKS",
    "0", "BLOCK", "2", "A", "10", "0", "20", "0", "0", "LINE", "8", "A$0$RD_CL", "10", "1", "20", "2", "11", "3", "21", "4", "0", "ENDBLK",
    "0", "BLOCK", "2", "B", "10", "0", "20", "0", "0", "MTEXT", "8", "B$0$0-Alignment Name", "10", "5", "20", "6", "1", "ROAD-01", "0", "ENDBLK",
    "0", "BLOCK", "2", "*U7", "10", "10", "20", "0", "0", "LWPOLYLINE", "8", "RD_C_PROF_FG", "10", "10", "20", "0", "10", "20", "20", "5", "0", "ENDBLK",
    "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    "0", "INSERT", "8", "C-ROAD-PROF-VIEW", "2", "*U7", "10", "1000", "20", "2000",
    "0", "MTEXT", "8", "RD_C_PROF_TITL", "10", "990", "20", "2010", "1", "ROAD-01",
    "0", "ENDSEC", "0", "EOF"].join("\n");
  const two = readDxfBlock(dxf, "A|B");
  assert.deepEqual(two.map((e) => e.layer), ["RD_CL", "0-Alignment Name"]);
  assert.deepEqual(two[0]!.end, [3, 4], "a LINE keeps its end point");
  const ms = readDxfBlock(dxf, "*Model_Space");
  const fg = ms.find((e) => e.layer === "RD_C_PROF_FG")!;
  assert.deepEqual([fg.x, fg.y], [[1000, 1010], [2000, 2005]], "block content moved by the insert, less the block base");
  assert.ok(ms.some((e) => e.layer === "RD_C_PROF_TITL"));
});

test("alignments: Al Narjis centrelines on RD_CL, one of them a LINE; External Road pieces left out", () => {
  const line = (layer: string, a: [number, number], b: [number, number]): DxfEnt => ({ type: "LINE", layer, x: [a[0]], y: [a[1]], bulge: [0], txt: "", end: b });
  const layout = [pline("RD_CL", [[0, 0], [60, 0]]), line("RD_CL", [60, 0], [100, 0]), pline("RD_CL External Road", [[100, 0], [140, 0]]), mtext("RD_C_CHAIN_TEXT", 0, 2, "0+000")];
  const r = buildAlignments(layout, [view("ROAD-01 (18m R.O.W)", 100)], [{ name: "ROAD-01 (18m R.O.W)", start: [0, 0] }]);
  assert.equal(r.roads.length, 1);
  assert.ok(Math.abs(r.roads[0]!.length - 100) < 1e-9);
  assert.equal(buildAlignments(layout, [view("ROAD-X", 140)], [{ name: "ROAD-X", start: [0, 0] }]).roads.length, 0, "the external road is no piece");
});

test("sections: Al Narjis' right of way on __ROW types an 18 m road A2 and a 15 m road A1 (IRO-30001)", () => {
  const road = straight("ROAD-03 (18m R.O.W)", 100);
  const a2 = classifySections([pline("__ROW", [[0, 9], [100, 9]]), pline("__ROW", [[0, -9], [100, -9]])], [road]);
  assert.equal(a2[road.name]!.type, "A2");
  const a1 = classifySections([pline("__ROW", [[0, 7.5], [100, 7.5]]), pline("__ROW", [[0, -7.5], [100, -7.5]])], [road]);
  assert.equal(a1[road.name]!.type, "A1");
});

test("PVIs: a curve without printed PVC / PVT takes their levels from the FG line (R.14.G.11, R.7.G.8)", () => {
  const ents = profileEnts({ curveLabels: false });
  const { views } = readProfileViews(ents);
  const p = assemblePvis(ents, views).roads["R.P"]!.find((q) => q.L)!;
  assert.equal(p.pvcFromFG, true);
  assert.ok(Math.abs(p.z! - 681) < 0.01);
});

// ---------- direction against a surface z = 690 + 0.02 x (rising with x), road levels 0.6 m above it
const rising = (x: number) => 690 + 0.02 * x;
const pviRising = (len: number) => [{ s: 0, z: 690.6, L: 0 }, { s: len, z: 690.6 + 0.02 * len, L: 0 }];

test("direction: a road chained from the wrong end is reversed (R.5.G.1: rising 6 m where the surface falls 6 m)", () => {
  const r: Alignment = { name: "R.X", length: 200, segs: [{ a: [200, 0], b: [0, 0], bulge: 0 }] };
  const o = orientRoads([r], { "R.X": pviRising(200) }, rising);
  assert.deepEqual(o.reversed, ["R.X"]);
  assert.deepEqual(r.segs[0]!.a, [0, 0]);
});

test("direction: a junction at the same level keeps a road the surface alone would reverse (R.13.G.5)", () => {
  const cross: Alignment = { name: "R.C", length: 100, segs: [{ a: [200, -50], b: [200, 50], bulge: 0 }] };
  const r: Alignment = { name: "R.X", length: 200, segs: [{ a: [200, 0], b: [0, 0], bulge: 0 }] };
  // R.X starts on R.C at R.C's level (694.6) and falls towards x = 0, where the surface is highest:
  // the surface says reverse, the junction says keep
  const pv = { "R.C": [{ s: 0, z: 694.6, L: 0 }, { s: 100, z: 694.6, L: 0 }], "R.X": [{ s: 0, z: 694.6, L: 0 }, { s: 200, z: 690.6, L: 0 }] };
  const o = orientRoads([cross, r], pv, (x) => 694 - 0.02 * x);
  assert.ok(!o.reversed.includes("R.X"));
  assert.match(o.report.join("\n"), /R\.X.*KEPT \(junctions\)/);
});

// ---------- sections and crossfall
test("sections: the median is raised 150 mm by upstand kerbs, lanes start at the profile level (C1)", () => {
  const s = buildSection("C1");
  assert.equal(s.width, 30);
  const median = s.parts.filter((p) => p.role === "median" || p.role === "median kerb").flatMap((p) => p.crossSection.map((q) => q[1]));
  assert.ok(Math.abs(Math.max(...median) - 0.15) < 1e-9);
  const shy = s.parts.find((p) => p.role === "shy")!.crossSection.map((q) => q[1]);
  assert.ok(Math.abs(Math.max(...shy)) < 1e-9, "shy lane edge at the profile level");
});

test("sections: a divided road has exactly its lanes as Lane components; the 0.4 m strip is a Shoulder (B1, C1, C2)", () => {
  for (const t of ["B1", "C1", "C2"] as const) {
    const s = buildSection(t);
    const refs = (s.componentStyle as { references: { def: string; paramOverrides: { name: string; value: number }[] }[] }).references;
    const lanes = refs.filter((r) => r.def.endsWith("/Lane"));
    assert.equal(lanes.length, 2 * s.lanes, `${t}: ${s.lanes} lanes each way`);
    assert.ok(lanes.every((r) => r.paramOverrides.find((p) => p.name === "Width")!.value === 3.3));
    const shoulders = refs.filter((r) => r.def.endsWith("/Shoulder"));
    assert.deepEqual(shoulders.map((r) => r.paramOverrides.find((p) => p.name === "Width")!.value), [0.4, 0.4]);
  }
});

test("sections: a local road falling left has its lane slopes flipped", () => {
  const slopes = (fall: "left" | "right") => (buildSection("A1", { fall }).componentStyle as { references: { def: string; paramOverrides: { name: string; value: number }[] }[] }).references
    .filter((r) => r.def.endsWith("/Lane")).map((r) => r.paramOverrides.find((p) => p.name === "Slope")!.value);
  assert.deepEqual(slopes("right"), [0.02, -0.02]);
  assert.deepEqual(slopes("left"), [-0.02, 0.02]);
});

test("crossfall: the side comes from the grading surface (falls right of the chainage at 2 %)", () => {
  const r = straight("R.A", 100);
  const surface = (_x: number, y: number) => 690 + 0.02 * y; // higher on the left (+y) of a road along +x
  const out = crossfallSides([r], { "R.A": { type: "A1", votes: {}, samples: 0, oneSidedSamples: 0, edge: null } }, surface);
  assert.equal(out["R.A"]!.fall, "right");
  assert.equal(out["R.A"]!.xfall, 0.02);
});

// ---------- roundabouts (AICC 3 Nov 2026: width from the edges Parsons draws around each RA)
// RA alignment: one arc from (cx+R, cy) almost all the way round; bulge = tan(theta/4)
const ring = (name: string, cx: number, cy: number, R: number, ccw = true): Alignment => {
  const th = 2 * Math.PI - 1e-4, b: [number, number] = [cx + R * Math.cos(ccw ? th : -th), cy + R * Math.sin(ccw ? th : -th)];
  return { name, length: R * th, segs: [{ a: [cx + R, cy], b, bulge: (ccw ? 1 : -1) * Math.tan(th / 4) }] };
};
const circle = (layer: string, x: number, y: number, r: number): DxfEnt => ({ type: "CIRCLE", layer, x: [x], y: [y], bulge: [0], txt: "", r });
// an edge polyline whose middle vertex pair is a 40 degree arc of radius r about (cx, cy)
const edgeArc = (cx: number, cy: number, r: number, a0: number, deg = 40): DxfEnt => {
  const t0 = (a0 * Math.PI) / 180, t1 = ((a0 + deg) * Math.PI) / 180;
  const p0: [number, number] = [cx + r * Math.cos(t0), cy + r * Math.sin(t0)], p1: [number, number] = [cx + r * Math.cos(t1), cy + r * Math.sin(t1)];
  return pline("-RD_Edges", [[p0[0] + 5 * Math.cos(t0), p0[1] + 5 * Math.sin(t0)], p0, p1, [p1[0] + 5 * Math.cos(t1), p1[1] + 5 * Math.sin(t1)]], [0, Math.tan((deg * Math.PI) / 180 / 4), 0, 0]);
};

test("DXF block reader keeps the radius of a CIRCLE (the roundabout island)", () => {
  const dxf = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", "L", "0", "CIRCLE", "8", "L$0$-RD_Edges", "10", "100", "20", "200", "40", "12.0",
    "0", "ENDBLK", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"].join("\n");
  const [e] = readDxfBlock(dxf, "L");
  assert.equal(e!.r, 12);
  assert.deepEqual([e!.x[0], e!.y[0]], [100, 200]);
});

test("roundabouts: width = outer edge arcs minus the island circle (RA-1: 20.2 - 12.0 = 8.2 m)", () => {
  const layout = [circle("-RD_Edges", 1000, 2000, 12), edgeArc(1000, 2000, 20.2, 10), edgeArc(1000, 2000, 20.2, 100), edgeArc(1000, 2000, 20.3, 200, 10),
    circle("-RD_Edges", 1100, 2000, 3), pline("RD_ROW", [[1024.7, 2000], [1030, 2000]])];
  const { roundabouts, problems } = measureRoundabouts(layout, [ring("RA-1", 1000, 2000, 20.2), straight("R.1.G.1", 50), ring("RA-2", 1000, 2000, 20.2, false)]);
  assert.deepEqual(problems, []);
  assert.equal(roundabouts.length, 2, "straight roads are not roundabouts");
  const [a, b] = roundabouts;
  assert.equal(a!.island, 12); assert.equal(a!.outer, 20.2); assert.equal(a!.width, 8.2);
  assert.ok(Math.abs(a!.outerDeg - 80) < 1e-6, "the larger outer radius by drawn angle wins over a short 20.3 piece");
  assert.equal(a!.side, "left", "anticlockwise chainage: island on the left");
  assert.equal(b!.side, "right", "clockwise chainage: island on the right");
});

test("roundabouts: no island circle or an outer edge off the alignment is reported, not guessed", () => {
  const r1 = measureRoundabouts([edgeArc(0, 0, 20.2, 10)], [ring("RA-1", 0, 0, 20.2)]);
  assert.equal(r1.roundabouts.length, 0);
  assert.match(r1.problems[0]!, /RA-1: island circles 0/);
  const r2 = measureRoundabouts([circle("-RD_Edges", 0, 0, 12), edgeArc(0, 0, 21, 10)], [ring("RA-1", 0, 0, 20.2)]);
  assert.match(r2.problems[0]!, /not on the alignment/);
});

test("roundabout section: 8.2 m carriageway on the island side at 0 %, kerbs on both edges", () => {
  const s = buildRoundaboutSection(8.2, "left");
  assert.equal(s.type, "RA");
  assert.equal(s.speed, null, "no documented design speed: the template's is kept");
  const lane = s.parts.find((p) => p.role === "lane")!.crossSection;
  const xs = lane.map((q) => q[0]), top = lane.filter((q) => q[2] === 2 || q[2] === 3);
  assert.ok(Math.abs(Math.min(...xs) + 8.2) < 1e-9 && Math.abs(Math.max(...xs)) < 1e-9, "lane from the alignment (outer edge) to 8.2 m left");
  assert.ok(top.every((q) => Math.abs(q[1]!) < 1e-9), "flat: 0 % crossfall at the profile level");
  const kerbs = s.parts.filter((p) => p.role === "kerb").map((p) => [Math.min(...p.crossSection.map((q) => q[0])), Math.max(...p.crossSection.map((q) => q[0]))]);
  assert.deepEqual(kerbs.map(([a, b]) => [+a!.toFixed(3), +b!.toFixed(3)]), [[-8.5, -8.2], [0, 0.3]]);
  assert.ok(Math.abs(s.width - 8.8) < 1e-9);
  const right = buildRoundaboutSection(8.2, "right").parts.find((p) => p.role === "lane")!.crossSection.map((q) => q[0]);
  assert.ok(Math.abs(Math.max(...right) - 8.2) < 1e-9, "island on the right: lane to the right");
  assert.throws(() => buildRoundaboutSection(0, "left"));
});

test("section decisions: an untyped road takes the AICC type; a road the drawing types is not overridden", () => {
  // R.9.G.6 / R.9.G.7: A1 at their ends (ROW 15 m) but no exact width over enough samples
  const cls = (type: SectionClass["type"]): SectionClass => ({ type, votes: {}, samples: 0, oneSidedSamples: 0, edge: null });
  const sections: Record<string, SectionClass> = { "R.9.G.6": cls(null), "R.9.G.7": cls(null), "R.0.D.6": cls("B1") };
  const d = applySectionDecisions(sections, parseSectionDecisions("R.9.G.6=A1, R.9.G.7=A1,R.0.D.6=A1,R.X=A2"));
  assert.deepEqual(d.applied, ["R.9.G.6=A1", "R.9.G.7=A1"]);
  assert.deepEqual(d.refused, ["R.0.D.6: the drawing types it B1", "R.X: not a road of the layout"]);
  assert.equal(sections["R.9.G.6"]!.type, "A1");
  assert.equal(sections["R.9.G.6"]!.decided, true);
  assert.equal(sections["R.0.D.6"]!.type, "B1");
  assert.throws(() => parseSectionDecisions("R.9.G.6=D9"), /expected <road>=/);
});

test("sections: the raised median is the kerbs themselves, nothing else sits on the median, the road hangs off the kerb (B1, C1, C2)", () => {
  for (const t of ["B1", "C1", "C2"] as const) {
    const refs = (buildSection(t).componentStyle as { references: { def: string; attachment?: { point: number; ex_comp: number; ex_point: number }; paramOverrides: { name: string; value: number }[] }[] }).references;
    const w = (r: (typeof refs)[number]) => r.paramOverrides.find((p) => p.name === "Width")!.value;
    const onMedian = refs.filter((r) => r.attachment?.ex_comp === 0);
    assert.deepEqual(onMedian.map((r) => r.def), ["ComponentDefinition/Curb", "ComponentDefinition/Curb"], `${t}: only the two median kerbs`);
    assert.ok(onMedian.every((r) => w(r) === w(refs[0]!) / 2), `${t}: each kerb half the median`);
    const kerbs = onMedian.map((r) => refs.indexOf(r));
    const shoulders = refs.filter((r) => r.def.endsWith("/Shoulder"));
    assert.deepEqual(shoulders.map((r) => [kerbs.includes(r.attachment!.ex_comp), r.attachment!.ex_point]), [[true, 1], [true, 1]], `${t}: shoulder on the kerb face`);
  }
});