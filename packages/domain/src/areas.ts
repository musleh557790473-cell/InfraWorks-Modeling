import polygonClipping from "polygon-clipping";
import type { MultiPolygon as ClipMulti, Polygon as ClipPolygon } from "polygon-clipping";

import { findLayerMapping, matchesLayer, stripBoundXrefPrefix } from "./layers.js";
import type { DomainFeature, Geometry, MappingProfile } from "./types.js";

type Bbox = [number, number, number, number];

function polygonsOf(g: Geometry): ClipPolygon[] {
  if (g.type === "Polygon") return [g.coordinates as ClipPolygon];
  if (g.type === "MultiPolygon") return g.coordinates as ClipMulti;
  return [];
}

function bboxOf(polys: ClipPolygon[]): Bbox {
  const b: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const [x, y] of p[0] ?? []) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

const overlaps = (a: Bbox, b: Bbox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function matchesAny(rules: string[], layer: string): boolean {
  const own = stripBoundXrefPrefix(layer);
  return rules.some((r) => matchesLayer(r, layer) || matchesLayer(r, own));
}

/**
 * For each rule with `subtract`, cut the closed areas of the named layers out of the rule's own
 * areas: the road reserve is the site boundary minus the blocks its right-of-way lines enclose.
 * Areas cut away entirely are dropped. Only the rule's areas change; the cutters stay as they are.
 */
export function subtractAreas(features: DomainFeature[], profile: Pick<MappingProfile, "layers">): { features: DomainFeature[]; notes: string[] } {
  const rules = profile.layers.filter((l) => l.subtract?.length);
  if (!rules.length) return { features, notes: [] };

  const notes: string[] = [];
  const dropped = new Set<string>();
  const replaced = new Map<string, DomainFeature>();

  for (const rule of rules) {
    const targets = features.filter((f) => {
      const layer = f.provenance.sourceLayer ?? "";
      return findLayerMapping(profile, layer) === rule && polygonsOf(f.geometry).length > 0;
    });
    if (!targets.length) continue;
    const cutters = features
      .filter((f) => !targets.includes(f) && matchesAny(rule.subtract!, f.provenance.sourceLayer ?? ""))
      .map((f) => polygonsOf(f.geometry))
      .filter((p) => p.length > 0)
      .map((p) => ({ polys: p, bbox: bboxOf(p) }));

    let used = 0;
    let area0 = 0;
    let area1 = 0;
    for (const t of targets) {
      const own = polygonsOf(t.geometry);
      const box = bboxOf(own);
      const near = cutters.filter((c) => overlaps(c.bbox, box));
      used += near.length;
      area0 += areaOf(own);
      const out = near.length ? polygonClipping.difference(own, ...near.map((c) => c.polys)) : own;
      area1 += areaOf(out);
      if (!out.length) {
        dropped.add(t.id);
        continue;
      }
      const geometry: Geometry = out.length === 1 ? { type: "Polygon", coordinates: out[0]! } : { type: "MultiPolygon", coordinates: out };
      replaced.set(t.id, { ...t, geometry });
    }
    notes.push(
      `${rule.outputLayer ?? rule.dwgLayer}: ${targets.length} area(s) on "${rule.dwgLayer}" minus ${used} closed area(s) on ` +
        `${rule.subtract!.map((s) => `"${s}"`).join(", ")}: ${(area0 / 1e6).toFixed(3)} km² → ${(area1 / 1e6).toFixed(3)} km²`,
    );
  }

  return {
    features: features.filter((f) => !dropped.has(f.id)).map((f) => replaced.get(f.id) ?? f),
    notes,
  };
}

/** Plan area, holes taken out. */
export function areaOf(polys: ClipPolygon[]): number {
  let s = 0;
  for (const p of polys) {
    p.forEach((ring, i) => {
      const a = Math.abs(shoelace(ring));
      s += i === 0 ? a : -a;
    });
  }
  return s;
}

function shoelace(ring: number[][]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!;
  return s / 2;
}
