import type { InfraFeatureClass, LayerMapping, MappingProfile } from "./types.js";

/** "*ROAD*CL*" → /^.*ROAD.*CL.*$/i. Only * and ? are special. */
export function wildcardToRegExp(rule: string): RegExp {
  const body = rule
    .trim()
    .split("")
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`, "i");
}

const cache = new Map<string, RegExp>();
export function matchesLayer(rule: string, layer: string): boolean {
  let re = cache.get(rule);
  if (!re) {
    re = wildcardToRegExp(rule);
    cache.set(rule, re);
  }
  return re.test(layer.trim());
}

/**
 * Binding an xref renames its layers to "<xref>$0$<layer>" ("$1$" and up on name clashes, repeated
 * for nested xrefs). Returns the designer's own layer name, or the name unchanged.
 */
export function stripBoundXrefPrefix(layer: string): string {
  return layer.replace(/^.*\$\d+\$/, "");
}

/**
 * First rule in the profile that matches the layer (exact names and wildcards alike). A bound-xref
 * layer is tried by its full name first, then by its own name, so "RD_CL" also maps "Xref Roads$0$RD_CL".
 */
export function findLayerMapping(profile: Pick<MappingProfile, "layers">, layer: string): LayerMapping | undefined {
  const own = stripBoundXrefPrefix(layer);
  return (
    profile.layers.find((l) => matchesLayer(l.dwgLayer, layer)) ??
    (own !== layer ? profile.layers.find((l) => matchesLayer(l.dwgLayer, own)) : undefined)
  );
}

/**
 * Keyword hints for layers no profile covers yet. Order matters: the first hit wins, so the
 * more specific road/centreline words come before generic ones. Covers the US National CAD
 * Standard (V-/C- prefixes), common Gulf-project names, and Arabic layer names.
 */
const HINTS: { cls: InfraFeatureClass; words: RegExp }[] = [
  // Point objects first: a sign or manhole on a ROAD/STRM layer is not a road or a pipe.
  { cls: "annotation", words: /(SIGN|LITE|LIGHT|POLE|MHOL|MANHOLE|INLT|INLET|VALV|VALVE|MRKR|MARKER|HYDRANT|HYDT|METER|TREE|SYMB|TEXT|ANNO|LABEL|NOTE|عمود|إنارة|اشارة|إشارة|غرفة)/i },
  // Road edges are not centrelines: leave them for a person to decide.
  { cls: "unmapped", words: /(CURB|KERB|EDGE|\bEOP\b|GUTTER|SHLD|SHOULDER|STRIPE|MARKING|DIM|HATCH|XREF|FRAME|VIEWPORT|DEFPOINTS|رصيف|حافة)/i },
  { cls: "road_centerline", words: /(CNTR|CENTER|CENTRE|C[-_ ]?L\b|\bCL\b|ALIGN|ROAD|STREET|\bRD\b|HWY|HIGHWAY|طريق|طرق|شارع|محور)/i },
  { cls: "parcel", words: /(PARCEL|PLOT|PROP|LOT|CADAST|BOUNDARY|قطع|قطعة|أراض|اراض|حدود)/i },
  { cls: "water", words: /(TOPO[-_ ]?WATR|WATR[-_ ]?(BODY|AREA|EDGE)|WATERCOURSE|HYDRO|WATER[-_ ]?BODY|POND|LAKE|WADI|RIVER|STREAM|HYDRO|CHANNEL|مياه|وادي|بحيرة|قناة)/i },
  { cls: "pipeline", words: /(PIPE|SSWR|SEWER|STRM|STORM|WATR|UTIL|DRAIN|GAS|POWR|ELEC|TELE|CATV|PHON|أنابيب|صرف|خطوط)/i },
  { cls: "coverage", words: /(COVER|LANDUSE|LAND[-_ ]?USE|ZONE|ZONING|LSCP|LANDSCAPE|GREEN|PARK|PAVE|استعمال|منطقة|تشجير)/i },
  { cls: "annotation", words: /(TEXT|ANNO|LABEL|DIM|NOTE|TITLE|نص|كتابة)/i },
];

export function suggestFeatureClass(layer: string): InfraFeatureClass {
  // Judge a bound-xref layer by its own name: the "Xref ..." prefix would read as XREF (unmapped).
  const own = stripBoundXrefPrefix(layer);
  for (const h of HINTS) if (h.words.test(own)) return h.cls;
  return "unmapped";
}

/** Join-key attribute a layer of this class usually carries. */
export function defaultJoinAttribute(cls: InfraFeatureClass): string | undefined {
  if (cls === "road_centerline") return "asset_id";
  if (cls === "parcel") return "parcel_id";
  if (cls === "pipeline") return "asset_id";
  return undefined;
}
