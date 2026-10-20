import {
  CRS_002_UTM_E_MAX,
  CRS_002_UTM_E_MIN,
  CRS_002_UTM_N_MAX,
  CRS_002_UTM_N_MIN,
} from "../../types.js";
import { isUtmProjected, resolveCrs } from "../../crs.js";
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

export const crs001: ValidationRule = {
  id: "CRS-001",
  group: "CRS",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    const epsg = ctx.collection.crs?.epsg ?? ctx.profile.crs.epsg;
    const resolved = resolveCrs(epsg);
    if (!epsg || epsg <= 0 || !resolved.known) {
      return [
        {
          code: "CRS-001",
          severity: resolveSeverity("blocking", ctx.profile.rules["CRS-001"]?.severity),
          message: `EPSG missing or unresolvable (got ${epsg}) — no domain default CRS`,
        },
      ];
    }
    return [];
  },
};

export const crs002: ValidationRule = {
  id: "CRS-002",
  group: "CRS",
  minimumSeverity: "blocking",
  appliesWhen: (profile, ctx) =>
    isUtmProjected(ctx.collection.crs?.epsg ?? profile.crs.epsg),
  run(ctx) {
    const epsg = ctx.collection.crs?.epsg ?? ctx.profile.crs.epsg;
    if (!isUtmProjected(epsg)) return [];
    const outside: string[] = [];
    for (const f of ctx.collection.features) {
      for (const p of collectPositions(f.geometry.coordinates)) {
        const e = p[0];
        const n = p[1];
        if (
          e == null ||
          n == null ||
          e < CRS_002_UTM_E_MIN ||
          e > CRS_002_UTM_E_MAX ||
          n < CRS_002_UTM_N_MIN ||
          n > CRS_002_UTM_N_MAX
        ) {
          outside.push(f.id);
          break;
        }
      }
    }
    if (outside.length === 0) return [];
    return [
      {
        code: "CRS-002",
        severity: resolveSeverity("blocking", ctx.profile.rules["CRS-002"]?.severity),
        message: `${outside.length} feature(s) outside UTM valid envelope [E ${CRS_002_UTM_E_MIN}–${CRS_002_UTM_E_MAX}, N ${CRS_002_UTM_N_MIN}–${CRS_002_UTM_N_MAX}]`,
        details: { featureIds: outside.slice(0, 20) },
      },
    ];
  },
};

export const crs003: ValidationRule = {
  id: "CRS-003",
  group: "CRS",
  minimumSeverity: "info",
  appliesWhen: (profile) => profile.siteEnvelopes.length > 0,
  run(ctx) {
    const envelopes = ctx.profile.siteEnvelopes;
    const outside: string[] = [];
    for (const f of ctx.collection.features) {
      const positions = collectPositions(f.geometry.coordinates);
      const ok = positions.some((pos) => {
        const e = pos[0];
        const n = pos[1];
        if (e == null || n == null) return false;
        return envelopes.some(
          (env) => e >= env.minE && e <= env.maxE && n >= env.minN && n <= env.maxN,
        );
      });
      if (!ok && positions.length > 0) outside.push(f.id);
    }
    if (outside.length === 0) return [];
    return [
      {
        code: "CRS-003",
        severity: resolveSeverity("warning", ctx.profile.rules["CRS-003"]?.severity),
        message: `${outside.length} feature(s) outside all siteEnvelopes`,
        details: { featureIds: outside },
      },
    ];
  },
};

function referenceVertices(
  ref: NonNullable<import("../types.js").RuleContext["reference"]>,
): Array<{ id: string; e: number; n: number }> {
  if (ref.kind === "controlPoints") {
    return ref.points.map((p) => ({ id: p.id, e: p.e, n: p.n }));
  }
  const out: Array<{ id: string; e: number; n: number }> = [];
  for (const f of ref.features) {
    const positions = collectPositions(f.geometry.coordinates);
    const id = String(f.id ?? f.properties?.id ?? out.length);
    if (positions[0]) out.push({ id, e: positions[0][0]!, n: positions[0][1]! });
  }
  return out;
}

