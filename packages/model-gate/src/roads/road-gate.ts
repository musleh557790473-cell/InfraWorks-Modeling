import type { DatabaseSync } from "node:sqlite";

import type { DxfEnt } from "@infraworks/domain";

import type { ModelFinding } from "../types.js";
import { curbReturnsFromDrawing, junctionCentre } from "./curb-returns.js";
import { danglingLinks, pruneDanglingIntersections, readJunctions } from "./intersections.js";
import { missingDrawnRoads } from "./merge.js";

/**
 * Gate G3 for a road model written by model:roads / model:intersections (no import package to compare
 * with): the model is checked against the designer's layout drawing and against itself.
 *
 *   G3-020 every drawn road is in the model (as a road, or a recorded part of a merged road: D1)
 *   G3-021 every intersection link points at a road definition
 *   G3-022 no junction rows left over (on deleted roads, without a parent, bodies of gone junctions)
 *   G3-023 roundabout type and ROUNDABOUTS row agree on every junction
 *   G3-024 roundabout arms are built (a blend point offset and no failed status)
 *   G3-025 kerb returns are the drawn radii (D8)
 *   G3-026 every road reaching a roundabout centre has an arm there (RA-3 lost its R.0.D.11 arm when a
 *          Grading Limit edit on R.9.G.5 cascaded through R.0.D.12 / R.0.D.15, 9 Nov 2026)
 */

/** XY points of a ROADS.GEOMETRY line blob (type 2, 3D). */
const linePoints = (blob: Uint8Array): [number, number][] => {
  const g = Buffer.from(blob), n = g.length >= 12 ? g.readUInt32LE(8) : 0, p: [number, number][] = [];
  for (let i = 0; i < n && 12 + 24 * i + 16 <= g.length; i++) p.push([g.readDoubleLE(12 + 24 * i), g.readDoubleLE(20 + 24 * i)]);
  return p;
};
const distToLine = (pts: [number, number][], c: [number, number]): number => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(c[0] - a[0] - dx * t, c[1] - a[1] - dy * t));
  }
  return best;
};

/** Roads whose centreline passes within `tol` m of a roundabout's centre but have no arm on it. */
export function roundaboutArmGaps(db: DatabaseSync, tol = 1.0): { id: number; road: string }[] {
  const ras = db.prepare("select ID id, GUID g, REFERENCE_POINTS rp from INTERSECTIONS where INTERSECTION_TYPE = 1").all() as { id: number; g: string; rp: Uint8Array | null }[];
  const roads = (db.prepare("select NAME n, FK_PARENT_GUID d, GEOMETRY geo from ROADS where FK_PARENT_GUID is not null and GEOMETRY is not null").all() as { n: string; d: string; geo: Uint8Array }[])
    .map((r) => ({ n: r.n, d: r.d, pts: linePoints(r.geo) }));
  const out: { id: number; road: string }[] = [];
  for (const ra of ras) {
    let c: [number, number];
    try { c = junctionCentre(ra.rp ?? new Uint8Array()); } catch { continue; }
    const armed = new Set((db.prepare("select FK_ASSET_GUID g from INTERSECTION_ARMS where FK_PARENT_GUID = ?").all(ra.g) as { g: string }[]).map((a) => a.g));
    for (const r of roads) if (!armed.has(r.d) && distToLine(r.pts, c) <= tol) out.push({ id: ra.id, road: r.n });
  }
  return out;
}

const f = (ruleId: string, rule: string, severity: ModelFinding["severity"], message: string, context?: Record<string, string>): ModelFinding =>
  ({ ruleId, rule, code: ruleId.replace("-", "_"), severity, message, ...(context ? { context } : {}) });

/** Road names in the layout: the texts on layer "0-Alignment Name", MTEXT formatting codes stripped (each road is labelled twice). */
export function drawnRoadNames(layout: readonly DxfEnt[], layer = "0-Alignment Name"): string[] {
  const names = new Set<string>();
  for (const e of layout) {
    if (!e.layer.endsWith(layer) || !/TEXT/.test(e.type)) continue;
    const t = (e.txt ?? "").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "").trim();
    if (t) names.add(t);
  }
  return [...names].sort();
}

export interface RoadGateOptions {
  /** drawn names that are not expected as roads (the roundabout rings InfraWorks builds as intersections) */
  notRoads?: RegExp;
}

