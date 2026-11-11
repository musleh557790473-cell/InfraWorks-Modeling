import assert from "node:assert/strict";
import test from "node:test";

import {
  PARSONS_DN_CORRIDORS_PROFILE,
  PARSONS_DN_DRY_PROFILE,
  PARSONS_DN_SECURITY_SECONDARY_PROFILE,
  PARSONS_DN_WET_PROFILE,
  PARSONS_NRJS_CORRIDORS_PROFILE,
  PARSONS_NRJS_DRY_PROFILE,
  PARSONS_NRJS_WET_PROFILE,
  findLayerMapping,
  parseDxf,
} from "../src/index.js";

/** Build a DXF from [code, value] pairs. */
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";
const SITE = { minX: 656600, maxX: 658000, minY: 2713980, maxY: 2714950 };
const onSite = (p: number[]) => p[0]! >= SITE.minX && p[0]! <= SITE.maxX && p[1]! >= SITE.minY && p[1]! <= SITE.maxY;

test("OCS elevation: Namar's water valves (tilted extrusion, OCS Z -52 308 m) land on site, not 1 km away", () => {
  // One of the 119 C-WATR-APPT inserts of PWT-DWG-10000-000, as written in the DXF.
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "*U31", 70, 1, 10, 0, 20, 0,
    0, "LWPOLYLINE", 8, "0", 90, 2, 70, 0, 10, -0.5, 20, 0, 10, 0.5, 20, 0,
    0, "ENDBLK",
    0, "BLOCK", 2, "LDIP-N~1", 70, 0, 10, 0, 20, 0,
    0, "INSERT", 8, "LDIP-N~1$0$C-WATR-APPT", 2, "*U31",
    10, "1897001.102936088", 20, "2048494.749409617", 30, "-52308.4189753102", 50, 90,
    210, "0.0124492506118049", 220, "-0.0222851999759127", 230, "0.9996741399182226",
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "LDIP-N~1", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const valves = parseDxf(text, "PWT-10000-000.dxf", PARSONS_DN_WET_PROFILE).features.filter((f) => f.outputLayer === "water_valves");
  assert.equal(valves.length, 1);
  const p = valves[0]!.geometry.coordinates as number[];
  assert.ok(onSite(p), `valve at ${p.map((n) => n.toFixed(0)).join(" ")}`);
});

test("skipBlocks: a legend's sample on the network's own bare layer name is not read", () => {
  const duct = (x: number) => [0, "LWPOLYLINE", 8, "Primary Duct", 90, 2, 70, 0, 10, x, 20, 2714400, 10, x + 50, 20, 2714400];
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "Notes & Legend", 70, 0, 10, 0, 20, 0,
    ...duct(657000),
    0, "INSERT", 8, "TEL_HH", 2, "2-COVER-HH1", 10, 657010, 20, 2714400,
    0, "ENDBLK",
    0, "BLOCK", 2, "2-COVER-HH1", 70, 0, 10, 0, 20, 0,
    0, "CIRCLE", 8, "TEL_HH_01", 10, 0, 20, 0, 40, 0.4,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    ...duct(657100),
    0, "INSERT", 8, "TEL_HH", 2, "2-COVER-HH1", 10, 657100, 20, 2714400,
    0, "INSERT", 8, "0", 2, "Notes & Legend", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const p = parseDxf(text, "SEC-10000-000.dxf", PARSONS_DN_DRY_PROFILE);
  assert.equal(p.features.filter((f) => f.outputLayer === "security_ducts").length, 1);
  assert.equal(p.features.filter((f) => f.outputLayer === "security_handholes").length, 1);
  assert.equal(p.skippedEntities["INSERT (skipBlocks)"], 1);
});

test("dedupePoints: a street light drawn twice on the same spot is kept once (Namar SLT-10000)", () => {
  const SL = "Xref_Nemar_SL Network";
  const pole = (x: number) => [0, "INSERT", 8, `${SL}$0$AAM`, 2, `${SL}$0$2-arm st light-`, 10, x, 20, 2714400];
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, `${SL}$0$2-arm st light-`, 70, 0, 10, 0, 20, 0,
    0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 0.3,
    0, "ENDBLK",
    0, "BLOCK", 2, SL, 70, 0, 10, 0, 20, 0,
    ...pole(657000), ...pole(657000.004), ...pole(657030),
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, SL, 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const p = parseDxf(text, "SLT-10000-000.dxf", PARSONS_DN_DRY_PROFILE);
  assert.equal(p.features.filter((f) => f.outputLayer === "street_lights").length, 2);
  assert.ok(p.notes.some((n) => /street_lights: 1 point\(s\) drawn twice/.test(n)), p.notes.join("\n"));
});

