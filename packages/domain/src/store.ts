import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type {
  JobStatus,
  MappingProfile,
  ProjectStatus,
  ValidationReport,
} from "./types.js";
import { BUILTIN_PROFILES, DEFAULT_MAPPING_PROFILE, DEFAULT_EPSG } from "./types.js";
import { resolveCrs } from "./crs.js";

export interface UploadedFile {
  id: string;
  projectId: string;
  filename: string;
  kind: "dwg" | "dxf" | "csv" | "xlsx" | "pdf" | "shp" | "tif" | "other";
  path: string;
  size: number;
  uploadedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  status: ProjectStatus;
  epsg: number;
  crsName: string;
  infraWorksCrsHint: string;
  mappingProfile: MappingProfile;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  projectId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  packagePath?: string;
  validation?: ValidationReport;
}

export interface DomainStore {
  createProject(name: string, epsg?: number): ProjectRecord;
  getProject(id: string): ProjectRecord | undefined;
  listProjects(): ProjectRecord[];
  updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord;
  addUpload(upload: Omit<UploadedFile, "id" | "uploadedAt">): UploadedFile;
  listUploads(projectId: string): UploadedFile[];
  setMappingProfile(projectId: string, profile: MappingProfile): ProjectRecord;
  createJob(projectId: string): JobRecord;
  getJob(id: string): JobRecord | undefined;
  listJobs(projectId: string): JobRecord[];
  updateJob(id: string, patch: Partial<JobRecord>): JobRecord;
  /** Built-in default first, then the saved team profiles. */
  listProfiles(): MappingProfile[];
  getProfile(id: string): MappingProfile | undefined;
  saveProfile(profile: MappingProfile): MappingProfile;
  deleteProfile(id: string): boolean;
  dataDir: string;
  uploadDir: string;
  artifactDir: string;
}

function detectKind(filename: string): UploadedFile["kind"] {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "dwg") return "dwg";
  if (ext === "dxf") return "dxf";
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "pdf") return "pdf";
  if (ext === "shp") return "shp";
  if (ext === "tif" || ext === "tiff") return "tif";
  return "other";
}

/** Windows errors a rename gets while another program briefly holds the target open. */
const TRANSIENT_LOCK = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * renameSync that waits out a short lock. On Windows, replacing a file fails with EPERM while
 * any other process has it open without delete sharing — antivirus scanning the file just
 * written, OneDrive syncing the data folder, the search indexer, or the API/worker reading it.
 * Such locks last milliseconds to a second, so retry with backoff (about 3 s in all) before failing.
 */
export function renameWithRetry(from: string, to: string, budgetMs = 3000): void {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let waited = 0;
  for (let delay = 10; ; delay = Math.min(delay * 2, 250)) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_LOCK.has(code) || waited >= budgetMs) throw err;
      Atomics.wait(pause, 0, 0, delay); // synchronous sleep: the store API is synchronous
      waited += delay;
    }
  }
}

