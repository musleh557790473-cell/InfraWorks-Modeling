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
};
