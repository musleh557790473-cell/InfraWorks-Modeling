/**
 * InfraWorks intersections in a closed model file.
 *
 * InfraWorks stores an intersection as one INTERSECTIONS row, one INTERSECTION_ARMS row per arm
 * (a road leaving the junction; a road passing through gives two arms, one per direction) and one
 * INTERSECTION_REGIONS row per kerb return between two arms. Arms and regions point at roads by the
 * road's CONSTRAINED_DEFINITIONS GUID (FK_ASSET_GUID, FK_INCOMING/OUTGOING_ASSET_GUID).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { parseFgf } from "@infraworks/imx-gate";

export interface PrunedIntersection {
  id: number;
  guid: string;
  /** Names of the roads that still have arms here. */
  roads: string[];
  arms: number;
  regions: number;
}

export interface PruneResult {
  /** Intersections removed: after dropping the dead road, fewer than two roads met there. */
  removed: PrunedIntersection[];
  /**
   * Intersections that lost an arm but still join two or more roads. InfraWorks turns them into a
   * smaller junction (cross to T) with new kerb returns; that is not guessed here, they are left as
   * they are and listed for a rebuild in InfraWorks.
   */
  kept: PrunedIntersection[];
  /** Arms and regions whose parent intersection no longer exists, removed. */
  orphans: number;
}

type Row = Record<string, unknown>;

/**
 * Removes the intersections left pointing at a deleted road, as InfraWorks does when a road is
 * deleted (Autodesk InfraWorks tutorial "Roads Tutorial 3 Exercise 1: Creating Intersections":
 * deleting the road, "the lower intersection disappears and the upper intersection reverts to its
 * previous appearance as a simple T-junction").
 *
 * An intersection whose live arms come from fewer than two roads is no junction any more (only the
 * through road is left) and goes, with its arms and regions. One that still joins two roads or more
 * is reported in `kept`, unchanged. With `dry`, nothing is written.
 */
export function pruneDanglingIntersections(db: DatabaseSync, opts: { dry?: boolean } = {}): PruneResult {
  const live = new Set((db.prepare("select GUID from CONSTRAINED_DEFINITIONS").all() as Row[]).map((r) => String(r.GUID)));
  const names = new Map(
    (db.prepare("select c.GUID g, r.NAME n from CONSTRAINED_DEFINITIONS c join ROADS r on r.FK_PARENT_GUID = c.GUID").all() as Row[]).map((r) => [String(r.g), String(r.n)]),
  );
  const res: PruneResult = { removed: [], kept: [], orphans: 0 };
  const work: (() => void)[] = [];
  for (const i of db.prepare("select ID, GUID from INTERSECTIONS order by ID").all() as Row[]) {
    const guid = String(i.GUID);
    const arms = (db.prepare("select FK_ASSET_GUID g from INTERSECTION_ARMS where FK_PARENT_GUID = ?").all(guid) as Row[]).map((r) => String(r.g));
    const regs = db.prepare("select FK_INCOMING_ASSET_GUID a, FK_OUTGOING_ASSET_GUID b from INTERSECTION_REGIONS where FK_PARENT_GUID = ?").all(guid) as Row[];
    const dead = arms.some((g) => !live.has(g)) || regs.some((r) => [r.a, r.b].some((g) => g != null && !live.has(String(g))));
    if (!dead) continue;
    const roads = [...new Set(arms.filter((g) => live.has(g)))];
    const item: PrunedIntersection = { id: Number(i.ID), guid, roads: roads.map((g) => names.get(g) ?? g), arms: arms.length, regions: regs.length };
    if (roads.length >= 2) { res.kept.push(item); continue; }
    res.removed.push(item);
    work.push(() => {
      db.prepare("delete from INTERSECTION_REGIONS where FK_PARENT_GUID = ?").run(guid);
      db.prepare("delete from INTERSECTION_ARMS where FK_PARENT_GUID = ?").run(guid);
      db.prepare("delete from INTERSECTIONS where GUID = ?").run(guid);
    });
  }
  const orphanWhere = "where not exists (select 1 from INTERSECTIONS i where i.GUID = t.FK_PARENT_GUID)";
  for (const t of ["INTERSECTION_ARMS", "INTERSECTION_REGIONS"]) {
    res.orphans += Number((db.prepare(`select count(*) n from ${t} t ${orphanWhere}`).get() as Row).n);
  }
  if (opts.dry) return res;
  db.exec("savepoint prune");
  try {
    for (const w of work) w();
    for (const t of ["INTERSECTION_ARMS", "INTERSECTION_REGIONS"]) db.prepare(`delete from ${t} as t ${orphanWhere}`).run();
    db.exec("release prune");
  } catch (e) {
    db.exec("rollback to prune; release prune");
    throw e;
  }
  return res;
}

