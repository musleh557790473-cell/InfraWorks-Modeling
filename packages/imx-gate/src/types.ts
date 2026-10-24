import type { ValidationIssue } from "@infraworks/domain";

/**
 * One gate rule result. Extends the repo-wide ValidationIssue contract with the
 * rule identity and whether the gate is able to repair it automatically.
 */
export interface ImxFinding extends ValidationIssue {
  /** Stable rule id, e.g. "IMX-002". Never renumber a published rule. */
  ruleId: string;
  /** Human title of the rule that produced this finding. */
  rule: string;
  /** True when `repair()` can fix this finding without touching geometry. */
  repairable: boolean;
  /** Set by `repair()` once the fix has been written and verified. */
  repaired?: boolean;
}

export interface ImxGateReport {
  ok: boolean;
  file: string;
  fileBytes: number;
  imxVersion: string | null;
  declaredCrs: string | null;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  repairedCount: number;
  repairedFile?: string;
  findings: ImxFinding[];
  stats: ImxStats;
  generatedAt: string;
}

export interface ImxStats {
  roads: number;
  designRoads: number;
  corridorRegions: number;
  corridorSections: number;
  surfaces: number;
  coverages: number;
  /** Per corridor region: declared span vs the sections actually present. */
  regions: RegionStat[];
  /** Bounding box of every road geometry in the file, source units. */
  extent: Extent | null;
}

export interface RegionStat {
  guid: string;
  name: string;
  baseline: string;
  corridor: string;
  alignment: string | null;
  startStation: number;
  endStation: number;
  lengthM: number;
  sectionCount: number;
  firstSection: number | null;
  lastSection: number | null;
  maxStationGapM: number | null;
  corridorOutOfDate: boolean | null;
  baselineOutOfDate: boolean | null;
  assemblyName: string | null;
  subassemblyCount: number | null;
}

export interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface GateOptions {
  /** Expected projected CRS, e.g. 32636 or 32638. Enables the zone plausibility rule. */
  epsg?: number;
  /** Station spacing above this (metres) raises IMX-006. */
  maxStationGapM?: number;
  /** Write a repaired copy. Default false (report only). */
  repair?: boolean;
  /** Explicit output path for the repaired copy. Default `<name>_FIXED.imx`. */
  out?: string;
}

export const DEFAULT_MAX_STATION_GAP_M = 15;
