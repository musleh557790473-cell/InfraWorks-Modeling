import assert from "node:assert/strict";
import test from "node:test";

import {
  PARSONS_DN60_CORRIDORS_PROFILE,
  PARSONS_DN60_FITTINGS_PROFILE,
  PARSONS_DN60_POWER_PROFILE,
  PARSONS_DN60_STREETLIGHTING_PROFILE,
  PARSONS_DN60_TELECOM_PROFILE,
  findLayerMapping,
  parseDxf,
} from "../src/index.js";

// Namar 60 % Detailed Design (Nov 2026): layer names as the converted sheets bind them (HANDOVER-60.md).
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";

test("dedupePoints in metres: a pole drawn as a 3D block and a plan symbol 4 cm apart is kept once (SLT-MOD-90000-001)", () => {
  const pole = (block: string, x: number) => [0, "INSERT", 8, "PRN_PR_SL_SLPL", 2, block, 10, x, 20, 2714400];
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "SL6_ Model", 70, 0, 10, 0, 20, 0, 0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 0.2, 0, "ENDBLK",
    0, "BLOCK", 2, "SL1 PLAN", 70, 0, 10, 0, 20, 0, 0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 0.3, 0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    ...pole("SL6_ Model", 657000), ...pole("SL1 PLAN", 657000.04), ...pole("SL6_ Model", 657030), ...pole("SL1 PLAN", 657030.03),
    ...pole("SL6_ Model", 657030.5),
    0, "ENDSEC", 0, "EOF",
  );
  const p = parseDxf(text, "SLT-MOD-90000-001.dxf", PARSONS_DN60_STREETLIGHTING_PROFILE);
  assert.equal(p.features.filter((f) => f.outputLayer === "street_lights").length, 3, "pairs within 10 cm merge; a pole 0.5 m away stays");
  assert.ok(p.notes.some((n) => /street_lights: 2 point\(s\) drawn twice/.test(n)), p.notes.join("\n"));
});

test("Namar 60 % profiles: nested MV cables, telecom depth from Parsons' IFC, corridors under the new xref name", () => {
  const power = (l: string) => findLayerMapping(PARSONS_DN60_POWER_PROFILE, l);
  const mv = power("Xref_Nemar_MV Network$0$Xref_Nemar_MV Network_Correct Corr$0$Xref_MV Network$0$MV Cables - Loop1 (PSS)");
  assert.equal(mv?.outputLayer, "mv_cables");
  assert.equal(mv?.depth && "centreM" in mv.depth ? mv.depth.centreM : undefined, 0.8);
  assert.match(String(mv?.size?.fixed?.source), /DES-RPT-00003 §3\.3\.9\.3/);
  assert.equal(power("Xref_Nemar_LV Network$0$MV Cables - Loop1 (PSS)")?.infraFeatureClass, "unmapped", "the LV xref's copy of the MV loop is not read");
  assert.equal(power("Xref_Nemar_LV Network$0$E-POWER-CABL185")?.outputLayer, "lv_cables");
  assert.equal(power("Xref_Nemar_MV Network$0$RMU")?.attributes?.conn_type, "Ring Main Unit");

  const tel = findLayerMapping(PARSONS_DN60_TELECOM_PROFILE, "Primary telecom x");
  assert.equal(tel?.depth && "centreM" in tel.depth ? tel.depth.centreM : undefined, 0.5);
  assert.match(String(tel?.depth?.source), /TEL-MOD-90000-001\.ifc/);

  assert.equal(findLayerMapping(PARSONS_DN60_CORRIDORS_PROFILE, "Ladun_Dahiyat Nemar_Utilities Corridor$0$-05- Potable Water")?.outputLayer, "corridor_water");
  const fit = (l: string) => findLayerMapping(PARSONS_DN60_FITTINGS_PROFILE, l);
  assert.equal(fit("Ladun Dahiyat Namar Potable Water$0$C-WATR-APPT")?.outputLayer, "water_valves");
  assert.equal(fit("CI-Ss_55_70_42-P-IR_Irrigation Distribution 90")?.outputLayer, "irrigation_pipes_dwg");
});
