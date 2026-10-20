import { serve } from "@hono/node-server";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, isAbsolute, resolve } from "node:path";
import {
  CreateProjectInput,
  MappingProfile,
  createFileStore,
  detectKind,
  runBuildPipeline,
  DEFAULT_MAPPING_PROFILE,
} from "@infraworks/domain";
import { createApsClientFromEnv } from "@infraworks/aps-client";
import { createApsPipelineHooks } from "./aps-hooks.js";
import { isApiPath, proxyToNext, WEB_ORIGIN } from "./web-proxy.js";
import { buildLocalPreview } from "./local-preview.js";
import {
  defaultPreviewMode,
  reportApsMode,
  resolvePreviewMode,
  type PreviewMode,
} from "./preview-mode.js";

const dataDir = process.env.DATA_DIR || join(process.cwd(), "../../data");
const store = createFileStore(dataDir);
const aps = createApsClientFromEnv();
const apsHooks = createApsPipelineHooks(aps);
const port = Number(process.env.API_PORT || 8787);

function modeFromRequest(
  c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } },
  bodyMode?: string | null,
): PreviewMode {
  return resolvePreviewMode({
    query: c.req.query("previewMode") ?? c.req.query("mode"),
    header: c.req.header("x-preview-mode") ?? c.req.header("X-Preview-Mode"),
    body: bodyMode,
  });
}

const app = new OpenAPIHono();
// CORS only on API JSON routes — do not wrap proxied Next HTML/assets
app.use("/health", cors());
app.use("/aps/*", cors());
app.use("/projects/*", cors());
app.use("/projects", cors());
app.use("/jobs/*", cors());
app.use("/mapping-profiles/*", cors());
app.use("/openapi.json", cors());
app.use("/api", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    localMode: process.env.LOCAL_MODE !== "0",
    apsConfigured: aps.isConfigured,
    /** Product APS status: off (local free / no keys) · mock (auto, no keys) · live */
    apsMode: reportApsMode(aps.isConfigured),
    /** Default preview path when client omits previewMode */
    previewMode: defaultPreviewMode(),
    bucketKey: aps.isConfigured ? aps.bucketKey : null,
    badge: defaultPreviewMode() === "local" ? "FREE · local" : aps.isConfigured ? "APS · live" : "APS · needs keys",
  }),
);

/** Viewer token (viewables:read). Local free mode skips APS — returns 400. */
app.get("/aps/token", async (c) => {
  const mode = modeFromRequest(c);
  if (mode === "local") {
    return c.json(
      {
        error: "Local free mode — APS token not used. Switch previewMode=aps for live Viewer.",
        previewMode: "local",
        mocked: false,
      },
      400,
    );
  }
  if (!aps.isConfigured) {
    return c.json(
      {
        error: "APS credentials missing — set APS_CLIENT_ID and APS_CLIENT_SECRET for live mode.",
        previewMode: "aps",
        mocked: false,
      },
      401,
    );
  }
  const token = await aps.getViewerToken();
  return c.json({
    access_token: token.access_token,
    expires_in: token.expires_in,
    token_type: token.token_type,
    mocked: token.mocked,
    previewMode: "aps",
  });
});

const createProjectRoute = createRoute({
  method: "post",
  path: "/projects",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateProjectInput,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: z.any() } },
    },
  },
});

app.openapi(createProjectRoute, async (c) => {
  const body = c.req.valid("json");
  const project = store.createProject(body.name, body.epsg);
  return c.json(project, 201);
});

app.get("/projects", (c) => c.json(store.listProjects()));

app.get("/projects/:id", (c) => {
  const project = store.getProject(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  return c.json({
    ...project,
    uploads: store.listUploads(project.id),
    jobs: store.listJobs(project.id),
  });
});

app.post("/projects/:id/uploads", async (c) => {
  const projectId = c.req.param("id");
  const project = store.getProject(projectId);
  if (!project) return c.json({ error: "Not found" }, 404);

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "file required" }, 400);
  }

  const projectUploadDir = join(store.uploadDir, projectId);
  mkdirSync(projectUploadDir, { recursive: true });
  const filename = file.name || "upload.bin";
  const dest = join(projectUploadDir, filename);
  const ab = await file.arrayBuffer();
  writeFileSync(dest, Buffer.from(ab));

  const upload = store.addUpload({
    projectId,
    filename,
    kind: detectKind(filename),
    path: dest,
    size: ab.byteLength,
  });
  return c.json(upload, 201);
});

