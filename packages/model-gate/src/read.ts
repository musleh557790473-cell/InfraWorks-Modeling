import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { parseFgf, partLength2d } from "@infraworks/imx-gate";

import type { Extent2d, PackageInfo, PackageLayer } from "./types.js";

/* ------------------------------------------------------------------ package */

function grow(e: Extent2d | null, x: number, y: number): Extent2d {
  if (!e) return { minX: x, minY: y, maxX: x, maxY: y };
  return { minX: Math.min(e.minX, x), minY: Math.min(e.minY, y), maxX: Math.max(e.maxX, x), maxY: Math.max(e.maxY, y) };
}

function* positions(c: unknown): Generator<number[]> {
  if (!Array.isArray(c)) return;
  if (typeof c[0] === "number") {
    yield c as number[];
    return;
  }
  for (const x of c) yield* positions(x);
}

function lineLength(pts: number[][]): number {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!);
  return t;
}

interface GeoJson {
  features: { geometry: { type: string; coordinates: unknown } }[];
}

function summarise(name: string, cls: string, file: string, gj: GeoJson): PackageLayer {
  let extent: Extent2d | null = null;
  let length = 0;
  for (const f of gj.features) {
    for (const p of positions(f.geometry.coordinates)) extent = grow(extent, p[0]!, p[1]!);
    if (f.geometry.type === "LineString") length += lineLength(f.geometry.coordinates as number[][]);
    if (f.geometry.type === "MultiLineString") for (const l of f.geometry.coordinates as number[][][]) length += lineLength(l);
  }
  return { name, infraFeatureClass: cls, file, featureCount: gj.features.length, extent, length };
}

/** Read an import package — the ZIP the builder produced, or its unpacked folder. */
export function readPackage(path: string): PackageInfo {
  if (!existsSync(path)) throw new Error(`Package not found: ${path}`);
  let read: (rel: string) => string;
  if (statSync(path).isDirectory()) {
    read = (rel) => readFileSync(join(path, rel), "utf8");
  } else {
    const zip = new AdmZip(path);
    read = (rel) => {
      const entry = zip.getEntry(rel);
      if (!entry) throw new Error(`${rel} missing from ${path}`);
      return entry.getData().toString("utf8");
    };
  }
  const manifest = JSON.parse(read("manifest.json")) as {
    projectName: string;
    crs: { epsg: number };
    layers: {
      name: string;
      infraFeatureClass: string;
      format: string;
      path: string;
      featureCount: number;
      extent?: [number, number, number, number];
      length?: number;
    }[];
  };
  // Shapefiles are what InfraWorks imports, so compare against them when the package has them.
  // Older packages (GeoJSON only) are summarised from the GeoJSON itself.
  const shp = manifest.layers.filter((l) => l.format === "shp");
  const layers: PackageLayer[] = shp.length
    ? shp.map((l) => ({
        name: l.name,
        infraFeatureClass: l.infraFeatureClass,
        file: l.path.split("/").pop()!,
        featureCount: l.featureCount,
        extent: l.extent ? { minX: l.extent[0], minY: l.extent[1], maxX: l.extent[2], maxY: l.extent[3] } : null,
        length: l.length ?? 0,
      }))
    : manifest.layers
        .filter((l) => l.format === "geojson")
        .map((l) => summarise(l.name, l.infraFeatureClass, l.path.split("/").pop()!, JSON.parse(read(l.path)) as GeoJson));
  return { source: path, projectName: manifest.projectName, epsg: manifest.crs.epsg, layers };
}

/* ------------------------------------------------------------------ model */

export interface ModelHandle {
  db: Db;
  tables: Set<string>;
}

