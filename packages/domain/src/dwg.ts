import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import DxfParserImport from "dxf-parser";

type DxfParserCtor = new () => { parseSync: (text: string) => unknown };
const DxfParser: DxfParserCtor = ((DxfParserImport as unknown as { default?: DxfParserCtor; DxfParser?: DxfParserCtor })
  .DxfParser ??
  (DxfParserImport as unknown as { default?: DxfParserCtor }).default ??
  (DxfParserImport as unknown as DxfParserCtor)) as DxfParserCtor;
import type { DomainFeature, InfraFeatureClass } from "./types.js";
import type { ProjectProfile } from "./profile.js";
import { ParseError, PARSE_CODES } from "./parse-error.js";
import type { ParseMeta } from "./rules/types.js";

export interface ParsedDwgLayer {
  name: string;
  entityCount: number;
}

export interface ParsedDwg {
  layers: ParsedDwgLayer[];
  features: DomainFeature[];
  format: "dxf" | "dwg";
  notes: string[];
  parseMeta: ParseMeta;
}

type LayerMap = { dwgLayer: string; infraFeatureClass: InfraFeatureClass; joinKeyAttribute?: string };

function layerClass(layers: LayerMap[], layer: string): InfraFeatureClass {
  const mapping = layers.find((l) => l.dwgLayer.toLowerCase() === layer.toLowerCase());
  return mapping?.infraFeatureClass ?? "unmapped";
}

function joinAttr(layers: LayerMap[], layer: string): string | undefined {
  return layers.find((l) => l.dwgLayer.toLowerCase() === layer.toLowerCase())?.joinKeyAttribute;
}

/**
 * Parse user CAD. Never synthesizes geometry (IGN-001).
 * DXF via `dxf-parser`; binary DWG via `@mlightcad/libredwg-web` when available,
 * otherwise throws ParseError (no stub).
 */
export function parseCadInput(
  filePath: string,
  filename: string,
  profile: Pick<ProjectProfile, "layers">,
): ParsedDwg {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dxf")) {
    return parseDxfFile(filePath, filename, profile.layers);
  }
  if (lower.endsWith(".dwg")) {
    return parseDwgFile(filePath, filename, profile.layers);
  }
  throw new ParseError(
    PARSE_CODES.IGN_001_NO_ENTITIES,
    `Unsupported CAD extension for ${filename}`,
  );
}

