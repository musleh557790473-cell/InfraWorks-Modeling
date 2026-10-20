import type { ProjectProfile } from "../profile.js";

/**
 * LDIP / Tawazun example fixture profile.
 * Values from AICC JV survey control register (VALIDATION-RULES §2.3).
 * §6.3: sliverRatio omitted until a cited standard exists.
 */
export const LDIP_PROFILE: ProjectProfile = {
  schemaVersion: "1.0.0",
  id: "ldip-tawazun",
  name: "LDIP / Tawazun — example profile",
  crs: {
    epsg: 32638,
    name: "WGS 84 / UTM zone 38N",
    infraWorksCrsHint: "UTM84-38N",
    verticalDatum: "Riyadh Amanah Datum / MSL",
  },
  siteEnvelopes: [
    {
      id: "nrjs",
      name: "Al Narjis",
      minE: 663_700,
      maxE: 664_200,
      minN: 2_756_600,
      maxN: 2_757_300,
      minZ: 640,
      maxZ: 700,
      source: "AICC JV survey control — Al Narjis",
    },
    {
      id: "nmar",
      name: "Dahiyat Namar",
      minE: 655_000,
      maxE: 658_500,
      minN: 2_712_000,
      maxN: 2_715_000,
      minZ: 660,
      maxZ: 790,
      source: "AICC JV survey control — Dahiyat Namar",
    },
  ],
  tolerances: {
    horizontalMetres: 0.02,
    boundaryBufferMetres: 25,
    translationDetectMetres: 0.5,
    translationSpreadMetres: 0.05,
    // sliverRatio intentionally omitted — §6.3
  },
  expectedCounts: [
    {
      datasetId: "nrjs-plots",
      infraFeatureClass: "parcel",
      expected: 117,
      source: "DLUS.csv — Al Narjis",
    },
    {
      datasetId: "nmar-plots",
      infraFeatureClass: "parcel",
      expected: 765,
      source: "DLUS.csv — Dahiyat Namar",
    },
  ],
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
  rules: {},
};

/** Alias for older fixture id. */
export const LDIP_EPSG = LDIP_PROFILE.crs.epsg;
export const LDIP_CRS_NAME = LDIP_PROFILE.crs.name;
export const LDIP_INFRAWORKS_CRS_HINT = LDIP_PROFILE.crs.infraWorksCrsHint;
