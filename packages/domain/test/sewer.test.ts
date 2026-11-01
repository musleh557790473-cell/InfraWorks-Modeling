import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createFileStore, readHydraulicModel, runBuildPipeline } from "../src/index.js";
import type { PackageManifest } from "../src/index.js";
import { makeSewerModel } from "./sewer-model.js";

test("a SewerGEMS model: pipes and manholes in metres, deleted pipes left out, start/end and flow as drawn", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "iw-sewer-")), "Al Qairawan.stsw.sqlite");
  makeSewerModel(path);
  const net = await readHydraulicModel(path, "Al Qairawan.stsw.sqlite");
  const pipes = net.features.filter((f) => f.outputLayer === "sewer_pipes");
  const nodes = net.features.filter((f) => f.outputLayer === "sewer_manholes");
  assert.equal(pipes.length, 2, "the deleted pipe is left out");
  assert.equal(net.stats.deletedPipes, 1);
  assert.equal(nodes.length, 4);
  assert.ok(pipes.every((f) => f.infraFeatureClass === "pipeline" && f.nameAttribute === "label"));
  assert.ok(nodes.every((f) => f.infraFeatureClass === "pipe_connector"));

  const co1 = pipes.find((f) => f.attributes.label === "CO-1")!;
  assert.deepEqual((co1.geometry.coordinates as number[][]).map((p) => p.map((v) => Math.round(v * 1000) / 1000)), [[657000, 2748000], [657100, 2748000]], "feet to metres");
  assert.equal(co1.attributes.diameter_mm, 200);
  assert.equal(co1.attributes.size_m, 0.2);
  assert.equal(co1.attributes.material, "HDPE CORRUGATED");
  assert.equal(co1.attributes.inv_start_m, 683);
  assert.equal(co1.attributes.inv_end_m, 682.5);
  assert.equal(co1.attributes.slope_pct, 0.5);
  assert.equal(co1.attributes.flow, "start-to-end");
  assert.equal(co1.attributes.node_start, "MH-1");
  assert.equal(pipes.find((f) => f.attributes.label === "CO-2")!.attributes.flow, "end-to-start", "drawn against the flow");

  const mh1 = nodes.find((f) => f.attributes.label === "MH-1")!;
  assert.equal(mh1.attributes.rim_m, 685);
  assert.equal(mh1.attributes.depth_m, 2);
  assert.equal(mh1.attributes.size_m, 1.2);
  const out = nodes.find((f) => f.attributes.label === "OUT-1")!;
  assert.equal(out.attributes.kind, "Outfall");
  assert.equal(out.attributes.rim_m, null, "a rim of 0 is no level");
  assert.equal(out.attributes.depth_m, null);
  assert.ok(net.notes.some((n) => /1 node\(s\) have no usable rim level/.test(n)));
});

test("a SewerGEMS model builds a package: Pipelines and Pipeline Connectors, with the InfraWorks columns to fill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iw-sewer-"));
  const path = join(dir, "Al Qairawan.stsw.sqlite");
  makeSewerModel(path);
  const store = createFileStore(dir);
  const project = store.createProject("sewer", 32638);
  store.addUpload({ projectId: project.id, filename: "Al Qairawan.stsw.sqlite", kind: "hydraulic", path, size: 0 });
  const r = await runBuildPipeline(store, project.id);
  assert.equal(r.validation.ok, true, JSON.stringify(r.validation.issues));
  const out = dirname(r.packagePath);
  const staging = readdirSync(out).find((d) => d.startsWith(`pkg-${project.id}-`))!;
  const manifest = JSON.parse(readFileSync(join(out, staging, "manifest.json"), "utf8")) as PackageManifest;
  const pipes = manifest.layers.find((l) => l.format === "shp" && l.name === "sewer_pipes")!;
  const mh = manifest.layers.find((l) => l.format === "shp" && l.name === "sewer_manholes")!;
  assert.equal(pipes.infraWorksType, "Pipelines");
  assert.equal(mh.infraWorksType, "Pipeline Connectors");
  assert.equal(pipes.nameField, "NAME");
  assert.deepEqual(pipes.fields, { SIZE_X: "SIZE_M", SIZE_Y: "SIZE_M", PIPE_MATERIAL: "MATERIAL", UTILITY_TYPE: "UTILITY", NETWORKNAME: "NETWORK" });
  assert.equal(mh.fields?.HEIGHT, "DEPTH_M");
  assert.ok(manifest.importChecklist.some((s) => /Table tab: SIZE_X = SIZE_M, SIZE_Y = SIZE_M, PIPE_MATERIAL = MATERIAL/.test(s)), manifest.importChecklist.join("\n"));
});