function parseDxfFile(filePath: string, filename: string, layers: LayerMap[]): ParsedDwg {
  const text = readFileSync(filePath, "utf8");
  const parser = new DxfParser();
  let dxf: {
    entities?: Array<Record<string, unknown>>;
    header?: Record<string, unknown>;
  } | null;
  try {
    dxf = parser.parseSync(text) as typeof dxf;
  } catch (err) {
    throw new ParseError(
      PARSE_CODES.IGN_001_NO_ENTITIES,
      `DXF parse failed for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!dxf) {
    throw new ParseError(PARSE_CODES.IGN_001_NO_ENTITIES, `DXF parse returned empty for ${filename}`);
  }

  const entityCountsByType: Record<string, number> = {};
  const unsupportedEntityCounts: Record<string, number> = {};
  const layerCounts: Record<string, number> = {};
  const features: DomainFeature[] = [];
  let ocsRejectedCount = 0;
  let hasAnyZ = false;

  const entities = (dxf.entities ?? []) as Array<Record<string, unknown>>;
  for (const ent of entities) {
    const type = String(ent.type ?? "UNKNOWN");
    entityCountsByType[type] = (entityCountsByType[type] ?? 0) + 1;

    const extrusion = ent.extrusionDirection as { x?: number; y?: number; z?: number } | undefined;
    if (
      extrusion &&
      (extrusion.x !== 0 || extrusion.y !== 0 || (extrusion.z != null && extrusion.z !== 1))
    ) {
      ocsRejectedCount += 1;
      continue;
    }

    const layer = String(ent.layer ?? "0");
    layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;

    const built = entityToFeature(ent, type, layer, filename, layers);
    if (!built) {
      unsupportedEntityCounts[type] = (unsupportedEntityCounts[type] ?? 0) + 1;
      continue;
    }
    if (built.hasZ) hasAnyZ = true;
    features.push(built.feature);
  }

  // Header $INSUNITS
  const header = (dxf.header ?? {}) as Record<string, { value?: number } | number | undefined>;
  const insRaw = header.$INSUNITS ?? header.INSUNITS;
  let insunits: number | null = null;
  if (typeof insRaw === "number") insunits = insRaw;
  else if (insRaw && typeof insRaw === "object" && typeof insRaw.value === "number") {
    insunits = insRaw.value;
  } else if (!("$INSUNITS" in header) && !("INSUNITS" in header)) {
    insunits = null;
  }

  if (features.length === 0) {
    throw new ParseError(
      PARSE_CODES.IGN_001_NO_ENTITIES,
      `No supported entities in ${filename}`,
      { entityCountsByType, unsupportedEntityCounts },
    );
  }

  return {
    layers: Object.entries(layerCounts).map(([name, entityCount]) => ({ name, entityCount })),
    features,
    format: "dxf",
    notes: [`Parsed ${features.length} entities via dxf-parser`],
    parseMeta: {
      entityCountsByType,
      layerCounts,
      parserPath: "dxf",
      sourceFile: filename,
      unsupportedEntityCounts,
      insunits,
      hasAnyZ,
      ocsRejectedCount,
    },
  };
}

function entityToFeature(
  ent: Record<string, unknown>,
  type: string,
  layer: string,
  filename: string,
  layers: LayerMap[],
): { feature: DomainFeature; hasZ: boolean } | null {
  const ja = joinAttr(layers, layer);
  const baseAttrs: Record<string, string | number | boolean | null> = {
    layer,
    ...(ja ? { [ja]: String(ent.handle ?? `${layer}-${nanoid(4)}`) } : {}),
  };
  const provenance = {
    sourceFile: filename,
    sourceLayer: layer,
    sourceEntityId: ent.handle != null ? String(ent.handle) : undefined,
  };
  const cls = layerClass(layers, layer);

  if (type === "LINE") {
    const verts = ent.vertices as unknown[] | undefined;
    const s = verts?.[0] ?? ent.startPoint ?? ent.start;
    const e = verts?.[1] ?? ent.endPoint ?? ent.end;
    const a = asPoint(s);
    const b = asPoint(e);
    if (!a || !b) return null;
    const hasZ = a.length > 2 || b.length > 2;
    return {
      hasZ,
      feature: {
        id: nanoid(8),
        infraFeatureClass: cls,
        geometry: { type: "LineString", coordinates: [a, b] },
        attributes: baseAttrs,
        provenance,
      },
    };
  }

  if (type === "LWPOLYLINE" || type === "POLYLINE") {
    const verts = (ent.vertices as unknown[]) ?? [];
    const coords = verts.map(asPoint).filter(Boolean) as Array<[number, number] | [number, number, number]>;
    if (coords.length < 2) return null;
    const closed = Boolean(ent.shape || ent.closed);
    if (closed && (coords[0]![0] !== coords[coords.length - 1]![0] || coords[0]![1] !== coords[coords.length - 1]![1])) {
      coords.push(coords[0]!);
    }
    const hasZ = coords.some((c) => c.length > 2);
    if (closed && coords.length >= 4) {
      return {
        hasZ,
        feature: {
          id: nanoid(8),
          infraFeatureClass: cls,
          geometry: { type: "Polygon", coordinates: [coords] },
          attributes: baseAttrs,
          provenance,
        },
      };
    }
    return {
      hasZ,
      feature: {
        id: nanoid(8),
        infraFeatureClass: cls,
        geometry: { type: "LineString", coordinates: coords },
        attributes: baseAttrs,
        provenance,
      },
    };
  }

  if (type === "POINT") {
    const p = asPoint(ent.position ?? ent);
    if (!p) return null;
    return {
      hasZ: p.length > 2,
      feature: {
        id: nanoid(8),
        infraFeatureClass: cls,
        geometry: { type: "Point", coordinates: p },
        attributes: baseAttrs,
        provenance,
      },
    };
  }

  return null;
}

function asPoint(v: unknown): [number, number] | [number, number, number] | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { x?: number; y?: number; z?: number; X?: number; Y?: number; Z?: number };
  const x = o.x ?? o.X;
  const y = o.y ?? o.Y;
  const z = o.z ?? o.Z;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (typeof z === "number") return [x, y, z];
  return [x, y];
}

function parseDwgFile(filePath: string, filename: string, layers: LayerMap[]): ParsedDwg {
  // Wired dependency: @mlightcad/libredwg-web (WASM). Node sync path: accept DXF
  // bytes mislabeled as .dwg; otherwise fail loud — never synthesize (IGN-001 / §6.4).
  const buf = readFileSync(filePath);
  const head = buf.subarray(0, 64).toString("utf8");
  if (head.includes("SECTION") || /^\s*0\s/.test(head)) {
    return parseDxfFile(filePath, filename, layers);
  }

  throw new ParseError(
    PARSE_CODES.IGN_DWG_UNSUPPORTED,
    `Binary DWG ${filename} (${buf.length} bytes): convert to DXF for local parse. Dependency @mlightcad/libredwg-web is wired for WASM environments; sync Node decode is not available. Synthetic geometry is forbidden (IGN-001).`,
    { bytes: buf.length, lib: "@mlightcad/libredwg-web" },
  );
}
