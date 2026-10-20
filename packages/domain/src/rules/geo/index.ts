import { Geometry, GEO_005_DEFAULT_COINCIDENCE_METRES } from "../../types.js";
import type { RuleIssue, ValidationRule } from "../types.js";
import { resolveSeverity } from "../types.js";

function ringClosed(ring: number[][]): boolean {
  if (ring.length < 4) return false;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  return a[0] === b[0] && a[1] === b[1] && (a[2] ?? 0) === (b[2] ?? 0);
}

function segmentsIntersect(
  a1: number[],
  a2: number[],
  b1: number[],
  b2: number[],
): boolean {
  const orient = (p: number[], q: number[], r: number[]) => {
    const v = (q[1]! - p[1]!) * (r[0]! - q[0]!) - (q[0]! - p[0]!) * (r[1]! - q[1]!);
    if (v === 0) return 0;
    return v > 0 ? 1 : 2;
  };
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  return o1 !== o2 && o3 !== o4;
}

function ringSelfIntersects(ring: number[][]): boolean {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return true;
    }
  }
  return false;
}

function polygonArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return Math.abs(a) / 2;
}

function perimeter(ring: number[][]): number {
  let p = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    p += Math.hypot(ring[i + 1]![0]! - ring[i]![0]!, ring[i + 1]![1]! - ring[i]![1]!);
  }
  return p;
}

function distinctVertexCount(coords: number[][]): number {
  const seen = new Set<string>();
  for (const c of coords) seen.add(`${c[0]},${c[1]}`);
  return seen.size;
}

export const geo001: ValidationRule = {
  id: "GEO-001",
  group: "GEO",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      const parsed = Geometry.safeParse(f.geometry);
      if (!parsed.success) {
        issues.push({
          code: "GEO-001",
          severity: resolveSeverity("blocking", ctx.profile.rules["GEO-001"]?.severity),
          message: `Feature ${f.id}: invalid geometry (GEO-001 Zod boundary)`,
          details: parsed.error.flatten(),
        });
      }
    }
    return issues;
  },
};

export const geo002: ValidationRule = {
  id: "GEO-002",
  group: "GEO",
  minimumSeverity: "warning",
  appliesWhen: () => true,
  run(ctx) {
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
      const polys =
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          if (!ringClosed(ring as number[][])) {
            issues.push({
              code: "GEO-002",
              severity: resolveSeverity("blocking", ctx.profile.rules["GEO-002"]?.severity),
              message: `Feature ${f.id}: open polygon ring`,
            });
          }
        }
      }
    }
    return issues;
  },
};

export const geo003: ValidationRule = {
  id: "GEO-003",
  group: "GEO",
  minimumSeverity: "warning",
  appliesWhen: () => true,
  run(ctx) {
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
      const polys =
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.coordinates;
      for (const poly of polys) {
        const ring = poly[0] as number[][];
        if (ring && ringSelfIntersects(ring)) {
          issues.push({
            code: "GEO-003",
            severity: resolveSeverity("blocking", ctx.profile.rules["GEO-003"]?.severity),
            message: `Feature ${f.id}: self-intersecting ring`,
          });
        }
      }
    }
    return issues;
  },
};

export const geo004: ValidationRule = {
  id: "GEO-004",
  group: "GEO",
  minimumSeverity: "warning",
  appliesWhen: () => true,
  run(ctx) {
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      const g = f.geometry;
      if (g.type === "LineString") {
        if (distinctVertexCount(g.coordinates as number[][]) < 2) {
          issues.push({
            code: "GEO-004",
            severity: resolveSeverity("blocking", ctx.profile.rules["GEO-004"]?.severity),
            message: `Feature ${f.id}: degenerate LineString`,
          });
        }
      }
      if (g.type === "Polygon") {
        const ring = g.coordinates[0] as number[][];
        if (!ring || ring.length < 4 || polygonArea(ring) === 0) {
          issues.push({
            code: "GEO-004",
            severity: resolveSeverity("blocking", ctx.profile.rules["GEO-004"]?.severity),
            message: `Feature ${f.id}: degenerate Polygon`,
          });
        }
      }
    }
    return issues;
  },
};

