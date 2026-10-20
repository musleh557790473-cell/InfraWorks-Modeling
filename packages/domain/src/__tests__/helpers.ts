import type { DomainFeatureCollection } from "../types.js";
import type { ProjectProfile } from "../profile.js";
import { LDIP_PROFILE } from "../profiles/ldip.js";
import { GENERIC_PROFILE } from "../profiles/generic.js";

export function baseCollection(
  overrides: Partial<DomainFeatureCollection> = {},
): DomainFeatureCollection {
  return {
    type: "FeatureCollection",
    schemaVersion: "1.0.0",
    crs: {
      epsg: 32638,
      name: "WGS 84 / UTM zone 38N",
      infraWorksCrsHint: "UTM84-38N",
    },
    features: [
      {
        id: "f1",
        infraFeatureClass: "road_centerline",
        geometry: {
          type: "LineString",
          coordinates: [
            [663800, 2756700],
            [663900, 2756710],
          ],
        },
        attributes: { asset_id: "RD-001", layer: "ROADS" },
        provenance: { sourceFile: "sample.dxf", sourceLayer: "ROADS", sourceEntityId: "1" },
      },
    ],
    noElevationData: true,
    ...overrides,
  };
}

export function ldipProfile(patch: Partial<ProjectProfile> = {}): ProjectProfile {
  return { ...structuredClone(LDIP_PROFILE), ...patch };
}

export function genericProfile(patch: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    ...structuredClone(GENERIC_PROFILE),
    crs: {
      epsg: 32638,
      name: "WGS 84 / UTM zone 38N",
      infraWorksCrsHint: "UTM84-38N",
    },
    ...patch,
  };
}
