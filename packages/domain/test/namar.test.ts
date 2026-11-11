import assert from "node:assert/strict";
import test from "node:test";

import {
  NAMAR_LAYOUT,
  PARSONS_DN_PLOTS_PROFILE,
  PARSONS_DN_ROADS_PROFILE,
  findLayerMapping,
  parseDxf,
  parsonsDistrictRoadsProfile,
} from "../src/index.js";

/** Build a DXF from [code, value] pairs. */
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";
const RL = "Xref Road Layout Dahiyat Nemar";
const E = 657000, N = 2714400;
const square = (layer: string, x0: number, y0: number, s: number) =>
  [0, "LWPOLYLINE", 8, layer, 90, 4, 70, 1, 10, x0, 20, y0, 10, x0 + s, 20, y0, 10, x0 + s, 20, y0 + s, 10, x0, 20, y0 + s];

test("Namar profiles: rules carry the layout xref prefix, so legend samples and key-plan copies stay out", () => {
  const roads = (layer: string) => findLayerMapping(PARSONS_DN_ROADS_PROFILE, layer);
  assert.equal(roads(`${RL}$0$_CL`)?.infraFeatureClass, "road_centerline");
  assert.equal(roads("_CL"), undefined, "the legend's sample centreline");
  assert.equal(roads(`${RL}$0$__ROW`)?.outputLayer, "blocks");
  assert.equal(roads(`${RL}$0$NOTES & LEGEND ROAD-NHC-DMM$0$RD-PVT-MRK`)?.outputLayer, "road_reserve");
  assert.equal(roads("NOTES & LEGEND ROAD-NHC-DMM$0$RD-PVT-MRK"), undefined, "the legend's sample boundary");
  const plots = (layer: string) => findLayerMapping(PARSONS_DN_PLOTS_PROFILE, layer);
  assert.equal(plots(`${RL}$0$Residential plots`)?.outputLayer, "plots");
  assert.equal(plots("Ladun Dahiyat Namar Title Block_A1$0$Residential plots"), undefined, "the title block's key plan");
  // The factory keeps Al Narjis' 10 m default; Namar's names stand 11-12 m off.
  assert.equal(parsonsDistrictRoadsProfile({ ...NAMAR_LAYOUT, labelDistance: undefined }).layers[0]!.labels!.maxDistance, 10);
  assert.equal(PARSONS_DN_ROADS_PROFILE.layers[0]!.labels!.maxDistance, 15);
});

test("Namar 10200: a centreline named from a label 12 m off; blocks and road reserve from the nested boundary", () => {
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, RL, 70, 0, 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, `${RL}$0$_CL`, 90, 2, 70, 0, 10, E, 20, N, 10, E + 200, 20, N,
    ...square(`${RL}$0$NOTES & LEGEND ROAD-NHC-DMM$0$RD-PVT-MRK`, E - 100, N - 100, 400),
    ...square(`${RL}$0$__ROW`, E, N + 15, 100),
    0, "ENDBLK",
    0, "BLOCK", 2, "Xref Dim_Names Dahiyat Nemar", 70, 0, 10, 0, 20, 0,
    0, "MTEXT", 8, "Xref Dim_Names Dahiyat Nemar$0$0-Alignment Name", 10, E + 100, 20, N - 12, 40, 2, 1, String.raw`{\Fisocp.shx|c0;\C256;RD-06}`,
    0, "ENDBLK",
    0, "BLOCK", 2, "LEGEND", 70, 0, 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, "_CL", 90, 2, 70, 0, 10, E + 900, 20, N, 10, E + 950, 20, N,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, RL, 10, 0, 20, 0,
    0, "INSERT", 8, "0", 2, "Xref Dim_Names Dahiyat Nemar", 10, 0, 20, 0,
    0, "INSERT", 8, "0", 2, "LEGEND", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const p = parseDxf(text, "10200-000.dxf", PARSONS_DN_ROADS_PROFILE);
  const roads = p.features.filter((f) => f.infraFeatureClass === "road_centerline");
  assert.equal(roads.length, 1, "the legend sample is not a road");
  assert.equal(roads[0]!.attributes.road_name, "RD-06");
  assert.equal(p.features.filter((f) => f.outputLayer === "blocks").length, 1);
  const reserve = p.features.filter((f) => f.outputLayer === "road_reserve");
  assert.equal(reserve.length, 1);
  assert.equal((reserve[0]!.geometry.coordinates as number[][][]).length, 2, "the block is cut out as a hole");
});

