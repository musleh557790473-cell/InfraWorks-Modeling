import type { DatabaseSync } from "node:sqlite";

import type { DxfEnt } from "@infraworks/domain";
import { parseFgf } from "@infraworks/imx-gate";

/**
 * Kerb return radii from the designer's layout (deviation D8, Al Qairawan): every INTERSECTION_REGIONS
 * row is one corner of a junction, between the incoming road and the outgoing road; InfraWorks gives it
 * its own radius (9 m on most of Al Qairawan, 11 / 12 / 10 elsewhere, taper types on a few). Parsons
 * draws each corner as an arc on layer -RD_Edges (10200 drawing): r 10 on the local roads, 12 and 11
 * on the collectors, 20 at the roundabout entries. The arc's centre lies in the corner's quadrant,
 * 10-30 m from the junction centre on the divided roads, so a corner is matched to the drawn arc whose
 * centre bears within `wedge` degrees of the corner's own direction (the centroid of the region
 * geometry; checked on all 634 regions of the model on 7 Nov 2026: the corner always lies in the wedge
 * between the incoming arm, before the centre when SAME_DIRECTION_AS_INCOMING_ASSET, and the outgoing
 * arm, after the centre when SAME_DIRECTION_AS_OUTGOING_ASSET). Tiny fillets (r < `minRadius`) and
 * arcs sweeping less than `minSweep` degrees are not kerb returns.
 */

export interface KerbArc { cx: number; cy: number; r: number; /** sweep in degrees; NaN for an ARC entity, whose angles the reader does not keep */ deg: number }

/**
 * The layer the kerb returns are drawn on: Al Narjis (IRO-10001) has its own RD_CURB_RETURN, at the
 * radii dimensioned on the plan (R12.00, R14.00; its RD_Edge arcs lie 0.30 m out, the kerb width);
 * Al Qairawan (10200) draws them on -RD_Edges.
 */
export const kerbLayer = (layout: readonly DxfEnt[]) => (layout.some((e) => e.layer === "RD_CURB_RETURN") ? "RD_CURB_RETURN" : "RD_Edges");

/** Arcs on the road-edge layer: LWPOLYLINE bulge segments (true centre and sweep) and ARC entities (centre, radius). */
export function kerbArcs(layout: readonly DxfEnt[], layer = kerbLayer(layout)): KerbArc[] {
  const out: KerbArc[] = [];
  for (const e of layout) {
    if (!e.layer.endsWith(layer)) continue;
    if (e.type === "ARC" && e.r != null && e.x.length) { out.push({ cx: e.x[0]!, cy: e.y[0]!, r: e.r, deg: NaN }); continue; }
    if (e.type !== "LWPOLYLINE" || !e.bulge) continue;
    for (let k = 0; k + 1 < e.x.length; k++) {
      const bg = e.bulge[k]; if (!bg) continue;
      const a = [e.x[k]!, e.y[k]!], b = [e.x[k + 1]!, e.y[k + 1]!];
      const th = 4 * Math.atan(bg), c = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      if (!c) continue;
      const r = c / (2 * Math.sin(th / 2)), h = r * Math.cos(th / 2), ux = (b[0]! - a[0]!) / c, uy = (b[1]! - a[1]!) / c;
      out.push({ cx: (a[0]! + b[0]!) / 2 - uy * h, cy: (a[1]! + b[1]!) / 2 + ux * h, r: Math.abs(r), deg: (Math.abs(th) * 180) / Math.PI });
    }
  }
  return out;
}

export interface CurbReturn {
  id: number;
  region: number;
  /** bearing of the corner from the junction centre, degrees from north */
  corner: number;
  /** InfraWorks' radius before */
  was: number | null;
  /** the drawn radius, or null when no arc lies in the corner */
  drawn: number | null;
  /** other drawn radii in the same corner (a compound curve), if any */
  others: number[];
  status: "set" | "unchanged" | "no drawn arc" | "ambiguous";
}

export interface CurbReturnOptions {
  dry?: boolean;
  /** junction IDs to limit to */
  only?: readonly number[];
  /** arcs whose centre is farther from the junction centre are not its kerb returns (m) */
  near?: number;
  /** half-angle of the corner wedge (degrees) */
  wedge?: number;
  minRadius?: number;
  maxRadius?: number;
  minSweep?: number;
}

