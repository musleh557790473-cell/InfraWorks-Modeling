import { basename } from "node:path";
import type { DomainStore } from "./store.js";
import { parseCadInput } from "./dwg.js";
import { indexRowsByKey, parseCsvReport, parsePdfReportStub } from "./reports.js";
import { validateCollection } from "./validate.js";
import { buildPackageZip } from "./package.js";
import type { DomainFeatureCollection, ValidationReport } from "./types.js";
import { ParseError } from "./parse-error.js";
import type { ReferenceDataset } from "./rules/types.js";

export interface BuildResult {
  jobId: string;
  packagePath?: string;
  validation: ValidationReport;
  collection: DomainFeatureCollection;
  manifestPathHint: string;
  refused?: boolean;
  aps?: {
    previewUrn?: string;
    previewStatus?: string;
    daLayers?: string[];
    daMessage?: string;
    mocked: boolean;
  };
}

export interface ApsPipelineHooks {
  preparePreview?: (
    filePath: string,
    filename: string,
  ) => Promise<{
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
  opts?: { reference?: ReferenceDataset },
): Promise<BuildResult> {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const job = jobId
    ? (store.getJob(jobId) ?? store.createJob(projectId))
    : store.createJob(projectId);

  store.updateJob(job.id, { status: "running" });
  const profile = project.projectProfile;

  try {
    const uploads = store.listUploads(projectId);
    const cad = uploads.find((u) => u.kind === "dwg" || u.kind === "dxf");
    const reports = uploads.filter(
      (u) => u.kind === "csv" || u.kind === "xlsx" || u.kind === "pdf",
    );

    if (!cad) {
      const empty: DomainFeatureCollection = {
        type: "FeatureCollection",
        schemaVersion: "1.0.0",
        crs: {
          epsg: profile.crs.epsg,
          name: profile.crs.name,
          infraWorksCrsHint: profile.crs.infraWorksCrsHint,
        },
        features: [],
        noElevationData: true,
      };
      const validation = validateCollection(empty, profile, {
        parseMeta: {
          entityCountsByType: {},
          layerCounts: {},
          parserPath: "dxf",
          sourceFile: undefined,
        },
      });
      // Ensure CAD missing surfaces as blocking via IGN-001 empty features
      store.updateJob(job.id, {
        status: "failed",
        validation,
        error: "No DWG/DXF upload found for this project",
      });
      store.updateProject(projectId, { status: "failed" });
      await buildPackageZip({
        project,
        profile,
        collection: empty,
        validation,
        outDir: store.artifactDir,
      });
      throw Object.assign(new Error("No DWG/DXF upload found for this project"), {
        validation,
        collection: empty,
      });
    }

    let parsed;
    try {
      parsed = parseCadInput(cad.path, cad.filename, profile);
    } catch (err) {
      if (err instanceof ParseError) {
        store.updateJob(job.id, { status: "failed", error: `${err.code}: ${err.message}` });
        store.updateProject(projectId, { status: "failed" });
      }
      throw err;
    }

    let apsMeta: BuildResult["aps"] = { mocked: true };
    if (apsHooks) {
      const fallbackLayers =
        parsed.layers.map((l) => l.name).filter(Boolean).length > 0
          ? parsed.layers.map((l) => l.name)
          : profile.layers.map((l) => l.dwgLayer);

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
    const features = parsed.features.map((f) => ({
      ...f,
      attributes: { ...f.attributes },
    }));

    for (const join of profile.reportJoins) {
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

    const hasZ = parsed.parseMeta.hasAnyZ === true;
    const collection: DomainFeatureCollection = {
      type: "FeatureCollection",
      schemaVersion: "1.0.0",
      crs: {
        epsg: profile.crs.epsg,
        name: profile.crs.name,
        infraWorksCrsHint: profile.crs.infraWorksCrsHint,
      },
      features,
      // §6.5 — genuine 2D marked explicitly
      noElevationData: !hasZ,
    };

    const validation = validateCollection(collection, profile, {
      parseMeta: parsed.parseMeta,
      joinStats: { joinedCount, reportRowCount },
      reference: opts?.reference,
    });

    if (project.profileFallbackWarning) {
      validation.issues.push({
        code: "PROFILE_FALLBACK",
        severity: "warning",
        message: project.profileFallbackWarning,
      });
      validation.warningCount += 1;
    }

    const built = await buildPackageZip({
      project,
      profile,
      collection,
      validation,
      outDir: store.artifactDir,
      cadSourcePath: cad.path,
      cadSourceName: basename(cad.filename),
    });

    if (built.refused || !validation.ok) {
      store.updateJob(job.id, {
        status: "failed",
        validation,
        error:
          built.refused
            ? `Package refused: ${built.reason}`
            : `Validation failed with ${validation.blockingCount} blocking issue(s)`,
      });
      store.updateProject(projectId, { status: "failed" });
      const refuseReason = built.refused ? built.reason : "";
      throw Object.assign(
        new Error(
          validation.issues
            .filter((i) => i.severity === "blocking")
            .map((i) => i.message)
            .join("; ") || refuseReason,
        ),
        { validation, collection },
      );
    }

    store.updateJob(job.id, {
      status: "succeeded",
      packagePath: built.zipPath,
      validation,
    });
    store.updateProject(projectId, { status: "ready" });

    return {
      jobId: job.id,
      packagePath: built.zipPath,
      validation,
      collection,
      manifestPathHint: `manifest.json (${built.manifest.layers.length} layers)`,
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
