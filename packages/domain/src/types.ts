import { z } from "zod";

/** InfraWorks feature classes supported in the MVP mapping profiles. */
export const InfraFeatureClass = z.enum([
  "road_centerline",
  "coverage",
  "water",
  "parcel",
  "pipeline",
  /** Manholes, chambers, valves: InfraWorks Pipeline Connectors (PIPE_CONNECTORS). */
  "pipe_connector",
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
  /** Package layer the feature goes into, when its mapping names one (default: its feature class). */
  outputLayer: z.string().optional(),
  /** The attribute that names the feature (road name, plot number): what InfraWorks' Name should show. */
  nameAttribute: z.string().optional(),
  /** InfraWorks column → the attribute that fills it (SIZE_X → size_m, PIPE_MATERIAL → material). */
  infraWorksFields: z.record(z.string()).optional(),
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
  /**
   * Package layer (Shapefile name) for this rule, so two rules of one class ship as separate
   * files, e.g. "road_reserve" and "blocks" both Coverage Areas. Default: the feature class.
   */
  outputLayer: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,30}$/, "lowercase letters, digits and _ only")
    .optional(),
  /**
   * Layer rules whose closed areas are cut out of this rule's areas. The road reserve is the
   * site boundary minus the blocks the right-of-way lines enclose: { dwgLayer: "Boundary",
   * subtract: ["RD_ROW"] }.
   */
  subtract: z.array(z.string().min(1)).optional(),
  /**
   * Build this rule's areas from separate lines: the faces the lines enclose, as for plots drawn
   * as single LINE segments. `closeGaps` joins line ends that stop short of another line by up to
   * that distance (drafting gaps). Only a label inside an area names it.
   */
  polygonize: z.object({ closeGaps: z.number().nonnegative().max(5).optional() }).optional(),
  /**
   * Names written as text next to the features (road names along their centreline): each label on
   * these layers names the nearest feature of this rule within maxDistance, and a feature named by
   * several labels takes the one most of them give. The text goes into `attribute`.
   */
  labels: z
    .object({
      layers: z.array(z.string().min(1)).min(1),
      attribute: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "lowercase letters, digits and _ only"),
      maxDistance: z.number().positive().default(10),
    })
    .optional(),
  /**
   * Attributes every feature of this rule carries, e.g. { utility: "Storm", network: "Storm - Al
   * Qairawan" }, as the hydraulic readers give their pipes.
   */
  attributes: z.record(z.string()).optional(),
  /**
   * InfraWorks columns this rule's attributes fill (column → attribute), as the hydraulic readers
   * set them: { SIZE_X: "size_m", SIZE_Y: "size_y_m", NETWORKNAME: "network" }. The manifest lists
   * them, the checklist names them for the Table tab, model:names fills them and G3-012 checks them.
   */
  fields: z.record(z.string()).optional(),
  /**
   * Pipe size, in mm in the drawing: diameter_mm and size_m (metres, for SIZE_X), size_y_m (a box's
   * rise, for SIZE_Y) and size_mm as written. From the layer name ("PIPE-SEWER-200mm", "Pipe Dia
   * 400", "Box 2000x1500": one or two numbers captured by `fromLayer`), or from the nearest text
   * label ("Ø160 mm") on `fromLabel.labels` within `maxDistance`, then carried along a run.
   */
  size: z
    .object({
      fromLayer: z.string().optional(),
      fromLabel: z
        .object({
          labels: z.array(z.string().min(1)).min(1),
          pattern: z.string().default(String.raw`(\d+(?:\.\d+)?)\s*mm`),
          maxDistance: z.number().positive().default(5),
        })
        .optional(),
    })
    .optional(),
  /**
   * true: expand blocks inserted on this layer even when the rule's class is "unmapped", so the
   * layers inside them can be used. false: never expand them; each insert stays one point (a cable
   * layer that also carries joint symbols, whose pieces would otherwise become bits of cable).
   */
  explode: z.boolean().optional(),
  /** Ship each feature as one point at the centre of its shape (CCTV cameras drawn as circles). */
  asPoint: z.boolean().optional(),
  /**
   * Depth from the project's documents when the drawing carries none, always with its `source`:
   * `coverM` soil over a pipe crown, `centreM` a cable's depth to its centre, `fromPipes` a node
   * reaching the deepest pipe invert within that many metres. Fills off_start_m / off_end_m (lines)
   * or depth_m / off_base_m (nodes).
   */
  depth: z
    .object({
      coverM: z.number().positive().optional(),
      centreM: z.number().positive().optional(),
      fromPipes: z.number().positive().optional(),
      source: z.string().min(1),
    })
    .optional(),
  /**
   * Where symbol inserts on this layer go when the rule itself is for lines: Al Qairawan draws the
   * street-light cable and the light poles on one layer (AAMSLCrdr), so the poles become points of
   * their own class and package layer.
   */
  symbols: z
    .object({
      infraFeatureClass: InfraFeatureClass,
      outputLayer: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/).optional(),
      attributes: z.record(z.string()).optional(),
      fields: z.record(z.string()).optional(),
    })
    .optional(),
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
      /** Shapefile layers: the .dbf field to map to Name in InfraWorks (Configure → Common). */
      nameField: z.string().optional(),
      /** The feature attribute behind nameField, as in the GeoJSON layer. */
      nameAttribute: z.string().optional(),
      /** Features in this file that carry a name. */
      namedCount: z.number().int().optional(),
      /** The GeoJSON layer holding the same features (with their names), for checks. */
      geojson: z.string().optional(),
      /** InfraWorks column → .dbf field that fills it (beyond Name), for model:names and Gate G3. */
      fields: z.record(z.string()).optional(),
      /** InfraWorks column → the feature attribute behind it, as in the GeoJSON layer. */
      fieldAttributes: z.record(z.string()).optional(),
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
 * Boundary". Road edges, curb returns and chainage marks (RD_Edge, -RD_Edges, RD_CURB_RETURN, __ROW,
 * RD_C_CHAIN_*) are not centrelines and stay unmapped for a person to decide.
 *
 * Al Qairawan also gives the areas around the roads. Its right-of-way lines (RD_ROW) close around
 * the blocks between the roads, so the closed RD_ROW areas are the blocks, and the road reserve is
 * the site boundary (Boundary, in the baseplan xref) minus those blocks. Closed asphalt areas
 * (G-ASPHALT ROAD) ship on their own; the open asphalt edges cannot form areas.
 *
 * Its baseplan draws the plots as separate lines (MP-PLT-LIN), many stopping up to ~0.5 m short of
 * the line they meet; the plots are the faces those lines enclose, numbered by the text inside
 * them (MP-PLT-TXT). On sheet 10100: 6,555 plots, 5,938 of the 5,952 numbers each alone in a plot.
 * Rules use the layers' own names, so they also match the same layers inside a bound xref.
 */
