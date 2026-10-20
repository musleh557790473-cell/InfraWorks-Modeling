import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { JobStatus, ProjectStatus, ValidationReport, MappingProfile } from "./types.js";
import type { ProjectProfile } from "./profile.js";
import { resolveProfile } from "./profile.js";
import { resolveCrs } from "./crs.js";
import { GENERIC_PROFILE } from "./profiles/generic.js";

export interface UploadedFile {
  id: string;
  projectId: string;
  filename: string;
  kind: "dwg" | "dxf" | "csv" | "xlsx" | "pdf" | "shp" | "tif" | "other" | "reference";
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
  /** Full validation profile (replaces bare MappingProfile as source of truth). */
  projectProfile: ProjectProfile;
  /** Transitional mirror of layers/joins for older callers. */
  mappingProfile: MappingProfile;
  createdAt: string;
  updatedAt: string;
  profileFallbackWarning?: string;
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
  createProject(
    name: string,
    opts?: { epsg?: number; profileId?: string; profile?: ProjectProfile },
  ): ProjectRecord;
  getProject(id: string): ProjectRecord | undefined;
  listProjects(): ProjectRecord[];
  updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord;
  addUpload(upload: Omit<UploadedFile, "id" | "uploadedAt">): UploadedFile;
  listUploads(projectId: string): UploadedFile[];
  setProjectProfile(projectId: string, profile: ProjectProfile): ProjectRecord;
  /** @deprecated use setProjectProfile */
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

function toMapping(profile: ProjectProfile): MappingProfile {
  return {
    id: profile.id,
    name: profile.name,
    layers: profile.layers,
    reportJoins: profile.reportJoins,
  };
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

  let projects = readJson<ProjectRecord[]>(projectsPath, []).map(migrateProject);
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
    createProject(name, opts = {}) {
      const { profile, usedGenericFallback } = resolveProfile({
        profileId: opts.profileId,
        profile: opts.profile,
      });
      const epsg = opts.epsg ?? (profile.crs.epsg > 0 ? profile.crs.epsg : undefined);
      if (epsg == null || epsg <= 0) {
        throw new Error("CRS-001: epsg is required when profile has no declared CRS (no domain default)");
      }
      const crs = resolveCrs(epsg);
      const now = new Date().toISOString();
      const projectProfile: ProjectProfile = {
        ...structuredClone(profile),
        crs: {
          epsg: crs.epsg,
          name: crs.known ? crs.name : profile.crs.name !== "UNDECLARED" ? profile.crs.name : crs.name,
          infraWorksCrsHint: crs.known
            ? crs.infraWorksCrsHint
            : profile.crs.infraWorksCrsHint !== "UNDECLARED"
              ? profile.crs.infraWorksCrsHint
              : crs.infraWorksCrsHint,
          verticalDatum: profile.crs.verticalDatum,
        },
      };
      const project: ProjectRecord = {
        id: nanoid(10),
        name,
        status: "draft",
        epsg: projectProfile.crs.epsg,
        crsName: projectProfile.crs.name,
        infraWorksCrsHint: projectProfile.crs.infraWorksCrsHint,
        projectProfile,
        mappingProfile: toMapping(projectProfile),
        createdAt: now,
        updatedAt: now,
        ...(usedGenericFallback
          ? {
              profileFallbackWarning:
                "No profile supplied — fell back to profiles/generic.ts (§6.2)",
            }
          : {}),
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
      const row: UploadedFile = {
        ...upload,
        id: nanoid(10),
        uploadedAt: new Date().toISOString(),
        kind: upload.kind || detectKind(upload.filename),
      };
      uploads.push(row);
      persist();
      return row;
    },
    listUploads(projectId) {
      return uploads.filter((u) => u.projectId === projectId);
    },
    setProjectProfile(projectId, profile) {
      return this.updateProject(projectId, {
        projectProfile: profile,
        mappingProfile: toMapping(profile),
        epsg: profile.crs.epsg,
        crsName: profile.crs.name,
        infraWorksCrsHint: profile.crs.infraWorksCrsHint,
        status: "mapped",
        profileFallbackWarning: undefined,
      });
    },
    setMappingProfile(projectId, profile) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const merged: ProjectProfile = {
        ...current.projectProfile,
        id: profile.id,
        name: profile.name,
        layers: profile.layers,
        reportJoins: profile.reportJoins,
      };
      return this.setProjectProfile(projectId, merged);
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

function migrateProject(p: ProjectRecord & { projectProfile?: ProjectProfile }): ProjectRecord {
  if (p.projectProfile) return p;
  const fallback = structuredClone(GENERIC_PROFILE);
  const profile: ProjectProfile = {
    ...fallback,
    id: p.mappingProfile?.id ?? "migrated",
    name: p.mappingProfile?.name ?? p.name,
    crs: {
      epsg: p.epsg,
      name: p.crsName,
      infraWorksCrsHint: p.infraWorksCrsHint,
    },
    layers: p.mappingProfile?.layers ?? [],
    reportJoins: p.mappingProfile?.reportJoins ?? [],
  };
  return {
    ...p,
    projectProfile: profile,
    mappingProfile: toMapping(profile),
  };
}

export function listArtifactFiles(artifactDir: string): string[] {
  if (!existsSync(artifactDir)) return [];
  return [];
}

export { detectKind };
