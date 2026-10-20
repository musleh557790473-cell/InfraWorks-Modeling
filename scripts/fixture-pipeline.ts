/**
 * End-to-end fixture: sample DXF + roads_report.csv → InfraWorks package ZIP.
 * Uses LDIP profile explicitly (not a domain default).
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFileStore,
  runBuildPipeline,
  LDIP_PROFILE,
} from "@infraworks/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const fixtures = join(root, "fixtures");

async function main() {
  const store = createFileStore(dataDir);
  const project = store.createProject("Fixture LDIP Al Narjis", {
    epsg: LDIP_PROFILE.crs.epsg,
    profileId: LDIP_PROFILE.id,
  });
  store.setProjectProfile(project.id, LDIP_PROFILE);

  const uploadDir = join(store.uploadDir, project.id);
  mkdirSync(uploadDir, { recursive: true });

  // Prefer DXF — binary DWG fails loud per IGN-001 / §6.4
  const cadName = "sample.dxf";
  const cadDest = join(uploadDir, cadName);
  copyFileSync(join(fixtures, cadName), cadDest);
  store.addUpload({
    projectId: project.id,
    filename: cadName,
    kind: "dxf",
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
    skipped: result.validation.skipped,
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
