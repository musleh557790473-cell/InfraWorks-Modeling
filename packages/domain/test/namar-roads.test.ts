import assert from "node:assert/strict";
import test from "node:test";

import { buildAlignments, classifySections, readProfileViews, type Alignment, type DxfEnt, type ProfileView } from "../src/index.js";

const pline = (layer: string, pts: [number, number][]): DxfEnt => ({ type: "LWPOLYLINE", layer, x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), bulge: pts.map(() => 0), txt: "" });
const mtext = (layer: string, x: number, y: number, txt: string): DxfEnt => ({ type: "MTEXT", layer, x: [x], y: [y], bulge: [0], txt });
const view = (name: string, len: number): ProfileView => ({ name, tx: 0, ty: 0, datum: 760, k: 1, ve: 10, s0: 0, send: len, smaxLabel: len, nfg: 1, nchk: 0, maxd: null, pts: [[0, 760], [len, 761]] });

/**
 * A short Namar profile view (ROD-40000, 10-2026): title at (0, 100), station row 16 m below, the tick of
 * 0+000 at x 44 but its label at 45.1, regular labels only to 0+050 while the FG line runs to 0+088.5,
 * and the next view's title 2.6 m higher on the same row (its end label falls on this view's row).
 */
function namarView(): DxfEnt[] {
  const rowY = 84, x0 = 44, yOf = (z: number) => rowY + 5 + (z - 760) * 10;
  const e: DxfEnt[] = [mtext("RD_C_PROF_TITL", 0, 100, "RD-33"), mtext("RD_C_PROF_TITL", 14, 94, "Datum: 760.000")];
  e.push(mtext("RD_C_PROF_STN-MAJR", x0 + 1.1, rowY, "0+000"), mtext("RD_C_PROF_STN-MAJR", x0 + 25, rowY, "0+025"), mtext("RD_C_PROF_STN-MAJR", x0 + 50, rowY, "0+050"));
  for (const z of [765, 770]) e.push(mtext("RD_C_PROF_TEXT-GRID", 36, yOf(z), String(z)));
  e.push(pline("RD_C_PROF_FG", [[x0, yOf(766)], [x0 + 40, yOf(767)], [x0 + 88.5, yOf(766.5)]]));
  // the next view: title 2.6 m higher, its own FG and its end label on this row
  e.push(mtext("RD_C_PROF_TITL", 202, 102.6, "RD-34"), mtext("RD_C_PROF_TITL", 216, 96.6, "Datum: 760.000"));
  e.push(mtext("RD_C_PROF_STN-MAJR", 247, 86.6, "0+000"), mtext("RD_C_PROF_STN-MAJR", 271, 86.6, "0+025"), mtext("RD_C_PROF_STN-MAJR", 296, 86.6, "0+050"));
  e.push(mtext("RD_C_PROF_STN-MAJR", 330, 84.4, "0+082.000"));
  e.push(pline("RD_C_PROF_FG", [[246, yOf(767)], [328, yOf(768)]]));
  return e;
}

test("Namar profile views: offset first label, labels stopping short of the end, next title 2.6 m higher", () => {
  const { views } = readProfileViews(namarView());
  const v = views.find((q) => q.name === "RD-33")!;
  assert.equal(v.k, 1, "scale from the labels that sit on their ticks");
  assert.equal(v.nfg, 1, "only its own FG line");
  assert.ok(Math.abs(v.pts[0]![0]) < 1e-6, "0+000 where the line starts, not 1.1 m on");
  assert.ok(Math.abs(v.pts[v.pts.length - 1]![0] - 88.5) < 1e-6);
  assert.ok(Math.abs(v.pts[0]![1] - 766) < 1e-6);
});

const tick = mtext("RD_C_CHAIN_TEXT", 0, 2, "0+000");

test("Namar alignments: centrelines on _CL; a piece 1.1 cm short of its profile is extended to its end (RD-32)", () => {
  const r = buildAlignments([pline("_CL", [[0, 0], [99.989, 0]]), tick], [view("RD-32", 100)], [{ name: "RD-32", start: [0, 0] }]);
  assert.equal(r.roads.length, 1);
  assert.ok(Math.abs(r.roads[0]!.length - 100) < 1e-9);
  assert.match(r.report[0]!, /extended 0\.011 m to the profile end/);
  const far = buildAlignments([pline("_CL", [[0, 0], [99.9, 0]]), tick], [view("RD-X", 100)], [{ name: "RD-X", start: [0, 0] }]);
  assert.equal(far.roads.length, 0, "10 cm short: not stretched");
});

test("Namar alignments: a piece running 8.2 m into a roundabout ring is cut at the profile end (RD-M-01 / RA-01)", () => {
  const ring: DxfEnt = { type: "CIRCLE", layer: "_CL", x: [120], y: [0], bulge: [0], txt: "", r: 20 };
  const piece = pline("_CL", [[0, 0], [108.2, 0]]);
  const r = buildAlignments([piece, ring, tick], [view("RD-M-01", 100)], [{ name: "RD-M-01", start: [0, 0] }]);
  assert.equal(r.roads.length, 1);
  assert.ok(Math.abs(r.roads[0]!.length - 100) < 1e-9);
  assert.match(r.report[0]!, /cut to the profile end \(8\.200 m, inside a roundabout ring\)/);
  assert.equal(buildAlignments([piece, tick], [view("RD-M-01", 100)], [{ name: "RD-M-01", start: [0, 0] }]).roads.length, 0, "no ring: 8.2 m is too much to cut");
});

test("Namar sections: road edges on 'Road edge' are measured beside the right of way", () => {
  const road: Alignment = { name: "RD-01", length: 100, segs: [{ a: [0, 0], b: [100, 0], bulge: 0 }] };
  const s = classifySections([pline("__ROW", [[0, 7.5], [100, 7.5]]), pline("__ROW", [[0, -7.5], [100, -7.5]]), pline("Road edge", [[0, 3.6], [100, 3.6]]), pline("Road edge", [[0, -3.6], [100, -3.6]])], [road]);
  assert.equal(s["RD-01"]!.type, "A1");
  assert.equal(s["RD-01"]!.edge, "7.2");
});
