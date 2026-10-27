import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DomainStore, UploadedFile } from "./store.js";
import { parseDxf } from "./dwg.js";
import type { ParsedDwg } from "./dwg.js";
import { normalizeKey } from "./dwg.js";
import { ConversionError, convertDwgToDxf } from "./convert.js";
import type { ConvertOptions } from "./convert.js";
import { indexRowsByKey, readReport } from "./reports.js";
import { validateCollection } from "./validate.js";
import { buildPackageZip } from "./package.js";
import { resolveAssetKeys } from "./types.js";
import type { DomainFeatureCollection, MappingProfile, ValidationReport } from "./types.js";

export interface BuildResult {
  jobId: string;
  packagePath: string;
  validation: ValidationReport;
  collection: DomainFeatureCollection;
  manifestPathHint: string;
}

export interface CadLoad {
  upload?: UploadedFile;
  parsed: ParsedDwg;
  /** Set when a DWG could not be converted. */
  conversionError?: string;
}

const EMPTY: ParsedDwg = {
  layers: [],
  features: [],
  format: "none",
  notes: [],
  skippedEntities: {},
  paperSpaceSkipped: 0,
  keyStats: { xdata: 0, attribute: 0, text: 0, missing: 0 },
};

/** The project's latest CAD upload — a corrected drawing replaces the earlier one. */
export function latestCad(store: DomainStore, projectId: string): UploadedFile | undefined {
  return store.listUploads(projectId).filter((u) => u.kind === "dwg" || u.kind === "dxf").at(-1);
}

/**
 * DXF path for a CAD upload. DWG is converted once and cached next to the store, so
 * scanning layers and building afterwards do not convert twice.
 */
export async function dxfFor(
  store: DomainStore,
  upload: UploadedFile,
  opts?: ConvertOptions,
): Promise<{ path: string; converter?: ParsedDwg["converter"] }> {
  if (upload.kind === "dxf") return { path: upload.path };
  const dir = join(store.dataDir, "converted");
  const out = join(dir, `${upload.id}.dxf`);
  const log = join(dir, `${upload.id}.json`);
  if (existsSync(out) && existsSync(log)) {
    return { path: out, converter: JSON.parse(readFileSync(log, "utf8")) as ParsedDwg["converter"] };
  }
  const res = await convertDwgToDxf(upload.path, out, opts);
  const converter = { engine: res.engine, attempts: res.attempts };
  mkdirSync(dir, { recursive: true });
  writeFileSync(log, JSON.stringify(converter, null, 2));
  return { path: out, converter };
}

/** Read the project's CAD with a given profile (used by the build and by the layer scan). */
export async function loadCad(
  store: DomainStore,
  projectId: string,
  profile: MappingProfile,
  opts?: ConvertOptions,
): Promise<CadLoad> {
  const upload = latestCad(store, projectId);
  if (!upload) return { parsed: { ...EMPTY, notes: ["No CAD upload"] } };
  try {
    const { path, converter } = await dxfFor(store, upload, opts);
    const parsed = parseDxf(readFileSync(path, "utf8"), upload.filename, profile);
    if (converter) {
      parsed.converter = converter;
      parsed.notes.unshift(`Converted ${upload.filename} to DXF with ${converter.engine}`);
    }
    return { upload, parsed };
  } catch (err) {
    if (err instanceof ConversionError) {
      return { upload, parsed: { ...EMPTY, notes: err.attempts }, conversionError: err.message };
    }
    throw err;
  }
}

function reportFor(store: DomainStore, projectId: string, reportFile: string, joinCount: number) {
  const reports = store.listUploads(projectId).filter((u) => u.kind === "csv" || u.kind === "xlsx" || u.kind === "pdf");
  const byName = reports.filter((r) => r.filename.toLowerCase() === reportFile.toLowerCase()).at(-1);
  // Fall back to "the only report" only when one join is defined; otherwise one file
  // would silently feed every join.
  return byName ?? (joinCount === 1 && reports.length === 1 ? reports[0] : undefined);
}

export async function runBuildPipeline(
  store: DomainStore,
  projectId: string,
  jobId?: string,
  opts?: ConvertOptions,
): Promise<BuildResult> {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const job = jobId ? (store.getJob(jobId) ?? store.createJob(projectId)) : store.createJob(projectId);
  store.updateJob(job.id, { status: "running" });

  try {
    const profile = project.mappingProfile;
    const keys = resolveAssetKeys(profile);
    const norm = (v: string) => normalizeKey(v, keys.normalize);
    const cad = await loadCad(store, projectId, profile, opts);

    let reportRowCount = 0;
    let joinedCount = 0;
    const features = cad.parsed.features.map((f) => ({
      ...f,
      attributes: { ...f.attributes },
      provenance: { ...f.provenance },
    }));

    for (const join of profile.reportJoins) {
      const upload = reportFor(store, projectId, join.reportFile, profile.reportJoins.length);
      if (!upload) continue;
      const table = await readReport(upload.path, upload.kind, join.sheet);
      if (table.rows.length && !table.columns.includes(join.joinKeyColumn)) {
        throw new Error(
          `Report ${upload.filename} has no column "${join.joinKeyColumn}" — columns: ${table.columns.join(", ")}`,
        );
      }
      reportRowCount += table.rows.length;
      const index = indexRowsByKey(table.rows, join.joinKeyColumn, norm);
      const joinedKeys = new Set<string>();

      for (const feature of features) {
        const keyVal = feature.attributes[join.featureJoinAttribute];
        if (keyVal == null) continue;
        const key = norm(String(keyVal));
        const row = index.get(key);
        if (!row) continue;
        joinedKeys.add(key);
        feature.provenance.reportJoinKey = String(keyVal);
        // The report's spelling is the official id ("rd-001" found on a label becomes "RD-001").
        feature.attributes[join.featureJoinAttribute] = row[join.joinKeyColumn] ?? String(keyVal);
        for (const [k, v] of Object.entries(row)) {
          if (k === join.joinKeyColumn) continue;
          feature.attributes[k] = v;
        }
      }
      joinedCount += joinedKeys.size;
    }

    const collection: DomainFeatureCollection = {
      type: "FeatureCollection",
      schemaVersion: "1.0.0",
      crs: { epsg: project.epsg, name: project.crsName, infraWorksCrsHint: project.infraWorksCrsHint },
      features,
    };

    const validation = validateCollection(collection, profile, {
      joinedCount,
      reportRowCount,
      hasCad: Boolean(cad.upload),
      cad: cad.parsed,
      conversionError: cad.conversionError,
    });

    if (!validation.ok) {
      throw Object.assign(
        new Error(validation.issues.filter((i) => i.severity === "blocking").map((i) => i.message).join("; ")),
        { validation, collection },
      );
    }

    const { zipPath, manifest } = await buildPackageZip({
      project,
      collection,
      validation,
      outDir: store.artifactDir,
      cadSourcePath: cad.upload?.path,
      cadSourceName: cad.upload ? basename(cad.upload.filename) : undefined,
    });

    store.updateJob(job.id, { status: "succeeded", packagePath: zipPath, validation });
    store.updateProject(projectId, { status: "ready" });

    return {
      jobId: job.id,
      packagePath: zipPath,
      validation,
      collection,
      manifestPathHint: `manifest.json (${manifest.layers.length} layers)`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const validation = (err as { validation?: ValidationReport }).validation;
    store.updateJob(job.id, { status: "failed", error: message, ...(validation ? { validation } : {}) });
    store.updateProject(projectId, { status: "failed" });
    throw err;
  }
}
