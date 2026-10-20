import type { ProjectProfile } from "../profile.js";

/**
 * Structural-only profile — no envelopes, counts, or cadastral tolerances.
 * Unknown projects get this (§6.2 fallback).
 * CRS epsg must still be supplied by the project at create/build time;
 * placeholder 0 is rejected by CRS-001 until overridden on the project.
 */
export const GENERIC_PROFILE: ProjectProfile = {
  schemaVersion: "1.0.0",
  id: "generic",
  name: "Generic (structural rules only)",
  crs: {
    epsg: 0,
    name: "UNDECLARED",
    infraWorksCrsHint: "UNDECLARED",
  },
  siteEnvelopes: [],
  tolerances: {},
  expectedCounts: [],
  layers: [],
  reportJoins: [],
  rules: {},
};