export const geo005: ValidationRule = {
  id: "GEO-005",
  group: "GEO",
  minimumSeverity: "info",
  appliesWhen: () => true,
  run(ctx) {
    const thr =
      ctx.profile.tolerances.horizontalMetres ?? GEO_005_DEFAULT_COINCIDENCE_METRES;
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      const walk = (coords: unknown): number[][] => {
        if (!Array.isArray(coords)) return [];
        if (typeof coords[0] === "number") return [coords as number[]];
        return (coords as unknown[]).flatMap(walk);
      };
      const pts = walk(f.geometry.coordinates);
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!);
        if (d > 0 && d <= thr) {
          issues.push({
            code: "GEO-005",
            severity: resolveSeverity("warning", ctx.profile.rules["GEO-005"]?.severity),
            message: `Feature ${f.id}: near-duplicate consecutive vertices (d=${d})`,
          });
          break;
        }
        if (d === 0) {
          issues.push({
            code: "GEO-005",
            severity: resolveSeverity("warning", ctx.profile.rules["GEO-005"]?.severity),
            message: `Feature ${f.id}: duplicate consecutive vertices`,
          });
          break;
        }
      }
    }
    return issues;
  },
};

export const geo006: ValidationRule = {
  id: "GEO-006",
  group: "GEO",
  minimumSeverity: "info",
  appliesWhen: (profile) => profile.tolerances.sliverRatio != null,
  run(ctx) {
    const ratio = ctx.profile.tolerances.sliverRatio!;
    const issues: RuleIssue[] = [];
    for (const f of ctx.collection.features) {
      if (f.geometry.type !== "Polygon") continue;
      const ring = f.geometry.coordinates[0] as number[][];
      const area = polygonArea(ring);
      const peri = perimeter(ring);
      if (peri === 0) continue;
      const score = (4 * Math.PI * area) / (peri * peri);
      if (score < ratio) {
        issues.push({
          code: "GEO-006",
          severity: resolveSeverity("warning", ctx.profile.rules["GEO-006"]?.severity),
          message: `Feature ${f.id}: sliver polygon (score=${score.toFixed(4)} < ${ratio})`,
        });
      }
    }
    return issues;
  },
};

export const geo007: ValidationRule = {
  id: "GEO-007",
  group: "GEO",
  minimumSeverity: "info",
  appliesWhen: (profile) => profile.tolerances.horizontalMetres != null,
  run(ctx) {
    // Bounding-box overlap proxy (full topology deferred); flags same-class bbox overlap
    const thr = ctx.profile.tolerances.horizontalMetres!;
    const polys = ctx.collection.features.filter((f) => f.geometry.type === "Polygon");
    const issues: RuleIssue[] = [];
    const bbox = (ring: number[][]) => {
      const xs = ring.map((p) => p[0]!);
      const ys = ring.map((p) => p[1]!);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    };
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const a = polys[i]!;
        const b = polys[j]!;
        if (a.infraFeatureClass !== b.infraFeatureClass) continue;
        const ba = bbox(a.geometry.coordinates[0] as number[][]);
        const bb = bbox(b.geometry.coordinates[0] as number[][]);
        const overlap =
          ba.minX < bb.maxX - thr &&
          ba.maxX > bb.minX + thr &&
          ba.minY < bb.maxY - thr &&
          ba.maxY > bb.minY + thr;
        if (overlap) {
          issues.push({
            code: "GEO-007",
            severity: resolveSeverity("warning", ctx.profile.rules["GEO-007"]?.severity),
            message: `Same-class polygon overlap: ${a.id} ∩ ${b.id}`,
          });
        }
      }
    }
    return issues;
  },
};

export const GEO_RULES: ValidationRule[] = [
  geo001,
  geo002,
  geo003,
  geo004,
  geo005,
  geo006,
  geo007,
];
