import type {
  DomainFeatureCollection,
  MappingProfile,
  ValidationIssue,
  ValidationReport,
} from "./types.js";

export function validateCollection(
  collection: DomainFeatureCollection,
  profile: MappingProfile,
  opts: {
    joinedCount: number;
    reportRowCount: number;
    hasCad: boolean;
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
