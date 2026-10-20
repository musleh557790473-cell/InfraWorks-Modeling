import type { DomainFeatureCollection, ValidationIssue, ValidationReport } from "./types.js";
import type { ProjectProfile } from "./profile.js";
import { Geometry } from "./types.js";
import { ParseError, PARSE_CODES } from "./parse-error.js";
import { runRules } from "./rules/registry.js";
import type { RuleContext } from "./rules/types.js";
// Geometry used by parseGeometryOrThrow (GEO-001 boundary)

/**
 * Validate a feature collection against a project profile via the rule registry.
 * GEO-001 also enforced at Zod boundary when parsing geometries.
 */
export function validateCollection(
  collection: DomainFeatureCollection,
  profile: ProjectProfile,
  extras?: Partial<RuleContext>,
): ValidationReport {
  const result = runRules({
    profile,
    collection,
    ...extras,
  });

  const issues: ValidationIssue[] = result.issues.map((i) => ({
    code: i.code,
    severity: i.severity,
    message: i.message,
    details: i.details,
    context:
      i.details && typeof i.details === "object"
        ? undefined
        : undefined,
  }));

  return {
    ok: result.ok,
    blockingCount: result.blockingCount,
    warningCount: result.warningCount,
    issues,
    skipped: result.skipped,
    generatedAt: new Date().toISOString(),
    profileId: profile.id,
    profileSchemaVersion: profile.schemaVersion,
  };
}

/** Parse unknown GeoJSON geometry; failures become GEO-001 ParseError. */
export function parseGeometryOrThrow(input: unknown, featureId = "?") {
  const parsed = Geometry.safeParse(input);
  if (!parsed.success) {
    throw new ParseError(
      PARSE_CODES.GEO_001_INVALID_GEOMETRY,
      `GEO-001: invalid geometry on feature ${featureId}`,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}