/**
 * Moves every intersection link from one road definition to another (a road merged into another
 * that runs the same way). Returns the links moved.
 */
export function repointLinks(db: DatabaseSync, fromGuid: string, toGuid: string): number {
  let n = 0;
  n += Number(db.prepare("update INTERSECTION_ARMS set FK_ASSET_GUID = ? where FK_ASSET_GUID = ?").run(toGuid, fromGuid).changes);
  n += Number(db.prepare("update INTERSECTION_REGIONS set FK_INCOMING_ASSET_GUID = ? where FK_INCOMING_ASSET_GUID = ?").run(toGuid, fromGuid).changes);
  n += Number(db.prepare("update INTERSECTION_REGIONS set FK_OUTGOING_ASSET_GUID = ? where FK_OUTGOING_ASSET_GUID = ?").run(toGuid, fromGuid).changes);
  return n;
}

/** Links (arm or region ends) that point at no road definition. */
export function danglingLinks(db: DatabaseSync): number {
  const q = `select count(*) n from (
    select FK_ASSET_GUID g from INTERSECTION_ARMS
    union all select FK_INCOMING_ASSET_GUID from INTERSECTION_REGIONS
    union all select FK_OUTGOING_ASSET_GUID from INTERSECTION_REGIONS
  ) where g is not null and g not in (select GUID from CONSTRAINED_DEFINITIONS)`;
  return Number((db.prepare(q).get() as Row).n);
}

export interface Junction {
  id: number;
  guid: string;
  /** INTERSECTION_TYPE 0 = intersection, 1 = roundabout. */
  type: "intersection" | "roundabout";
  arms: number;
  roads: string[];
  roundabout?: { inscribedCircleDiameter: number; islandDiameter: number; apronWidth: number; lanes: number; standard: string };
  /** Type and ROUNDABOUTS row disagree (a roundabout without its row, or a row on an intersection). */
  problem?: string;
}

/**
 * The junctions as InfraWorks stores them (InfraWorks 2026, Al Qairawan junction 4, 4 Nov 2026).
 * Converting an intersection to a roundabout in the Stack sets INTERSECTIONS.INTERSECTION_TYPE 0 -> 1,
 * adds one ROUNDABOUTS row (FK_PARENT_TABLE INTERSECTIONS, FK_PARENT_GUID = the intersection;
 * INSCRIBED_CIRCLE_DIAMETER, ISLAND_DIAMETER, APRON_WIDTH, LANES + LANE_DETAILS widths, STANDARD_NAME)
 * and fills ARM_INDEX, blend points and ENTRY/EXIT_LANES_AT_YIELD on each arm; regions are kept.
 * Converting back sets the type to 0 and deletes the ROUNDABOUTS row (the arm fields stay).
 */
export function readJunctions(db: DatabaseSync): Junction[] {
  const names = new Map(
    (db.prepare("select c.GUID g, r.NAME n from CONSTRAINED_DEFINITIONS c join ROADS r on r.FK_PARENT_GUID = c.GUID").all() as Row[]).map((r) => [String(r.g), String(r.n)]),
  );
  const ra = new Map<string, Row>();
  for (const r of db.prepare("select * from ROUNDABOUTS").all() as Row[]) ra.set(String(r.FK_PARENT_GUID), r);
  return (db.prepare("select ID, GUID, INTERSECTION_TYPE t from INTERSECTIONS order by ID").all() as Row[]).map((i) => {
    const guid = String(i.GUID);
    const arms = (db.prepare("select FK_ASSET_GUID g from INTERSECTION_ARMS where FK_PARENT_GUID = ?").all(guid) as Row[]).map((r) => String(r.g));
    const j: Junction = { id: Number(i.ID), guid, type: Number(i.t) === 1 ? "roundabout" : "intersection", arms: arms.length, roads: [...new Set(arms)].map((g) => names.get(g) ?? g) };
    const r = ra.get(guid);
    if (r) j.roundabout = { inscribedCircleDiameter: Number(r.INSCRIBED_CIRCLE_DIAMETER), islandDiameter: Number(r.ISLAND_DIAMETER), apronWidth: Number(r.APRON_WIDTH), lanes: Number(r.LANES), standard: String(r.STANDARD_NAME ?? "") };
    if (j.type === "roundabout" && !r) j.problem = "roundabout type without a ROUNDABOUTS row";
    if (j.type === "intersection" && r) j.problem = "ROUNDABOUTS row on an intersection";
    return j;
  });
}
/** Roundabout values for writeRoundabout, all from the designer's drawings (or an AICC decision). */
export interface RoundaboutSpec {
  inscribedCircleDiameter: number;
  islandDiameter: number;
  apronWidth: number;
  /** circulatory lanes and the width of each */
  lanes: number;
  laneWidth: number;
}

