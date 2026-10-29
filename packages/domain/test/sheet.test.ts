import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_MAPPING_PROFILE,
  PARSONS_LDIP_ROADS_PROFILE,
  createFileStore,
  findLayerMapping,
  parseDxf,
  runBuildPipeline,
  stripBoundXrefPrefix,
  suggestFeatureClass,
} from "../src/index.js";
import type { ValidationReport } from "../src/index.js";

/** Build a DXF from [code, value] pairs. */
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";

/**
 * A plotted sheet like Parsons' Al Narjis 10001: the road layout bound in as an xref (layers
 * "<xref>$0$<layer>"), a bound title block, and model space holding only the title block insert.
 */
const SHEET_BLOCKS = [
  0, "SECTION", 2, "BLOCKS",
  0, "BLOCK", 2, "Xref Road Layout Al Narjis", 70, 0, 10, 0, 20, 0, 1, "Xref Road Layout Al Narjis.dwg",
  0, "LWPOLYLINE", 8, "Xref Road Layout Al Narjis$0$RD_CL", 90, 3, 70, 0, 10, 663700, 20, 2756700, 10, 663800, 20, 2756700, 10, 663900, 20, 2756800,
  0, "LINE", 8, "Xref Road Layout Al Narjis$0$RD_CL External Road", 10, 664000, 20, 2756700, 11, 664000, 21, 2757000,
  0, "LINE", 8, "Xref Road Layout Al Narjis$0$RD_Edge", 10, 663700, 20, 2756710, 11, 663800, 21, 2756710,
  0, "LWPOLYLINE", 8, "Xref Road Layout Al Narjis$0$Project Boundary", 90, 4, 70, 1, 10, 663600, 20, 2756600, 10, 664100, 20, 2756600, 10, 664100, 20, 2757100, 10, 663600, 20, 2757100,
  0, "ENDBLK",
  0, "BLOCK", 2, "Title Block_A1", 70, 0, 10, 0, 20, 0,
  0, "LINE", 8, "Title Block_A1$0$FRAME", 10, 0, 20, 0, 11, 841, 21, 0,
  0, "ENDBLK",
  0, "ENDSEC",
];

const roadsOf = (p: ReturnType<typeof parseDxf>) => p.features.filter((f) => f.infraFeatureClass === "road_centerline");

test("bound-xref layer names are matched and suggested by their own name", () => {
  assert.equal(stripBoundXrefPrefix("Xref Road Layout Al Narjis$0$RD_CL"), "RD_CL");
  assert.equal(stripBoundXrefPrefix("Site$0$Roads$1$RD_CL"), "RD_CL", "nested binds");
  assert.equal(stripBoundXrefPrefix("ROADS"), "ROADS");
  assert.equal(stripBoundXrefPrefix("COST$ITEMS"), "COST$ITEMS", "a plain $ is not a bind prefix");

  // The word XREF in the xref's name used to send every layer to "unmapped".
  assert.equal(suggestFeatureClass("Xref Road Layout Al Narjis$0$RD_CL"), "road_centerline");
  assert.equal(suggestFeatureClass("Xref Road Layout Al Narjis$0$RD_Edge"), "unmapped");

  const rule = (layer: string) => findLayerMapping(PARSONS_LDIP_ROADS_PROFILE, layer)?.infraFeatureClass;
  assert.equal(rule("Xref Road Layout Al Narjis$0$RD_CL External Road"), "road_centerline");
  assert.equal(rule("RD_CL"), "road_centerline");
  assert.equal(rule("Xref Road Layout Al Narjis$0$Project Boundary"), "coverage");
  assert.equal(rule("Xref Road Layout Al Narjis$0$RD_CURB_RETURN"), undefined);
  // A rule written with the prefix still matches first.
  const prefixed = { layers: [{ dwgLayer: "Xref A$0$RD_CL", infraFeatureClass: "water" as const }, { dwgLayer: "RD_CL", infraFeatureClass: "road_centerline" as const }] };
  assert.equal(findLayerMapping(prefixed, "Xref A$0$RD_CL")?.infraFeatureClass, "water");
});

