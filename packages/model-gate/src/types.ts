import type { ValidationIssue } from "@infraworks/domain";

export interface ModelFinding extends ValidationIssue {
  /** Stable rule id, e.g. "G3-003". Never renumber a published rule. */
  ruleId: string;
  rule: string;
}

export interface Extent2d {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One layer of the import package, as shipped. */
export interface PackageLayer {
  name: string;
  infraFeatureClass: string;
  /** File name inside the package, e.g. "road_centerline.geojson". */
  file: string;
  featureCount: number;
  extent: Extent2d | null;
  /** Total plan length of line features, in CRS units. */
  length: number;
  /** The .dbf field the checklist says to map to Name, and the names the package's features carry. */
  nameField?: string;
  names?: Set<string>;
  namedCount?: number;
  /** InfraWorks column → .dbf field (beyond Name), and how many package features carry a value for it. */
  fields?: Record<string, string>;
  fieldCounts?: Record<string, number>;
}

export interface PackageInfo {
  source: string;
  projectName: string;
  epsg: number;
  layers: PackageLayer[];
}

/** One InfraWorks data source matched (or not) to a package layer. */
export interface LayerComparison {
  layer: string;
  infraFeatureClass: string;
  expectedTable: string;
  dataSource: { id: string; name: string; targetTable: string; sourceCs: string } | null;
  packageCount: number;
  modelCount: number;
  packageLength: number;
  modelLength: number;
  centreOffset: number | null;
  /** Names (Configure → Common → Name): package features carrying one, model rows with one, and those that match. */
  names?: { field: string; package: number; model: number; matched: number };
  /** Other mapped columns: package features with a value, model rows with one. */
  fields?: Record<string, { field: string; package: number; model: number }>;
}

export interface RegionComparison {
  name: string;
  guid: string;
  /** How the IMX region was paired with the model's: InfraWorks re-issues GUIDs, so usually "name". */
  matchedBy: "guid" | "name" | null;
  imxSections: number;
  imxSpan: number;
  modelSections: number | null;
  modelSpan: number | null;
}

export interface ModelGateReport {
  ok: boolean;
  model: string;
  package: string | null;
  imx: string | null;
  schemaVersion: string | null;
  modelCrs: string | null;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  findings: ModelFinding[];
  layers: LayerComparison[];
  regions: RegionComparison[];
  generatedAt: string;
}

export interface ModelGateOptions {
  /** The import package (ZIP or unpacked folder) the model was built from. */
  packagePath?: string;
  /** The Civil 3D IMX export the model's design roads came from (enables G3-008). */
  imxPath?: string;
  /** Allowed shift between package and model positions, in metres. Default 1. */
  maxOffsetM?: number;
  /** Allowed missing road length, as a fraction. Default 0.01 (1 %). */
  maxLengthLoss?: number;
}

/** InfraWorks table each package feature class should land in. */
export const EXPECTED_TABLE: Record<string, string[]> = {
  road_centerline: ["ROADS"],
  coverage: ["COVERAGES", "LAND_AREAS"],
  water: ["WATER_AREAS", "STREAMS"],
  parcel: ["PARCELS"],
  pipeline: ["PIPELINES"],
  pipe_connector: ["PIPE_CONNECTORS"],
  annotation: ["POIS"],
};
