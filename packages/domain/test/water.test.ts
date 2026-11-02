import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileStore, nominalFromInside, readHydraulicModel, runBuildPipeline } from "../src/index.js";
import type { PackageManifest } from "../src/index.js";
import { makeWaterModel } from "./water-model.js";

const modelPath = () => {
  const path = join(mkdtempSync(join(tmpdir(), "iw-water-")), "Qairawan.wtg.sqlite");
  makeWaterModel(path);
  return path;
};

test("PE inside diameters give the nominal outside size (SDR 11); other materials keep the bore", () => {
  assert.deepEqual(nominalFromInside(130.8, "HDPE"), { mm: 160, how: "PE SDR11 outside from inside" });
  assert.deepEqual(nominalFromInside(73.6, "HDPE"), { mm: 90, how: "PE SDR11 outside from inside" });
  assert.deepEqual(nominalFromInside(515.6, "HDPE"), { mm: 630, how: "PE SDR11 outside from inside" });
  assert.deepEqual(nominalFromInside(700, "Ductile Iron"), { mm: 700, how: "inside" });
  assert.deepEqual(nominalFromInside(140, "HDPE"), { mm: 140, how: "inside" }, "no standard size near: kept as is");
});

test("a WaterGEMS model: pipes and structures only; deleted, prototype and switched-off pipes left out", async () => {
  const net = await readHydraulicModel(modelPath(), "Qairawan.wtg.sqlite", { utility: "Irrigation" });
  const pipes = net.features.filter((f) => f.outputLayer === "irrigation_pipes");
  const nodes = net.features.filter((f) => f.outputLayer === "irrigation_structures");
  assert.deepEqual(pipes.map((f) => f.attributes.label).sort(), ["P-1", "P-2", "P-DI"]);
  assert.equal(net.stats.deletedPipes, 1);
  assert.deepEqual(nodes.map((f) => `${f.attributes.kind}:${f.attributes.label}`).sort(), ["Air Valve:AV-1", "Isolation Valve:ISO-1", "Reservoir:R-1"], "junctions do not ship");
  assert.ok(net.notes.some((n) => /1 deleted, 1 switched off in scenario "7500", 1 prototype/.test(n)), net.notes.join(" | "));

  const p1 = pipes.find((f) => f.attributes.label === "P-1")!;
  assert.deepEqual((p1.geometry.coordinates as number[][]).map((p) => p.map((v) => Math.round(v * 1000) / 1000)), [[657000, 2748000], [657100, 2748000]], "feet to metres");
  assert.deepEqual([p1.attributes.diameter_mm, p1.attributes.inside_mm, p1.attributes.size_m, p1.attributes.material], [160, 130.8, 0.16, "HDPE"]);
  assert.deepEqual([p1.attributes.node_start, p1.attributes.elev_start_m, p1.attributes.elev_end_m], ["R-1", 700, 699]);
  assert.equal(p1.attributes.network, "Irrigation - Qairawan");
  // No cover given: no depth, and no ELEV_FROM / ELEV_TO to map.
  assert.equal(p1.attributes.off_start_m, null);
  assert.ok(!("ELEV_FROM" in p1.infraWorksFields!) && p1.infraWorksFields!.SIZE_X === "size_m");
  assert.equal(pipes.find((f) => f.attributes.label === "P-DI")!.attributes.diameter_mm, 700);
});

test("WaterGEMS pipe depth comes only from a given cover: centre = cover + half the outside diameter", async () => {
  const net = await readHydraulicModel(modelPath(), "Qairawan.wtg.sqlite", { utility: "Water", coverM: 1.0, coverSource: "PWT-10000-001 note 5" });
  const pipes = net.features.filter((f) => f.outputLayer === "water_pipes");
  const p2 = pipes.find((f) => f.attributes.label === "P-2")!;
  assert.deepEqual([p2.attributes.off_start_m, p2.attributes.off_end_m, p2.attributes.cover_m, p2.attributes.cover_src], [-1.315, -1.315, 1, "PWT-10000-001 note 5"]);
  assert.equal(p2.infraWorksFields!.ELEV_FROM, "off_start_m");
  assert.ok(net.notes.some((n) => /cover 1 m over the crown \(PWT-10000-001 note 5\)/.test(n)));
});

test("a WaterGEMS model builds into a package with its InfraWorks fields listed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iw-water-pkg-"));
  const path = join(dir, "Qairawan.wtg.sqlite");
  makeWaterModel(path);
  const store = createFileStore(join(dir, "store"));
  const p = store.createProject("water", 32638);
  store.addUpload({ projectId: p.id, filename: "Qairawan.wtg.sqlite", kind: "hydraulic", path, size: 0, hydraulic: { utility: "Water", coverM: 1 } });
  const r = await runBuildPipeline(store, p.id);
  const staging = join(store.artifactDir, readdirSync(store.artifactDir).find((d) => d.startsWith(`pkg-${p.id}`))!);
  const manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8")) as PackageManifest;
  const shp = manifest.layers.filter((l) => l.format === "shp");
  assert.deepEqual(shp.map((l) => `${l.name}:${l.featureCount}:${l.infraWorksType}`).sort(), ["water_pipes:3:Pipelines", "water_structures:3:Pipeline Connectors"]);
  const pipes = shp.find((l) => l.name === "water_pipes")!;
  assert.deepEqual(Object.keys(pipes.fieldAttributes ?? {}).sort(), ["ELEV_FROM", "ELEV_TO", "NETWORKNAME", "PIPE_MATERIAL", "SIZE_X", "SIZE_Y"]);
  assert.equal(r.validation.ok, true);
});
