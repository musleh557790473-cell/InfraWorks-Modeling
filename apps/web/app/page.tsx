"use client";

import { useEffect, useState } from "react";
import { DwgPreview, type PreviewPayload } from "../components/DwgPreview";

/** API base: same-origin when UI is served via :8787 proxy; absolute when on :3000. */
function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://127.0.0.1:8787";
  return window.location.port === "3000" ? "http://127.0.0.1:8787" : "";
}

type Project = {
  id: string;
  name: string;
  status: string;
  epsg: number;
  mappingProfile?: unknown;
};

type Job = {
  id: string;
  status: string;
  error?: string;
  validation?: {
    ok: boolean;
    blockingCount: number;
    warningCount: number;
    issues: Array<{ severity: string; message: string; code: string }>;
  };
  aps?: unknown;
};

export default function HomePage() {
  const [name, setName] = useState("LDIP Al Narjis sample");
  const [epsg, setEpsg] = useState(32638);
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [message, setMessage] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [apsMode, setApsMode] = useState<string>("…");

  useEffect(() => {
    const base = apiBase();
    fetch(`${base}/health`)
      .then((r) => r.json())
      .then((h) => {
        if (!h.ok) setMessage("API unhealthy");
        setApsMode(h.apsMode || (h.apsConfigured ? "live" : "mock"));
      })
      .catch(() => setMessage("API not reachable — start with pnpm dev"));

    // Resume latest project + succeeded job so Download ZIP stays visible after refresh.
    fetch(`${base}/projects`)
      .then((r) => r.json())
      .then(async (projects: Array<{ id: string; updatedAt?: string }>) => {
        if (!Array.isArray(projects) || projects.length === 0) return;
        const sorted = [...projects].sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        );
        const detail = await fetch(`${base}/projects/${sorted[0].id}`).then((r) => r.json());
        if (!detail?.id) return;
        setProject(detail);
        const jobs = Array.isArray(detail.jobs) ? detail.jobs : [];
        const succeeded = [...jobs]
          .reverse()
          .find((j: Job) => j.status === "succeeded");
        if (succeeded) {
          setJob(succeeded);
          setMessage(`Resumed ${detail.name} — package ready`);
        }
      })
      .catch(() => undefined);
  }, []);

  async function createProject() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${apiBase()}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, epsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      setProject(data);
      setJob(null);
      setPreview(null);
      setMessage(`Project ${data.id} created`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles() {
    if (!project || !files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${apiBase()}/projects/${project.id}/uploads`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setMessage(`Uploaded ${files.length} file(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyDefaultMapping() {
    if (!project) return;
    setBusy(true);
    try {
      const profile = await fetch(`${apiBase()}/mapping-profiles/default`).then((r) => r.json());
      const res = await fetch(`${apiBase()}/projects/${project.id}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mapping failed");
      setProject(data);
      setMessage("Default LDIP mapping profile applied");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBuild() {
    if (!project) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase()}/projects/${project.id}/jobs`, { method: "POST" });
      const data = await res.json();
      setJob(data);
      if (data.status === "succeeded") {
        setMessage("Build succeeded — package ready");
      } else if (data.status === "failed") {
        setMessage(data.error || "Build failed");
      } else {
        setMessage(`Job ${data.id}: ${data.status}`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    if (!project) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase()}/projects/${project.id}/preview`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data);
      setMessage(data.mocked ? "Mock DWG preview ready" : `Preview ${data.status}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <p className="badge">NOT FOR ISSUE · package builder · APS {apsMode}</p>
      <h1 className="brand">InfraWorks Modeling</h1>
      <p className="lede">
        Turn 2D DWG and CSV/XLSX/PDF reports into an InfraWorks-ready import package
        (GeoJSON layers, overlay DWG, manifest, validation). Same flow via web, REST, and MCP.
      </p>

      <ol className="steps">
        <li>Create project (CRS EPSG:32638 / UTM84-38N)</li>
        <li>Upload DWG + roads_report.csv</li>
        <li>Preview DWG (mock URN or live Model Derivative) → map → build → download ZIP</li>
      </ol>

      <section className="panel">
        <h2>1 · Project</h2>
        <div className="row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} type="text" />
          </label>
          <label>
            EPSG
            <input
              value={epsg}
              onChange={(e) => setEpsg(Number(e.target.value))}
              type="number"
            />
          </label>
          <button disabled={busy} onClick={createProject} type="button">
            Create project
          </button>
        </div>
        {project && (
          <p className="status ok">
            Active: {project.name} · {project.id} · {project.status} · EPSG:{project.epsg}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>2 · Upload, preview & map</h2>
        <div className="row">
          <label>
            Files
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              disabled={!project}
            />
          </label>
          <button disabled={busy || !project || !files?.length} onClick={uploadFiles} type="button">
            Upload
          </button>
          <button
            className="secondary"
            disabled={busy || !project}
            onClick={applyDefaultMapping}
            type="button"
          >
            Apply default mapping
          </button>
          <button
            className="secondary"
            disabled={busy || !project}
            onClick={loadPreview}
            type="button"
          >
            DWG preview
          </button>
        </div>
        <DwgPreview preview={preview} apiBase={apiBase()} />
      </section>

      <section className="panel">
        <h2>3 · Build package</h2>
        <div className="row">
          <button disabled={busy || !project} onClick={runBuild} type="button">
            Run build
          </button>
          {job?.status === "succeeded" && (
            <a
              className="btn"
              href={`${apiBase()}/jobs/${job.id}/package`}
              download={`${job.id}-infraworks-package.zip`}
            >
              Download ZIP
            </a>
          )}
        </div>
        {job?.status === "succeeded" && (
          <p className="status ok">
            Package ready — click <strong>Download ZIP</strong>, or open{" "}
            <code>{`${apiBase() || ""}/jobs/${job.id}/package`}</code> in this
            Try Live Chrome (not Windows). Also saved on Desktop as{" "}
            <code>InfraWorks-package.zip</code>.
          </p>
        )}
        {job && (
          <div>
            <p className={`status ${job.status === "succeeded" ? "ok" : job.status === "failed" ? "err" : ""}`}>
              Job {job.id}: {job.status}
              {job.validation
                ? ` · blocking ${job.validation.blockingCount} · warnings ${job.validation.warningCount}`
                : ""}
            </p>
            {job.validation && <pre>{JSON.stringify(job.validation, null, 2)}</pre>}
            {job.aps != null && <pre>{JSON.stringify(job.aps, null, 2)}</pre>}
          </div>
        )}
      </section>

      {message && <p className="status">{message}</p>}
    </main>
  );
}
