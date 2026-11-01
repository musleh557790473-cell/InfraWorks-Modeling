import { createWriteStream, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { finished } from "node:stream/promises";
import archiver from "archiver";
import type {
  DomainFeature,
  DomainFeatureCollection,
  InfraFeatureClass,
  PackageManifest,
  ValidationReport,
} from "./types.js";
import type { ProjectRecord } from "./store.js";
import { esriWkt, writeShapefile } from "./shapefile.js";
import { dropDegenerateRings } from "./areas.js";
import type { ShapeKind, ShpFeature } from "./shapefile.js";

/** Package layers: one per mapping output layer, which defaults to the feature class. */
function featuresByLayer(features: DomainFeature[]) {
  const map = new Map<string, { cls: InfraFeatureClass; features: DomainFeature[] }>();
  for (const f of features) {
    if (f.infraFeatureClass === "unmapped") continue;
    const key = f.outputLayer ?? f.infraFeatureClass;
    const entry = map.get(key) ?? { cls: f.infraFeatureClass, features: [] };
    entry.features.push(f);
    map.set(key, entry);
  }
  return map;
}

/** Classes InfraWorks only builds from closed areas: open lines on them are not shipped. */
const AREA_ONLY: InfraFeatureClass[] = ["coverage", "parcel"];

/**
 * Coordinates stay in the project CRS (e.g. UTM metres), which RFC 7946 GeoJSON does not
 * allow by default. The legacy `crs` member tells GDAL/OGR-based readers — InfraWorks
 * among them — what the numbers are, instead of reading them as WGS 84 degrees.
 */
function toGeoJson(features: DomainFeature[], epsg: number) {
  return {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${epsg}` } },
    features: features.map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: f.geometry,
      properties: {
        infraFeatureClass: f.infraFeatureClass,
        ...f.attributes,
        _sourceFile: f.provenance.sourceFile,
        _sourceLayer: f.provenance.sourceLayer,
      },
    })),
  };
}

export async function buildPackageZip(opts: {
  project: ProjectRecord;
  collection: DomainFeatureCollection;
  validation: ValidationReport;
  outDir: string;
  cadSourcePath?: string;
  cadSourceName?: string;
}): Promise<{ zipPath: string; manifest: PackageManifest; stagingDir: string }> {
  const stagingDir = join(opts.outDir, `pkg-${opts.project.id}-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(join(stagingDir, "layers"), { recursive: true });

  const byLayer = featuresByLayer(opts.collection.features);
  const layerEntries: PackageManifest["layers"] = [];
  const files: string[] = [];

  for (const [name, { cls: infraFeatureClass, features: feats }] of byLayer) {
    const rel = `layers/${name}.geojson`;
    writeFileSync(join(stagingDir, rel), JSON.stringify(toGeoJson(feats, opts.collection.crs.epsg), null, 2));
    files.push(rel);
    layerEntries.push({
      name,
      infraFeatureClass,
      format: "geojson",
      path: rel,
      featureCount: feats.length,
    });
  }

  // Shapefiles: what InfraWorks actually imports (it has no GeoJSON reader).
  const shp = writeShapefileLayers(stagingDir, byLayer, opts.collection.crs.epsg);
  files.push(...shp.files);
  layerEntries.push(...shp.layers);

  const crs = {
    epsg: opts.collection.crs.epsg,
    name: opts.collection.crs.name,
    infraWorksCrsHint:
      opts.collection.crs.infraWorksCrsHint ?? opts.project.infraWorksCrsHint,
  };
  writeFileSync(join(stagingDir, "crs.json"), JSON.stringify(crs, null, 2));
  files.push("crs.json");

  writeFileSync(
    join(stagingDir, "validation_report.json"),
    JSON.stringify(opts.validation, null, 2),
  );
  files.push("validation_report.json");

  writeFileSync(
    join(stagingDir, "domain_features.json"),
    JSON.stringify(opts.collection, null, 2),
  );
  files.push("domain_features.json");

  if (opts.cadSourcePath && existsSync(opts.cadSourcePath)) {
    const overlayName = opts.cadSourceName ?? basename(opts.cadSourcePath);
    const overlayRel = `overlay/${overlayName}`;
    mkdirSync(join(stagingDir, "overlay"), { recursive: true });
    copyFileSync(opts.cadSourcePath, join(stagingDir, overlayRel));
    files.push(overlayRel);
    layerEntries.push({
      name: "dwg_overlay",
      infraFeatureClass: "annotation",
      format: "dwg_overlay",
      path: overlayRel,
      featureCount: 0,
    });
  }

  const checklist = importChecklist(crs, shp.layers, Boolean(opts.cadSourcePath && existsSync(opts.cadSourcePath)));

  writeFileSync(join(stagingDir, "IMPORT_CHECKLIST.txt"), checklist.join("\n") + "\n");
  files.push("IMPORT_CHECKLIST.txt");

  const manifest: PackageManifest = {
    schemaVersion: "1.0.0",
    projectId: opts.project.id,
    projectName: opts.project.name,
    generatedAt: new Date().toISOString(),
    crs,
    layers: layerEntries,
    files: ["manifest.json", ...files],
    notForIssue: true,
    importChecklist: checklist,
  };
  writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const zipPath = join(opts.outDir, `${opts.project.id}-infraworks-package.zip`);
  await zipDirectory(stagingDir, zipPath);
  return { zipPath, manifest, stagingDir };
}

/* ------------------------------------------------------------------ Shapefile layers */

const KIND_OF: Record<string, ShapeKind> = {
  Point: "point",
  MultiPoint: "point",
  LineString: "line",
  MultiLineString: "line",
  Polygon: "area",
  MultiPolygon: "area",
};

/** InfraWorks data source type for each class and geometry kind (Data Source Configuration → Type). */
export function infraWorksType(cls: InfraFeatureClass, kind: ShapeKind): string {
  if (kind === "point") return "Points of Interest";
  switch (cls) {
    case "road_centerline":
      return "Roads";
    case "coverage":
      return "Coverage Areas";
    case "parcel":
      return "Parcels";
    case "pipeline":
      return "Pipelines";
    case "water":
      return kind === "area" ? "Water Areas" : "Streams";
    default:
      return kind === "area" ? "Coverage Areas" : "Points of Interest";
  }
}

/** One feature's geometry as Shapefile records (a multi-point becomes one record per point). */
function toShp(f: DomainFeature): ShpFeature[] {
  const kind = KIND_OF[f.geometry.type];
  if (!kind) return [];
  // A field called NAME first, holding the feature's name (road name, plot number): the field
  // InfraWorks' Name should take. A CAD attribute already called "name" moves to name_cad.
  const { name: cadName, ...rest } = f.attributes;
  const named = f.nameAttribute ? f.attributes[f.nameAttribute] : undefined;
  const attributes = {
    ...(f.nameAttribute ? { name: named === undefined || named === null || String(named).trim() === "" ? null : String(named).trim() } : {}),
    ...(f.nameAttribute ? rest : f.attributes),
    ...(f.nameAttribute && cadName !== undefined && cadName !== null && cadName !== "" ? { name_cad: cadName } : {}),
    src_file: f.provenance.sourceFile,
    src_layer: f.provenance.sourceLayer ?? null,
  };
  const c = f.geometry.coordinates;
  if (f.geometry.type === "MultiPoint") return (c as number[][]).map((p) => ({ kind, parts: [[p]], attributes }));
  let parts: number[][][];
  switch (f.geometry.type) {
    case "Point":
      parts = [[c as number[]]];
      break;
    case "LineString":
      parts = [c as number[][]];
      break;
    case "MultiLineString":
      parts = c as number[][][];
      break;
    case "Polygon": {
      // No ring without area reaches InfraWorks: one such hole makes it drop the whole area.
      const [poly] = dropDegenerateRings([c as [number, number][][]]);
      if (!poly) return [];
      parts = poly;
      break;
    }
    case "MultiPolygon": {
      // Each polygon's first ring is an outer ring, the rest its holes.
      const polys = dropDegenerateRings(c as [number, number][][][]) as number[][][][];
      if (!polys.length) return [];
      return [{ kind, parts: polys.flat(), holes: polys.flatMap((p) => p.map((_, i) => i > 0)), attributes }];
    }
    default:
      return [];
  }
  return [{ kind, parts, attributes }];
}

function writeShapefileLayers(stagingDir: string, byLayer: ReturnType<typeof featuresByLayer>, epsg: number) {
  mkdirSync(join(stagingDir, "shp"), { recursive: true });
  const layers: PackageManifest["layers"] = [];
  const files: string[] = [];
  const fieldRows: string[] = ["file,dbf_field,source_attribute,type"];

  for (const [layer, { cls, features: feats }] of byLayer) {
    const byKind = new Map<ShapeKind, ShpFeature[]>();
    for (const f of feats) {
      for (const s of toShp(f)) {
        // An open line cannot become a coverage or parcel: AREA_NOT_CLOSED reports it instead.
        if (AREA_ONLY.includes(cls) && s.kind !== "area") continue;
        byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
      }
    }
    for (const [kind, list] of byKind) {
      // One kind → "road_centerline.shp"; several → "water_line.shp", "water_area.shp".
      const name = byKind.size === 1 ? layer : `${layer}_${kind}`;
      const res = writeShapefile(join(stagingDir, "shp", name), kind, list, epsg);
      files.push(...res.files.map((p) => `shp/${basename(p)}`));
      for (const fl of res.fields) fieldRows.push(`${name}.shp,${fl.dbf},"${fl.source.replace(/"/g, '""')}",${fl.type}`);
      // The field InfraWorks' Name should take: the attribute the mapping names features by.
      const nameAttribute = mostCommonValue(feats.map((f) => f.nameAttribute).filter((a): a is string => Boolean(a)));
      const nameField = nameAttribute ? res.fields.find((fl) => fl.source === "name")?.dbf : undefined;
      const namedCount = nameAttribute
        ? list.filter((s) => s.attributes[nameAttribute] !== undefined && s.attributes[nameAttribute] !== null && String(s.attributes[nameAttribute]).trim() !== "").length
        : 0;
      layers.push({
        name,
        infraFeatureClass: cls,
        format: "shp",
        path: `shp/${name}.shp`,
        featureCount: res.count,
        geometryKind: kind,
        extent: res.bbox,
        ...(kind === "line" ? { length: res.length } : {}),
        infraWorksType: infraWorksType(cls, kind),
        ...(nameField && nameAttribute ? { nameField, nameAttribute, namedCount, geojson: `layers/${layer}.geojson` } : {}),
      });
    }
  }
  // BOM so Excel opens Arabic attribute names correctly.
  writeFileSync(join(stagingDir, "shp", "field_names.csv"), "﻿" + fieldRows.join("\r\n") + "\r\n");
  files.push("shp/field_names.csv");
  return { layers, files };
}

/** Step-by-step import into InfraWorks, written for this package's actual files. */
export function importChecklist(
  crs: { epsg: number; infraWorksCrsHint: string },
  shpLayers: PackageManifest["layers"],
  hasOverlay: boolean,
): string[] {
  const prj = esriWkt(crs.epsg) !== null;
  const steps = [
    `1. Create or open the model with coordinate system ${crs.infraWorksCrsHint} (EPSG:${crs.epsg}).`,
    "2. Data Sources → Add File Data Source → SHP, and select the files in shp/ (InfraWorks cannot import the GeoJSON in layers/ — those are for GIS tools and checks).",
    "3. For each data source, open Configure and set:",
    ...shpLayers.flatMap((l) => [
      `   - ${basename(l.path)} → Type: ${l.infraWorksType} (${l.featureCount} feature(s))`,
      ...(l.nameField
        ? [`       and on the Common tab: Name = ${l.nameField} (${l.namedCount} of ${l.featureCount} have one; it holds ${l.nameAttribute}). InfraWorks keeps only the fields you map.`]
        : []),
    ]),
    prj
      ? `   - Coordinate System: check it reads ${crs.infraWorksCrsHint} (taken from the .prj). If it shows LL84 or is empty, set ${crs.infraWorksCrsHint}.`
      : `   - Coordinate System: set ${crs.infraWorksCrsHint} by hand (no .prj is written for EPSG:${crs.epsg}).`,
    "   - Then Close & Refresh.",
    "4. Attribute names are shortened to 10 characters in the .dbf; shp/field_names.csv maps each to its original name. Any field you do not map in Configure is not kept by InfraWorks.",
    ...(hasOverlay ? ["5. Optional: add the drawing in overlay/ as a 2D overlay for reference."] : []),
    `${hasOverlay ? 6 : 5}. Close the model, then check the import: pnpm gate:model "<model>.sqlite" --package <this package>.zip`,
    ...(shpLayers.some((l) => l.nameField)
      ? [
          "   InfraWorks does not map NAME by itself. Instead of mapping it by hand, after closing the model run",
          "   pnpm model:names \"<model>.sqlite\" --package <this package>.zip and open the \"<model> (names)\" copy it writes.",
        ]
      : []),
    "Review validation_report.json. Outputs are NOT FOR ISSUE until Human Review Gate approval.",
  ];
  return steps;
}

async function zipDirectory(sourceDir: string, zipPath: string) {
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  // Throwing inside an event handler would crash the process; reject the build instead.
  const failed = new Promise<never>((_, reject) => archive.on("error", reject));
  archive.pipe(output);
  archive.directory(sourceDir, false);
  await Promise.race([Promise.all([archive.finalize(), finished(output)]), failed]);
}

function mostCommonValue(values: string[]): string | undefined {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}