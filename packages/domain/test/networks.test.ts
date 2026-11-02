import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { AssetKeyConfig, createFileStore, infraWorksType, parseDxf, parseSize, runBuildPipeline } from "../src/index.js";
import type { MappingProfile, ValidationReport } from "../src/index.js";

const X = 657000;
const Y = 2747000;
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join("\n") + "\n";
const pline = (layer: string, pts: number[][]) => [0, "LWPOLYLINE", 8, layer, 90, pts.length, 70, 0, ...pts.flatMap(([x, y]) => [10, X + x!, 20, Y + y!])];
const text = (layer: string, s: string, x: number, y: number) => [0, "TEXT", 8, layer, 10, X + x, 20, Y + y, 40, 1, 1, s];
const insert = (layer: string, block: string, x: number, y: number) => [0, "INSERT", 8, layer, 2, block, 10, X + x, 20, Y + y];
const blocks = (...names: string[]) => [0, "SECTION", 2, "BLOCKS", ...names.flatMap((n) => [0, "BLOCK", 2, n, 10, 0, 20, 0, 0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 1, 0, "ENDBLK"]), 0, "ENDSEC"];

const PROFILE: MappingProfile = {
  id: "t",
  name: "t",
  layers: [
    { dwgLayer: "PIPE-SEWER-*", infraFeatureClass: "pipeline", outputLayer: "sewer_pipes", attributes: { utility: "Sewer" }, size: { fromLayer: String.raw`(\d+(?:\.\d+)?)\s*mm` } },
    { dwgLayer: "BOX-*", infraFeatureClass: "pipeline", outputLayer: "storm_pipes", size: { fromLayer: String.raw`(\d+)x(\d+)` } },
    { dwgLayer: "PW-PIPE", infraFeatureClass: "pipeline", outputLayer: "water_pipes", size: { fromLabel: { labels: ["PW-TXT"], pattern: String.raw`(\d+)\s*mm`, maxDistance: 5 } } },
    { dwgLayer: "MH", infraFeatureClass: "pipe_connector", outputLayer: "sewer_manholes", attributes: { conn_type: "Manhole" } },
  ],
  reportJoins: [],
  assetKeys: AssetKeyConfig.parse({}),
};

test("sizes: one number is a round pipe in mm, two a box, and under 10 is metres already", () => {
  assert.deepEqual(parseSize(["200"]), { mm: [200] });
  assert.deepEqual(parseSize(["2000", "1500"]), { mm: [2000, 1500] });
  assert.deepEqual(parseSize(["1.5", "1.5"]), { mm: [1500, 1500] });
  assert.equal(parseSize([undefined]), null);
});

test("pipes take their size from the layer name, or from a label and then along the run; nodes keep their block", () => {
  const p = parseDxf(
    dxf(
      ...blocks("MH-2000"),
      0, "SECTION", 2, "ENTITIES",
      ...pline("PIPE-SEWER-200mm.", [[0, 0], [50, 0]]),
      ...pline("BOX-2000x1500", [[0, 10], [50, 10]]),
      // A water run in two pieces, labelled once on the first.
      ...pline("PW-PIPE", [[0, 20], [40, 20]]), ...pline("PW-PIPE", [[40, 20], [80, 20]]),
      ...text("PW-TXT", "%%C160 mm", 20, 21.5),
      ...pline("PW-PIPE", [[0, 60], [40, 60]]), // unlabelled and unconnected
      ...insert("MH", "MH-2000", 0, 0),
      0, "ENDSEC", 0, "EOF",
    ),
    "t.dxf",
    PROFILE,
  );
  const of = (layer: string) => p.features.filter((f) => f.outputLayer === layer);
  const sewer = of("sewer_pipes")[0]!.attributes;
  assert.deepEqual([sewer.size_mm, sewer.diameter_mm, sewer.size_m, sewer.size_y_m, sewer.utility, sewer.size_from], ["200", 200, 0.2, 0.2, "Sewer", "layer"]);
  const box = of("storm_pipes")[0]!.attributes;
  assert.deepEqual([box.size_mm, box.size_m, box.size_y_m], ["2000x1500", 2, 1.5]);
  const water = of("water_pipes").map((f) => [f.attributes.size_mm, f.attributes.size_from]);
  assert.deepEqual(water, [["160", "label"], ["160", "network"], [undefined, undefined]]);
  const mh = of("sewer_manholes")[0]!;
  assert.equal(mh.geometry.type, "Point");
  assert.deepEqual([mh.attributes.block, mh.attributes.conn_type], ["MH-2000", "Manhole"]);
  assert.deepEqual(p.pipeStats!.find((s) => s.layer === "water_pipes"), { layer: "water_pipes", pipes: 3, fromLayer: 0, fromLabel: 2, carried: 1, unsized: 1 });
  assert.equal(infraWorksType("pipe_connector", "point"), "Pipeline Connectors");
  assert.equal(infraWorksType("pipeline", "line"), "Pipelines");
});

