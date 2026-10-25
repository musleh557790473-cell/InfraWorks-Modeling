import { basename } from "node:path";
import type { DomainStore } from "./store.js";
import { parseCadInput } from "./dwg.js";
import type { ParsedDwg } from "./dwg.js";
import { indexRowsByKey, parseCsvReport, parsePdfReportStub } from "./reports.js";
import { validateCollection } from "./validate.js";
import { buildPackageZip } from "./package.js";
import type { DomainFeatureCollection, ValidationReport } from "./types.js";

export interface BuildResult {
  jobId: string;
  packagePath: string;
  validation: ValidationReport;
  collection: DomainFeatureCollection;
  manifestPathHint: string;
}

export async function runBuildPipeline(
  store: DomainStore,
  projectId: string,
  jobId?: string,
): Promise<BuildResult> {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const job = jobId
    ? store.getJob(jobId) ?? store.createJob(projectId)
    : store.createJob(projectId);

  store.updateJob(job.id, { status: "running" });

  try {
    const uploads = store.listUploads(projectId);
    // Latest upload wins, so a corrected drawing replaces the earlier one.
    const cad = uploads.filter((u) => u.kind === "dwg" || u.kind === "dxf").at(-1);
    const reports = uploads.filter((u) => u.kind === "csv" || u.kind === "xlsx" || u.kind === "pdf");

    const parsed: ParsedDwg = cad
      ? parseCadInput(cad.path, cad.filename, project.mappingProfile)
      : {
          layers: [],
          features: [],
          format: "synthetic",
          notes: ["No CAD upload"],
          skippedEntities: {},
        };

    let reportRowCount = 0;
    let joinedCount = 0;
    const features = parsed.features.map((f) => ({
      ...f,
      attributes: { ...f.attributes },
      provenance: { ...f.provenance },
    }));
    const joins = project.mappingProfile.reportJoins;

    for (const join of joins) {
      const byName = reports
        .filter((r) => r.filename.toLowerCase() === join.reportFile.toLowerCase())
        .at(-1);
      // Fall back to "the only report" only when there is a single join to feed;
      // otherwise one file would silently feed every join.
      const reportUpload = byName ?? (joins.length === 1 && reports.length === 1 ? reports[0] : undefined);
      if (!reportUpload) continue;
      if (reportUpload.kind === "xlsx") {
        throw new Error(`XLSX reports are not supported yet (${reportUpload.filename}) — export it as CSV`);
      }

      const rows =
        reportUpload.kind === "pdf"
          ? parsePdfReportStub(reportUpload.path)
          : parseCsvReport(reportUpload.path);
      reportRowCount += rows.length;
      const index = indexRowsByKey(rows, join.joinKeyColumn);
      const joinedKeys = new Set<string>();

      for (const feature of features) {
        const keyAttr = join.featureJoinAttribute;
        const keyVal = feature.attributes[keyAttr];
        if (keyVal == null) continue;
        const row = index.get(String(keyVal));
        if (!row) continue;
        joinedKeys.add(String(keyVal));
        feature.provenance.reportJoinKey = String(keyVal);
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
      crs: {
        epsg: project.epsg,
        name: project.crsName,
        infraWorksCrsHint: project.infraWorksCrsHint,
      },
      features,
    };

    const validation = validateCollection(collection, project.mappingProfile, {
      joinedCount,
      reportRowCount,
      hasCad: Boolean(cad),
      cad: parsed,
    });

    if (!validation.ok) {
      store.updateJob(job.id, {
        status: "failed",
        validation,
        error: `Validation failed with ${validation.blockingCount} blocking issue(s)`,
      });
      store.updateProject(projectId, { status: "failed" });
      // Still emit package for inspection when only partial failures? MVP: fail closed.
      // But docs say "download ZIP with validation_report.json and zero blocking issues"
      // For fixture success we need zero blocking — keep fail closed.
      throw Object.assign(new Error(validation.issues.filter(i => i.severity === "blocking").map(i => i.message).join("; ")), {
        validation,
        collection,
      });
    }

    const { zipPath, manifest } = await buildPackageZip({
      project,
      collection,
      validation,
      outDir: store.artifactDir,
      cadSourcePath: cad?.path,
      cadSourceName: cad ? basename(cad.filename) : undefined,
    });

    store.updateJob(job.id, {
      status: "succeeded",
      packagePath: zipPath,
      validation,
    });
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
    store.updateJob(job.id, {
      status: "failed",
      error: message,
      ...(validation ? { validation } : {}),
    });
    store.updateProject(projectId, { status: "failed" });
    throw err;
  }
}
