import { z } from "zod";

/** InfraWorks feature classes supported in the MVP mapping profiles. */
export const InfraFeatureClass = z.enum([
  "road_centerline",
  "coverage",
  "water",
  "parcel",
  "pipeline",
  "annotation",
  "unmapped",
]);
export type InfraFeatureClass = z.infer<typeof InfraFeatureClass>;

export const GeometryType = z.enum([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
]);
export type GeometryType = z.infer<typeof GeometryType>;

export const Position = z.tuple([z.number(), z.number()]).rest(z.number());
export type Position = z.infer<typeof Position>;

export const Geometry = z.object({
  type: GeometryType,
  coordinates: z.any(),
});
export type Geometry = z.infer<typeof Geometry>;

export const FeatureProvenance = z.object({
  sourceFile: z.string(),
  sourceLayer: z.string().optional(),
  sourceEntityId: z.string().optional(),
  reportJoinKey: z.string().optional(),
});
export type FeatureProvenance = z.infer<typeof FeatureProvenance>;

export const DomainFeature = z.object({
  id: z.string(),
  infraFeatureClass: InfraFeatureClass,
  geometry: Geometry,
  attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  provenance: FeatureProvenance,
});
export type DomainFeature = z.infer<typeof DomainFeature>;

export const DomainFeatureCollection = z.object({
  type: z.literal("FeatureCollection"),
  schemaVersion: z.literal("1.0.0"),
  crs: z.object({
    epsg: z.number().int(),
    name: z.string(),
    infraWorksCrsHint: z.string().optional(),
  }),
  features: z.array(DomainFeature),
});
export type DomainFeatureCollection = z.infer<typeof DomainFeatureCollection>;

export const LayerMapping = z.object({
  /** Layer name, or a wildcard rule ("*ROAD*CL*", "V-PROP-?"). Case-insensitive; first match wins. */
  dwgLayer: z.string().min(1),
  infraFeatureClass: InfraFeatureClass,
  /** Feature attribute that receives the asset id found for this layer's entities. */
  joinKeyAttribute: z.string().optional(),
});
export type LayerMapping = z.infer<typeof LayerMapping>;

export const ReportJoin = z.object({
  reportFile: z.string(),
  joinKeyColumn: z.string(),
  featureJoinAttribute: z.string().default("asset_id"),
  /** Excel only: sheet name. Default: the first sheet. */
  sheet: z.string().optional(),
});
export type ReportJoin = z.infer<typeof ReportJoin>;

/**
 * Where a team keeps asset ids in its drawings. Teams differ, so every source is tried
 * in order: XDATA → block attribute → nearest text label.
 */
export const AssetKeyConfig = z.object({
  /** Regex an id must match, e.g. "^RD-\\d+$". Also lets ids be found in any attribute or nearby text. */
  pattern: z.string().optional(),
  /** XDATA application names to read ids from; "*" accepts any application. */
  xdataApps: z.array(z.string()).default(["INFRAWORKS"]),
  /** Block attribute tags that hold the id (matched ignoring case, spaces, "-" and "_"). */
  attributeTags: z.array(z.string()).default(["ASSET_ID", "ROAD_ID", "PARCEL_ID", "PLOT_ID", "PLOT_NO"]),
  /** Layers whose TEXT/MTEXT may label a feature (wildcards allowed). Empty = any layer, only when `pattern` is set. */
  textLayers: z.array(z.string()).default([]),
  /** Maximum distance from a label to its feature, in drawing units. */
  textMaxDistance: z.number().positive().default(10),
  /** How ids are compared with the report: exact, trimmed upper-case, or letters/digits only. */
  normalize: z.enum(["exact", "trim-upper", "alnum-upper"]).default("trim-upper"),
});
export type AssetKeyConfig = z.infer<typeof AssetKeyConfig>;

export const MappingProfile = z.object({
  id: z.string(),
  name: z.string(),
  /** Team or consultant this profile belongs to, e.g. "Parsons" or "Survey team B". */
  team: z.string().optional(),
  layers: z.array(LayerMapping),
  reportJoins: z.array(ReportJoin).default([]),
  assetKeys: AssetKeyConfig.default({}),
});
export type MappingProfile = z.infer<typeof MappingProfile>;

/** Asset-key settings with defaults filled in (profiles stored before the field existed have none). */
export function resolveAssetKeys(profile: { assetKeys?: Partial<AssetKeyConfig> }): AssetKeyConfig {
  return AssetKeyConfig.parse(profile.assetKeys ?? {});
}

