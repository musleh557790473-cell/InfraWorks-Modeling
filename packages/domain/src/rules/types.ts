import type { DomainFeatureCollection } from "../types.js";
import type { ProjectProfile } from "../profile.js";

export type RuleSeverity = "blocking" | "warning" | "info";
export type RuleGroup = "IGN" | "CRS" | "GEO" | "REC" | "PKG";

export interface ParseMeta {
  entityCountsByType: Record<string, number>;
  layerCounts: Record<string, number>;
  parserPath: "dxf" | "dwg" | "demo";
  sourceFile?: string;
  unsupportedEntityCounts?: Record<string, number>;
  insunits?: number | null;
  hasAnyZ?: boolean;
  ocsRejectedCount?: number;
}

/** CRS-004 / REC-003 — all three reference sources (§6.1). */
export type ReferenceDataset =
  | {
      kind: "geojson";
      features: Array<{
        id?: string;
        geometry: { type: string; coordinates: unknown };
        properties?: Record<string, unknown>;
      }>;
    }
  | {
      kind: "upload";
      features: Array<{
        id?: string;
        geometry: { type: string; coordinates: unknown };
        properties?: Record<string, unknown>;
      }>;
    }
  | {
      kind: "controlPoints";
      points: Array<{ id: string; e: number; n: number; z?: number }>;
    };

export interface DeclaredTransform {
  offsetE?: number;
  offsetN?: number;
  offsetZ?: number;
  rotationRadians?: number;
  scale?: number;
  declaredInProfile: boolean;
  writtenToManifest: boolean;
}

export interface PackageDraft {
  manifest?: {
    notForIssue?: boolean;
    files?: string[];
    generatedAt?: string;
    profileId?: string;
    profileSchemaVersion?: string;
  };
  zipFiles?: string[];
  validationGeneratedAt?: string;
  hasZip?: boolean;
  blockingCount?: number;
}

export interface RuleContext {
  profile: ProjectProfile;
  collection: DomainFeatureCollection;
  parseMeta?: ParseMeta;
  packageDraft?: PackageDraft;
  reference?: ReferenceDataset;
  transforms?: DeclaredTransform[];
  /** Join stats for REC-002 */
  joinStats?: { joinedCount: number; reportRowCount: number };
  /** Boundary polygon for REC-004 (exterior ring positions [E,N]…) */
  boundaryRing?: Array<[number, number]>;
}

export interface RuleIssue {
  code: string;
  severity: RuleSeverity;
  message: string;
  details?: unknown;
}

export interface ValidationRule {
  id: string;
  group: RuleGroup;
  minimumSeverity: RuleSeverity;
  appliesWhen(profile: ProjectProfile, ctx: RuleContext): boolean;
  run(ctx: RuleContext): RuleIssue[];
}

export function resolveSeverity(
  minimum: RuleSeverity,
  profileOverride: RuleSeverity | undefined,
): RuleSeverity {
  const rank: Record<RuleSeverity, number> = { info: 0, warning: 1, blocking: 2 };
  if (!profileOverride) return minimum;
  return rank[profileOverride] >= rank[minimum] ? profileOverride : minimum;
}
