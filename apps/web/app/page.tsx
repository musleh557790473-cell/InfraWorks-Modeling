"use client";

import { useEffect, useState } from "react";
import { MappingEditor } from "./MappingEditor";
import type { Profile } from "./MappingEditor";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";

type Project = {
  id: string;
  name: string;
  status: string;
  epsg: number;
  mappingProfile?: Profile;
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
};

export default function HomePage() {
  const [name, setName] = useState("LDIP Al Narjis sample");
  const [epsg, setEpsg] = useState(32638);
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [message, setMessage] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<unknown>(null);

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((h) => {
        if (!h.ok) setMessage("API unhealthy");
      })
      .catch(() => setMessage("API not reachable — start with pnpm dev"));
  }, []);

  async function createProject() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${API}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, epsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      setProject(data);
      setJob(null);
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
        const res = await fetch(`${API}/projects/${project.id}/uploads`, {
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

  async function runBuild() {
    if (!project) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/projects/${project.id}/jobs`, { method: "POST" });
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
    const data = await fetch(`${API}/projects/${project.id}/preview`).then((r) => r.json());
    setPreview(data);
  }

  return (
    <main>
      <p className="badge">NOT FOR ISSUE · package builder</p>
      <h1 className="brand">InfraWorks Modeling</h1>
      <p className="lede">
        Turn 2D DWG and CSV/XLSX/PDF reports into an InfraWorks-ready import package
        (GeoJSON layers, overlay DWG, manifest, validation). Same flow via web, REST, and MCP.
      </p>

      <ol className="steps">
        <li>Create project (CRS EPSG:32638 / UTM84-38N)</li>
        <li>Upload the team&apos;s DWG/DXF + its CSV/XLSX report</li>
        <li>Map layers (or reuse the team&apos;s profile) → run build → download ZIP</li>
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
        <h2>2 · Upload & map</h2>
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
            onClick={loadPreview}
            type="button"
          >
            DWG preview status
          </button>
        </div>
        {preview != null && <pre>{JSON.stringify(preview, null, 2)}</pre>}
      </section>

      {project && (
        <section className="panel">
          <h2>3 · Map layers for this team</h2>
          <p className="hint">
            DWG or DXF from any team: pick that team&apos;s saved profile (or start from the default), scan the drawing,
            adjust, then save the profile so the team&apos;s next drawing maps itself.
          </p>
          <MappingEditor
            key={project.id}
            api={API}
            projectId={project.id}
            current={project.mappingProfile}
            onApplied={setMessage}
          />
        </section>
      )}

      <section className="panel">
        <h2>4 · Build package</h2>
        <div className="row">
          <button disabled={busy || !project} onClick={runBuild} type="button">
            Run build
          </button>
          {job?.status === "succeeded" && (
            <a className="btn" href={`${API}/jobs/${job.id}/package`}>
              Download ZIP
            </a>
          )}
        </div>
        {job && (
          <div>
            <p className={`status ${job.status === "succeeded" ? "ok" : job.status === "failed" ? "err" : ""}`}>
              Job {job.id}: {job.status}
              {job.validation
                ? ` · blocking ${job.validation.blockingCount} · warnings ${job.validation.warningCount}`
                : ""}
            </p>
            {job.validation && <pre>{JSON.stringify(job.validation, null, 2)}</pre>}
          </div>
        )}
      </section>

      {message && <p className="status">{message}</p>}
    </main>
  );
}
