import type {
  DomainFeature,
  DomainFeatureCollection,
  InfraFeatureClass,
  MappingProfile,
  ValidationIssue,
  ValidationReport,
} from "./types.js";
import type { ParsedDwg } from "./dwg.js";

const UNIT_NAMES: Record<number, string> = { 1: "inches", 2: "feet", 3: "miles", 4: "millimetres", 5: "centimetres", 6: "metres", 7: "kilometres" };

/** Feature classes InfraWorks expects as closed areas. */
const AREA_CLASSES: InfraFeatureClass[] = ["coverage", "parcel"];

/**
 * Plausible coordinate envelope for a CRS, or null when we do not know it.
 * Catches the most common CAD failure: a drawing left in local/arbitrary units.
 */
export function crsEnvelope(epsg: number): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (epsg >= 32601 && epsg <= 32660) return { minX: 100_000, maxX: 900_000, minY: 0, maxY: 9_400_000 };
  if (epsg >= 32701 && epsg <= 32760) return { minX: 100_000, maxX: 900_000, minY: 1_000_000, maxY: 10_000_000 };
  if (epsg === 4326) return { minX: -180, maxX: 180, minY: -90, maxY: 90 };
  return null;
}

function* positions(coords: unknown): Generator<number[]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    yield coords as number[];
    return;
  }
  for (const c of coords) yield* positions(c);
}