const bearing = (fx: number, fy: number, tx: number, ty: number) => ((Math.atan2(tx - fx, ty - fy) * 180) / Math.PI + 360) % 360;
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Junction centre from REFERENCE_POINTS (a Point, or a MultiPoint on some junctions: 51, 300, 303). */
export function junctionCentre(rp: Uint8Array): [number, number] {
  const p = parseFgf(Buffer.from(rp)).points[0];
  if (!p) throw new Error("junction without a reference point");
  return [p[0]!, p[1]!];
}

/**
 * Writes the drawn kerb return radius on every junction corner that has one. The region keeps its
 * other settings; CURB_RETURN_TYPE 2 is InfraWorks' plain radius type, INPUT_CURB_RETURN_TYPE 2 and
 * MANUALLY_CHANGED 1 are what the Stack writes when a user sets a Turning Zone's radius (assumed; to
 * be confirmed on the first rebuild in InfraWorks). Corners with no drawn arc, and roundabouts, are
 * left as they are. Returns one entry per corner looked at.
 */
export function curbReturnsFromDrawing(db: DatabaseSync, layout: readonly DxfEnt[], opts: CurbReturnOptions = {}): CurbReturn[] {
  const near = opts.near ?? 35, wedge = opts.wedge ?? 35, minR = opts.minRadius ?? 3, maxR = opts.maxRadius ?? 40, minSweep = opts.minSweep ?? 20;
  const arcs = kerbArcs(layout).filter((a) => a.r >= minR && a.r <= maxR && (Number.isNaN(a.deg) || a.deg >= minSweep));
  const out: CurbReturn[] = [];
  const js = (db.prepare("select ID id, GUID g, REFERENCE_POINTS rp from INTERSECTIONS where INTERSECTION_TYPE = 0 or INTERSECTION_TYPE is null order by ID").all() as { id: number; g: string; rp: Uint8Array }[])
    .filter((j) => !opts.only || opts.only.includes(Number(j.id)));
  // prepared only when writing: on a read-only connection preparing an UPDATE parses InfraWorks' triggers
  const upd = opts.dry ? null : db.prepare("update INTERSECTION_REGIONS set CURB_RETURN_RADIUS = ?, CURB_RETURN_TYPE = 2, INPUT_CURB_RETURN_TYPE = 2, MANUALLY_CHANGED = 1 where ID = ?");
  if (!opts.dry) db.exec("savepoint kerbs");
  try {
    for (const j of js) {
      const [cx, cy] = junctionCentre(j.rp);
      const local = arcs.filter((a) => Math.hypot(a.cx - cx, a.cy - cy) <= near);
      for (const r of db.prepare("select ID rid, GEOMETRY geom, CURB_RETURN_RADIUS cr from INTERSECTION_REGIONS where FK_PARENT_GUID = ?").all(j.g) as { rid: number; geom: Uint8Array | null; cr: number | null }[]) {
        if (!r.geom) continue;
        const pts = parseFgf(Buffer.from(r.geom)).points;
        const c = pts.reduce<[number, number]>((m, p) => [m[0] + p[0]! / pts.length, m[1] + p[1]! / pts.length], [0, 0]);
        const corner = bearing(cx, cy, c[0], c[1]);
        const cands = local.map((a) => ({ a, off: angDiff(bearing(cx, cy, a.cx, a.cy), corner) })).filter((x) => x.off <= wedge).sort((p, q) => p.off - q.off);
        const radii = [...new Set(cands.map((x) => Math.round(x.a.r * 100) / 100))];
        const was = r.cr == null ? null : Number(r.cr);
        if (!radii.length) { out.push({ id: Number(j.id), region: Number(r.rid), corner, was, drawn: null, others: [], status: "no drawn arc" }); continue; }
        const drawn = radii[0]!, others = radii.slice(1);
        const status: CurbReturn["status"] = was != null && Math.abs(was - drawn) < 0.005 ? "unchanged" : others.length ? "ambiguous" : "set";
        out.push({ id: Number(j.id), region: Number(r.rid), corner, was, drawn, others, status });
        if (upd && status !== "unchanged") upd.run(drawn, Number(r.rid));
      }
    }
    if (!opts.dry) db.exec("release kerbs");
  } catch (e) {
    if (!opts.dry) db.exec("rollback to kerbs; release kerbs");
    throw e;
  }
  return out;
}