test("Namar 10200: blocks closed by the project boundary are added where they hold plots; road strips and plots stay out of the reserve", () => {
  const bnd = `${RL}$0$NOTES & LEGEND ROAD-NHC-DMM$0$RD-PVT-MRK`;
  // boundary 0..300 x 0..100. Block A drawn closed; block B a ROW "U" open to the boundary on the north;
  // C: plots between a road and the boundary with no ROW line on the road side (a face holding the road)
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, RL, 70, 0, 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, bnd, 90, 4, 70, 1, 10, E, 20, N, 10, E + 300, 20, N, 10, E + 300, 20, N + 100, 10, E, 20, N + 100,
    ...square(`${RL}$0$__ROW`, E + 10, N + 10, 40),
    0, "LWPOLYLINE", 8, `${RL}$0$__ROW`, 90, 4, 70, 0, 10, E + 70, 20, N + 100, 10, E + 70, 20, N + 60, 10, E + 130, 20, N + 60, 10, E + 130, 20, N + 100,
    ...square(`${RL}$0$Residential plots`, E + 80, N + 70, 20),
    0, "LWPOLYLINE", 8, `${RL}$0$__ROW`, 90, 2, 70, 0, 10, E + 200, 20, N, 10, E + 200, 20, N + 100,
    0, "LWPOLYLINE", 8, `${RL}$0$_CL`, 90, 2, 70, 0, 10, E + 210, 20, N, 10, E + 210, 20, N + 100,
    ...square(`${RL}$0$Residential plots`, E + 260, N + 40, 20),
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, RL, 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const p = parseDxf(text, "10200-000.dxf", PARSONS_DN_ROADS_PROFILE);
  const blocks = p.features.filter((f) => f.outputLayer === "blocks");
  assert.equal(blocks.length, 2, "A as drawn, B closed by the boundary; the face holding the road is no block");
  assert.ok(p.notes.some((n) => /1 more closed by/.test(n) && /1 face\(s\) left out/.test(n)), p.notes.join("\n"));
  const reserve = p.features.find((f) => f.outputLayer === "road_reserve")!;
  const area = (r: number[][]) => { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1]![0]! * r[i]![1]! - r[i]![0]! * r[i - 1]![1]!; return Math.abs(a / 2); };
  const polys = (reserve.geometry.type === "Polygon" ? [reserve.geometry.coordinates] : reserve.geometry.coordinates) as number[][][][];
  const total = polys.reduce((s, poly) => s + poly.reduce((t, r, i) => t + (i ? -area(r) : area(r)), 0), 0);
  // 30 000 less block A (1 600), block B (60 x 40 = 2 400) and the plot by the road (400)
  assert.ok(Math.abs(total - (30000 - 1600 - 2400 - 400)) < 1, `reserve ${total}`);
});

test("Namar SLT-10000: plot numbers in a baseplan xref of texts only still number the layout's plots", () => {
  // The baseplan's own plot lines (MP-PLT-LIN) are not mapped: before, the reader did not open an xref
  // holding only those numbers, and all 767 plots came out without one.
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, RL, 70, 0, 10, 0, 20, 0,
    ...square(`${RL}$0$Residential plots`, E, N, 20),
    ...square(`${RL}$0$Residential plots`, E + 20, N, 20),
    0, "ENDBLK",
    0, "BLOCK", 2, "Ladun Dahiyat Namar Baseplan", 70, 0, 10, 0, 20, 0,
    0, "LINE", 8, "Ladun Dahiyat Namar Baseplan$0$MP-PLT-LIN", 10, E, 20, N, 11, E + 20, 21, N,
    0, "TEXT", 8, "Ladun Dahiyat Namar Baseplan$0$MP-PLT-TXT", 10, E + 10, 20, N + 10, 40, 1, 1, "58",
    0, "TEXT", 8, "Ladun Dahiyat Namar Baseplan$0$MP-PLT-TXT", 10, E + 30, 20, N + 10, 40, 1, 1, "59",
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, RL, 10, 0, 20, 0,
    0, "INSERT", 8, "0", 2, "Ladun Dahiyat Namar Baseplan", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const plots = parseDxf(text, "SLT-10000-000.dxf", PARSONS_DN_PLOTS_PROFILE).features.filter((f) => f.outputLayer === "plots");
  assert.equal(plots.length, 2);
  assert.deepEqual(plots.map((f) => f.attributes.parcel_id).sort(), ["58", "59"]);
});
