import {
  createWriteStream,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, basename, relative } from "node:path";
import { finished } from "node:stream/promises";
import archiver from "archiver";
import type {
  DomainFeature,
  DomainFeatureCollection,
  InfraFeatureClass,
  PackageManifest,
  ValidationReport,
} from "./types.js";
import type { ProjectProfile } from "./profile.js";
import type { ProjectRecord } from "./store.js";
import { runRules } from "./rules/registry.js";

function featuresByClass(features: DomainFeature[]) {
  const map = new Map<InfraFeatureClass, DomainFeature[]>();
  for (const f of features) {
    const list = map.get(f.infraFeatureClass) ?? [];
    list.push(f);
    map.set(f.infraFeatureClass, list);
  }
  return map;
}

export function toGeoJson(features: DomainFeature[]) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({
      type: "Feature" as const,
      id: f.id,
      geometry: f.geometry,
      properties: {
        infraFeatureClass: f.infraFeatureClass,
        ...f.attributes,
        _sourceFile: f.provenance.sourceFile,
        _sourceLayer: f.provenance.sourceLayer,
      },
    })),
  };
}

export async function buildPackageZip(opts: {
  project: ProjectRecord;
  profile: ProjectProfile;
  collection: DomainFeatureCollection;
  validation: ValidationReport;
  outDir: string;
  cadSourcePath?: string;
  cadSourceName?: string;
}): Promise<
  | { zipPath: string; manifest: PackageManifest; stagingDir: string; refused: false }
  | { zipPath?: undefined; manifest?: PackageManifest; stagingDir: string; refused: true; reason: string }
