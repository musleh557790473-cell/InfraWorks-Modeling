import { nanoid } from "nanoid";
import type { ProjectProfile } from "./profile.js";
import type { DomainFeature, DomainFeatureCollection } from "./types.js";

/**
 * Demo-only geometry generator. Reachable from scripts/ and DEMO_MODE=1 —
 * never from the upload parse path (IGN-001 / IGN-002).
 */
export function generateDemoCollection(profile: ProjectProfile): DomainFeatureCollection {
  const originE = 663_900;
  const originN = 2_756_900;
  const features: DomainFeature[] = [];

  profile.layers.forEach((mapping, idx) => {
    const y = originN + idx * 40;
    let geometry: DomainFeature["geometry"];
    if (mapping.infraFeatureClass === "coverage" || mapping.infraFeatureClass === "parcel") {
      geometry = {
        type: "Polygon",
        coordinates: [
          [
            [originE, y] as [number, number],
            [originE + 80, y] as [number, number],
            [originE + 80, y + 25] as [number, number],
            [originE, y + 25] as [number, number],
            [originE, y] as [number, number],
          ],
        ],
      };
    } else if (mapping.infraFeatureClass === "annotation") {
      geometry = { type: "Point", coordinates: [originE + 40, y + 10] };
    } else {
      geometry = {
        type: "LineString",
        coordinates: [
          [originE, y],
          [originE + 120, y + 2],
          [originE + 200, y],
        ],
      };
    }

    features.push({
      id: nanoid(8),
      infraFeatureClass: mapping.infraFeatureClass,
      geometry,
      attributes: {
        layer: mapping.dwgLayer,
        __synthetic: true,
        ...(mapping.joinKeyAttribute
          ? { [mapping.joinKeyAttribute]: `DEMO-${idx + 1}` }
          : {}),
      },
      provenance: {
        sourceFile: "demo://generateDemoCollection",
        sourceLayer: mapping.dwgLayer,
        sourceEntityId: `demo-${idx}`,
      },
    });
  });

  return {
    type: "FeatureCollection",
    schemaVersion: "1.0.0",
    crs: {
      epsg: profile.crs.epsg,
      name: profile.crs.name,
      infraWorksCrsHint: profile.crs.infraWorksCrsHint,
    },
    features,
    noElevationData: true,
  };
}

export function isDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === "1" || env.DEMO_MODE === "true";
}