export const PARSONS_LDIP_ROADS_PROFILE: MappingProfile = {
  id: "parsons-ldip-roads",
  name: "Parsons / LDIP road layout",
  team: "Parsons",
  layers: [
    { dwgLayer: "RD_CL*", infraFeatureClass: "road_centerline" },
    // Road names (R.6.G.12) are MTEXT 2-10 m beside each centreline, usually twice per road.
    { dwgLayer: "RD_PR_CNRL*", infraFeatureClass: "road_centerline", labels: { layers: ["0-Alignment Name"], attribute: "road_name", maxDistance: 10 } },
    { dwgLayer: "Project Boundary", infraFeatureClass: "coverage" },
    { dwgLayer: "Boundary", infraFeatureClass: "coverage", outputLayer: "road_reserve", subtract: ["RD_ROW"] },
    { dwgLayer: "RD_ROW", infraFeatureClass: "coverage", outputLayer: "blocks" },
    { dwgLayer: "G-ASPHALT ROAD", infraFeatureClass: "coverage", outputLayer: "asphalt" },
    {
      dwgLayer: "MP-PLT-LIN",
      infraFeatureClass: "parcel",
      outputLayer: "plots",
      joinKeyAttribute: "parcel_id",
      polygonize: { closeGaps: 0.5 },
    },
  ],
  reportJoins: [],
  // Plot numbers (1000, 188, P-01, AP-04) are texts on MP-PLT-TXT inside each plot.
  assetKeys: AssetKeyConfig.parse({ textLayers: ["MP-PLT-TXT"], pattern: "^([A-Z]{1,2}-)?[0-9]{1,4}$" }),
};