function outsideEnvelope(f: DomainFeature, env: NonNullable<ReturnType<typeof crsEnvelope>>): boolean {
  for (const p of positions(f.geometry.coordinates)) {
    const [x, y] = p as [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    if (x < env.minX || x > env.maxX || y < env.minY || y > env.maxY) return true;
  }
  return false;
}

export function validateCollection(
  collection: DomainFeatureCollection,
  profile: MappingProfile,
  opts: {
    joinedCount: number;
    reportRowCount: number;
    hasCad: boolean;
    cad?: Partial<
      Pick<ParsedDwg, "format" | "notes" | "skippedEntities" | "insunits" | "keyStats" | "paperSpaceSkipped" | "truncated" | "extractedXrefs">
    >;
    conversionError?: string;
  },
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!collection.crs?.epsg) {
    issues.push({
      code: "CRS_MISSING",
      severity: "blocking",
      message: "Project CRS (EPSG) is not set",
    });
  }

  if (!opts.hasCad) {
    issues.push({
      code: "CAD_MISSING",
      severity: "blocking",
      message: "No DWG/DXF upload found for this project",
    });
  }

  if (opts.conversionError) {
    issues.push({
      code: "CAD_CONVERSION_FAILED",
      severity: "blocking",
      message:
        `${opts.conversionError}. Install ODA File Converter (free) or ezdwg, or save the drawing as DXF ` +
        `from AutoCAD and upload that.`,
    });
  }

  if (opts.cad?.truncated) {
    issues.push({
      code: "DXF_TRUNCATED",
      severity: "warning",
      message:
        "The DXF ends before its end-of-file marker: it was cut off while being saved, exported or copied, so the " +
        "end of the drawing (often the whole model space) is missing. Ask for the drawing to be saved again.",
    });
  }

  const xrefs = opts.cad?.extractedXrefs ?? [];
  if (xrefs.length) {
    issues.push({
      code: "SHEET_XREF_EXTRACTED",
      severity: "warning",
      message:
        `Model space had nothing mapped, so the geometry was read from bound xref(s) ${xrefs.map((x) => `"${x}"`).join(", ")} ` +
        `at their own coordinates. A plotted sheet often holds only the part of the design inside its viewport: ` +
        `ask for the source drawing (${xrefs.map((x) => `${x}.dwg`).join(", ")}) for the full layout.`,
      context: { xrefs: xrefs.join("; ") },
    });
  }

  const units = opts.cad?.insunits;
  const metric = collection.crs?.epsg ? crsEnvelope(collection.crs.epsg) !== null && collection.crs.epsg !== 4326 : false;
  if (metric && units !== undefined && units !== 0 && units !== 6) {
    issues.push({
      code: "DRAWING_UNITS_NOT_METRES",
      severity: "warning",
      message:
        `The drawing's units are ${UNIT_NAMES[units] ?? `code ${units}`}, but EPSG:${collection.crs.epsg} is in metres. ` +
        `Coordinates are not rescaled — check the drawing is really in metres or scale it in CAD.`,
      context: { insunits: String(units) },
    });
  }

  const skippedMap = opts.cad?.skippedEntities ?? {};
  const civil = Object.entries(skippedMap).filter(([t]) => t === "ACAD_PROXY_ENTITY" || t.startsWith("AECC"));
  if (civil.length) {
    const n = civil.reduce((s, [, c]) => s + c, 0);
    issues.push({
      code: "CIVIL3D_OBJECTS_NOT_READ",
      severity: "warning",
      message:
        `${n} Civil 3D object(s) (alignments, parcels, feature lines, corridors…) cannot be read outside Civil 3D. ` +
        `In Civil 3D run ExportToAutoCAD (or explode them) before sending the drawing, or send LandXML for alignments and surfaces.`,
      context: { count: String(n) },
    });
  }

  const ks = opts.cad?.keyStats;
  if (ks && ks.missing > 0) {
    issues.push({
      code: "ASSET_ID_MISSING",
      severity: "warning",
      message:
        `${ks.missing} feature(s) on layers that need an asset id have none. Found so far: ${ks.xdata} from XDATA, ` +
        `${ks.attribute} from block attributes, ${ks.text} from nearby text. Set the team's id pattern, attribute tags ` +
        `or label layer in the mapping profile.`,
      context: { missing: String(ks.missing), xdata: String(ks.xdata), attribute: String(ks.attribute), text: String(ks.text) },
    });
  }

  const skipped = Object.entries(skippedMap).filter(([t]) => !civil.some(([c]) => c === t));
  if (skipped.length) {
    const total = skipped.reduce((n, [, c]) => n + c, 0);
    issues.push({
      code: "CAD_ENTITIES_SKIPPED",
      severity: "warning",
      message: `${total} entity(ies) of unsupported type were not converted: ${skipped
        .map(([t, c]) => `${t} (${c})`)
        .join(", ")}`,
      context: Object.fromEntries(skipped.map(([t, c]) => [t, String(c)])),
    });
  }

  if (collection.features.length === 0) {
    issues.push({
      code: "GEOMETRY_EMPTY",
      severity: "blocking",
      message: "No features extracted from CAD input",
    });
  }

  const unmapped = collection.features.filter((f) => f.infraFeatureClass === "unmapped");
  if (unmapped.length > 0) {
    issues.push({
      code: "LAYERS_UNMAPPED",
      severity: "warning",
      message: `${unmapped.length} feature(s) have unmapped layers`,
      context: { count: String(unmapped.length) },
    });
  }

  const openAreas = collection.features.filter(
    (f) => AREA_CLASSES.includes(f.infraFeatureClass) && f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon",
  );
  if (openAreas.length) {
    issues.push({
      code: "AREA_NOT_CLOSED",
      severity: "warning",
      message:
        `${openAreas.length} coverage/parcel feature(s) are open lines, not closed boundaries — ` +
        `InfraWorks will not create an area from them. Close the polylines in CAD.`,
      context: { count: String(openAreas.length) },
    });
  }

  const env = crsEnvelope(collection.crs.epsg);
  if (env) {
    const outside = collection.features.filter((f) => outsideEnvelope(f, env));
    if (outside.length) {
      issues.push({
        code: "COORDS_OUTSIDE_CRS",
        severity: "blocking",
        message:
          `${outside.length} feature(s) have coordinates outside the valid range for EPSG:${collection.crs.epsg}. ` +
          `The drawing is probably in local coordinates or a different CRS — the model would land in the wrong place.`,
        context: { count: String(outside.length), epsg: String(collection.crs.epsg) },
      });
    }
  }

  const needsJoin = profile.reportJoins.length > 0 && opts.reportRowCount > 0;
  if (needsJoin && opts.joinedCount === 0) {
    issues.push({
      code: "REPORT_JOIN_FAILED",
      severity: "blocking",
      message: "Report rows present but none joined to features — check join keys",
    });
  } else if (needsJoin && opts.joinedCount < opts.reportRowCount) {
    issues.push({
      code: "REPORT_JOIN_PARTIAL",
      severity: "warning",
      message: `Joined ${opts.joinedCount}/${opts.reportRowCount} report rows`,
      context: {
        joined: String(opts.joinedCount),
        total: String(opts.reportRowCount),
      },
    });
  }

  for (const f of collection.features) {
    if (!f.geometry?.coordinates) {
      issues.push({
        code: "GEOMETRY_INVALID",
        severity: "blocking",
        message: `Feature ${f.id} has empty geometry`,
        context: { featureId: f.id },
      });
    }
  }

  const blockingCount = issues.filter((i) => i.severity === "blocking").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    ok: blockingCount === 0,
    blockingCount,
    warningCount,
    issues,
    generatedAt: new Date().toISOString(),
  };
}
