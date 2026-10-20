import type { ValidationRule } from "../types.js";
import { resolveSeverity } from "../types.js";

export const ign001: ValidationRule = {
  id: "IGN-001",
  group: "IGN",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    // Enforced primarily at parse time via ParseError. Runner checks residual empty CAD parse.
    if (ctx.parseMeta?.parserPath !== "demo" && ctx.collection.features.length === 0) {
      return [
        {
          code: "IGN-001",
          severity: resolveSeverity("blocking", ctx.profile.rules["IGN-001"]?.severity),
          message:
            "No entities parsed from user CAD — synthetic geometry is forbidden (IGN-001)",
        },
      ];
    }
    return [];
  },
};

export const ign002: ValidationRule = {
  id: "IGN-002",
  group: "IGN",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    const synth = ctx.collection.features.filter((f) => f.attributes.__synthetic === true);
    if (synth.length === 0) return [];
    return [
      {
        code: "IGN-002",
        severity: resolveSeverity("blocking", ctx.profile.rules["IGN-002"]?.severity),
        message: `${synth.length} synthetic feature(s) present — packager refuses collections with __synthetic`,
        details: { featureIds: synth.map((f) => f.id) },
      },
    ];
  },
};

export const ign003: ValidationRule = {
  id: "IGN-003",
  group: "IGN",
  minimumSeverity: "info",
  appliesWhen: () => true,
  run(ctx) {
    const unsupported = ctx.parseMeta?.unsupportedEntityCounts ?? {};
    const total = Object.values(unsupported).reduce((a, b) => a + b, 0);
    if (total === 0) return [];
    const sev = resolveSeverity("warning", ctx.profile.rules["IGN-003"]?.severity);
    return [
      {
        code: "IGN-003",
        severity: sev,
        message: `Unsupported entity types skipped: ${JSON.stringify(unsupported)}`,
        details: { unsupportedEntityCounts: unsupported },
      },
    ];
  },
};

export const ign004: ValidationRule = {
  id: "IGN-004",
  group: "IGN",
  minimumSeverity: "warning",
  appliesWhen: (profile) => profile.siteEnvelopes.some((e) => e.minZ != null),
  run(ctx) {
    // §6.5 — genuine 2D OK when marked noElevationData; do not block 2D-only workflows
    if (ctx.collection.noElevationData) return [];
    const hasZ = ctx.parseMeta?.hasAnyZ === true;
    if (hasZ) return [];
    const sev = resolveSeverity("warning", ctx.profile.rules["IGN-004"]?.severity);
    return [
      {
        code: "IGN-004",
        severity: sev,
        message:
          "Profile declares minZ but no elevation on entities — mark package noElevationData for genuine 2D, or supply Z",
      },
    ];
  },
};

export const ign005: ValidationRule = {
  id: "IGN-005",
  group: "IGN",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    const n = ctx.parseMeta?.ocsRejectedCount ?? 0;
    if (n === 0) return [];
    return [
      {
        code: "IGN-005",
        severity: resolveSeverity("blocking", ctx.profile.rules["IGN-005"]?.severity),
        message: `${n} entit(y/ies) rejected — OCS extrusion ≠ (0,0,1) and transform not implemented`,
      },
    ];
  },
};

export const ign006: ValidationRule = {
  id: "IGN-006",
  group: "IGN",
  minimumSeverity: "warning",
  appliesWhen: () => true,
  run(ctx) {
    const units = ctx.parseMeta?.insunits;
    if (units === undefined) return [];
    if (units === null) {
      return [
        {
          code: "IGN-006",
          severity: resolveSeverity("warning", ctx.profile.rules["IGN-006"]?.severity),
          message: "$INSUNITS absent — drawing units unknown",
        },
      ];
    }
    // AutoCAD INSUNITS 6 = metres
    if (units !== 6) {
      return [
        {
          code: "IGN-006",
          severity: resolveSeverity("blocking", ctx.profile.rules["IGN-006"]?.severity),
          message: `$INSUNITS=${units} is not metres (expected 6)`,
          details: { insunits: units },
        },
      ];
    }
    return [];
  },
};

export const ign007: ValidationRule = {
  id: "IGN-007",
  group: "IGN",
  minimumSeverity: "info",
  appliesWhen: () => true,
  run(ctx) {
    if (!ctx.parseMeta) return [];
    return [
      {
        code: "IGN-007",
        severity: "info",
        message: `Parse path=${ctx.parseMeta.parserPath}; entities=${JSON.stringify(ctx.parseMeta.entityCountsByType)}`,
        details: {
          entityCountsByType: ctx.parseMeta.entityCountsByType,
          layerCounts: ctx.parseMeta.layerCounts,
          parserPath: ctx.parseMeta.parserPath,
          sourceFile: ctx.parseMeta.sourceFile,
        },
      },
    ];
  },
};

export const IGN_RULES: ValidationRule[] = [
  ign001,
  ign002,
  ign003,
  ign004,
  ign005,
  ign006,
  ign007,
];
