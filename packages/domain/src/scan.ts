import type { DomainStore } from "./store.js";
import type { ConvertOptions } from "./convert.js";
import { loadCad } from "./pipeline.js";
import { defaultJoinAttribute, findLayerMapping, suggestFeatureClass } from "./layers.js";
import { readReport } from "./reports.js";
import type { InfraFeatureClass, MappingProfile } from "./types.js";

export interface LayerScanRow {
  layer: string;
  entityCount: number;
  types: Record<string, number>;
  /** Class from the profile rule that matched, or a keyword suggestion when no rule did. */
  infraFeatureClass: InfraFeatureClass;
  joinKeyAttribute?: string;
  source: "profile" | "suggested" | "none";
  /** The profile rule that matched, e.g. "*ROAD*CL*". */
  rule?: string;
}

export interface CadScan {
  file?: string;
  converter?: string;
  conversionError?: string;
  layers: LayerScanRow[];
  notes: string[];
  skippedEntities: Record<string, number>;
  insunits?: number;
  keyStats: { xdata: number; attribute: number; text: number; missing: number };
}

/**
 * What the latest drawing contains, seen through a mapping profile: every layer with its
 * entity types and the class it would get. Drives the mapping screen, so a team's
 * drawing can be mapped once and saved as that team's profile.
 */
export async function scanProjectCad(
  store: DomainStore,
  projectId: string,
  profile: MappingProfile,
  opts?: ConvertOptions,
): Promise<CadScan> {
  const cad = await loadCad(store, projectId, profile, opts);
  const layers: LayerScanRow[] = cad.parsed.layers.map((l) => {
    const rule = findLayerMapping(profile, l.name);
    if (rule) {
      return {
        layer: l.name,
        entityCount: l.entityCount,
        types: l.types,
        infraFeatureClass: rule.infraFeatureClass,
        joinKeyAttribute: rule.joinKeyAttribute,
        source: "profile",
        rule: rule.dwgLayer,
      };
    }
    // A layer holding only text is a label layer (useful for asset ids), never geometry.
    const onlyText = Object.keys(l.types).every((t) => t === "TEXT" || t === "MTEXT");
    const cls = onlyText ? "unmapped" : suggestFeatureClass(l.name);
    return {
      layer: l.name,
      entityCount: l.entityCount,
      types: l.types,
      infraFeatureClass: cls,
      joinKeyAttribute: defaultJoinAttribute(cls),
      source: cls === "unmapped" ? "none" : "suggested",
    };
  });
  return {
    file: cad.upload?.filename,
    converter: cad.parsed.converter?.engine,
    conversionError: cad.conversionError,
    layers,
    notes: cad.parsed.notes,
    skippedEntities: cad.parsed.skippedEntities,
    insunits: cad.parsed.insunits,
    keyStats: cad.parsed.keyStats,
  };
}

/** Columns (and sheets, for Excel) of every report upload, for picking join columns. */
export async function scanProjectReports(store: DomainStore, projectId: string) {
  const reports = store.listUploads(projectId).filter((u) => u.kind === "csv" || u.kind === "xlsx");
  const out: { uploadId: string; filename: string; kind: string; columns: string[]; sheets?: string[]; rowCount: number; error?: string }[] = [];
  for (const r of reports) {
    try {
      const t = await readReport(r.path, r.kind);
      out.push({ uploadId: r.id, filename: r.filename, kind: r.kind, columns: t.columns, sheets: t.sheets, rowCount: t.rows.length });
    } catch (err) {
      out.push({ uploadId: r.id, filename: r.filename, kind: r.kind, columns: [], rowCount: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