/** The InfraWorks columns a drawing's pipes and connectors fill, as the hydraulic readers set them. */
const PIPE_COLUMNS = { SIZE_X: "size_m", SIZE_Y: "size_y_m", NETWORKNAME: "network" };
const CONNECTOR_COLUMNS = { NETWORKNAME: "network" };
/** Depth from the documents: a pipe's or cable's two end offsets, a node's depth and offset. */
const LINE_DEPTH_COLUMNS = { ELEV_FROM: "off_start_m", ELEV_TO: "off_end_m" };
const NODE_DEPTH_COLUMNS = { HEIGHT: "depth_m", ELEVATION_OFFSET: "off_base_m" };
/** Al Qairawan 30% concept design report, where the drawings give no depth. */
const AQ_REPORT = "LDIP-RCRC-SAP-01-AQ-DES-RPT-00001";
const STORM_COVER = { coverM: 1.2, source: `${AQ_REPORT} §8 minimum cover: soil above top of pipe not less than 1.2 m` };
/** Constant attributes: the utility, and the network name it leads ("Storm - Al Qairawan"). */
const net = (utility: string, conn_type?: string) => ({ utility, network: `${utility} - Al Qairawan`, ...(conn_type ? { conn_type } : {}) });

/**
 * Parsons wet utilities that only the drawings carry, from the Al Qairawan network sheets (each
 * network in its own xref). The pipes of potable water, sewer and irrigation come from their
 * hydraulic models (SewerGEMS / WaterGEMS), which are the designer's own data; the drawings add:
 * - storm drainage (STO): no hydraulic model was issued. Pipe sizes from the layer names
 *   ("…SW_Pipe Dia 400"), manholes and outfalls. The sheet rotates its xrefs 295° about a point off
 *   site; they are read at their own coordinates (XREF_READ_AT_OWN_COORDINATES).
 * - potable water valves and fire hydrants (PWT): the WaterGEMS model has none.
 * - irrigation gate and washout valves (IRR): the WaterGEMS model has its air and isolation valves only.
 * Layers with generic names (RD2) are matched with their xref prefix: RD2 is a road edge elsewhere.
 * Not read: the "QIC Storm" pipes in the sewer xref (about 160 km away, another site).
 */
