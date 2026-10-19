import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type {
  JobStatus,
  MappingProfile,
  ProjectStatus,
  ValidationReport,
} from "./types.js";
import { DEFAULT_MAPPING_PROFILE, DEFAULT_EPSG } from "./types.js";
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

  const readJson = <T>(path: string, fallback: T): T => {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  };
  const writeJson = (path: string, value: unknown) => {
    writeFileSync(path, JSON.stringify(value, null, 2));
  };

  let projects = readJson<ProjectRecord[]>(projectsPath, []);
  let uploads = readJson<UploadedFile[]>(uploadsPath, []);
  let jobs = readJson<JobRecord[]>(jobsPath, []);

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
      return projects.find((p) => p.id === id);
    },
    listProjects() {
      return [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    updateProject(id, patch) {
      const idx = projects.findIndex((p) => p.id === id);
      if (idx < 0) throw new Error(`Project not found: ${id}`);
      const current = projects[idx]!;
      const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
      projects[idx] = next;
      persist();
      return next;
    },
    addUpload(upload) {
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
      return uploads.filter((u) => u.projectId === projectId);
    },
    setMappingProfile(projectId, profile) {
      return this.updateProject(projectId, {
        mappingProfile: profile,
        status: "mapped",
      });
    },
    createJob(projectId) {
      const now = new Date().toISOString();
      const job: JobRecord = {
        id: nanoid(10),
        projectId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      jobs.push(job);
      this.updateProject(projectId, { status: "building" });
      persist();
      return job;
    },
    getJob(id) {
      return jobs.find((j) => j.id === id);
    },
    listJobs(projectId) {
      return jobs.filter((j) => j.projectId === projectId);
    },
    updateJob(id, patch) {
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx < 0) throw new Error(`Job not found: ${id}`);
      const current = jobs[idx]!;
      const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
      jobs[idx] = next;
      persist();
      return next;
    },
  };
}

export function listArtifactFiles(artifactDir: string): string[] {
  if (!existsSync(artifactDir)) return [];
  return readdirSync(artifactDir);
}

export { detectKind };