test("a plotted sheet: roads are read from the bound xref at their own coordinates, not the title block", () => {
  const text = dxf(
    ...SHEET_BLOCKS,
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Title Block_A1", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "10001-0A.dxf", PARSONS_LDIP_ROADS_PROFILE);
  assert.deepEqual(parsed.extractedXrefs, ["Xref Road Layout Al Narjis"]);
  assert.equal(parsed.truncated, undefined);
  const roads = roadsOf(parsed);
  assert.equal(roads.length, 2);
  assert.deepEqual(roads[0]!.geometry.coordinates[0], [663700, 2756700], "coordinates as drawn");
  assert.equal(roads[0]!.provenance.sourceLayer, "Xref Road Layout Al Narjis$0$RD_CL");
  assert.equal(parsed.features.filter((f) => f.infraFeatureClass === "coverage").length, 1);
  assert.ok(!parsed.features.some((f) => f.provenance.sourceLayer.startsWith("Title Block_A1")), "title block left out");
  assert.match(parsed.notes[0]!, /bound xref\(s\) "Xref Road Layout Al Narjis" were read/);
});

test("a sheet whose xref layers are not mapped says which xrefs to map instead of guessing", () => {
  const text = dxf(...SHEET_BLOCKS, 0, "SECTION", 2, "ENTITIES", 0, "ENDSEC", 0, "EOF");
  const parsed = parseDxf(text, "10001-0A.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.extractedXrefs, undefined);
  assert.equal(parsed.features.length, 0);
  assert.ok(parsed.notes.some((n) => /none has a mapped layer: "Xref Road Layout Al Narjis", "Title Block_A1"/.test(n)));
});

test("a drawing that places its xref in model space is read normally, without the sheet fallback", () => {
  const text = dxf(
    ...SHEET_BLOCKS,
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Xref Road Layout Al Narjis", 10, 0, 20, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const parsed = parseDxf(text, "layout.dxf", PARSONS_LDIP_ROADS_PROFILE);
  assert.equal(parsed.extractedXrefs, undefined);
  assert.equal(roadsOf(parsed).length, 2, "read once, through the insert");
});

test("a DXF cut off inside ENTITIES is flagged, and its half-written last entity is dropped", () => {
  const text = dxf(
    0, "SECTION", 2, "ENTITIES",
    0, "LINE", 8, "ROADS", 10, 673000, 20, 2735000, 11, 673100, 21, 2735000,
    0, "INSERT", 5, "12", 100, "AcDbEntity", 8, "0", 100, "AcDbBlockReference",
  );
  const parsed = parseDxf(text, "cut.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.features.length, 1, "no stray point at 0,0 from the cut-off insert");
  assert.equal(parsed.features[0]!.infraFeatureClass, "road_centerline");
  assert.ok(parsed.notes.some((n) => /cut off/.test(n)));

  const whole = parseDxf(dxf(0, "SECTION", 2, "ENTITIES", 0, "ENDSEC", 0, "EOF"), "ok.dxf", DEFAULT_MAPPING_PROFILE);
  assert.equal(whole.truncated, undefined);
});

test("the build report warns about a cut-off DXF and about roads taken from a sheet's xref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iw-sheet-"));
  const path = join(dir, "10001-0A.dxf");
  // The real Al Narjis sheet: ends inside ENTITIES, in the middle of its only model-space insert.
  writeFileSync(path, dxf(...SHEET_BLOCKS, 0, "SECTION", 2, "ENTITIES", 0, "INSERT", 5, "12", 8, "0"));
  const store = createFileStore(dir);
  const project = store.createProject("sheet", 32638);
  store.setMappingProfile(project.id, PARSONS_LDIP_ROADS_PROFILE);
  store.addUpload({ projectId: project.id, filename: "10001-0A.dxf", kind: "dxf", path, size: 0 });
  let validation: ValidationReport;
  try {
    validation = (await runBuildPipeline(store, project.id)).validation;
  } catch (err) {
    validation = (err as { validation: ValidationReport }).validation;
  }
  const codes = validation.issues.map((i) => i.code);
  assert.ok(codes.includes("DXF_TRUNCATED"));
  assert.ok(codes.includes("SHEET_XREF_EXTRACTED"));
  const sheet = validation.issues.find((i) => i.code === "SHEET_XREF_EXTRACTED")!;
  assert.match(sheet.message, /Xref Road Layout Al Narjis\.dwg/);
  assert.equal(validation.ok, true, "warnings, not blocking: the roads are still usable");
});