export const PARSONS_LDIP_WET_PROFILE: MappingProfile = {
  id: "parsons-ldip-wet-utilities",
  name: "Parsons / LDIP wet utilities (drawings)",
  team: "Parsons",
  layers: [
    // GRP: the legend of STO-DWG-10000-001..019 ("Ø 400mm GRP PIPE" … 800 mm). No storm model was
    // issued, so depth is the report's minimum cover; its Table 8.9 lists deeper covers for some pipes.
    {
      dwgLayer: "*SW_Pipe Dia *",
      infraFeatureClass: "pipeline",
      outputLayer: "storm_pipes",
      attributes: { ...net("Storm"), material: "GRP", material_src: "STO-DWG-10000-001 legend" },
      fields: { ...PIPE_COLUMNS, PIPE_MATERIAL: "material", ...LINE_DEPTH_COLUMNS },
      size: { fromLayer: String.raw`Dia\s*(\d+)` },
      depth: STORM_COVER,
    },
    { dwgLayer: "C-SSWR-MNHL-P", infraFeatureClass: "pipe_connector", outputLayer: "storm_manholes", attributes: net("Storm", "Manhole"), fields: { ...CONNECTOR_COLUMNS, ...NODE_DEPTH_COLUMNS }, depth: { fromPipes: 2, source: STORM_COVER.source } },
    { dwgLayer: "Xref Storm Network$0$C-STRM-STRC", infraFeatureClass: "pipe_connector", outputLayer: "storm_manholes", attributes: net("Storm", "Outfall"), fields: { ...CONNECTOR_COLUMNS, ...NODE_DEPTH_COLUMNS }, depth: { fromPipes: 2, source: STORM_COVER.source } },
    { dwgLayer: "Xref Potable Water$0$RD2", infraFeatureClass: "pipe_connector", outputLayer: "water_hydrants", attributes: net("Water", "Fire Hydrant"), fields: CONNECTOR_COLUMNS },
    { dwgLayer: "C-WATR-APPT", infraFeatureClass: "pipe_connector", outputLayer: "water_valves", attributes: net("Water", "Valve"), fields: CONNECTOR_COLUMNS },
    { dwgLayer: "Motorized Gate Valve", infraFeatureClass: "pipe_connector", outputLayer: "water_valves", attributes: net("Water", "Motorized Gate Valve"), fields: CONNECTOR_COLUMNS },
    { dwgLayer: "C-PW-AIR VALVE", infraFeatureClass: "pipe_connector", outputLayer: "water_valves", attributes: net("Water", "Air Valve"), fields: CONNECTOR_COLUMNS },
    { dwgLayer: "C-PW-WASHOUT VALVE", infraFeatureClass: "pipe_connector", outputLayer: "water_valves", attributes: net("Water", "Washout Valve"), fields: CONNECTOR_COLUMNS },
    { dwgLayer: "BGV 110mm", infraFeatureClass: "pipe_connector", outputLayer: "irrigation_valves", attributes: net("Irrigation", "Gate Valve"), fields: CONNECTOR_COLUMNS },
    { dwgLayer: "IR-WASHOUT VALVE", infraFeatureClass: "pipe_connector", outputLayer: "irrigation_valves", attributes: net("Irrigation", "Washout Valve"), fields: CONNECTOR_COLUMNS },
  ],
  reportJoins: [],
  assetKeys: AssetKeyConfig.parse({}),
};

/**
 * Parsons dry utilities for LDIP, from the Al Qairawan network sheets, one per network, each with
 * its network in an xref: low voltage (ELV), medium voltage (EMV), street lighting (SLT), telecom
 * (TEL) and security (SEC). Cables and ducts ship as Pipelines; pillars, substations, panels,
 * handholes and manholes as Pipeline Connectors; street lights and CCTV cameras (drawn as circles)
 * as Points of Interest. Each xref repeats some shared layers (the street-light corridor AAMSLCrdr
 * in the LV, MV and SL xrefs; DSS substations in LV and MV; TEL_HH handholes in telecom and
 * security), so those are matched with the one xref prefix that owns them.
 * Not read: tree and corridor guides (-00-Tree_*, -06- Street Lighting), annotation and labels.
 */