/**
 * The roundabout standard InfraWorks 2026 chose itself when junction 4 was converted in the Stack
 * (4 Nov 2026); the only one whose pool GUID is known. Its sizes are replaced by the designer's.
 */
export const IW_ROUNDABOUT_STANDARD = { EXTERNAL_STANDARD_GUID: "4bfa64b5-07ca-4a15-8413-79dab6124e1d", STANDARD_NAME: "FHWA 2010: Rural Double Lane Roundabout", STANDARD_SOURCE: "Pool" } as const;

const pt3 = (x: number, y: number, z: number) => { const b = Buffer.alloc(32); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); b.writeDoubleLE(z, 24); return b; };
/** FGF polygon, XY, one ring (as InfraWorks stores INTERSECTIONS / ROUNDABOUTS boxes). */
export const boxBlob = (x0: number, y0: number, x1: number, y1: number) => {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const b = Buffer.alloc(16 + 16 * ring.length);
  b.writeUInt32LE(3, 0); b.writeUInt32LE(0, 4); b.writeUInt32LE(1, 8); b.writeUInt32LE(ring.length, 12);
  ring.forEach(([x, y], i) => { b.writeDoubleLE(x!, 16 + 16 * i); b.writeDoubleLE(y!, 24 + 16 * i); });
  return b;
};

/** Bearing (deg from north, clockwise) of the arm leaving the centre along its road. */
function armBearing(line: number[][], cx: number, cy: number, upstream: boolean): number {
  let best = 0, bd = Infinity;
  line.forEach((p, i) => { const d = Math.hypot(p[0]! - cx, p[1]! - cy); if (d < bd) { bd = d; best = i; } });
  const step = upstream ? -1 : 1;
  let q = line[best]!;
  for (let i = best + step; i >= 0 && i < line.length; i += step) { q = line[i]!; if (Math.hypot(q[0]! - cx, q[1]! - cy) > 5) break; }
  return (Math.atan2(q[0]! - cx, q[1]! - cy) * 180 / Math.PI + 360) % 360;
}

/**
 * Turns an intersection into a roundabout as InfraWorks stores one (junction 4 converted in the Stack,
 * 4 Nov 2026): INTERSECTION_TYPE 1; one ROUNDABOUTS row on the intersection, its box the inscribed
 * circle's square around the reference point; arms numbered anticlockwise, one lane each way at the
 * yield line. Blend points and the body are left to InfraWorks. On a roundabout already, only its sizes
 * are replaced. Returns the arm numbers by arm GUID.
 */