export function openModel(path: string): ModelHandle {
  if (!existsSync(path)) throw new Error(`Model not found: ${path}`);
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const tables = new Set(
    (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((r) => r.name),
  );
  return { db, tables };
}

export interface DataSourceRow {
  ID: number;
  GUID: string;
  NAME: string | null;
  CONNECTION_STRING: string | null;
  TARGET_CLASS_NAME: string | null;
  SOURCE_CS: string | null;
  CONFIG: string | null;
}

export function dataSources(h: ModelHandle): DataSourceRow[] {
  if (!h.tables.has("DATA_SOURCES")) return [];
  return h.db
    .prepare("select ID, GUID, NAME, CONNECTION_STRING, TARGET_CLASS_NAME, SOURCE_CS, CONFIG from DATA_SOURCES")
    .all() as DataSourceRow[];
}

export function schemaVersion(h: ModelHandle): string | null {
  if (!h.tables.has("SCHEMA_VERSION")) return null;
  const r = h.db.prepare("select VERSION from SCHEMA_VERSION limit 1").get() as { VERSION: string } | undefined;
  return r?.VERSION ?? null;
}

export function modelWkt(h: ModelHandle): { name: string | null; wkt: string | null } {
  if (!h.tables.has("spatial_ref_sys")) return { name: null, wkt: null };
  const r = h.db.prepare("select sr_name, auth_name, srtext from spatial_ref_sys limit 1").get() as
    | { sr_name: string | null; auth_name: string | null; srtext: string | null }
    | undefined;
  // InfraWorks writes sr_name "Default" and keeps the real code (e.g. UTM84-38N) in auth_name
  // and in the WKT's own name, so prefer those.
  const wktName = r?.srtext ? /^\s*(?:PROJCS|GEOGCS)\s*\[\s*"([^"]+)"/i.exec(r.srtext)?.[1] : undefined;
  const name = wktName ?? (r?.sr_name && r.sr_name !== "Default" ? r.sr_name : r?.auth_name) ?? null;
  return { name, wkt: r?.srtext ?? null };
}

/** Rows a data source put into a table: count, extent and plan length (from FGF geometry). */
export function importedStats(h: ModelHandle, table: string, dataSourceGuid: string) {
  const out = { count: 0, extent: null as Extent2d | null, length: 0, unreadable: 0 };
  if (!h.tables.has(table)) return out;
  const cols = (h.db.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("DATA_SOURCE_ID") || !cols.includes("GEOMETRY")) return out;
  const rows = h.db.prepare(`select GEOMETRY from "${table}" where DATA_SOURCE_ID = ?`).iterate(dataSourceGuid) as Iterable<{
    GEOMETRY: Buffer | null;
  }>;
  for (const r of rows) {
    out.count += 1;
    if (!r.GEOMETRY?.length) continue;
    try {
      const g = parseFgf(r.GEOMETRY);
      for (const p of g.points) out.extent = grow(out.extent, p[0]!, p[1]!);
      if (g.type === "LineString" || g.type === "MultiLineString") for (const part of g.parts) out.length += partLength2d(part);
    } catch {
      out.unreadable += 1;
    }
  }
  return out;
}

/** Design-road regions and the cross-sections InfraWorks actually built for each. */
export function modelRegions(h: ModelHandle) {
  const out = new Map<string, { guid: string; name: string | null; sections: number; span: number | null }>();
  if (!h.tables.has("ALIGNMENT_REGIONS")) return out;
  for (const r of h.db.prepare("select GUID, NAME from ALIGNMENT_REGIONS").all() as { GUID: string; NAME: string | null }[]) {
    out.set(r.GUID, { guid: r.GUID, name: r.NAME, sections: 0, span: null });
  }
  if (!h.tables.has("ALIGNMENT_CROSS_SECTIONS")) return out;
  const rows = h.db
    .prepare(
      `select FK_REGION_GUID as g, count(*) as n, max(REGION_DISTANCE_2D) - min(REGION_DISTANCE_2D) as span
         from ALIGNMENT_CROSS_SECTIONS group by FK_REGION_GUID`,
    )
    .all() as { g: string | null; n: number; span: number | null }[];
  for (const r of rows) {
    if (!r.g) continue;
    const reg = out.get(r.g) ?? { guid: r.g, name: null, sections: 0, span: null };
    reg.sections = r.n;
    reg.span = r.span;
    out.set(r.g, reg);
  }
  return out;
}