app.put("/projects/:id/mapping", async (c) => {
  const projectId = c.req.param("id");
  if (!store.getProject(projectId)) return c.json({ error: "Not found" }, 404);
  const body = MappingProfile.parse(await c.req.json());
  const project = store.setMappingProfile(projectId, body);
  return c.json(project);
});

app.get("/mapping-profiles/default", (c) => c.json(DEFAULT_MAPPING_PROFILE));

app.post("/projects/:id/jobs", async (c) => {
  const projectId = c.req.param("id");
  if (!store.getProject(projectId)) return c.json({ error: "Not found" }, 404);
  const job = store.createJob(projectId);

  let bodyMode: string | null = null;
  const ct = c.req.header("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const body = (await c.req.json()) as { previewMode?: string };
      if (body?.previewMode) bodyMode = String(body.previewMode);
    } catch {
      /* empty / invalid body */
    }
  }
  const mode = modeFromRequest(c, bodyMode);
  if (mode === "aps" && !aps.isConfigured) {
    return c.json(
      {
        error:
          "APS live selected but credentials are missing. Set APS_CLIENT_ID and APS_CLIENT_SECRET, or use Local free.",
        previewMode: "aps",
      },
      401,
    );
  }
  // Local free: package build unchanged but never call APS hooks
  const hooks = mode === "aps" ? apsHooks : undefined;

  // In LOCAL_MODE run inline; worker also polls queued jobs
  if (process.env.LOCAL_MODE !== "0") {
    try {
      const result = await runBuildPipeline(store, projectId, job.id, hooks);
      const record = store.getJob(result.jobId);
      return c.json(
        {
          ...record,
          previewMode: mode,
          aps:
            mode === "local"
              ? { mocked: false, skipped: true, message: "Local free — APS skipped" }
              : result.aps,
        },
        201,
      );
    } catch {
      return c.json(store.getJob(job.id), 201);
    }
  }
  return c.json(job, 201);
});

app.get("/jobs/:id", (c) => {
  const job = store.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  return c.json(job);
});

app.get("/jobs/:id/validation", (c) => {
  const job = store.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  if (!job.validation) return c.json({ error: "No validation yet" }, 404);
  return c.json(job.validation);
});

app.get("/jobs/:id/package", (c) => {
  const job = store.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  if (!job.packagePath) {
    return c.json({ error: "Package not ready" }, 404);
  }
  // Resolve relative paths against API cwd and common monorepo locations
  const candidates = [
    job.packagePath,
    isAbsolute(job.packagePath) ? job.packagePath : resolve(process.cwd(), job.packagePath),
    resolve(process.cwd(), "../../data/artifacts", basename(job.packagePath)),
    resolve(process.cwd(), "data/artifacts", basename(job.packagePath)),
    join(store.artifactDir, basename(job.packagePath)),
  ];
  const filePath = candidates.find((p) => p && existsSync(p));
  if (!filePath) {
    return c.json(
      { error: "Package file missing on disk", packagePath: job.packagePath },
      404,
    );
  }
  const buf = readFileSync(filePath);
  const filename = basename(filePath);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.get("/jobs/:id/package-url", (c) => {
  const job = store.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  if (job.status !== "succeeded") {
    return c.json({ error: "Package not ready", status: job.status }, 409);
  }
  return c.json({
    url: `/jobs/${job.id}/package`,
    absoluteHint: `http://127.0.0.1:${port}/jobs/${job.id}/package`,
  });
});

/**
 * DWG/DXF preview.
 * - previewMode=local (default): local parse → GeoJSON for 2D map (never calls APS)
 * - previewMode=aps: OSS + Model Derivative + Viewer URN (requires credentials)
 */
app.get("/projects/:id/preview", async (c) => {
  const projectId = c.req.param("id");
  const project = store.getProject(projectId);
  if (!project) return c.json({ error: "Not found" }, 404);
  const uploads = store.listUploads(projectId);
  const cad = uploads.find((u) => u.kind === "dwg" || u.kind === "dxf");
  if (!cad) return c.json({ error: "No CAD upload" }, 404);

  const mode = modeFromRequest(c);

  if (mode === "local") {
    try {
      const preview = buildLocalPreview({
        cad,
        profile: project.mappingProfile,
        epsg: project.epsg,
      });
      return c.json(preview);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, status: "failed", previewMode: "local" }, 502);
    }
  }

  if (!aps.isConfigured) {
    return c.json(
      {
        error:
          "APS live selected but credentials are missing. Set APS_CLIENT_ID and APS_CLIENT_SECRET, or switch to Local free.",
        status: "failed",
        previewMode: "aps",
        mocked: false,
      },
      401,
    );
  }

  try {
    const preview = await aps.prepareDwgPreview(cad.path, cad.filename);
    return c.json({ ...preview, previewMode: "aps", apsCalled: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, status: "failed", previewMode: "aps", mocked: false }, 502);
  }
});