export function createFileStore(dataDir: string): DomainStore {
  const uploadDir = join(dataDir, "uploads");
  const artifactDir = join(dataDir, "artifacts");
  const dbDir = join(dataDir, "db");
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(dbDir, { recursive: true });

  const projectsPath = join(dbDir, "projects.json");
  const uploadsPath = join(dbDir, "uploads.json");
  const jobsPath = join(dbDir, "jobs.json");
  /** Saved mapping profiles, one per team or consultant, reusable across projects. */
  const profilesPath = join(dbDir, "profiles.json");

  const readJson = <T>(path: string, fallback: T): T => {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  };
  // Write-then-rename so the other process never reads a half-written file.
  const writeJson = (path: string, value: unknown) => {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    try {
      renameWithRetry(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  };

  let projects = readJson<ProjectRecord[]>(projectsPath, []);
  let uploads = readJson<UploadedFile[]>(uploadsPath, []);
  let jobs = readJson<JobRecord[]>(jobsPath, []);

  // API and worker are separate processes sharing these files: re-read before every
  // operation so neither works from a stale copy or overwrites the other with one.
  const load = () => {
    projects = readJson<ProjectRecord[]>(projectsPath, []);
    uploads = readJson<UploadedFile[]>(uploadsPath, []);
    jobs = readJson<JobRecord[]>(jobsPath, []);
  };

  const persist = () => {
    writeJson(projectsPath, projects);
    writeJson(uploadsPath, uploads);
    writeJson(jobsPath, jobs);
  };

  return {
    dataDir,
    uploadDir,
    artifactDir,
    createProject(name, epsg = DEFAULT_EPSG) {
      load();
      const crs = resolveCrs(epsg);
      const now = new Date().toISOString();
      const project: ProjectRecord = {
        id: nanoid(10),
        name,
        status: "draft",
        epsg: crs.epsg,
        crsName: crs.name,
        infraWorksCrsHint: crs.infraWorksCrsHint,
        mappingProfile: structuredClone(DEFAULT_MAPPING_PROFILE),
        createdAt: now,
        updatedAt: now,
      };
      projects.push(project);
      persist();
      return project;
    },
    getProject(id) {
      load();
      return projects.find((p) => p.id === id);
    },
    listProjects() {
      load();
      return [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    updateProject(id, patch) {
      load();
      const idx = projects.findIndex((p) => p.id === id);
      if (idx < 0) throw new Error(`Project not found: ${id}`);
      const current = projects[idx]!;
      const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
      projects[idx] = next;
      persist();
      return next;
    },
    addUpload(upload) {
      load();
      const record: UploadedFile = {
        ...upload,
        id: nanoid(10),
        kind: upload.kind ?? detectKind(upload.filename),
        uploadedAt: new Date().toISOString(),
      };
      uploads.push(record);
      persist();
      return record;
    },
    listUploads(projectId) {
      load();
      return uploads.filter((u) => u.projectId === projectId);
    },
    setMappingProfile(projectId, profile) {
      return this.updateProject(projectId, {
        mappingProfile: profile,
        status: "mapped",
      });
    },
    createJob(projectId) {
      load();
      const now = new Date().toISOString();
      const job: JobRecord = {
        id: nanoid(10),
        projectId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      jobs.push(job);
      // Persist first: updateProject re-reads from disk and would drop the unsaved job.
      persist();
      this.updateProject(projectId, { status: "building" });
      return job;
    },
    getJob(id) {
      load();
      return jobs.find((j) => j.id === id);
    },
    listJobs(projectId) {
      load();
      return jobs.filter((j) => j.projectId === projectId);
    },
    updateJob(id, patch) {
      load();
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx < 0) throw new Error(`Job not found: ${id}`);
      const current = jobs[idx]!;
      const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
      jobs[idx] = next;
      persist();
      return next;
    },
    listProfiles() {
      const saved = readJson<MappingProfile[]>(profilesPath, []);
      return [...BUILTIN_PROFILES, ...saved.filter((p) => !BUILTIN_PROFILES.some((b) => b.id === p.id))];
    },
    getProfile(id) {
      return this.listProfiles().find((p) => p.id === id);
    },
    saveProfile(profile) {
      if (BUILTIN_PROFILES.some((b) => b.id === profile.id)) {
        throw new Error("A built-in profile cannot be overwritten — save it under a new name");
      }
      const saved = readJson<MappingProfile[]>(profilesPath, []).filter((p) => p.id !== profile.id);
      saved.push(profile);
      writeJson(profilesPath, saved);
      return profile;
    },
    deleteProfile(id) {
      const saved = readJson<MappingProfile[]>(profilesPath, []);
      const next = saved.filter((p) => p.id !== id);
      writeJson(profilesPath, next);
      return next.length !== saved.length;
    },
  };
}

export function listArtifactFiles(artifactDir: string): string[] {
  if (!existsSync(artifactDir)) return [];
  return readdirSync(artifactDir);
}

export { detectKind };