async function build(files: { name: string; text: string }[], profile: MappingProfile): Promise<ValidationReport> {
  const dir = mkdtempSync(join(tmpdir(), "iw-net-"));
  const store = createFileStore(dir);
  const project = store.createProject("t", 32638);
  store.setMappingProfile(project.id, profile);
  if (files.length > 1) store.updateProject(project.id, { cadMode: "all" });
  for (const f of files) {
    const path = join(dir, f.name);
    writeFileSync(path, f.text);
    store.addUpload({ projectId: project.id, filename: f.name, kind: "dxf", path, size: 0 });
  }
  try {
    return (await runBuildPipeline(store, project.id)).validation;
  } catch (err) {
    return (err as { validation: ValidationReport }).validation;
  }
}

test("a sheet that rotates its xref off the CRS is read at the xref's own coordinates", async () => {
  // Bound xref "Xref Storm" drawn in UTM, inserted rotated 295° about a point off site.
  const sheet = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "Xref Storm", 10, 0, 20, 0,
    ...pline("Xref Storm$0$PIPE-SEWER-400mm", [[0, 0], [100, 0]]),
    0, "ENDBLK", 0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Xref Storm", 10, 663988.92, 20, 2757118.87, 50, 295.27,
    0, "ENDSEC", 0, "EOF",
  );
  const v = await build([{ name: "sto.dxf", text: sheet }], PROFILE);
  assert.ok(v.issues.some((i) => i.code === "XREF_READ_AT_OWN_COORDINATES"), JSON.stringify(v.issues));
  assert.ok(!v.issues.some((i) => i.code === "COORDS_OUTSIDE_CRS"));
  assert.equal(v.ok, true);
});

test("an xref renamed by EXPORTTOAUTOCAD (Xref Storm Network_1, layers still Xref Storm Network$0$) is still read at its own coordinates", async () => {
  // Al Qairawan STO exported with EXPORTTOAUTOCAD: the block became "…_1", its layers kept the prefix.
  const sheet = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "Xref Storm Network_1", 10, 0, 20, 0,
    ...pline("Xref Storm Network$0$PIPE-SEWER-400mm", [[0, 0], [100, 0]]),
    0, "ENDBLK", 0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, "0", 2, "Xref Storm Network_1", 10, 663988.92, 20, 2757118.87, 50, 295.27,
    0, "ENDSEC", 0, "EOF",
  );
  const v = await build([{ name: "sto.dxf", text: sheet }], PROFILE);
  assert.ok(v.issues.some((i) => i.code === "XREF_READ_AT_OWN_COORDINATES"), JSON.stringify(v.issues));
  assert.ok(!v.issues.some((i) => i.code === "COORDS_OUTSIDE_CRS"));
  assert.equal(v.ok, true);
});

test("several drawings combine into one package; a couple of stray pipes at 0,0 are left out, not blocking", async () => {
  const pipes = (n: number) => Array.from({ length: n }, (_, i) => pline("PIPE-SEWER-200mm", [[0, i * 5], [40, i * 5]])).flat();
  const sewer = dxf(0, "SECTION", 2, "ENTITIES", ...pipes(20), 0, "LWPOLYLINE", 8, "PIPE-SEWER-800mm", 90, 2, 70, 0, 10, 0, 20, 0, 10, 50, 20, 0, 0, "ENDSEC", 0, "EOF");
  const water = dxf(0, "SECTION", 2, "ENTITIES", ...pline("PW-PIPE", [[0, 200], [40, 200]]), ...text("PW-TXT", "200 mm", 20, 201), 0, "ENDSEC", 0, "EOF");
  const v = await build([{ name: "swn.dxf", text: sewer }, { name: "pwt.dxf", text: water }], PROFILE);
  const left = v.issues.find((i) => i.code === "COORDS_OUTSIDE_CRS_LEFT_OUT");
  assert.equal(left?.context?.count, "1", JSON.stringify(v.issues));
  assert.equal(v.ok, true);
  assert.ok(v.issues.some((i) => i.code === "PIPE_SIZES" && /water_pipes \(pwt\.dxf\)/.test(i.message)), "the water drawing was read too");

  // A drawing mostly in local coordinates still blocks.
  const local = dxf(0, "SECTION", 2, "ENTITIES", ...Array.from({ length: 10 }, (_, i) => [0, "LINE", 8, "PIPE-SEWER-200mm", 10, 0, 20, i, 11, 10, 21, i]).flat(), 0, "ENDSEC", 0, "EOF");
  const blocked = await build([{ name: "local.dxf", text: local }], PROFILE);
  assert.equal(blocked.issues.find((i) => i.code === "COORDS_OUTSIDE_CRS")?.severity, "blocking");
});