app.get("/projects/:id/layers-da", async (c) => {
  const projectId = c.req.param("id");
  const project = store.getProject(projectId);
  if (!project) return c.json({ error: "Not found" }, 404);
  const uploads = store.listUploads(projectId);
  const cad = uploads.find((u) => u.kind === "dwg" || u.kind === "dxf");
  if (!cad) return c.json({ error: "No CAD upload" }, 404);

  const mode = modeFromRequest(c);
  const fallback = project.mappingProfile.layers.map((l) => l.dwgLayer);

  if (mode === "local") {
    const local = buildLocalPreview({
      cad,
      profile: project.mappingProfile,
      epsg: project.epsg,
    });
    const layers =
      local.layers.map((l) => l.name).filter(Boolean).length > 0
        ? local.layers.map((l) => l.name)
        : fallback;
    return c.json({
      status: "succeeded",
      layers,
      mocked: false,
      previewMode: "local",
      apsCalled: false,
      message: "Local free layer list from CAD parse — APS skipped",
    });
  }

  if (!aps.isConfigured) {
    return c.json(
      {
        error: "APS credentials missing for Design Automation. Use Local free or set APS_* keys.",
        previewMode: "aps",
        mocked: false,
      },
      401,
    );
  }

  let inputObjectId: string | undefined;
  try {
    const uploaded = await aps.uploadObject(cad.path);
    inputObjectId = uploaded.objectId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `OSS upload failed: ${message}`, previewMode: "aps" }, 502);
  }
  const result = await aps.listDwgLayersViaDesignAutomation({
    inputObjectId,
    fallbackLayers: fallback,
  });
  return c.json({ ...result, previewMode: "aps", apsCalled: true });
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "InfraWorks Modeling API",
    version: "0.1.0",
    description:
      "Build InfraWorks-ready import packages from 2D DWG + reports (not a hosted InfraWorks model).",
  },
});

/** Machine-readable API index (UI lives at `/` via Next proxy). */
app.get("/api", (c) =>
  c.json({
    name: "InfraWorks Modeling API",
    openapi: "/openapi.json",
    health: "/health",
    apsToken: "/aps/token",
    ui: "/",
    webOrigin: WEB_ORIGIN,
  }),
);

/**
 * Proxy non-API routes to Next.js so the web UI is reachable on :8787
 * (same port as /health — works in Try Live when :3000 is awkward).
 */
app.all("*", async (c) => {
  if (isApiPath(c.req.path)) {
    return c.json({ error: "Not found" }, 404);
  }
  return proxyToNext(c);
});

const hostname = process.env.API_HOST || "0.0.0.0";
console.log(
  `API+UI on http://${hostname}:${port} (preview=${defaultPreviewMode()} apsMode=${reportApsMode(aps.isConfigured)}; UI ← ${WEB_ORIGIN})`,
);
serve({ fetch: app.fetch, port, hostname });
