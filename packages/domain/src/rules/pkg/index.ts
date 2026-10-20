import type { RuleIssue, ValidationRule } from "../types.js";
import { resolveSeverity } from "../types.js";

export const pkg001: ValidationRule = {
  id: "PKG-001",
  group: "PKG",
  minimumSeverity: "blocking",
  appliesWhen: (_p, ctx) => Boolean(ctx.packageDraft?.manifest),
  run(ctx) {
    const m = ctx.packageDraft!.manifest!;
    if (m.notForIssue === true) return [];
    return [
      {
        code: "PKG-001",
        severity: resolveSeverity("blocking", ctx.profile.rules["PKG-001"]?.severity),
        message: "manifest.notForIssue must be true — no configuration path may set it false",
      },
    ];
  },
};

export const pkg002: ValidationRule = {
  id: "PKG-002",
  group: "PKG",
  minimumSeverity: "blocking",
  appliesWhen: (_p, ctx) =>
    Boolean(ctx.packageDraft?.manifest?.files && ctx.packageDraft?.zipFiles),
  run(ctx) {
    const listed = new Set(ctx.packageDraft!.manifest!.files ?? []);
    const zipped = new Set(ctx.packageDraft!.zipFiles ?? []);
    const missing = [...listed].filter((f) => f !== "manifest.json" && !zipped.has(f));
    const extra = [...zipped].filter((f) => !listed.has(f));
    if (missing.length === 0 && extra.length === 0) return [];
    return [
      {
        code: "PKG-002",
        severity: resolveSeverity("blocking", ctx.profile.rules["PKG-002"]?.severity),
        message: `ZIP↔manifest file list mismatch (missing=${missing.length}, extra=${extra.length})`,
        details: { missing, extra },
      },
    ];
  },
};

export const pkg003: ValidationRule = {
  id: "PKG-003",
  group: "PKG",
  minimumSeverity: "blocking",
  appliesWhen: (_p, ctx) =>
    Boolean(ctx.packageDraft?.manifest?.generatedAt && ctx.packageDraft?.validationGeneratedAt),
  run(ctx) {
    const a = ctx.packageDraft!.manifest!.generatedAt!;
    const b = ctx.packageDraft!.validationGeneratedAt!;
    if (a === b) return [];
    return [
      {
        code: "PKG-003",
        severity: resolveSeverity("blocking", ctx.profile.rules["PKG-003"]?.severity),
        message: `validation report generatedAt (${b}) ≠ manifest generatedAt (${a})`,
      },
    ];
  },
};

export const pkg004: ValidationRule = {
  id: "PKG-004",
  group: "PKG",
  minimumSeverity: "blocking",
  appliesWhen: (_p, ctx) => ctx.packageDraft?.blockingCount != null,
  run(ctx) {
    const blocking = ctx.packageDraft!.blockingCount ?? 0;
    if (blocking > 0 && ctx.packageDraft!.hasZip) {
      return [
        {
          code: "PKG-004",
          severity: resolveSeverity("blocking", ctx.profile.rules["PKG-004"]?.severity),
          message: "ZIP must not be produced when blockingCount > 0",
        },
      ];
    }
    return [];
  },
};

export const pkg005: ValidationRule = {
  id: "PKG-005",
  group: "PKG",
  minimumSeverity: "warning",
  appliesWhen: (_p, ctx) => Boolean(ctx.packageDraft?.manifest),
  run(ctx) {
    const m = ctx.packageDraft!.manifest!;
    const issues: RuleIssue[] = [];
    if (!m.profileId) {
      issues.push({
        code: "PKG-005",
        severity: resolveSeverity("blocking", ctx.profile.rules["PKG-005"]?.severity),
        message: "manifest missing profile id",
      });
    }
    if (!m.profileSchemaVersion) {
      issues.push({
        code: "PKG-005",
        severity: resolveSeverity("blocking", ctx.profile.rules["PKG-005"]?.severity),
        message: "manifest missing profile schemaVersion",
      });
    }
    return issues;
  },
};

export const PKG_RULES: ValidationRule[] = [pkg001, pkg002, pkg003, pkg004, pkg005];
