/**
 * Build an InfraWorks package from one drawing, from the command line:
 *   pnpm package:build <drawing.dxf|dwg | model.stsw.sqlite> [--profile <id>] [--name <project>] [--epsg <code>]
 * A SewerGEMS / WaterGEMS model database (<model>.stsw.sqlite / <model>.wtg.sqlite) gives the network's
 * pipes and structures. For a hydraulic model:
 *   --utility <Water|Irrigation|Sewer>  layer prefix and network name (default: Sewer / Water)
 *   --cover <m> --cover-source "<doc>"   WaterGEMS has no inverts: cover over the crown, and where it comes from
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
// Several drawings combine into one package (one sheet per utility network: cadMode "all").
const sources = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const src = sources[0];
if (!src) {
  console.error("usage: pnpm package:build <drawing.dxf|dwg | model.stsw.sqlite> [more drawings…] [--profile <id>] [--name <project>] [--epsg <code>]");
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
const drawings = sources.filter((x) => !/\.(stsw|wtg)\.sqlite$/i.test(x));
if (drawings.length > 1) store.updateProject(project.id, { cadMode: "all" });
const dir = join(store.uploadDir, project.id);
mkdirSync(dir, { recursive: true });
// A hydraulic model's utility and pipe cover (WaterGEMS has no inverts), from the command line.
const cover = flag("--cover");
if (cover !== undefined && !(Number(cover) >= 0)) {
  console.error(`--cover expects metres, got "${cover}"`);
  process.exit(2);
}
const hydraulicOptions =
  flag("--utility") || cover !== undefined
    ? {
        ...(flag("--utility") ? { utility: flag("--utility")! } : {}),
        ...(cover !== undefined ? { coverM: Number(cover), coverSource: flag("--cover-source") ?? "given on the command line" } : {}),
      }
    : undefined;
for (const one of sources) {
  const dest = join(dir, basename(one));
  copyFileSync(resolve(one), dest);
  const kind = /\.(stsw|wtg)\.sqlite$/i.test(one) ? "hydraulic" : extname(one).toLowerCase() === ".dwg" ? "dwg" : "dxf";
  const hydraulic = kind === "hydraulic" ? hydraulicOptions : undefined;
  store.addUpload({ projectId: project.id, filename: basename(one), kind, path: dest, size: 0, ...(hydraulic ? { hydraulic } : {}) });
}

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