export function writeRoundabout(db: DatabaseSync, intersectionId: number, spec: RoundaboutSpec): Map<string, number> {
  const i = db.prepare("select GUID, REFERENCE_POINTS rp, INTERSECTION_TYPE t from INTERSECTIONS where ID = ?").get(intersectionId) as Row | undefined;
  if (!i) throw new Error(`no intersection ${intersectionId}`);
  const guid = String(i.GUID);
  for (const [k, v] of Object.entries(spec)) if (!(Number(v) > 0)) throw new Error(`roundabout ${intersectionId}: ${k} missing`);
  const sum = roundaboutDiameter(spec);
  if (Math.abs(sum - spec.inscribedCircleDiameter) > 0.01) throw new Error(`roundabout ${intersectionId}: island ${spec.islandDiameter} + 2 x apron ${spec.apronWidth} + 2 x ${spec.lanes} x lane ${spec.laneWidth} = ${sum.toFixed(2)} m, not the circle ${spec.inscribedCircleDiameter} m`);
  const existing = db.prepare("select GUID from ROUNDABOUTS where FK_PARENT_GUID = ?").get(guid) as Row | undefined;
  const rp = Buffer.from(i.rp as Uint8Array), cx = rp.readDoubleLE(8), cy = rp.readDoubleLE(16);
  const arms = db.prepare(`select a.GUID g, a.APPROACH_DIRECTION_MATCHES_ASSET d, r.GEOMETRY geom from INTERSECTION_ARMS a
    join ROADS r on r.FK_PARENT_GUID = a.FK_ASSET_GUID where a.FK_PARENT_GUID = ?`).all(guid) as Row[];
  if (arms.length < 3) throw new Error(`intersection ${intersectionId}: ${arms.length} arms, a roundabout needs 3 or more`);
  // an arm that approaches in the road's direction lies before the centre along the road
  const order = arms.map((a) => ({ g: String(a.g), b: armBearing(parseFgf(Buffer.from(a.geom as Uint8Array)).points as number[][], cx, cy, Boolean(a.d)) }))
    .sort((p, q) => q.b - p.b);
  const index = new Map(order.map((a, k) => [a.g, k + 1]));
  const h = spec.inscribedCircleDiameter / 2;
  const laneDetails = JSON.stringify({ version: "1.0.0", lanes: Array.from({ length: spec.lanes }, (_, k) => ({ id: k + 1, width: spec.laneWidth })) });
  db.exec("savepoint roundabout");
  try {
    if (existing) {
      // a roundabout already: its sizes are replaced, the rest (arms, standard) stays
      db.prepare(`update ROUNDABOUTS set GEOMETRY = ?, LANES = ?, LANE_DETAILS = ?, ISLAND_DIAMETER = ?, APRON_WIDTH = ?, INSCRIBED_CIRCLE_DIAMETER = ? where GUID = ?`)
        .run(boxBlob(cx - h, cy - h, cx + h, cy + h), spec.lanes, laneDetails, spec.islandDiameter, spec.apronWidth, spec.inscribedCircleDiameter, String(existing.GUID));
      db.prepare("update INTERSECTIONS set INTERSECTION_TYPE = 1 where GUID = ?").run(guid);
      db.exec("release roundabout");
      return index;
    }
    db.prepare(`insert into ROUNDABOUTS (GUID, GEOMETRY, FK_PARENT_TABLE, FK_PARENT_GUID, EXTERNAL_STANDARD_GUID, STANDARD_NAME, STANDARD_SOURCE,
      LOCATION_OFFSET, LANES, LANE_DETAILS, ISLAND_DIAMETER, APRON_WIDTH, INSCRIBED_CIRCLE_DIAMETER, TILTED_PLANE_BEARING, TILTED_PLANE_CROSSFALL, STATUS)
      values (?, ?, 'INTERSECTIONS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`).run(
      randomUUID(), boxBlob(cx - h, cy - h, cx + h, cy + h), guid, IW_ROUNDABOUT_STANDARD.EXTERNAL_STANDARD_GUID, IW_ROUNDABOUT_STANDARD.STANDARD_NAME, IW_ROUNDABOUT_STANDARD.STANDARD_SOURCE,
      pt3(0, 0, 0), spec.lanes, laneDetails,
      spec.islandDiameter, spec.apronWidth, spec.inscribedCircleDiameter);
    db.prepare("update INTERSECTIONS set INTERSECTION_TYPE = 1 where GUID = ?").run(guid);
    for (const [g, k] of index) db.prepare("update INTERSECTION_ARMS set ARM_INDEX = ?, ENTRY_LANES_AT_YIELD = 1, EXIT_LANES_AT_YIELD = 1, STATUS = 0 where GUID = ?").run(k, g);
    db.exec("release roundabout");
  } catch (e) {
    db.exec("rollback to roundabout; release roundabout");
    throw e;
  }
  return index;
}
/**
 * The inscribed circle InfraWorks shows for a roundabout: island + 2 x apron + 2 x the circulatory
 * lanes (Al Qairawan, 4 Nov 2026: junction 4 27 + 4 + 2 x 7.225 = 45.45; junction 41 24 + 4 + 14.45 =
 * 42.45 shown, though 40.4 was stored). Sizes that do not add up are not written.
 */
export function roundaboutDiameter(s: Pick<RoundaboutSpec, "islandDiameter" | "apronWidth" | "lanes" | "laneWidth">): number {
  return s.islandDiameter + 2 * s.apronWidth + 2 * s.lanes * s.laneWidth;
}