export function roadModelFindings(db: DatabaseSync, layout: readonly DxfEnt[], opts: RoadGateOptions = {}): ModelFinding[] {
  const out: ModelFinding[] = [];
  const notRoads = opts.notRoads ?? /^RA-\d+$/;
  const has = (t: string) => Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t));

  /* G3-020 drawn roads present */
  const drawn = drawnRoadNames(layout).filter((n) => !notRoads.test(n));
  const roads = db.prepare("select NAME, DESCRIPTION from ROADS").all() as { NAME: string; DESCRIPTION: string | null }[];
  const missing = missingDrawnRoads(roads, drawn);
  if (!drawn.length) out.push(f("G3-020", "Drawn roads in the model", "warning", "The layout has no road names on layer 0-Alignment Name; nothing to compare."));
  else if (missing.length) out.push(f("G3-020", "Drawn roads in the model", "blocking", `${missing.length} of ${drawn.length} drawn roads are neither a road nor a recorded part of a merged road: ${missing.join(" ")}`, { missing: missing.join(" ") }));
  else out.push(f("G3-020", "Drawn roads in the model", "info", `All ${drawn.length} drawn roads are in the model (${roads.length} roads; merged pairs recorded in their Description).`));

  if (!has("INTERSECTIONS") || !has("INTERSECTION_ARMS")) return out;

  /* G3-021 links */
  const dangling = danglingLinks(db);
  out.push(dangling ? f("G3-021", "Intersection links", "blocking", `${dangling} intersection arm / region link(s) point at no road definition.`) : f("G3-021", "Intersection links", "info", "Every intersection arm and region points at a road definition."));

  /* G3-022 leftovers */
  const prune = pruneDanglingIntersections(db, { dry: true });
  const left = prune.removed.length + prune.orphans + prune.bodies;
  out.push(left
    ? f("G3-022", "Junction rows left over", "warning", `${prune.removed.length} intersection(s) left on a deleted road, ${prune.orphans} arm / region / roundabout row(s) without a junction, ${prune.bodies} body row(s) of junctions that no longer exist (model:intersections cleans them).`)
    : f("G3-022", "Junction rows left over", "info", "No junction rows left over."));

  /* G3-023 roundabout rows */
  const js = readJunctions(db);
  const bad = js.filter((j) => j.problem);
  out.push(bad.length
    ? f("G3-023", "Roundabout rows", "blocking", bad.map((j) => `junction ${j.id}: ${j.problem}`).join("; "))
    : f("G3-023", "Roundabout rows", "info", `${js.filter((j) => j.type === "roundabout").length} roundabout(s) and ${js.filter((j) => j.type === "intersection").length} intersection(s), rows consistent.`));

  /* G3-024 roundabout arms */
  const arms = db.prepare(`select i.ID id, a.ARM_INDEX ix, a.BLEND_POINT_ENTRY_OFFSET o, a.STATUS st from INTERSECTION_ARMS a join INTERSECTIONS i on i.GUID = a.FK_PARENT_GUID
    where i.INTERSECTION_TYPE = 1 and (a.BLEND_POINT_ENTRY_OFFSET is null or a.BLEND_POINT_ENTRY_OFFSET <= 0 or a.STATUS <> 0 or a.ARM_INDEX is null or a.ARM_INDEX < 1) order by i.ID, a.ARM_INDEX`).all() as { id: number; ix: number | null; o: number | null; st: number | null }[];
  out.push(arms.length
    ? f("G3-024", "Roundabout arms built", "warning", `${arms.length} roundabout arm(s) not built: ${arms.map((a) => `junction ${a.id} arm ${a.ix ?? "?"} (offset ${a.o ?? "null"}, status ${a.st ?? "null"})`).join("; ")}`)
    : f("G3-024", "Roundabout arms built", "info", "Every roundabout arm has a blend point and a clean status."));

  /* G3-025 kerb returns as drawn */
  if (has("INTERSECTION_REGIONS")) {
    const kerbs = curbReturnsFromDrawing(db, layout, { dry: true });
    const differ = kerbs.filter((k) => k.status === "set" || k.status === "ambiguous");
    const none = kerbs.filter((k) => k.status === "no drawn arc");
    const msg = `${kerbs.length} corners: ${kerbs.filter((k) => k.status === "unchanged").length} at the drawn radius, ${differ.length} differ, ${none.length} without a drawn arc.`;
    out.push(differ.length
      ? f("G3-025", "Kerb returns as drawn", "warning", `${msg} Differing: ${differ.slice(0, 20).map((k) => `junction ${k.id} region ${k.region} ${k.was} -> ${k.drawn}`).join("; ")}${differ.length > 20 ? " ..." : ""} (model:intersections --curb-returns writes them).`)
      : f("G3-025", "Kerb returns as drawn", "info", msg));
  }

  /* G3-026 roads at roundabouts have their arm */
  const gaps = roundaboutArmGaps(db);
  out.push(gaps.length
    ? f("G3-026", "Roundabout arms present", "blocking", `${gaps.length} road(s) reach a roundabout centre without an arm there: ${gaps.map((g) => `junction ${g.id} ${g.road}`).join("; ")} (InfraWorks dropped or never made the arm).`)
    : f("G3-026", "Roundabout arms present", "info", "Every road reaching a roundabout centre has an arm there."));
  return out;
}