test("Namar network profiles: rules, covers and citations from the Namar report", () => {
  const wet = (layer: string) => findLayerMapping(PARSONS_DN_WET_PROFILE, layer);
  assert.equal(wet("CI-Ss_50_35_08_85-M-SW_Pipe Dia 1100")?.outputLayer, "storm_pipes");
  assert.match(String(wet("CI-Ss_50_35_08_85-M-SW_Pipe Dia 400")?.depth?.source), /DN-DES-RPT-00001 §10\.2\.7/);
  assert.equal(wet("outlet")?.attributes?.conn_type, "Outfall");
  assert.equal(wet("LDIP-N~1$0$%%c160mm")?.outputLayer, "water_pipes_dwg");
  assert.equal(wet("LDIP-N~1$0$%%c160mm")?.attributes?.network, "Water - Namar (drawing)");
  assert.equal(wet("Tie- ins")?.size?.fixed?.mm, 75);
  assert.equal(wet("Xref irrigation Network Plan$0$X-ref Irrigation Distribution Network$0$C-PW-AIR VALVE")?.outputLayer, "irrigation_valves");
  assert.equal(wet("LDIP-N~1$0$C-PW-AIR VALVE")?.outputLayer, "water_valves", "the water xref's air valve stays water");
  const dry = (layer: string) => findLayerMapping(PARSONS_DN_DRY_PROFILE, layer);
  assert.equal(dry("Xref_Nemar_LV Network$0$E-POWER-CABL185")?.depth?.centreM, 0.65);
  assert.equal(dry("Xref_Nemar_MV Network$0$MV Cables - Loop1 (PSS)")?.size?.fixed?.mm, 200);
  assert.equal(dry("Xref_Nemar_LV Network$0$MV Cables - Loop1 (PSS)")?.infraFeatureClass, "unmapped", "the LV xref's copy of the MV loop");
  assert.equal(dry("Nymar Overall Primary Telecom Network$0$Primary Duct")?.outputLayer, "telecom_ducts", "telecom wins over the bare security rule");
  assert.equal(dry("Primary Duct")?.outputLayer, "security_ducts");
  assert.equal(PARSONS_DN_SECURITY_SECONDARY_PROFILE.layers.length, 1);
  assert.equal(PARSONS_DN_CORRIDORS_PROFILE.layers.length, 15);
  assert.equal(findLayerMapping(PARSONS_DN_CORRIDORS_PROFILE, "-05- Potable Water"), undefined, "the legend copy outside the xref");
  assert.equal(findLayerMapping(PARSONS_DN_CORRIDORS_PROFILE, "Xref-Ladun_Dahiyat Nemar_Utilities Corridor$0$-02-Sewer FM")?.outputLayer, "corridor_sewer_fm");
});

test("Al Narjis profiles still come out of the shared district factories unchanged", () => {
  const irr = PARSONS_NRJS_WET_PROFILE.layers.find((l) => l.dwgLayer === "Xref Irrigation$0$Tie- INs")!;
  assert.deepEqual(irr.size, { fixed: { mm: 75, source: "IRW-DWG-10000 legend: Ø 75mm HDPE pipe for tie-ins" } });
  assert.equal(irr.attributes?.network, "Irrigation - Al Narjis (drawing)");
  const lv = PARSONS_NRJS_DRY_PROFILE.layers[0]!;
  assert.equal(lv.depth?.source, "SAPL-DSN-LDN-RPT-000003 §2.3.3 burial depth to the cable centre, LV");
  const c = PARSONS_NRJS_CORRIDORS_PROFILE.layers[0]!;
  assert.equal(c.dwgLayer, "Xref_Al Narjis_Utilities Corridor$0$-01- Storm Water");
  assert.equal(c.size?.fixed?.source, "display only: corridor line of IUC-DWG-10000");
  assert.equal(PARSONS_NRJS_WET_PROFILE.skipBlocks, undefined, "Al Narjis reads as before");
});
