import assert from "node:assert/strict";
import test from "node:test";

import { PARSONS_NRJS_CORRIDORS_PROFILE, PARSONS_NRJS_DRY_PROFILE, PARSONS_NRJS_WET_PROFILE, corridorFit, depthNetworks, parseDxf } from "../src/index.js";

/** Build a DXF from [code, value] pairs. */
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";
const LV = "Xref_Narjis_LV Network$0$";

test("Al Narjis LV: an LV Panel block on MINI-PILLAR-0 gives its pillar and its house connection lines", () => {
  // ILV-DWG-10000: 31 "LV Panel" dynamic-block copies (*U25…) on MINI-PILLAR-0, each holding the pillar
  // symbol (*U24 on MINI-PILLAR-2) and 19 house connections on "Electrical LV -HC". Kept as one point,
  // the panel lost all 589 house connections.
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "*U24", 70, 1, 10, 0, 20, 0, 0, "CIRCLE", 8, `${LV}E-POWR-MINI-PILLAR-2`, 10, 0, 20, 0, 40, 0.5, 0, "ENDBLK",
    0, "BLOCK", 2, "*U25", 70, 1, 10, 0, 20, 0,
    0, "INSERT", 8, `${LV}E-POWR-MINI-PILLAR-2`, 2, "*U24", 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, `${LV}Electrical LV -HC`, 90, 2, 70, 0, 10, 0, 20, 0, 10, 12, 20, 0,
    0, "ENDBLK",
    0, "BLOCK", 2, "Xref_Narjis_LV Network", 70, 0, 10, 0, 20, 0, 1, "Xref_Narjis_LV Network.dwg",
    0, "INSERT", 8, `${LV}E-POWR-MINI-PILLAR-0`, 2, "*U25", 10, 663900, 20, 2756900,
    0, "INSERT", 8, `${LV}SSLPC`, 2, "*U24", 10, 663956, 20, 2756954,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Xref_Narjis_LV Network", 10, 0, 20, 0,
    0, "INSERT", 8, "SSLPC", 2, "*U24", 10, 663956.06, 20, 2756953.96,
    0, "ENDSEC", 0, "EOF",
  );
  const f = parseDxf(text, "ILV-10000.dxf", PARSONS_NRJS_DRY_PROFILE).features;
  const by = (l: string) => f.filter((x) => x.outputLayer === l);
  assert.equal(by("lv_pillars").length, 1, "one pillar, from the symbol inside the panel");
  assert.equal(by("lv_pillars")[0]!.geometry.type, "Point");
  const hc = by("lv_cables");
  assert.equal(hc.length, 1);
  assert.equal(hc[0]!.attributes.conn_type, "House Connection");
  assert.deepEqual((hc[0]!.geometry.coordinates as number[][])[1], [663912, 2756900], "placed by the panel insert");
  assert.equal(by("streetlight_panels").length, 1, "the lighting panel drawn again in the LV xref is not shipped twice");
});

test("Al Narjis water: a hydrant block on layer 0 gives one hydrant at its circle; the xref's washout on C-STRM-STRC is no storm outfall", () => {
  // IPW-DWG-10000: each fire hydrant is an anonymous block on layer 0 holding a circle on
  // "C-PW-FIRE HYDRANT COVER CATCH" (and a hatch); unopened, no hydrant was read.
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "*U33", 70, 1, 10, 0, 20, 0,
    0, "CIRCLE", 8, "C-PW-FIRE HYDRANT COVER CATCH", 10, 1, 20, 2, 40, 0.4,
    0, "ENDBLK",
    0, "BLOCK", 2, "WO", 70, 0, 10, 0, 20, 0, 0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 0.3, 0, "ENDBLK",
    0, "BLOCK", 2, "Xref Potable", 70, 0, 10, 0, 20, 0, 1, "Xref Potable.dwg",
    0, "INSERT", 8, "0", 2, "*U33", 10, 663900, 20, 2756900,
    0, "INSERT", 8, "Xref Potable$0$C-STRM-STRC", 2, "WO", 10, 663950, 20, 2756950,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES", 0, "INSERT", 8, "0", 2, "Xref Potable", 10, 0, 20, 0, 0, "ENDSEC", 0, "EOF",
  );
  const f = parseDxf(text, "IPW-10000.dxf", PARSONS_NRJS_WET_PROFILE).features;
  const h = f.filter((x) => x.outputLayer === "water_hydrants");
  assert.equal(h.length, 1);
  assert.deepEqual(h[0]!.geometry, { type: "Point", coordinates: [663901, 2756902] });
  assert.deepEqual(f.filter((x) => x.outputLayer === "water_valves").map((x) => x.attributes.conn_type), ["Washout Valve"]);
  assert.equal(f.filter((x) => x.outputLayer === "storm_manholes").length, 0);
});

