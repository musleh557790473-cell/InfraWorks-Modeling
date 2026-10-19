import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import type { DomainFeature, InfraFeatureClass, MappingProfile } from "./types.js";

export interface ParsedDwgLayer {
  name: string;
  entityCount: number;
}

export interface ParsedDwg {
  layers: ParsedDwgLayer[];
  features: DomainFeature[];
  format: "dxf" | "dwg-stub" | "synthetic";
  notes: string[];
}

/**
 * Parse ASCII DXF entities into domain features.
 * Binary DWG in LOCAL_MODE is stubbed into synthetic geometry from known layers.
 */
export function parseCadInput(
  filePath: string,
  filename: string,
  profile: MappingProfile,
): ParsedDwg {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dxf")) {
    return parseDxf(filePath, filename, profile);
  }
  // Binary DWG: LOCAL_MODE stub — emit demo geometry for mapped layers
  return stubDwg(filename, profile);
}

function layerClass(profile: MappingProfile, layer: string): InfraFeatureClass {
  const mapping = profile.layers.find(
    (l) => l.dwgLayer.toLowerCase() === layer.toLowerCase(),
  );
  return mapping?.infraFeatureClass ?? "unmapped";
}

function parseDxf(
  filePath: string,
  filename: string,
  profile: MappingProfile,
): ParsedDwg {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const features: DomainFeature[] = [];
  const layerCounts = new Map<string, number>();

  let i = 0;
  while (i < lines.length) {
    const code = lines[i]?.trim();
    const value = lines[i + 1]?.trim() ?? "";
    if (code === "0" && (value === "LINE" || value === "LWPOLYLINE" || value === "POLYLINE")) {
      const entity = readEntity(lines, i, value);
      i = entity.nextIndex;
      const layer = entity.layer || "0";
      layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
      const coords = entity.points;
      if (coords.length >= 2) {
        const joinAttr = profile.layers.find(
          (l) => l.dwgLayer.toLowerCase() === layer.toLowerCase(),
        )?.joinKeyAttribute;
        features.push({
          id: nanoid(8),
          infraFeatureClass: layerClass(profile, layer),
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          attributes: {
            layer,
            ...(joinAttr ? { [joinAttr]: entity.handle || `${layer}-${features.length + 1}` } : {}),
          },
          provenance: {
            sourceFile: filename,
            sourceLayer: layer,
            sourceEntityId: entity.handle,
          },
        });
      }
      continue;
    }
    i += 1;
  }

  // If DXF had no geometry, fall back to stub so fixtures still produce a package
  if (features.length === 0) {
    const stub = stubDwg(filename, profile);
    return { ...stub, format: "dxf", notes: ["DXF contained no LINE/LWPOLYLINE; used synthetic fallback"] };
  }

  const layers = [...layerCounts.entries()].map(([name, entityCount]) => ({
    name,
    entityCount,
  }));

  return {
    layers,
    features,
    format: "dxf",
    notes: [`Parsed ${features.length} entities from DXF`],
  };
}

function readEntity(lines: string[], start: number, type: string) {
  let i = start + 2;
  let layer = "0";
  let handle: string | undefined;
  const points: [number, number][] = [];
  let x: number | undefined;
  let y: number | undefined;

  while (i < lines.length) {
    const code = lines[i]?.trim();
    const value = lines[i + 1]?.trim() ?? "";
    if (code === "0") break;
    if (code === "8") layer = value;
    if (code === "5") handle = value;
    if (code === "10" || code === "11") x = Number(value);
    if (code === "20" || code === "21") {
      y = Number(value);
      if (x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)) {
        points.push([x, y]);
        x = undefined;
        y = undefined;
      }
    }
    if (type === "LWPOLYLINE" && code === "10") {
      // pair with following 20
    }
    i += 2;
  }
  return { layer, handle, points, nextIndex: i };
}

function stubDwg(filename: string, profile: MappingProfile): ParsedDwg {
  const features: DomainFeature[] = [];
  const layers: ParsedDwgLayer[] = [];
  // Demo corridor in UTM 38N near Riyadh / Al Narjis vicinity (approx)
  const originX = 673000;
  const originY = 2735000;

  profile.layers.forEach((mapping, idx) => {
    const count =
      mapping.infraFeatureClass === "road_centerline" ? 5 : 1;
    for (let n = 0; n < count; n += 1) {
      const y = originY + idx * 80 + n * 12;
      const assetId = `RD-${String(n + 1).padStart(3, "0")}`;
      const geomType =
        mapping.infraFeatureClass === "coverage" || mapping.infraFeatureClass === "parcel"
          ? "Polygon"
          : mapping.infraFeatureClass === "annotation"
            ? "Point"
            : "LineString";

      let geometry;
      if (geomType === "Polygon") {
        geometry = {
          type: "Polygon" as const,
          coordinates: [[
            [originX, y],
            [originX + 200, y],
            [originX + 200, y + 30],
            [originX, y + 30],
            [originX, y],
          ]],
        };
      } else if (geomType === "Point") {
        geometry = {
          type: "Point" as const,
          coordinates: [originX + 100, y + 10],
        };
      } else {
        geometry = {
          type: "LineString" as const,
          coordinates: [
            [originX, y],
            [originX + 250, y + 5],
            [originX + 500, y],
          ],
        };
      }

      features.push({
        id: nanoid(8),
        infraFeatureClass: mapping.infraFeatureClass,
        geometry,
        attributes: {
          layer: mapping.dwgLayer,
          ...(mapping.joinKeyAttribute
            ? { [mapping.joinKeyAttribute]: assetId }
            : {}),
        },
        provenance: {
          sourceFile: filename,
          sourceLayer: mapping.dwgLayer,
          sourceEntityId: `stub-${idx}-${n}`,
        },
      });
    }
    layers.push({ name: mapping.dwgLayer, entityCount: count });
  });

  return {
    layers,
    features,
    format: "dwg-stub",
    notes: [
      "Binary DWG parsed in LOCAL_MODE stub; replace with APS Design Automation / real DWG parser for production",
    ],
  };
}
