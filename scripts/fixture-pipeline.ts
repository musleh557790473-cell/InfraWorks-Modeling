/**
 * End-to-end fixture: sample DWG + roads_report.csv → InfraWorks package ZIP.
 * Does not require the API server — uses domain pipeline directly.
 */
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFileStore,
  runBuildPipeline,
  DEFAULT_MAPPING_PROFILE,
} from "@infraworks/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const fixtures = join(root, "fixtures");

async function main() {
  const store = createFileStore(dataDir);
  const project = store.createProject("Fixture LDIP Al Narjis", 32638);
  store.setMappingProfile(project.id, DEFAULT_MAPPING_PROFILE);

  const uploadDir = join(store.uploadDir, project.id);
  mkdirSync(uploadDir, { recursive: true });

  const cadSrc = existsSync(join(fixtures, "sample.dwg"))
    ? join(fixtures, "sample.dwg")
    : join(fixtures, "sample.dxf");
  const cadName = cadSrc.endsWith(".dxf") ? "sample.dxf" : "sample.dwg";
  const cadDest = join(uploadDir, cadName);
  copyFileSync(cadSrc, cadDest);
  store.addUpload({
    projectId: project.id,
    filename: cadName,
    kind: cadName.endsWith(".dxf") ? "dxf" : "dwg",
    path: cadDest,
    size: 0,
  });

  const csvDest = join(uploadDir, "roads_report.csv");
  copyFileSync(join(fixtures, "roads_report.csv"), csvDest);
  store.addUpload({
    projectId: project.id,
    filename: "roads_report.csv",
    kind: "csv",
    path: csvDest,
    size: 0,
  });

  const result = await runBuildPipeline(store, project.id);
  const summary = {
    projectId: project.id,
    jobId: result.jobId,
    packagePath: result.packagePath,
    validation: result.validation,
    featureCount: result.collection.features.length,
  };
  const summaryPath = join(store.artifactDir, "fixture-pipeline-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nPackage: ${result.packagePath}`);
  if (!result.validation.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