test("Al Narjis irrigation: valves in the bound xref and its nested network xrefs, each kept as one point", () => {
  // IRW-DWG-10000: block "Xref Irrigation_1" (renamed by EXPORTTOAUTOCAD), layers "Xref Irrigation$0$…",
  // the air valve two xrefs deeper; each isolation valve block holds the butterfly valve symbol too.
  const deep = "Xref Irrigation$0$Xref irrigation Network Plan$0$Xref irrigation Network Plan$0$X-ref Irrigation Distribution Network$0$";
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "BF", 70, 0, 10, 0, 20, 0, 0, "CIRCLE", 8, "Xref Irrigation$0$C-IRR-BUTTERFLY VALVE", 10, 0, 20, 0, 40, 0.3, 0, "ENDBLK",
    // as drawn: the gate valve's own lines on C-IRR-VALVE beside the butterfly symbol
    0, "BLOCK", 2, "*U427", 70, 1, 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, "Xref Irrigation$0$C-IRR-VALVE", 90, 2, 70, 0, 10, -0.5, 20, 0, 10, 0.5, 20, 0,
    0, "INSERT", 8, "Xref Irrigation$0$C-IRR-BUTTERFLY VALVE", 2, "BF", 10, 0, 20, 0,
    0, "ENDBLK",
    0, "BLOCK", 2, "Xref Irrigation_1", 70, 0, 10, 0, 20, 0, 1, "Xref Irrigation.dwg",
    0, "INSERT", 8, "Xref Irrigation$0$Isolation valve", 2, "*U427", 10, 663900, 20, 2756900,
    0, "INSERT", 8, `${deep}C-PW-AIR VALVE`, 2, "BF", 10, 663950, 20, 2756950,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES", 0, "INSERT", 8, "0", 2, "Xref Irrigation_1", 10, 0, 20, 0, 0, "ENDSEC", 0, "EOF",
  );
  const v = parseDxf(text, "IRW-10000.dxf", PARSONS_NRJS_WET_PROFILE).features.filter((x) => x.outputLayer === "irrigation_valves");
  assert.deepEqual(v.map((x) => [x.attributes.conn_type, x.attributes.network, x.geometry.type]).sort(), [
    ["Air Valve", "Irrigation - Al Narjis", "Point"],
    ["Isolation Valve", "Irrigation - Al Narjis", "Point"],
  ]);
});

test("corridor fit: the share of a network lying within the tolerance of its IUC corridor line", () => {
  const corridor = [[[0, 0], [100, 0]]];
  // 60 m on the corridor (0.4 m off), then 40 m running 3 m away; and a line far off
  const net = [[[0, 0.4], [60, 0.4], [60, 3], [100, 3]], [[0, 50], [10, 50]]];
  const r = corridorFit(net, corridor, { tolerance: 1, step: 1 });
  assert.ok(Math.abs(r.length - 112.6) < 0.01, String(r.length));
  assert.ok(Math.abs(r.onCorridor - 61.0) < 0.6, String(r.onCorridor));
  assert.equal(r.linesOff, 1, "the far line never meets its corridor");
  assert.ok(r.median < 3.1);
  assert.deepEqual(corridorFit([], corridor).share, 0);
});

test("Al Narjis corridors: lines of the IUC xref ship as display-only corridor lines; the legend copies do not", () => {
  const X = "Xref_Al Narjis_Utilities Corridor$0$";
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "Xref_Al Narjis_Utilities Corridor", 70, 0, 10, 0, 20, 0, 1, "Corridor.dwg",
    0, "LWPOLYLINE", 8, `${X}-05- Potable Water`, 90, 2, 70, 0, 10, 663900, 20, 2756900, 10, 663950, 20, 2756900,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Xref_Al Narjis_Utilities Corridor", 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, "-05- Potable Water", 90, 2, 70, 0, 10, 695, 20, 466, 10, 734, 20, 466, // legend
    0, "ENDSEC", 0, "EOF",
  );
  const f = parseDxf(text, "IUC-10000.dxf", PARSONS_NRJS_CORRIDORS_PROFILE).features.filter((x) => x.outputLayer?.startsWith("corridor_"));
  assert.equal(f.length, 1);
  assert.equal(f[0]!.outputLayer, "corridor_water", "one Shapefile per corridor, so each takes its own colour");
  assert.equal(f[0]!.attributes.network, "Corridor - Water");
  // lifted 1.0 m above the terrain (else hidden under the road body)
  const lifted = depthNetworks(f, PARSONS_NRJS_CORRIDORS_PROFILE).features[0]!;
  assert.deepEqual([lifted.attributes.off_start_m, lifted.attributes.off_end_m, lifted.attributes.lift_m], [1, 1, 1]);
});

test("Al Narjis storm: pipe size from the layer, network named for Al Narjis, cover from its own report", () => {
  const rule = PARSONS_NRJS_WET_PROFILE.layers.find((l) => l.outputLayer === "storm_pipes")!;
  assert.equal(rule.attributes?.network, "Storm - Al Narjis");
  assert.match(String(rule.depth && "source" in rule.depth ? rule.depth.source : ""), /SAPL-DSN-LDN-RPT-000003 §5\.6\.7/);
  const text = dxf(0, "SECTION", 2, "ENTITIES", 0, "LWPOLYLINE", 8, "CI-Ss_50_35_08_85-M-SW_Pipe Dia 500", 90, 2, 70, 0, 10, 663900, 20, 2756900, 10, 663950, 20, 2756900, 0, "ENDSEC", 0, "EOF");
  const p = parseDxf(text, "ISW-10000.dxf", PARSONS_NRJS_WET_PROFILE).features.find((x) => x.outputLayer === "storm_pipes")!;
  assert.ok(p, "the pipe is read");
});