> {
  const stagingDir = join(opts.outDir, `pkg-${opts.project.id}-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(join(stagingDir, "layers"), { recursive: true });

  // PKG-004 — refuse ZIP on blocking; still write validation report alone
  if (opts.validation.blockingCount > 0) {
    writeFileSync(
      join(stagingDir, "validation_report.json"),
      JSON.stringify(opts.validation, null, 2),
    );
    return {
      stagingDir,
      refused: true,
      reason: `blockingCount=${opts.validation.blockingCount}`,
    };
  }

  // IGN-002 — refuse synthetic
  if (opts.collection.features.some((f) => f.attributes.__synthetic === true)) {
    writeFileSync(
      join(stagingDir, "validation_report.json"),
      JSON.stringify(opts.validation, null, 2),
    );
    return { stagingDir, refused: true, reason: "synthetic features present (IGN-002)" };
  }

  const generatedAt = opts.validation.generatedAt;
  const byClass = featuresByClass(opts.collection.features);
  const layerEntries: PackageManifest["layers"] = [];
  const files: string[] = [];

  for (const [infraFeatureClass, feats] of byClass) {
    if (infraFeatureClass === "unmapped") continue;
    const rel = `layers/${infraFeatureClass}.geojson`;
    writeFileSync(join(stagingDir, rel), JSON.stringify(toGeoJson(feats), null, 2));
    files.push(rel);
    layerEntries.push({
      name: infraFeatureClass,
      infraFeatureClass,
      format: "geojson",
      path: rel,
      featureCount: feats.length,
    });
  }

  const crs = {
    epsg: opts.collection.crs.epsg,
    name: opts.collection.crs.name,
    infraWorksCrsHint:
      opts.collection.crs.infraWorksCrsHint ?? opts.profile.crs.infraWorksCrsHint,
  };
  writeFileSync(join(stagingDir, "crs.json"), JSON.stringify(crs, null, 2));
  files.push("crs.json");

  writeFileSync(
    join(stagingDir, "validation_report.json"),
    JSON.stringify(opts.validation, null, 2),
  );
  files.push("validation_report.json");

  writeFileSync(
    join(stagingDir, "domain_features.json"),
    JSON.stringify(opts.collection, null, 2),
  );
  files.push("domain_features.json");

  if (opts.cadSourcePath && existsSync(opts.cadSourcePath)) {
    const overlayName = opts.cadSourceName ?? basename(opts.cadSourcePath);
    const overlayRel = `overlay/${overlayName}`;
    mkdirSync(join(stagingDir, "overlay"), { recursive: true });
    copyFileSync(opts.cadSourcePath, join(stagingDir, overlayRel));
    files.push(overlayRel);
    layerEntries.push({
      name: "dwg_overlay",
      infraFeatureClass: "annotation",
      format: "dwg_overlay",
      path: overlayRel,
      featureCount: 0,
    });
  }

  const checklist = [
    `Set model CRS to ${crs.infraWorksCrsHint} (EPSG:${crs.epsg}).`,
    "Import GeoJSON layers from layers/ as the matching InfraWorks feature classes.",
    "Place the 2D overlay DWG from overlay/ if present.",
    "Review validation_report.json — do not issue until Human Review Gate approval.",
    opts.collection.noElevationData
      ? "Package marked بلا بيانات ارتفاع / no elevation data (genuine 2D)."
      : "Confirm elevations if profile requires them.",
    "Outputs are marked NOT FOR ISSUE until approved.",
  ];

  writeFileSync(join(stagingDir, "IMPORT_CHECKLIST.txt"), checklist.join("\n") + "\n");
  files.push("IMPORT_CHECKLIST.txt");

  const manifest: PackageManifest = {
    schemaVersion: "1.0.0",
    projectId: opts.project.id,
    projectName: opts.project.name,
    generatedAt,
    crs,
    layers: layerEntries,
    files: ["manifest.json", ...files],
    notForIssue: true,
    importChecklist: checklist,
    profileId: opts.profile.id,
    profileSchemaVersion: opts.profile.schemaVersion,
    noElevationData: opts.collection.noElevationData,
  };

  // PKG rules check before zip
  const pkgCheck = runRules({
    profile: opts.profile,
    collection: opts.collection,
    packageDraft: {
      manifest: {
        notForIssue: manifest.notForIssue,
        files: manifest.files,
        generatedAt: manifest.generatedAt,
        profileId: manifest.profileId,
        profileSchemaVersion: manifest.profileSchemaVersion,
      },
      zipFiles: files,
      validationGeneratedAt: opts.validation.generatedAt,
      hasZip: false,
      blockingCount: 0,
    },
  });
  if (pkgCheck.blockingCount > 0) {
    writeFileSync(
      join(stagingDir, "validation_report.json"),
      JSON.stringify(
        {
          ...opts.validation,
          issues: [...opts.validation.issues, ...pkgCheck.issues],
          blockingCount: opts.validation.blockingCount + pkgCheck.blockingCount,
          ok: false,
        },
        null,
        2,
      ),
    );
    return {
      stagingDir,
      refused: true,
      reason: pkgCheck.issues.map((i) => i.message).join("; "),
    };
  }

  writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const zipPath = join(opts.outDir, `${opts.project.id}-infraworks-package.zip`);
  await zipDirectory(stagingDir, zipPath);

  // PKG-002 post-zip: list files actually in staging (zip mirrors staging)
  const staged = listFilesRecursive(stagingDir).map((p) => relative(stagingDir, p).replace(/\\/g, "/"));
  const post = runRules({
    profile: opts.profile,
    collection: opts.collection,
    packageDraft: {
      manifest: {
        notForIssue: true,
        files: manifest.files,
        generatedAt: manifest.generatedAt,
        profileId: manifest.profileId,
        profileSchemaVersion: manifest.profileSchemaVersion,
      },
      zipFiles: staged.filter((f) => f !== "manifest.json").concat(
        staged.includes("manifest.json") ? ["manifest.json"] : [],
      ),
      validationGeneratedAt: generatedAt,
      hasZip: true,
      blockingCount: 0,
    },
  });
  if (post.blockingCount > 0) {
    return {
      stagingDir,
      refused: true,
      reason: post.issues.map((i) => i.message).join("; "),
    };
  }

  return { zipPath, manifest, stagingDir, refused: false };
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

async function zipDirectory(sourceDir: string, zipPath: string) {
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    throw err;
  });
  archive.pipe(output);
  archive.directory(sourceDir, false);
  await archive.finalize();
  await finished(output);
}
