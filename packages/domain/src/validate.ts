import type {
  DomainFeature,
  DomainFeatureCollection,
  InfraFeatureClass,
  MappingProfile,
  ValidationIssue,
  ValidationReport,
} from "./types.js";
import type { ParsedDwg } from "./dwg.js";

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
    cad?: Pick<ParsedDwg, "format" | "notes" | "skippedEntities">;
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

  if (opts.cad?.format === "dwg-stub") {
    issues.push({
      code: "CAD_GEOMETRY_SYNTHETIC",
      severity: "blocking",
      message:
        "Binary DWG is not parsed in this build — the features are synthetic demo geometry, not your drawing. " +
        "Save the drawing as ASCII DXF and upload that instead.",
    });
  }

  const skipped = Object.entries(opts.cad?.skippedEntities ?? {});
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
