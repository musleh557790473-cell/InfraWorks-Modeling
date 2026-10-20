import { z } from "zod";

/** InfraWorks feature classes supported in MVP mapping profiles. */
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

export const Position2 = z.tuple([z.number(), z.number()]);
export const Position3 = z.tuple([z.number(), z.number(), z.number()]);
export const Position = z.union([Position2, Position3]);
export type Position = z.infer<typeof Position>;

const LineStringCoords = z.array(Position).min(2);
const LinearRing = z.array(Position).min(4);
const PolygonCoords = z.array(LinearRing).min(1);

/** GEO-001: discriminated geometry — wrong-depth arrays fail at Zod boundary. */
export const PointGeometry = z.object({
  type: z.literal("Point"),
  coordinates: Position,
});
export const MultiPointGeometry = z.object({
  type: z.literal("MultiPoint"),
  coordinates: z.array(Position).min(1),
});
export const LineStringGeometry = z.object({
  type: z.literal("LineString"),
  coordinates: LineStringCoords,
});
export const MultiLineStringGeometry = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(LineStringCoords).min(1),
});
export const PolygonGeometry = z.object({
  type: z.literal("Polygon"),
  coordinates: PolygonCoords,
});
export const MultiPolygonGeometry = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(PolygonCoords).min(1),
});

export const Geometry = z.discriminatedUnion("type", [
  PointGeometry,
  MultiPointGeometry,
  LineStringGeometry,
  MultiLineStringGeometry,
  PolygonGeometry,
  MultiPolygonGeometry,
]);
export type Geometry = z.infer<typeof Geometry>;

export const GeometryType = z.enum([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
]);
export type GeometryType = z.infer<typeof GeometryType>;

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
  /** §6.5 — genuine 2D packages are allowed when marked. */
  noElevationData: z.boolean().optional(),
});
export type DomainFeatureCollection = z.infer<typeof DomainFeatureCollection>;

export const LayerMapping = z.object({
  dwgLayer: z.string(),
  infraFeatureClass: InfraFeatureClass,
  joinKeyAttribute: z.string().optional(),
});
export type LayerMapping = z.infer<typeof LayerMapping>;

export const ReportJoin = z.object({
  reportFile: z.string(),
  joinKeyColumn: z.string(),
  featureJoinAttribute: z.string().default("asset_id"),
});
export type ReportJoin = z.infer<typeof ReportJoin>;

/** @deprecated Prefer ProjectProfile — kept for transitional MappingProfile.parse API. */
export const MappingProfile = z.object({
  id: z.string(),
  name: z.string(),
  layers: z.array(LayerMapping),
  reportJoins: z.array(ReportJoin).default([]),
});
export type MappingProfile = z.infer<typeof MappingProfile>;

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
  details: z.unknown().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const SkippedRule = z.object({
  id: z.string(),
  reason: z.string(),
});
export type SkippedRule = z.infer<typeof SkippedRule>;

export const ValidationReport = z.object({
  ok: z.boolean(),
  blockingCount: z.number().int(),
  warningCount: z.number().int(),
  issues: z.array(ValidationIssue),
  skipped: z.array(SkippedRule).default([]),
  generatedAt: z.string(),
  profileId: z.string().optional(),
  profileSchemaVersion: z.string().optional(),
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
    }),
  ),
  files: z.array(z.string()),
  notForIssue: z.literal(true),
  importChecklist: z.array(z.string()),
  profileId: z.string(),
  profileSchemaVersion: z.string(),
  noElevationData: z.boolean().optional(),
});
export type PackageManifest = z.infer<typeof PackageManifest>;

export const CreateProjectInput = z.object({
  name: z.string().min(1),
  /** Required when profileId omitted — no domain default CRS. */
  epsg: z.number().int().optional(),
  profileId: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

/** CRS-002 — named UTM valid-envelope constants (traceable to rule CRS-002). */
export const CRS_002_UTM_E_MIN = 100_000;
export const CRS_002_UTM_E_MAX = 900_000;
export const CRS_002_UTM_N_MIN = 0;
export const CRS_002_UTM_N_MAX = 10_000_000;

/** GEO-005 fallback coincidence when horizontalMetres unset (traceable to GEO-005). */
export const GEO_005_DEFAULT_COINCIDENCE_METRES = 1e-6;
