import { basename } from "node:path";
import type { DomainStore } from "./store.js";
import { parseCadInput } from "./dwg.js";
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
  aps?: {
    previewUrn?: string;
    previewStatus?: string;
    daLayers?: string[];
    daMessage?: string;
    mocked: boolean;
  };
}

/** Optional APS hooks (Model Derivative preview + Design Automation layer list). */
export interface ApsPipelineHooks {
  preparePreview?: (filePath: string, filename: string) => Promise<{
    urn?: string;
    status?: string;
    mocked: boolean;
    message?: string;
  }>;
  listLayers?: (opts: {
    filePath: string;
    filename: string;
    fallbackLayers: string[];
  }) => Promise<{ layers?: string[]; message?: string; mocked: boolean }>;
}

export async function runBuildPipeline(
  store: DomainStore,
  projectId: string,
  jobId?: string,
  apsHooks?: ApsPipelineHooks,
): Promise<BuildResult> {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const job = jobId
    ? store.getJob(jobId) ?? store.createJob(projectId)
    : store.createJob(projectId);

  store.updateJob(job.id, { status: "running" });

  try {
    const uploads = store.listUploads(projectId);
    const cad = uploads.find((u) => u.kind === "dwg" || u.kind === "dxf");
    const reports = uploads.filter((u) => u.kind === "csv" || u.kind === "xlsx" || u.kind === "pdf");

    const parsed = cad
      ? parseCadInput(cad.path, cad.filename, project.mappingProfile)
      : {
          layers: [],
          features: [],
          format: "synthetic" as const,
          notes: ["No CAD upload"],
        };

    let apsMeta: BuildResult["aps"] = { mocked: true };
    if (cad && apsHooks) {
      const fallbackLayers =
        parsed.layers.map((l) => l.name).filter(Boolean).length > 0
          ? parsed.layers.map((l) => l.name)
          : project.mappingProfile.layers.map((l) => l.dwgLayer);

      if (apsHooks.listLayers) {
        const da = await apsHooks.listLayers({
          filePath: cad.path,
          filename: cad.filename,
          fallbackLayers,
        });
        apsMeta = {
          ...apsMeta,
          daLayers: da.layers,
          daMessage: da.message,
          mocked: da.mocked,
        };
      }
      if (apsHooks.preparePreview) {
        const preview = await apsHooks.preparePreview(cad.path, cad.filename);
        apsMeta = {
          ...apsMeta,
          previewUrn: preview.urn,
          previewStatus: preview.status,
          mocked: apsMeta.mocked && preview.mocked,
        };
      }
    }

    let reportRowCount = 0;
    let joinedCount = 0;
    const features = parsed.features.map((f) => ({ ...f, attributes: { ...f.attributes } }));

    for (const join of project.mappingProfile.reportJoins) {
      const reportUpload =
        reports.find((r) => r.filename === join.reportFile) ??
        reports.find((r) => r.kind === "csv") ??
        reports[0];
      if (!reportUpload) continue;

      const rows =
        reportUpload.kind === "pdf"
          ? parsePdfReportStub(reportUpload.path)
          : parseCsvReport(reportUpload.path);
      reportRowCount += rows.length;
      const index = indexRowsByKey(rows, join.joinKeyColumn);

      for (const feature of features) {
        const keyAttr = join.featureJoinAttribute;
        const keyVal = feature.attributes[keyAttr];
        if (keyVal == null) continue;
        const row = index.get(String(keyVal));
        if (!row) continue;
        joinedCount += 1;
        feature.provenance.reportJoinKey = String(keyVal);
        for (const [k, v] of Object.entries(row)) {
          if (k === join.joinKeyColumn) continue;
          feature.attributes[k] = v;
        }
      }
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
      aps: apsMeta,
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
