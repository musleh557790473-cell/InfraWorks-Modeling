import type { RuleIssue, ValidationRule } from "../types.js";
import { resolveSeverity } from "../types.js";

function collectPositions(coords: unknown, out: number[][] = []): number[][] {
  if (!Array.isArray(coords)) return out;
  if (typeof coords[0] === "number") {
    out.push(coords as number[]);
    return out;
  }
  for (const c of coords) collectPositions(c, out);
  return out;
}

function polygonArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return Math.abs(a) / 2;
}

export const rec001: ValidationRule = {
  id: "REC-001",
  group: "REC",
  minimumSeverity: "info",
  appliesWhen: (profile) => profile.expectedCounts.length > 0,
  run(ctx) {
    const issues: RuleIssue[] = [];
    for (const exp of ctx.profile.expectedCounts) {
      const actual = ctx.collection.features.filter(
        (f) => f.infraFeatureClass === exp.infraFeatureClass,
      ).length;
      if (actual !== exp.expected) {
        issues.push({
          code: "REC-001",
          severity: resolveSeverity("warning", ctx.profile.rules["REC-001"]?.severity),
          message: `Count mismatch ${exp.datasetId}: expected ${exp.expected}, got ${actual} (source: ${exp.source})`,
          details: {
            datasetId: exp.datasetId,
            expected: exp.expected,
            actual,
            source: exp.source,
          },
        });
      }
    }
    return issues;
  },
};

export const rec002: ValidationRule = {
  id: "REC-002",
  group: "REC",
  minimumSeverity: "warning",
  appliesWhen: (profile) => profile.reportJoins.length > 0,
  run(ctx) {
    const stats = ctx.joinStats;
    if (!stats || stats.reportRowCount === 0) return [];
    if (stats.joinedCount === 0) {
      return [
        {
          code: "REC-002",
          severity: resolveSeverity("blocking", ctx.profile.rules["REC-002"]?.severity),
          message: "Report rows present but none joined to features",
        },
      ];
    }
    if (stats.joinedCount < stats.reportRowCount) {
      const ratio = stats.joinedCount / stats.reportRowCount;
      return [
        {
          code: "REC-002",
          severity: resolveSeverity("warning", ctx.profile.rules["REC-002"]?.severity),
          message: `Partial report join ${stats.joinedCount}/${stats.reportRowCount} (ratio=${ratio.toFixed(3)})`,
          details: { joinedCount: stats.joinedCount, reportRowCount: stats.reportRowCount, ratio },
        },
      ];
    }
    return [];
  },
};

export const rec003: ValidationRule = {
  id: "REC-003",
  group: "REC",
  minimumSeverity: "info",
  appliesWhen: (profile, ctx) =>
    Boolean(ctx.reference) && profile.tolerances.horizontalMetres != null,
  run(ctx) {
    const tol = ctx.profile.tolerances.horizontalMetres!;
    const ref = ctx.reference!;
    if (ref.kind === "controlPoints") return []; // dimension check needs polygons
    const issues: RuleIssue[] = [];
    const refById = new Map(
      ref.features.map((f) => [String(f.id ?? f.properties?.id ?? ""), f]),
    );
    for (const f of ctx.collection.features) {
      if (f.geometry.type !== "Polygon") continue;
      const key = String(f.attributes.asset_id ?? f.id);
      const r = refById.get(key);
      if (!r || r.geometry.type !== "Polygon") continue;
      const areaA = polygonArea((f.geometry.coordinates[0] as number[][]) ?? []);
      const areaB = polygonArea(
        collectPositions(r.geometry.coordinates).length >= 4
          ? (r.geometry.coordinates as number[][][])[0]!
          : [],
      );
      // Compare sqrt(area) as characteristic dimension
      const dimA = Math.sqrt(areaA);
      const dimB = Math.sqrt(areaB);
      if (Math.abs(dimA - dimB) > tol) {
        issues.push({
          code: "REC-003",
          severity: resolveSeverity("warning", ctx.profile.rules["REC-003"]?.severity),
          message: `Feature ${f.id}: dimension vs reference outside tolerance (${Math.abs(dimA - dimB).toFixed(3)} m)`,
        });
      }
    }
    return issues;
  },
};

export const rec004: ValidationRule = {
  id: "REC-004",
  group: "REC",
  minimumSeverity: "info",
  appliesWhen: (profile, ctx) =>
    profile.tolerances.boundaryBufferMetres != null && Boolean(ctx.boundaryRing),
  run(ctx) {
    const required = ctx.profile.tolerances.boundaryBufferMetres!;
    const ring = ctx.boundaryRing!;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const bMinE = Math.min(...xs);
    const bMaxE = Math.max(...xs);
    const bMinN = Math.min(...ys);
    const bMaxN = Math.max(...ys);

    let dataMinE = Infinity;
    let dataMaxE = -Infinity;
    let dataMinN = Infinity;
    let dataMaxN = -Infinity;
    for (const f of ctx.collection.features) {
      for (const p of collectPositions(f.geometry.coordinates)) {
        dataMinE = Math.min(dataMinE, p[0]!);
        dataMaxE = Math.max(dataMaxE, p[0]!);
        dataMinN = Math.min(dataMinN, p[1]!);
        dataMaxN = Math.max(dataMaxN, p[1]!);
      }
    }
    const margins = {
      west: bMinE - dataMinE,
      east: dataMaxE - bMaxE,
      south: bMinN - dataMinN,
      north: dataMaxN - bMaxN,
    };
    const short = Object.entries(margins).filter(([, m]) => m < required);
    if (short.length === 0) return [];
    return [
      {
        code: "REC-004",
        severity: resolveSeverity("warning", ctx.profile.rules["REC-004"]?.severity),
        message: `Boundary buffer shortfall (required ${required} m): ${JSON.stringify(margins)}`,
        details: { requiredMetres: required, marginsPerSide: margins },
      },
    ];
  },
};

export const rec005: ValidationRule = {
  id: "REC-005",
  group: "REC",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      if (!f.provenance?.sourceFile?.trim()) {
        issues.push({
          code: "REC-005",
          severity: resolveSeverity("blocking", ctx.profile.rules["REC-005"]?.severity),
          message: `Feature ${f.id}: empty/missing provenance.sourceFile`,
        });
      }
    }
    return issues;
  },
};

export const REC_RULES: ValidationRule[] = [rec001, rec002, rec003, rec004, rec005];
