import { z } from "zod";
import {
  InfraFeatureClass,
  LayerMapping,
  ReportJoin,
} from "./types.js";
import { GENERIC_PROFILE } from "./profiles/generic.js";
import { LDIP_PROFILE } from "./profiles/ldip.js";

export const SiteEnvelope = z.object({
  id: z.string(),
  name: z.string(),
  minE: z.number(),
  maxE: z.number(),
  minN: z.number(),
  maxN: z.number(),
  minZ: z.number().optional(),
  maxZ: z.number().optional(),
  /** Optional evidence pointer (§0 locked: optional). */
  source: z.string().optional(),
});
export type SiteEnvelope = z.infer<typeof SiteEnvelope>;

export const ExpectedCount = z.object({
  datasetId: z.string(),
  infraFeatureClass: InfraFeatureClass,
  expected: z.number().int(),
  source: z.string(),
});
export type ExpectedCount = z.infer<typeof ExpectedCount>;

export const ProjectProfile = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string(),
  name: z.string(),
  crs: z.object({
    epsg: z.number().int(),
    name: z.string(),
    infraWorksCrsHint: z.string(),
    verticalDatum: z.string().optional(),
  }),
  siteEnvelopes: z.array(SiteEnvelope).default([]),
  tolerances: z
    .object({
      horizontalMetres: z.number().optional(),
      boundaryBufferMetres: z.number().optional(),
      translationDetectMetres: z.number().optional(),
      translationSpreadMetres: z.number().optional(),
      sliverRatio: z.number().optional(),
    })
    .default({}),
  expectedCounts: z.array(ExpectedCount).default([]),
  layers: z.array(LayerMapping),
  reportJoins: z.array(ReportJoin).default([]),
  rules: z
    .record(
      z.object({
        enabled: z.boolean().default(true),
        severity: z.enum(["blocking", "warning", "info"]).optional(),
      }),
    )
    .default({}),
});
export type ProjectProfile = z.infer<typeof ProjectProfile>;

const SHIPPED: Record<string, ProjectProfile> = {
  generic: GENERIC_PROFILE,
  [GENERIC_PROFILE.id]: GENERIC_PROFILE,
  ldip: LDIP_PROFILE,
  [LDIP_PROFILE.id]: LDIP_PROFILE,
  "ldip-default": LDIP_PROFILE,
};

export function parseProfile(input: unknown): ProjectProfile {
  return ProjectProfile.parse(input);
}

export function loadProfileById(id: string): ProjectProfile {
  const profile = SHIPPED[id];
  if (!profile) {
    throw new Error(`Unknown profile id: ${id}`);
  }
  return structuredClone(profile);
}

/** §6.2 — missing profile → generic + warning flag for callers. */
export function resolveProfile(opts: {
  profileId?: string | null;
  profile?: unknown;
}): { profile: ProjectProfile; usedGenericFallback: boolean } {
  if (opts.profile != null) {
    return { profile: parseProfile(opts.profile), usedGenericFallback: false };
  }
  if (opts.profileId) {
    return { profile: loadProfileById(opts.profileId), usedGenericFallback: false };
  }
  return { profile: structuredClone(GENERIC_PROFILE), usedGenericFallback: true };
}

export function listShippedProfileIds(): string[] {
  return ["generic", LDIP_PROFILE.id];
}
