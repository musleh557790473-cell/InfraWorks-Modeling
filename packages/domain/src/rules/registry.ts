import type { ProjectProfile } from "../profile.js";
import { IGN_RULES } from "./ign/index.js";
import { CRS_RULES } from "./crs/index.js";
import { GEO_RULES } from "./geo/index.js";
import { REC_RULES } from "./rec/index.js";
import { PKG_RULES } from "./pkg/index.js";
import type { RuleContext, RuleIssue, ValidationRule } from "./types.js";

export const RULES: readonly ValidationRule[] = [
  ...IGN_RULES,
  ...CRS_RULES,
  ...GEO_RULES,
  ...REC_RULES,
  ...PKG_RULES,
].sort((a, b) => a.id.localeCompare(b.id));

export function runRules(ctx: RuleContext): {
  issues: RuleIssue[];
  skipped: { id: string; reason: string }[];
  blockingCount: number;
  warningCount: number;
  ok: boolean;
} {
  const issues: RuleIssue[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const rule of RULES) {
    const cfg = ctx.profile.rules[rule.id];
    if (cfg?.enabled === false) {
      skipped.push({ id: rule.id, reason: "disabled in profile.rules" });
      continue;
    }
    if (!rule.appliesWhen(ctx.profile, ctx)) {
      skipped.push({ id: rule.id, reason: skipReason(rule, ctx.profile) });
      continue;
    }
    issues.push(...rule.run(ctx));
  }

  const blockingCount = issues.filter((i) => i.severity === "blocking").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  return {
    issues,
    skipped,
    blockingCount,
    warningCount,
    ok: blockingCount === 0,
  };
}

function skipReason(rule: ValidationRule, profile: ProjectProfile): string {
  switch (rule.id) {
    case "CRS-003":
      return "no siteEnvelopes";
    case "CRS-004":
      return "no reference dataset and/or translation tolerances";
    case "CRS-006":
      return "no site envelope Z bounds";
    case "IGN-004":
      return "no siteEnvelopes.minZ";
    case "GEO-006":
      return "sliverRatio unset";
    case "GEO-007":
      return "horizontalMetres unset";
    case "REC-001":
      return "no expectedCounts";
    case "REC-002":
      return "no reportJoins";
    case "REC-003":
      return "no reference and/or horizontalMetres";
    case "REC-004":
      return "no boundaryRing and/or boundaryBufferMetres";
    case "CRS-002":
      return "CRS is not UTM projected";
    default:
      if (rule.group === "PKG") return "no packageDraft context";
      return `appliesWhen false (${rule.id}); profile=${profile.id}`;
  }
}
