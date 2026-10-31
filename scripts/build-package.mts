/**
 * Build an InfraWorks package from one drawing, from the command line:
 *   pnpm package:build <drawing.dxf|dwg> [--profile <id>] [--name <project>] [--epsg <code>]
 * Uses the data folder from DATA_DIR (.env), so the package lands where both machines see it.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_PROFILES, createFileStore, resolveDataDir, runBuildPipeline } from "@infraworks/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const src = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!src) {
  console.error("usage: pnpm package:build <drawing.dxf|dwg> [--profile <id>] [--name <project>] [--epsg <code>]");
  console.error(`profiles: ${BUILTIN_PROFILES.map((p) => p.id).join(", ")}`);
  process.exit(2);
}
const profileId = flag("--profile") ?? "parsons-ldip-roads";
const profile = BUILTIN_PROFILES.find((p) => p.id === profileId);
if (!profile) {
  console.error(`unknown profile "${profileId}"; built-in: ${BUILTIN_PROFILES.map((p) => p.id).join(", ")}`);
  process.exit(2);
}

const dataDir = resolveDataDir(root);
const store = createFileStore(dataDir);
const project = store.createProject(flag("--name") ?? basename(src, extname(src)), Number(flag("--epsg") ?? 32638));
store.setMappingProfile(project.id, profile);
const dir = join(store.uploadDir, project.id);
mkdirSync(dir, { recursive: true });
const dest = join(dir, basename(src));
copyFileSync(resolve(src), dest);
const kind = extname(src).toLowerCase() === ".dwg" ? "dwg" : "dxf";
store.addUpload({ projectId: project.id, filename: basename(src), kind, path: dest, size: 0 });

try {
  const r = await runBuildPipeline(store, project.id);
  console.log(`Data folder  ${dataDir}`);
  console.log(`Package      ${r.packagePath}`);
  for (const i of r.validation.issues) console.log(`[${i.severity}] ${i.code}: ${i.message}`);
  console.log(r.validation.ok ? "OK" : "BLOCKED");
} catch (err) {
  const v = (err as { validation?: { issues: { severity: string; code: string; message: string }[] } }).validation;
  if (!v) throw err;
  for (const i of v.issues) console.log(`[${i.severity}] ${i.code}: ${i.message}`);
  console.log("BLOCKED");
  process.exitCode = 1;
}