const LV = "Xref_Qairawan_LV Network-final$0$";
const MV = "Xref_Qairawan_MV Network$0$";
const SL = "Xref_Qairawan_SL Network$0$";
const TEL = "Xref Primary Telecom Network$0$";
const SEC = "Xref Primary Security Network$0$";
const cable = { infraFeatureClass: "pipeline" as const, explode: false, fields: { NETWORKNAME: "network" } };
// Burial depth to the cable centre: AQ report §3.3.3 service conditions, "0.65 meter for LV and 0.80
// meter for MV". Nothing in the report or sheets gives HV, street lighting, telecom or security depths.
const buried = (centreM: number, kind: string) => ({
  fields: { ...cable.fields, ...LINE_DEPTH_COLUMNS },
  depth: { centreM, source: `${AQ_REPORT} §3.3.3 burial depth to the cable centre, ${kind}` },
});
const node = { infraFeatureClass: "pipe_connector" as const, fields: CONNECTOR_COLUMNS };
export const PARSONS_LDIP_DRY_PROFILE: MappingProfile = {
  id: "parsons-ldip-dry-utilities",
  name: "Parsons / LDIP dry utilities (drawings)",
  team: "Parsons",
  layers: [
    // Low voltage: cables (cross-section in the layer name, kept in src_layer), house connections, pillars.
    { dwgLayer: `${LV}E-POWER-CABL*`, ...cable, ...buried(0.65, "LV"), outputLayer: "lv_cables", attributes: net("Electrical LV") },
    { dwgLayer: `${LV}Electrical LV -HC`, ...cable, ...buried(0.65, "LV"), outputLayer: "lv_cables", attributes: net("Electrical LV", "House Connection") },
    { dwgLayer: `${LV}E-POWR-MINI-PILLAR-*`, ...node, outputLayer: "lv_pillars", attributes: net("Electrical LV", "Mini Pillar") },
    // Medium voltage: cables, distribution and primary substations.
    { dwgLayer: `${MV}MV Cables*`, ...cable, ...buried(0.8, "MV"), outputLayer: "mv_cables", attributes: net("Electrical MV") },
    { dwgLayer: `${MV}HV Cables`, ...cable, outputLayer: "mv_cables", attributes: net("Electrical HV") },
    { dwgLayer: `${MV}DSS`, ...node, outputLayer: "substations", attributes: net("Electrical MV", "Distribution Substation") },
    { dwgLayer: `${MV}PSS`, ...node, outputLayer: "substations", asPoint: true, attributes: net("Electrical MV", "Primary Substation") },
    // Street lighting: one layer for both, its lines are the cable, its symbols the light poles.
    {
      dwgLayer: `${SL}AAMSLCrdr`,
      ...cable,
      outputLayer: "streetlight_cables",
      attributes: net("Street Lighting"),
      symbols: { infraFeatureClass: "annotation", outputLayer: "street_lights", attributes: { conn_type: "Street Light" } },
    },
    { dwgLayer: `${SL}AAM`, infraFeatureClass: "annotation", outputLayer: "street_lights", attributes: net("Street Lighting", "Street Light") },
    { dwgLayer: `${SL}SSLPC`, ...node, outputLayer: "streetlight_panels", attributes: net("Street Lighting", "Lighting Panel") },
    // Telecom: primary ducts and feeders, handholes, manholes, towers.
    { dwgLayer: `${TEL}Primary`, ...cable, outputLayer: "telecom_ducts", attributes: net("Telecom") },
    { dwgLayer: `${TEL}Main Feeder Primary`, ...cable, outputLayer: "telecom_ducts", attributes: net("Telecom", "Main Feeder") },
    { dwgLayer: `${TEL}TEL_HH`, ...node, outputLayer: "telecom_handholes", attributes: net("Telecom", "Handhole") },
    { dwgLayer: `${TEL}Telecom MH`, ...node, outputLayer: "telecom_handholes", attributes: net("Telecom", "Manhole") },
    { dwgLayer: `${TEL}SEC_TELECOM`, ...node, outputLayer: "telecom_handholes", attributes: net("Telecom", "Telecom Tower") },
    // Security: ducts, handholes (in a nested xref), CCTV cameras (circles: their centre).
    { dwgLayer: `${SEC}Primary Security_OM`, ...cable, outputLayer: "security_ducts", attributes: net("Security") },
    { dwgLayer: `${SEC}Security_*`, ...cable, outputLayer: "security_ducts", attributes: net("Security") },
    { dwgLayer: `${SEC}*TEL_HH`, ...node, outputLayer: "security_handholes", attributes: net("Security", "Handhole") },
    { dwgLayer: `${SEC}cctv camera`, infraFeatureClass: "annotation", outputLayer: "cctv_cameras", asPoint: true, attributes: net("Security", "CCTV Camera") },
  ],
  reportJoins: [],
  assetKeys: AssetKeyConfig.parse({}),
};

/** Profiles shipped with the tool: listed first, and never overwritten or deleted by a save. */
export const BUILTIN_PROFILES: MappingProfile[] = [DEFAULT_MAPPING_PROFILE, PARSONS_LDIP_ROADS_PROFILE, PARSONS_LDIP_WET_PROFILE, PARSONS_LDIP_DRY_PROFILE];