export const ProjectStatus = z.enum([
  "draft",
  "mapped",
  "building",
  "ready",
  "failed",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const JobStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ValidationIssue = z.object({
  code: z.string(),
  severity: z.enum(["blocking", "warning", "info"]),
  message: z.string(),
  context: z.record(z.string()).optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationReport = z.object({
  ok: z.boolean(),
  blockingCount: z.number().int(),
  warningCount: z.number().int(),
  issues: z.array(ValidationIssue),
  generatedAt: z.string(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export const PackageManifest = z.object({
  schemaVersion: z.literal("1.0.0"),
  projectId: z.string(),
  projectName: z.string(),
  generatedAt: z.string(),
  crs: z.object({
    epsg: z.number().int(),
    name: z.string(),
    infraWorksCrsHint: z.string(),
  }),
  layers: z.array(
    z.object({
      name: z.string(),
      infraFeatureClass: InfraFeatureClass,
      format: z.enum(["geojson", "shp", "dwg_overlay"]),
      path: z.string(),
      featureCount: z.number().int(),
      /** Shapefile layers: the one geometry kind the file holds. */
      geometryKind: z.enum(["point", "line", "area"]).optional(),
      /** [minX, minY, maxX, maxY] in the package CRS. */
      extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      /** Total plan length of line features, CRS units. */
      length: z.number().optional(),
      /** InfraWorks data source type to choose when importing this file. */
      infraWorksType: z.string().optional(),
    }),
  ),
  files: z.array(z.string()),
  notForIssue: z.literal(true),
  importChecklist: z.array(z.string()),
});
export type PackageManifest = z.infer<typeof PackageManifest>;

export const CreateProjectInput = z.object({
  name: z.string().min(1),
  epsg: z.number().int().default(32638),
  /** Start from a saved team profile instead of the built-in default. */
  profileId: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const DEFAULT_EPSG = 32638;
export const DEFAULT_CRS_NAME = "WGS 84 / UTM zone 38N";
export const INFRAWORKS_CRS_HINT = "UTM84-38N";

export const DEFAULT_MAPPING_PROFILE: MappingProfile = {
  id: "ldip-default",
  name: "LDIP / Al Narjis default",
  layers: [
    { dwgLayer: "ROADS", infraFeatureClass: "road_centerline", joinKeyAttribute: "asset_id" },
    { dwgLayer: "COVERAGES", infraFeatureClass: "coverage" },
    { dwgLayer: "WATER", infraFeatureClass: "water" },
    { dwgLayer: "PARCELS", infraFeatureClass: "parcel", joinKeyAttribute: "parcel_id" },
    { dwgLayer: "ANNOTATION", infraFeatureClass: "annotation" },
  ],
  reportJoins: [
    {
      reportFile: "roads_report.csv",
      joinKeyColumn: "asset_id",
      featureJoinAttribute: "asset_id",
    },
  ],
  assetKeys: AssetKeyConfig.parse({}),
};

/**
 * Parsons road layouts for LDIP. Centrelines are RD_CL and "RD_CL External Road" on Al Narjis (sheet
 * 10001) and RD_PR_CNRL (proposed centreline) on Al Qairawan (sheet 10100); the site is "Project
 * Boundary". Road edges, curb returns, the right of way and chainage marks (RD_Edge, -RD_Edges,
 * RD_CURB_RETURN, __ROW, RD_ROW, RD_C_CHAIN_*) are not centrelines and stay unmapped for a person to decide.
 * Rules use the layers' own names, so they also match the same layers inside a bound xref.
 */
export const PARSONS_LDIP_ROADS_PROFILE: MappingProfile = {
  id: "parsons-ldip-roads",
  name: "Parsons / LDIP road layout",
  team: "Parsons",
  layers: [
    { dwgLayer: "RD_CL*", infraFeatureClass: "road_centerline" },
    { dwgLayer: "RD_PR_CNRL*", infraFeatureClass: "road_centerline" },
    { dwgLayer: "Project Boundary", infraFeatureClass: "coverage" },
  ],
  reportJoins: [],
  assetKeys: AssetKeyConfig.parse({}),
};

/** Profiles shipped with the tool: listed first, and never overwritten or deleted by a save. */
export const BUILTIN_PROFILES: MappingProfile[] = [DEFAULT_MAPPING_PROFILE, PARSONS_LDIP_ROADS_PROFILE];
