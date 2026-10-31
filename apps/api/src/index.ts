import { serve } from "@hono/node-server";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  CreateProjectInput,
  MappingProfile,
  createFileStore,
  resolveDataDir,
  detectKind,
  runBuildPipeline,
  scanProjectCad,
  scanProjectReports,
  DEFAULT_MAPPING_PROFILE,
} from "@infraworks/domain";
import { createApsClientFromEnv } from "@infraworks/aps-client";

const dataDir = resolveDataDir();
const store = createFileStore(dataDir);
const aps = createApsClientFromEnv();
const port = Number(process.env.API_PORT || 8787);

function safeFilename(name: string | undefined): string {
  const base = basename(String(name ?? "").replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return base || "upload.bin";
}

const app = new OpenAPIHono();
app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    localMode: process.env.LOCAL_MODE !== "0",
    apsConfigured: aps.isConfigured,
  }),
);

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
  let project = store.createProject(body.name, body.epsg);
  if (body.profileId) {
    const profile = store.getProfile(body.profileId);
    if (profile) project = store.setMappingProfile(project.id, profile);
  }
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
  // Never trust the client filename as a path: "../../x" would write outside the project.
  const filename = safeFilename(file.name);
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
  const parsed = MappingProfile.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid mapping profile", issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;
  const project = store.setMappingProfile(projectId, body);
  return c.json(project);
});

app.get("/mapping-profiles/default", (c) => c.json(DEFAULT_MAPPING_PROFILE));

/* ---- Team mapping profiles: one per team or consultant, reused across projects ---- */

app.get("/mapping-profiles", (c) => c.json(store.listProfiles()));

app.get("/mapping-profiles/:id", (c) => {
  const p = store.getProfile(c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "Not found" }, 404);
});

app.post("/mapping-profiles", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (raw && !raw.id && typeof raw.name === "string") {
    raw.id = raw.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || `profile-${Date.now()}`;
  }
  const parsed = MappingProfile.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid mapping profile", issues: parsed.error.issues }, 400);
  try {
    return c.json(store.saveProfile(parsed.data), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.delete("/mapping-profiles/:id", (c) =>
  store.deleteProfile(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404),
);

/**
 * Layers of the project's latest drawing, as a profile would map them. Body (optional):
 * a profile to preview, or {"profileId": "..."}; default is the project's own profile.
 * A DWG is converted here (once — the DXF is cached for the build).
 */
app.post("/projects/:id/scan-layers", async (c) => {
  const project = store.getProject(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  let profile = project.mappingProfile;
  if (body?.profileId) {
    const p = store.getProfile(String(body.profileId));
    if (!p) return c.json({ error: `Profile not found: ${body.profileId}` }, 404);
    profile = p;
  } else if (body?.layers) {
    const parsed = MappingProfile.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid mapping profile", issues: parsed.error.issues }, 400);
    profile = parsed.data;
  }
  try {
    return c.json(await scanProjectCad(store, project.id, profile));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});

/** Columns and sheets of each uploaded report, for choosing the join column. */
app.get("/projects/:id/reports", async (c) => {
  const project = store.getProject(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  return c.json(await scanProjectReports(store, project.id));
});

app.post("/projects/:id/jobs", async (c) => {
  const projectId = c.req.param("id");
  if (!store.getProject(projectId)) return c.json({ error: "Not found" }, 404);
  const job = store.createJob(projectId);

  // In LOCAL_MODE run inline; worker also polls for queued jobs
  if (process.env.LOCAL_MODE !== "0") {
    try {
      const result = await runBuildPipeline(store, projectId, job.id);
      return c.json(store.getJob(result.jobId), 201);
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
  if (!job.packagePath || !existsSync(job.packagePath)) {
    return c.json({ error: "Package not ready" }, 404);
  }
  const buf = readFileSync(job.packagePath);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${basename(job.packagePath)}"`,
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

app.get("/projects/:id/preview", async (c) => {
  const projectId = c.req.param("id");
  const uploads = store.listUploads(projectId);
  const cad = uploads.find((u) => u.kind === "dwg" || u.kind === "dxf");
  if (!cad) return c.json({ error: "No CAD upload" }, 404);
  const preview = await aps.translateForPreview(cad.filename);
  return c.json(preview);
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

app.get("/", (c) =>
  c.json({
    name: "InfraWorks Modeling API",
    openapi: "/openapi.json",
    health: "/health",
  }),
);

console.log(`API listening on http://127.0.0.1:${port}`);
serve({ fetch: app.fetch, port });