test("dry networks: one layer for cable and poles, groups pasted at 0,0 opened, pillars kept as one point, cameras as centres", () => {
  const prof: MappingProfile = {
    id: "d",
    name: "d",
    layers: [
      { dwgLayer: "SL", infraFeatureClass: "pipeline", outputLayer: "sl_cables", explode: false, symbols: { infraFeatureClass: "annotation", outputLayer: "street_lights", attributes: { conn_type: "Street Light" } } },
      { dwgLayer: "PILLAR", infraFeatureClass: "pipe_connector", outputLayer: "pillars" },
      { dwgLayer: "CABLE", infraFeatureClass: "pipeline", outputLayer: "cables" },
      { dwgLayer: "CCTV", infraFeatureClass: "annotation", outputLayer: "cameras", asPoint: true },
    ],
    reportJoins: [],
    assetKeys: AssetKeyConfig.parse({}),
  };
  const p = parseDxf(
    dxf(
      0, "SECTION", 2, "BLOCKS",
      // A pole symbol, and a group of poles placed in world coordinates (base 0,0).
      0, "BLOCK", 2, "POLE", 10, 0, 20, 0, 0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 0.3, 0, "ENDBLK",
      0, "BLOCK", 2, "*U1", 10, 0, 20, 0, ...insert("SL", "POLE", 10, 0), ...insert("SL", "POLE", 30, 0), 0, "ENDBLK",
      // A pillar symbol whose drawing includes a stub on the cable layer.
      0, "BLOCK", 2, "PIL", 10, 0, 20, 0, 0, "LINE", 8, "CABLE", 10, 0, 20, 0, 11, 1, 21, 0, 0, "ENDBLK",
      0, "ENDSEC",
      0, "SECTION", 2, "ENTITIES",
      ...pline("SL", [[0, 0], [40, 0]]),
      0, "INSERT", 8, "SL", 2, "*U1", 10, 0, 20, 0,
      ...insert("PILLAR", "PIL", 50, 50), ...insert("PILLAR", "PIL", 60, 50),
      0, "LWPOLYLINE", 8, "CABLE", 90, 4, 70, 1, 10, X, 20, Y + 100, 10, X + 10, 20, Y + 100, 10, X + 10, 20, Y + 110, 10, X, 20, Y + 110,
      0, "CIRCLE", 8, "CCTV", 10, X + 5, 20, Y + 5, 40, 0.5,
      0, "ENDSEC", 0, "EOF",
    ),
    "t.dxf",
    prof,
  );
  const of = (l: string) => p.features.filter((f) => f.outputLayer === l);
  assert.equal(of("sl_cables").length, 1);
  assert.equal(of("street_lights").length, 2, "both poles from the group at 0,0");
  assert.ok(of("street_lights").every((f) => f.infraFeatureClass === "annotation" && f.attributes.conn_type === "Street Light"));
  assert.equal(of("pillars").length, 2);
  assert.ok(of("pillars").every((f) => f.geometry.type === "Point"));
  assert.equal(of("cables").length, 1, "the pillar's stub is not a cable; the closed ring is");
  const cam = of("cameras")[0]!.geometry.coordinates as number[];
  assert.ok(Math.abs(cam[0]! - (X + 5)) < 1e-6 && Math.abs(cam[1]! - (Y + 5)) < 1e-6);
});

test("an xref holding only mapped symbols (valves) is opened once, and a rule's InfraWorks columns reach the manifest", async () => {
  const prof: MappingProfile = {
    id: "v",
    name: "v",
    layers: [{ dwgLayer: "VALVE", infraFeatureClass: "pipe_connector", outputLayer: "water_valves", attributes: { utility: "Water", network: "Water - T" }, fields: { NETWORKNAME: "network" } }],
    reportJoins: [],
    assetKeys: AssetKeyConfig.parse({}),
  };
  // A bound xref "Xref PW" whose only content is two valve symbols on its own VALVE layer.
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "GV", 10, 0, 20, 0, 0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 0.3, 0, "ENDBLK",
    0, "BLOCK", 2, "Xref PW", 10, 0, 20, 0,
    ...insert("Xref PW$0$VALVE", "GV", 10, 10), ...insert("Xref PW$0$VALVE", "GV", 20, 10),
    0, "ENDBLK", 0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES", 0, "INSERT", 8, "0", 2, "Xref PW", 10, 0, 20, 0, 0, "ENDSEC", 0, "EOF",
  );
  const p = parseDxf(text, "pw.dxf", prof);
  const valves = p.features.filter((f) => f.outputLayer === "water_valves");
  assert.equal(valves.length, 2, "read through the insert, not again as a plotted sheet");
  assert.deepEqual(valves[0]!.infraWorksFields, { NETWORKNAME: "network" });

  const dir = mkdtempSync(join(tmpdir(), "iw-valves-"));
  const path = join(dir, "pw.dxf");
  writeFileSync(path, text);
  const store = createFileStore(join(dir, "store"));
  const proj = store.createProject("v", 32638);
  store.setMappingProfile(proj.id, prof);
  store.addUpload({ projectId: proj.id, filename: "pw.dxf", kind: "dxf", path, size: 0 });
  const r = await runBuildPipeline(store, proj.id);
  const layer = r.collection && JSON.parse(readFileSync(join(dirname(r.packagePath), readdirSync(dirname(r.packagePath)).find((d) => d.startsWith(`pkg-${proj.id}`))!, "manifest.json"), "utf8"))
    .layers.find((l: { name: string; format: string }) => l.name === "water_valves" && l.format === "shp");
  assert.deepEqual(layer.fieldAttributes, { NETWORKNAME: "network" });
});
