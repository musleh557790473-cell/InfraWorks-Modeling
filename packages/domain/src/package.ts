import { createWriteStream, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { finished } from "node:stream/promises";
import archiver from "archiver";
import type {
  DomainFeature,
  DomainFeatureCollection,
  InfraFeatureClass,
  PackageManifest,
  ValidationReport,
} from "./types.js";
import type { ProjectRecord } from "./store.js";

function featuresByClass(features: DomainFeature[]) {
  const map = new Map<InfraFeatureClass, DomainFeature[]>();
  for (const f of features) {
    const list = map.get(f.infraFeatureClass) ?? [];
    list.push(f);
    map.set(f.infraFeatureClass, list);
  }
  return map;
}

/** Standard GeoJSON FeatureCollection for package layers and local SVG preview. */
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
  collection: DomainFeatureCollection;
  validation: ValidationReport;
  outDir: string;
  cadSourcePath?: string;
  cadSourceName?: string;
}): Promise<{ zipPath: string; manifest: PackageManifest; stagingDir: string }> {
  const stagingDir = join(opts.outDir, `pkg-${opts.project.id}-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(join(stagingDir, "layers"), { recursive: true });

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
      opts.collection.crs.infraWorksCrsHint ?? opts.project.infraWorksCrsHint,
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
    "Import GeoJSON layers from layers/ as the matching InfraWorks feature classes (roads → Component Roads / coverages / water / parcels).",
    "Place the 2D overlay DWG from overlay/ using InfraWorks 2D DWG overlay rules if present.",
    "Review validation_report.json — do not issue until Human Review Gate approval.",
    "Outputs are marked NOT FOR ISSUE until approved.",
  ];

  writeFileSync(join(stagingDir, "IMPORT_CHECKLIST.txt"), checklist.join("\n") + "\n");
  files.push("IMPORT_CHECKLIST.txt");

  const manifest: PackageManifest = {
    schemaVersion: "1.0.0",
    projectId: opts.project.id,
    projectName: opts.project.name,
    generatedAt: new Date().toISOString(),
    crs,
    layers: layerEntries,
    files: ["manifest.json", ...files],
    notForIssue: true,
    importChecklist: checklist,
  };
  writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const zipPath = join(opts.outDir, `${opts.project.id}-infraworks-package.zip`);
  await zipDirectory(stagingDir, zipPath);
  return { zipPath, manifest, stagingDir };
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