export const crs004: ValidationRule = {
  id: "CRS-004",
  group: "CRS",
  minimumSeverity: "blocking",
  appliesWhen: (profile, ctx) =>
    Boolean(ctx.reference) &&
    profile.tolerances.translationDetectMetres != null &&
    profile.tolerances.translationSpreadMetres != null,
  run(ctx) {
    const detect = ctx.profile.tolerances.translationDetectMetres!;
    const spreadTol = ctx.profile.tolerances.translationSpreadMetres!;
    const refs = referenceVertices(ctx.reference!);
    const byId = new Map(refs.map((r) => [r.id, r]));
    const offsets: Array<{ de: number; dn: number }> = [];

    for (const f of ctx.collection.features) {
      const key =
        String(f.attributes.asset_id ?? f.attributes.control_id ?? f.provenance.sourceEntityId ?? f.id);
      const ref = byId.get(key) ?? byId.get(f.id);
      if (!ref) continue;
      const pos = collectPositions(f.geometry.coordinates)[0];
      if (!pos) continue;
      offsets.push({ de: pos[0]! - ref.e, dn: pos[1]! - ref.n });
    }

    if (offsets.length < 2) {
      return [
        {
          code: "CRS-004",
          severity: resolveSeverity("blocking", ctx.profile.rules["CRS-004"]?.severity),
          message: `CRS-004 sample size too small (${offsets.length}); need matched vertices vs reference`,
          details: { sampleSize: offsets.length },
        },
      ];
    }

    const meanDe = offsets.reduce((s, o) => s + o.de, 0) / offsets.length;
    const meanDn = offsets.reduce((s, o) => s + o.dn, 0) / offsets.length;
    const mag = Math.hypot(meanDe, meanDn);
    const spreads = offsets.map((o) => Math.hypot(o.de - meanDe, o.dn - meanDn));
    const spread =
      Math.sqrt(spreads.reduce((s, v) => s + v * v, 0) / spreads.length) || 0;

    if (spread < spreadTol && mag > detect) {
      return [
        {
          code: "CRS-004",
          severity: resolveSeverity("blocking", ctx.profile.rules["CRS-004"]?.severity),
          message: `Uniform displacement detected: ΔE=${meanDe.toFixed(3)}, ΔN=${meanDn.toFixed(3)}, spread=${spread.toFixed(3)}, n=${offsets.length}`,
          details: { deltaE: meanDe, deltaN: meanDn, spread, sampleSize: offsets.length },
        },
      ];
    }
    return [];
  },
};

export const crs005: ValidationRule = {
  id: "CRS-005",
  group: "CRS",
  minimumSeverity: "blocking",
  appliesWhen: () => true,
  run(ctx) {
    const transforms = ctx.transforms ?? [];
    const issues: RuleIssue[] = [];
    for (const t of transforms) {
      const nonzero =
        (t.offsetE ?? 0) !== 0 ||
        (t.offsetN ?? 0) !== 0 ||
        (t.offsetZ ?? 0) !== 0 ||
        (t.rotationRadians ?? 0) !== 0 ||
        (t.scale != null && t.scale !== 1);
      if (!nonzero) continue;
      if (!t.declaredInProfile || !t.writtenToManifest) {
        issues.push({
          code: "CRS-005",
          severity: resolveSeverity("blocking", ctx.profile.rules["CRS-005"]?.severity),
          message: "Undeclared non-zero ingest transform",
          details: t,
        });
      }
    }
    return issues;
  },
};

export const crs006: ValidationRule = {
  id: "CRS-006",
  group: "CRS",
  minimumSeverity: "info",
  appliesWhen: (profile) =>
    profile.siteEnvelopes.some((e) => e.minZ != null || e.maxZ != null),
  run(ctx) {
    const zs: number[] = [];
    for (const f of ctx.collection.features) {
      for (const p of collectPositions(f.geometry.coordinates)) {
        if (p.length >= 3 && typeof p[2] === "number") zs.push(p[2]);
      }
    }
    if (zs.length === 0) return [];
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const ok = ctx.profile.siteEnvelopes.some((e) => {
      if (e.minZ == null && e.maxZ == null) return false;
      const lo = e.minZ ?? -Infinity;
      const hi = e.maxZ ?? Infinity;
      return minZ >= lo && maxZ <= hi;
    });
    if (ok) return [];
    return [
      {
        code: "CRS-006",
        severity: resolveSeverity("warning", ctx.profile.rules["CRS-006"]?.severity),
        message: `Z range [${minZ}, ${maxZ}] outside site envelope Z bounds`,
        details: { measuredMinZ: minZ, measuredMaxZ: maxZ },
      },
    ];
  },
};

export const CRS_RULES: ValidationRule[] = [crs001, crs002, crs003, crs004, crs005, crs006];
