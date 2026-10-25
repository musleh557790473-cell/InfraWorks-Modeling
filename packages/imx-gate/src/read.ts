import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

import { parseFgf, partLength2d } from "./fgf.js";
import type { Extent, ImxStats, RegionStat } from "./types.js";

export interface ImxHandle {
  db: Db;
  path: string;
  tables: Set<string>;
}

export function openImx(path: string, readonly = true): ImxHandle {
  const db = new Database(path, { readonly, fileMustExist: true });
  const tables = new Set<string>(
    db
      .prepare("select name from sqlite_master where type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  return { db, path, tables };
}

export function has(h: ImxHandle, table: string): boolean {
  return h.tables.has(table);
}

export function count(h: ImxHandle, table: string): number {
  if (!has(h, table)) return 0;
  const row = h.db.prepare(`select count(*) as n from "${table}"`).get() as { n: number };
  return row.n;
}

export function imxVersion(h: ImxHandle): string | null {
  if (!has(h, "IMX_VERSION")) return null;
  const row = h.db.prepare("select VERSION from IMX_VERSION limit 1").get() as
    | { VERSION: string }
    | undefined;
  return row?.VERSION ?? null;
}

export interface DeclaredCrs {
  name: string | null;
  wkt: string | null;
  centralMeridian: number | null;
  /** UTM zone derived from the central meridian, when the projection is Transverse Mercator. */
  utmZone: number | null;
  /** True for a southern-hemisphere UTM (false_northing 10 000 000), null when unknown. */
  south: boolean | null;
}

export function declaredCrs(h: ImxHandle): DeclaredCrs {
  const empty: DeclaredCrs = { name: null, wkt: null, centralMeridian: null, utmZone: null, south: null };
  if (!has(h, "spatial_ref_sys")) return empty;
  const row = h.db.prepare("select auth_name, sr_name, srtext from spatial_ref_sys limit 1").get() as
    | { auth_name: string | null; sr_name: string | null; srtext: string | null }
    | undefined;
  if (!row) return empty;
  const wkt = row.srtext ?? null;
  let cm: number | null = null;
  let south: boolean | null = null;
  if (wkt) {
    const m = /PARAMETER\s*\[\s*"central_meridian"\s*,\s*(-?[\d.]+)/i.exec(wkt);
    if (m) cm = Number(m[1]);
    const fn = /PARAMETER\s*\[\s*"false_northing"\s*,\s*(-?[\d.]+)/i.exec(wkt);
    if (fn) south = Number(fn[1]) >= 5_000_000;
  }
  const zone = cm === null ? null : Math.round((cm + 183) / 6);
  return {
    name: row.auth_name ?? row.sr_name ?? null,
    wkt,
    centralMeridian: cm,
    utmZone: zone !== null && zone >= 1 && zone <= 60 ? zone : null,
    south,
  };
}

function mergeExtent(acc: Extent | null, pts: number[][]): Extent | null {
  let out = acc;
  for (const p of pts) {
    const x = p[0]!;
    const y = p[1]!;
    const z = p.length > 2 ? p[2]! : 0;
    if (!out) {
      out = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
      continue;
    }
    if (x < out.minX) out.minX = x;
    if (x > out.maxX) out.maxX = x;
    if (y < out.minY) out.minY = y;
    if (y > out.maxY) out.maxY = y;
    if (z < out.minZ) out.minZ = z;
    if (z > out.maxZ) out.maxZ = z;
  }
  return out;
}

export interface GeometryScan {
  extent: Extent | null;
  /** Rows whose GEOMETRY blob could not be parsed. */
  unreadable: { table: string; id: number; name: string | null; reason: string }[];
  /** Rows containing a non-finite coordinate. */
  nonFinite: { table: string; id: number; name: string | null }[];
  /** Rows with a null or empty GEOMETRY blob. */
  empty: { table: string; id: number; name: string | null }[];
}

const GEOMETRY_TABLES = ["ROADS", "SURFACES", "COVERAGES", "WATER_AREAS", "PARCELS"];

export function scanGeometry(h: ImxHandle): GeometryScan {
  const out: GeometryScan = { extent: null, unreadable: [], nonFinite: [], empty: [] };
  for (const table of GEOMETRY_TABLES) {
    if (!has(h, table)) continue;
    const rows = h.db.prepare(`select ID, NAME, GEOMETRY from "${table}"`).all() as {
      ID: number;
      NAME: string | null;
      GEOMETRY: Buffer | null;
    }[];
    for (const r of rows) {
      if (!r.GEOMETRY || r.GEOMETRY.length === 0) {
        out.empty.push({ table, id: r.ID, name: r.NAME });
        continue;
      }
      try {
        const g = parseFgf(r.GEOMETRY);
        if (g.points.some((p) => p.some((v) => !Number.isFinite(v)))) {
          out.nonFinite.push({ table, id: r.ID, name: r.NAME });
        }
        if (table === "ROADS") out.extent = mergeExtent(out.extent, g.points);
      } catch (err) {
        out.unreadable.push({
          table,
          id: r.ID,
          name: r.NAME,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return out;
}

interface RegionRow {
  ID: number;
  NAME: string | null;
  GUID: string | null;
  DEFINITION_ID: string | null;
  CORRIDOR_NAME: string | null;
  BASELINE_NAME: string | null;
  START_DISTANCE_2D: number | null;
  END_DISTANCE_2D: number | null;
  JSON_ASSEMBLY_DATA: string | null;
}

export function readRegions(h: ImxHandle, maxGapM: number): RegionStat[] {
  if (!has(h, "CONSTRAINED_DEF_CORRIDOR_REGIONS")) return [];
  const regions = h.db
    .prepare(
      `select ID, NAME, GUID, DEFINITION_ID, CORRIDOR_NAME, BASELINE_NAME,
              START_DISTANCE_2D, END_DISTANCE_2D, JSON_ASSEMBLY_DATA
         from CONSTRAINED_DEF_CORRIDOR_REGIONS`,
    )
    .all() as RegionRow[];

  const sectionsByRegion = new Map<string, number[]>();
  if (has(h, "CONSTRAINED_DEF_CORRIDOR_SECTIONS")) {
    const rows = h.db
      .prepare("select REGION_ID, DISTANCE_2D from CONSTRAINED_DEF_CORRIDOR_SECTIONS")
      .all() as { REGION_ID: string | null; DISTANCE_2D: number | null }[];
    for (const r of rows) {
      if (!r.REGION_ID || r.DISTANCE_2D === null) continue;
      const list = sectionsByRegion.get(r.REGION_ID) ?? [];
      list.push(r.DISTANCE_2D);
      sectionsByRegion.set(r.REGION_ID, list);
    }
  }

  const firstSectionJson = new Map<string, string>();
  if (has(h, "CONSTRAINED_DEF_CORRIDOR_SECTIONS")) {
    const rows = h.db
      .prepare(
        `select REGION_ID, JSON_CROSS_SECTION, min(DISTANCE_2D) as d
           from CONSTRAINED_DEF_CORRIDOR_SECTIONS group by REGION_ID`,
      )
      .all() as { REGION_ID: string | null; JSON_CROSS_SECTION: string | null }[];
    for (const r of rows) {
      if (r.REGION_ID && r.JSON_CROSS_SECTION) firstSectionJson.set(r.REGION_ID, r.JSON_CROSS_SECTION);
    }
  }

  return regions.map((r) => {
    const guid = r.GUID ?? `#${r.ID}`;
    const stations = (sectionsByRegion.get(guid) ?? []).slice().sort((a, b) => a - b);
    let maxGap: number | null = stations.length > 1 ? 0 : null;
    for (let i = 1; i < stations.length; i++) {
      const g = stations[i]! - stations[i - 1]!;
      if (maxGap === null || g > maxGap) maxGap = g;
    }

    let corridorOutOfDate: boolean | null = null;
    let baselineOutOfDate: boolean | null = null;
    let alignment: string | null = null;
    if (r.JSON_ASSEMBLY_DATA) {
      try {
        const j = JSON.parse(r.JSON_ASSEMBLY_DATA) as Record<string, unknown>;
        corridorOutOfDate = typeof j.corridorOutOfDate === "boolean" ? j.corridorOutOfDate : null;
        baselineOutOfDate = typeof j.baselineOutOfDate === "boolean" ? j.baselineOutOfDate : null;
        alignment = typeof j.alignmentName === "string" ? j.alignmentName : null;
      } catch {
        /* IMX-003 reports this */
      }
    }

    let assemblyName: string | null = null;
    let subassemblyCount: number | null = null;
    const xs = firstSectionJson.get(guid);
    if (xs) {
      try {
        const j = JSON.parse(xs) as { assemblyName?: unknown; subassemblies?: unknown };
        assemblyName = typeof j.assemblyName === "string" ? j.assemblyName : null;
        subassemblyCount = Array.isArray(j.subassemblies) ? j.subassemblies.length : null;
      } catch {
        /* IMX-002 reports this */
      }
    }

    const start = r.START_DISTANCE_2D ?? 0;
    const end = r.END_DISTANCE_2D ?? 0;
    return {
      guid,
      name: r.NAME ?? `region ${r.ID}`,
      baseline: r.BASELINE_NAME ?? "(unnamed baseline)",
      corridor: r.CORRIDOR_NAME ?? "(unnamed corridor)",
      alignment,
      startStation: start,
      endStation: end,
      lengthM: end - start,
      sectionCount: stations.length,
      firstSection: stations.length ? stations[0]! : null,
      lastSection: stations.length ? stations[stations.length - 1]! : null,
      maxStationGapM: maxGap,
      corridorOutOfDate,
      baselineOutOfDate,
      assemblyName,
      subassemblyCount,
    } satisfies RegionStat;
  });
}

export function readStats(h: ImxHandle, maxGapM: number): { stats: ImxStats; geometry: GeometryScan } {
  const geometry = scanGeometry(h);
  const designRoads = has(h, "ROADS")
    ? (h.db.prepare("select count(*) as n from ROADS where DEFINITION_ID is not null").get() as { n: number }).n
    : 0;
  return {
    geometry,
    stats: {
      roads: count(h, "ROADS"),
      designRoads,
      corridorRegions: count(h, "CONSTRAINED_DEF_CORRIDOR_REGIONS"),
      corridorSections: count(h, "CONSTRAINED_DEF_CORRIDOR_SECTIONS"),
      surfaces: count(h, "SURFACES"),
      coverages: count(h, "COVERAGES"),
      regions: readRegions(h, maxGapM),
      extent: geometry.extent,
    },
  };
}

export { partLength2d };
