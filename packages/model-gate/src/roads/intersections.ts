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
  /**
   * Arms, regions and roundabout rows whose parent intersection no longer exists, removed. InfraWorks
   * leaves such rows when a write fails half-way (7 Nov 2026: "database table is locked" after a
   * failed roundabout conversion left a ROUNDABOUTS row and four arms with an empty parent GUID).
   */
  orphans: number;
  /**
   * Body rows (PRIMITIVES, TERRAIN_OPERATIONS with FK_PARENT_TABLE INTERSECTIONS) of intersections that
   * no longer exist, removed. Left behind, their terrain cut-outs keep holes in the ground (the four
   * RA-1 ring junctions, 4 Nov 2026: a roundabout graded down into them).
   */
  bodies: number;
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
  const res: PruneResult = { removed: [], kept: [], orphans: 0, bodies: 0 };
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
  const hasTable = (t: string) => (db.prepare("select count(*) n from sqlite_master where type = 'table' and name = ?").get(t) as Row).n === 1;
  const orphanTables = ["INTERSECTION_ARMS", "INTERSECTION_REGIONS", "ROUNDABOUTS"].filter(hasTable);
  for (const t of orphanTables) {
    res.orphans += Number((db.prepare(`select count(*) n from ${t} t ${orphanWhere}`).get() as Row).n);
  }
  const removing = new Set(res.removed.map((i) => i.guid));
  const bodyTables = ["PRIMITIVES", "TERRAIN_OPERATIONS"].filter((t) => (db.prepare(`pragma table_info("${t}")`).all() as Row[]).some((c) => c.name === "FK_PARENT_TABLE"));
  const bodyWhere = `where t.FK_PARENT_TABLE = 'INTERSECTIONS' and not exists (select 1 from INTERSECTIONS i where i.GUID = t.FK_PARENT_GUID)`;
  for (const t of bodyTables) {
    res.bodies += Number((db.prepare(`select count(*) n from ${t} t ${bodyWhere}`).get() as Row).n);
    for (const g of removing) res.bodies += Number((db.prepare(`select count(*) n from ${t} where FK_PARENT_TABLE = 'INTERSECTIONS' and FK_PARENT_GUID = ?`).get(g) as Row).n);
  }
  if (opts.dry) return res;
  db.exec("savepoint prune");
  try {
    for (const w of work) w();
    for (const t of orphanTables) db.prepare(`delete from ${t} as t ${orphanWhere}`).run();
    for (const t of bodyTables) db.prepare(`delete from ${t} as t ${bodyWhere}`).run();
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
  /** may be 0 (the FHWA 2000 Urban Compact roundabout has none) */
  apronWidth: number;
  /** circulatory lanes and the width of each */
  lanes: number;
  laneWidth: number;
  /** InfraWorks standard to store (default "rural-double") */
  standard?: RoundaboutStandard;
  /**
   * Write the designer's lane width although InfraWorks is expected to write the standard's back on
   * the next rebuild (a trial: RA-4 / 308 with Parsons' 8.2 m on Urban Compact, 7 Nov 2026).
   */
  keepLaneWidth?: boolean;
}

/**
 * The InfraWorks 2026 roundabout standards seen in the model (pool GUIDs from ROUNDABOUTS rows
 * InfraWorks wrote itself). InfraWorks writes the standard's circulatory lane width back over
 * LANE_DETAILS when it builds the roundabout (junction 41: 8.2 written, 7.225 after the rebuild,
 * 4 Nov 2026), so only the circle, island and apron can be chosen. "rural-double" is what the Stack
 * picks on conversion (junction 4, 4 Nov 2026); "urban-compact" is the one whose arm geometry fits
 * where the neighbouring junctions are close (RA-4 / 308 built with it, 7 Nov 2026: ICD 42.0, island
 * 18.0, no apron, 2 lanes of 6 m). Parsons' 8.2 m lane written on it (`keepLaneWidth`) came back as
 * 6.0 m on opening and the ring as 2 x 6 m after the next rebuild (island 24.0 kept, ICD 48.0), so on
 * this standard too only the island (and apron) can be chosen.
 */
export const IW_ROUNDABOUT_STANDARDS = {
  "rural-double": { EXTERNAL_STANDARD_GUID: "4bfa64b5-07ca-4a15-8413-79dab6124e1d", STANDARD_NAME: "FHWA 2010: Rural Double Lane Roundabout", STANDARD_SOURCE: "Pool", laneWidth: 7.225, laneWidths: [7.225, 7.275] },
  "urban-compact": { EXTERNAL_STANDARD_GUID: "5d67ca9e-b1fc-4bf5-bf10-d792903f0b19", STANDARD_NAME: "FHWA 2000: Urban Compact Roundabout", STANDARD_SOURCE: "Pool", laneWidth: 6, laneWidths: [6, 6] },
} as const;
export type RoundaboutStandard = keyof typeof IW_ROUNDABOUT_STANDARDS;
export const IW_ROUNDABOUT_STANDARD = IW_ROUNDABOUT_STANDARDS["rural-double"];

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
 * yield line. Blend points and the body are left to InfraWorks, which builds them when a roundel
 * property (apron or island) is edited in the Stack (junction 41, 4 Nov 2026). On a roundabout already, only its sizes
 * are replaced. Returns the arm numbers by arm GUID.
 */
export function writeRoundabout(db: DatabaseSync, intersectionId: number, spec: RoundaboutSpec): Map<string, number> {
  const i = db.prepare("select GUID, REFERENCE_POINTS rp, INTERSECTION_TYPE t from INTERSECTIONS where ID = ?").get(intersectionId) as Row | undefined;
  if (!i) throw new Error(`no intersection ${intersectionId}`);
  const guid = String(i.GUID);
  const std = IW_ROUNDABOUT_STANDARDS[spec.standard ?? "rural-double"];
  if (!std) throw new Error(`roundabout ${intersectionId}: unknown standard ${spec.standard}; known: ${Object.keys(IW_ROUNDABOUT_STANDARDS).join(", ")}`);
  for (const k of ["inscribedCircleDiameter", "islandDiameter", "lanes", "laneWidth"] as const) if (!(Number(spec[k]) > 0)) throw new Error(`roundabout ${intersectionId}: ${k} missing`);
  if (!(Number(spec.apronWidth) >= 0)) throw new Error(`roundabout ${intersectionId}: apronWidth missing`);
  if (![1, 2].includes(spec.lanes) || (!spec.keepLaneWidth && Math.abs(spec.laneWidth - std.laneWidth) > 0.001)) throw new Error(`roundabout ${intersectionId}: ${spec.lanes} x ${spec.laneWidth} m lanes; InfraWorks keeps the standard's one lane of ${std.laneWidth} m`);
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
  const widths: readonly number[] = spec.keepLaneWidth ? Array(spec.lanes).fill(spec.laneWidth) : std.laneWidths.slice(0, spec.lanes);
  const laneDetails = JSON.stringify({ version: "1.0.0", lanes: widths.map((width, k) => ({ id: k + 1, width })) });
  db.exec("savepoint roundabout");
  try {
    if (existing) {
      // a roundabout already: its sizes are replaced, the rest (arms, standard) stays
      db.prepare(`update ROUNDABOUTS set GEOMETRY = ?, LANES = ?, LANE_DETAILS = ?, ISLAND_DIAMETER = ?, APRON_WIDTH = ?, INSCRIBED_CIRCLE_DIAMETER = ?,
        EXTERNAL_STANDARD_GUID = ?, STANDARD_NAME = ?, STANDARD_SOURCE = ? where GUID = ?`)
        .run(boxBlob(cx - h, cy - h, cx + h, cy + h), spec.lanes, laneDetails, spec.islandDiameter, spec.apronWidth, spec.inscribedCircleDiameter,
          std.EXTERNAL_STANDARD_GUID, std.STANDARD_NAME, std.STANDARD_SOURCE, String(existing.GUID));
      db.prepare("update INTERSECTIONS set INTERSECTION_TYPE = 1 where GUID = ?").run(guid);
      // InfraWorks widens the ring to two lanes once the approaches read two lanes each way (it set 2 at
      // the yield line on every divided-road arm; Al Qairawan 9 and 41, 6 Nov 2026): the arms take the
      // ring's lane count again
      // a two-lane ring keeps the arms' lanes as InfraWorks set them (2 on the divided roads, 1 on the others)
      if (spec.lanes === 1) db.prepare("update INTERSECTION_ARMS set ENTRY_LANES_AT_YIELD = ?, EXIT_LANES_AT_YIELD = ? where FK_PARENT_GUID = ?").run(spec.lanes, spec.lanes, guid);
      db.exec("release roundabout");
      return index;
    }
    db.prepare(`insert into ROUNDABOUTS (GUID, GEOMETRY, FK_PARENT_TABLE, FK_PARENT_GUID, EXTERNAL_STANDARD_GUID, STANDARD_NAME, STANDARD_SOURCE,
      LOCATION_OFFSET, LANES, LANE_DETAILS, ISLAND_DIAMETER, APRON_WIDTH, INSCRIBED_CIRCLE_DIAMETER, TILTED_PLANE_BEARING, TILTED_PLANE_CROSSFALL, STATUS)
      values (?, ?, 'INTERSECTIONS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`).run(
      randomUUID(), boxBlob(cx - h, cy - h, cx + h, cy + h), guid, std.EXTERNAL_STANDARD_GUID, std.STANDARD_NAME, std.STANDARD_SOURCE,
      pt3(0, 0, 0), spec.lanes, laneDetails,
      spec.islandDiameter, spec.apronWidth, spec.inscribedCircleDiameter);
    db.prepare("update INTERSECTIONS set INTERSECTION_TYPE = 1 where GUID = ?").run(guid);
    for (const [g, k] of index) db.prepare(spec.lanes === 1 ? "update INTERSECTION_ARMS set ARM_INDEX = ?, ENTRY_LANES_AT_YIELD = 1, EXIT_LANES_AT_YIELD = 1, STATUS = 0 where GUID = ?" : "update INTERSECTION_ARMS set ARM_INDEX = ?, STATUS = 0 where GUID = ?").run(k, g);
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
export function roundaboutDiameter(s: Pick<RoundaboutSpec, "islandDiameter" | "apronWidth" | "lanes" | "laneWidth" | "standard" | "keepLaneWidth">): number {
  // the ring lanes are the standard's (Rural Double: 7.225, then 7.275: InfraWorks junctions 9 and 41, 6 Nov 2026)
  const std = IW_ROUNDABOUT_STANDARDS[s.standard ?? "rural-double"];
  const widths: readonly number[] = !s.keepLaneWidth && std && s.laneWidth === std.laneWidth ? std.laneWidths.slice(0, s.lanes) : Array(s.lanes).fill(s.laneWidth);
  return s.islandDiameter + 2 * s.apronWidth + 2 * widths.reduce((a, b) => a + b, 0);
}
/** Height of a 3D polyline at the point nearest to (x, y), interpolated along the nearest segment. */
function levelAt(line: number[][], x: number, y: number): { z: number; d: number } {
  let best = { z: NaN, d: Infinity };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!, b = line[i + 1]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
    const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (y - a[1]!) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(a[0]! + t * dx - x, a[1]! + t * dy - y);
    if (d < best.d) best = { z: a[2]! + t * (b[2]! - a[2]!), d };
  }
  return best;
}

/**
 * Gives roundabout blend points their height. On a roundabout written into the file, InfraWorks places
 * each arm's blend point on its road but at height 0 (junctions 9 and 41, 4 Nov 2026: 0.00, so the
 * arms graded down ~680 m; on junction 4, converted in the Stack, they had the road's level). The height
 * is the road's own 3D centreline (the designer's profile) at that point; the position stays
 * InfraWorks'. Returns the points set: intersection, arm number, height, distance to the road.
 */
export function fixBlendLevels(db: DatabaseSync, opts: { dry?: boolean } = {}): { id: number; arm: number; z: number; off: number }[] {
  const out: { id: number; arm: number; z: number; off: number }[] = [];
  const rows = db.prepare(`select i.ID id, a.GUID g, a.ARM_INDEX ix, a.BLEND_POINT_ENTRY e, a.BLEND_POINT_EXIT x, r.GEOMETRY geom
    from INTERSECTIONS i join INTERSECTION_ARMS a on a.FK_PARENT_GUID = i.GUID join ROADS r on r.FK_PARENT_GUID = a.FK_ASSET_GUID
    where i.INTERSECTION_TYPE = 1 order by i.ID, a.ARM_INDEX`).all() as Row[];
  if (!opts.dry) db.exec("savepoint blend");
  try {
    for (const r of rows) {
      const line = parseFgf(Buffer.from(r.geom as Uint8Array)).points as number[][];
      for (const col of ["BLEND_POINT_ENTRY", "BLEND_POINT_EXIT"] as const) {
        const v = r[col === "BLEND_POINT_ENTRY" ? "e" : "x"] as Uint8Array | null;
        if (!v) continue;
        const b = Buffer.from(v);
        if (b.length < 32 || b.readDoubleLE(24) !== 0) continue;
        const x = b.readDoubleLE(8), y = b.readDoubleLE(16), at = levelAt(line, x, y);
        if (!(at.d < 1)) throw new Error(`intersection ${r.id} arm ${r.ix}: blend point ${at.d.toFixed(2)} m off its road`);
        out.push({ id: Number(r.id), arm: Number(r.ix), z: at.z, off: at.d });
        if (!opts.dry) db.prepare(`update INTERSECTION_ARMS set ${col} = ? where GUID = ?`).run(pt3(x, y, at.z), String(r.g));
      }
    }
    if (!opts.dry) db.exec("release blend");
  } catch (e) {
    if (!opts.dry) db.exec("rollback to blend; release blend");
    throw e;
  }
  return out;
}
/** Distance from (x, y) to a polyline, in plan. */
function distTo(line: number[][], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!, b = line[i + 1]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
    const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (y - a[1]!) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(a[0]! + t * dx - x, a[1]! + t * dy - y));
  }
  return d;
}

/**
 * Moves the intersection links of a road that was split back into its parts (in order, each starting
 * where the last ends) onto the part each junction lies on. At a joint, where both parts meet, the
 * direction decides: an arm approaching in the road's direction (APPROACH_DIRECTION_MATCHES_ASSET 1)
 * and a region end entering along it lie on the part that ends there; the others on the part that
 * starts there. Returns the links moved per part GUID.
 */
export function splitLinks(db: DatabaseSync, fromGuid: string, parts: { guid: string; line: number[][] }[], tol = 1): Map<string, number> {
  const moved = new Map(parts.map((p) => [p.guid, 0]));
  const js = db.prepare(`select distinct i.GUID g, i.ID id, i.REFERENCE_POINTS rp from INTERSECTIONS i where exists (select 1 from INTERSECTION_ARMS a where a.FK_PARENT_GUID = i.GUID and a.FK_ASSET_GUID = ?)
    or exists (select 1 from INTERSECTION_REGIONS r where r.FK_PARENT_GUID = i.GUID and ? in (r.FK_INCOMING_ASSET_GUID, r.FK_OUTGOING_ASSET_GUID))`).all(fromGuid, fromGuid) as Row[];
  for (const j of js) {
    const rp = Buffer.from(j.rp as Uint8Array), x = rp.readDoubleLE(8), y = rp.readDoubleLE(16);
    const d = parts.map((p) => distTo(p.line, x, y));
    const on = d.map((v, k) => (v < tol ? k : -1)).filter((k) => k >= 0);
    if (!on.length) throw new Error(`junction ${j.id}: on none of the parts (nearest ${Math.min(...d).toFixed(2)} m)`);
    // at a joint two consecutive parts touch: [k, k+1], k ends there and k+1 starts there
    const pick = (alongRoadIntoJunction: boolean) => (on.length === 1 ? on[0]! : alongRoadIntoJunction ? on[0]! : on[on.length - 1]!);
    const set = (sql: string, k: number, ...a: unknown[]) => {
      const to = parts[k]!.guid;
      if (to === fromGuid) return;
      const n = Number(db.prepare(sql).run(to, ...(a as never[])).changes);
      moved.set(to, moved.get(to)! + n);
    };
    for (const a of db.prepare("select GUID g, APPROACH_DIRECTION_MATCHES_ASSET d from INTERSECTION_ARMS where FK_PARENT_GUID = ? and FK_ASSET_GUID = ?").all(String(j.g), fromGuid) as Row[])
      set("update INTERSECTION_ARMS set FK_ASSET_GUID = ? where GUID = ?", pick(Boolean(a.d)), String(a.g));
    for (const r of db.prepare(`select GUID g, FK_INCOMING_ASSET_GUID ig, SAME_DIRECTION_AS_INCOMING_ASSET si, FK_OUTGOING_ASSET_GUID og, SAME_DIRECTION_AS_OUTGOING_ASSET so
      from INTERSECTION_REGIONS where FK_PARENT_GUID = ?`).all(String(j.g)) as Row[]) {
      if (r.ig === fromGuid) set("update INTERSECTION_REGIONS set FK_INCOMING_ASSET_GUID = ? where GUID = ?", pick(Boolean(r.si)), String(r.g));
      if (r.og === fromGuid) set("update INTERSECTION_REGIONS set FK_OUTGOING_ASSET_GUID = ? where GUID = ?", pick(!r.so), String(r.g));
    }
  }
  return moved;
}
/** Lanes each side, lane width and median width of a road, read from its own component style. */
export function roadSectionOf(manualStyle: string): { left: number; right: number; laneWidth: number; median: number } {
  const ms = JSON.parse(manualStyle) as { componentStyle?: string };
  const refs = ((ms.componentStyle ? JSON.parse(ms.componentStyle) : { references: [] }) as { references: { def?: string; paramOverrides?: { name: string; value: number }[] }[] }).references;
  const par = (r: (typeof refs)[number], n: string) => r.paramOverrides?.find((p) => p.name === n)?.value;
  const lanes = refs.filter((r) => r.def?.endsWith("/Lane"));
  const left = lanes.filter((r) => par(r, "LeftSideFactor") === -1).length;
  const med = refs.find((r) => r.def?.endsWith("/Sloped Median"));
  return { left, right: lanes.length - left, laneWidth: lanes.length ? Math.max(...lanes.map((r) => par(r, "Width") ?? 0)) : 0, median: med ? par(med, "Width") ?? 0 : 0 };
}

/**
 * Roundabout arms InfraWorks built without lanes (Parsons' divided roads B1 / C1: it reads no lanes,
 * 5 Nov 2026) get the lanes, lane width and median of the road they join, so the arm meets the road
 * as drawn until Parsons gives the entry design (AICC decision, 5 Nov 2026). Lanes are written as
 * InfraWorks writes them on a two-lane arm it did read (R.2.F.3: the road's left lanes travel 2, its
 * right lanes 1, category 1). One lane at the yield line stays. Returns the arms set.
 */
export function armsFromRoads(db: DatabaseSync, opts: { dry?: boolean } = {}): { id: number; arm: number; road: string; lanes: number; laneWidth: number; median: number }[] {
  const rows = db.prepare(`select i.ID id, a.GUID g, a.ARM_INDEX ix, a.LANES l, r.NAME n, r.MANUAL_STYLE ms
    from INTERSECTIONS i join INTERSECTION_ARMS a on a.FK_PARENT_GUID = i.GUID join ROADS r on r.FK_PARENT_GUID = a.FK_ASSET_GUID
    where i.INTERSECTION_TYPE = 1 order by i.ID, a.ARM_INDEX`).all() as Row[];
  const out: { id: number; arm: number; road: string; lanes: number; laneWidth: number; median: number }[] = [];
  for (const r of rows) {
    const have = (JSON.parse(String(r.l ?? "{}")) as { lanes?: unknown[] }).lanes ?? [];
    if (have.length) continue;
    const s = roadSectionOf(String(r.ms));
    if (!s.left || s.left !== s.right) throw new Error(`intersection ${r.id} arm ${r.ix}: ${r.n} has ${s.left} + ${s.right} lanes; not set`);
    const lanes = [...Array(s.left)].map(() => 2).concat([...Array(s.right)].map(() => 1)).map((td, k) => ({ id: k + 1, travelDirection: td, directionCategory: 1, directionVisibility: true }));
    out.push({ id: Number(r.id), arm: Number(r.ix), road: String(r.n), lanes: s.left, laneWidth: s.laneWidth, median: s.median });
    if (!opts.dry) db.prepare(`update INTERSECTION_ARMS set LANES = ?, BLEND_POINT_ENTRY_LANES = ?, BLEND_POINT_EXIT_LANES = ?, BLEND_POINT_ENTRY_WIDTH = ?,
      BLEND_POINT_EXIT_WIDTH = ?, BLEND_POINT_MEDIAN_WIDTH = ? where GUID = ?`).run(JSON.stringify({ version: 1, lanes }), s.left, s.right, s.laneWidth, s.laneWidth, s.median, String(r.g));
  }
  return out;
}
/**
 * Deletes one intersection with its arms, regions, roundabout row and body, so that InfraWorks creates
 * it afresh where the roads meet the next time one of them is edited (Al Qairawan junctions 106, 135,
 * 161: built while a road still had our body, they kept a surface dropping to height 0 through every
 * rebuild). Returns the rows deleted.
 */
export function deleteIntersection(db: DatabaseSync, id: number): number {
  const i = db.prepare("select GUID from INTERSECTIONS where ID = ?").get(id) as Row | undefined;
  if (!i) throw new Error(`no intersection ${id}`);
  const g = String(i.GUID), has = (t: string) => Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t));
  let n = 0;
  db.exec("savepoint deljunction");
  try {
    for (const t of ["INTERSECTION_REGIONS", "INTERSECTION_ARMS", "ROUNDABOUTS", "PRIMITIVES", "TERRAIN_OPERATIONS"]) if (has(t)) n += Number(db.prepare(`delete from ${t} where FK_PARENT_GUID = ?`).run(g).changes);
    n += Number(db.prepare("delete from INTERSECTIONS where GUID = ?").run(g).changes);
    db.exec("release deljunction");
  } catch (e) { db.exec("rollback to deljunction; release deljunction"); throw e; }
  return n;
}
/** Station of the point of a 3D polyline nearest to (x, y), and its distance. */
function stationOn(line: number[][], x: number, y: number): { s: number; d: number } {
  let s = 0, best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!, b = line[i + 1]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, L = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (y - a[1]!) * dy) / (L * L || 1)));
    const d = Math.hypot(a[0]! + t * dx - x, a[1]! + t * dy - y);
    if (d < best.d) best = { s: s + t * L, d };
    s += L;
  }
  return best;
}
/** Point (x, y, z) of a 3D polyline at a station. */
function pointAt(line: number[][], s: number): [number, number, number] {
  let acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!, b = line[i + 1]!, L = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    if (acc + L >= s || i + 2 === line.length) { const t = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0; return [a[0]! + t * (b[0]! - a[0]!), a[1]! + t * (b[1]! - a[1]!), a[2]! + t * (b[2]! - a[2]!)]; }
    acc += L;
  }
  const e = line[line.length - 1]!; return [e[0]!, e[1]!, e[2]!];
}

/** Arm length InfraWorks gives the one-lane roundabout here when it has room (Al Qairawan 9, 41, 140: 76.9-81.1 m). */
export const IW_DEFAULT_ARM = 76.9;

/**
 * Arm lengths InfraWorks 2026 clamps to itself where the next junction on the road is close, by
 * "intersection:arm" (Al Qairawan, 6-7 Nov 2026): the longest blend point offset it allows there. It
 * is the same whatever the standard (RA-4 arms 2 and 3: 47.57 and 64.27 m under Rural Double, which
 * failed, and under Urban Compact, which built; 125 and its fresh copy 308 alike) and it lies a few
 * metres inside the neighbour's GEOMETRY box (308 arm 3: 64.27 against the box at 61.0; 140 arm 1:
 * 55.8 against 52.0), so the box is a guide only. The build then fails when the standard's arm
 * geometry needs more than that: the log says "[Create Roundabout Fail] The blend point offset is
 * less than Inner Zone Of Influence Radius" (RoundaboutManager.cpp), then "update arm for arm N
 * failed", and the Stack "Invalid roundabout geometry - insufficient space for arm lengths, or arm
 * radii". That radius comes from the Vehicle Tracking engine per arm (standard: Deviation Offset,
 * Final Straight Section, Transition Arc Radius; the arm's lanes and angle) and is not stored: on a
 * 2 + 2 divided arm it is above 64.27 m for FHWA 2010 Rural Double Lane and below 47.57 m for FHWA
 * 2000 Urban Compact. The Stack's Arm Length is this offset minus the inscribed radius.
 */
export const IW_ARM_CLAMP_SEEN: Readonly<Record<string, number>> = {
  "136:3": 64.6, "136:4": 55.6, "125:2": 47.57, "125:3": 64.27, "308:2": 47.57, "308:3": 64.27, "140:1": 55.8, "140:3": 49.8,
  // RA-5 as 309 (7 Nov 2026, the arms InfraWorks wrote before it crashed): R.0.D.12 both ways 65.6, R.0.D.4 towards 142 55.6
  "309:1": 65.6, "309:3": 65.6, "309:4": 55.6,
};
/** @deprecated the measured lengths are InfraWorks' maxima before the next junction, not minima: `IW_ARM_CLAMP_SEEN` */
export const IW_MIN_ARM_SEEN = IW_ARM_CLAMP_SEEN;

/**
 * Where a standard is known to build or fail on a 2 + 2 divided arm clamped to `clamp` metres (RA-4,
 * 7 Nov 2026): Rural Double failed at 64.27, Urban Compact built at 47.57. Between the two nothing is
 * known. Local one-lane arms are not covered (140 arm 3, R.0.C.4, built at 49.8 under Rural Double).
 */
export function standardFitsArm(standard: RoundaboutStandard, clamp: number): "builds" | "fails" | "unknown" {
  if (standard === "rural-double") return clamp <= 64.27 ? "fails" : clamp >= IW_DEFAULT_ARM ? "builds" : "unknown";
  if (standard === "urban-compact") return clamp >= 47.57 ? "builds" : "unknown";
  return "unknown";
}

export interface ArmRoom {
  id: number;
  arm: number;
  road: string;
  /** BLEND_POINT_ENTRY_OFFSET, or InfraWorks' default when null */
  blend: number;
  /** next junction on this road beyond the arm, and its centre's distance along the road */
  nextId: number;
  next: number;
  /** where that junction's body (INTERSECTIONS.GEOMETRY box) begins, along the road from the centre */
  edge: number;
  /** the longest arm InfraWorks allows here, where measured (`clamp` option, `IW_ARM_CLAMP_SEEN`); else null */
  clamp: number | null;
  /** edge - blend: what is left before the next junction's body (negative inside it) */
  room: number;
  /** whether a standard's arm geometry is known to fit the clamp (`standardFitsArm`), when `standard` is given */
  standard: "builds" | "fails" | "unknown" | null;
  status: "fits" | "inside the next junction's box" | "reaches the next junction";
}

/**
 * Room for each roundabout arm before the next junction on its road (read-only).
 *
 * Seen on Al Qairawan (6-7 Nov 2026): InfraWorks clamps an arm's blend point before the next junction
 * on the road (`IW_ARM_CLAMP_SEEN`) and builds with the arm a few metres inside that junction's
 * GEOMETRY box (up to 3.8 m: 140 arm 1, 308 arms 2 and 3); what then decides the build is whether the
 * standard's arm geometry fits that length (`standardFitsArm`). An arm reaching the junction's centre
 * line less 10 m is beyond anything seen to build ("Invalid roundabout geometry - intersections
 * overlap", RA-5 with 80 m arms, 6 Nov 2026).
 */
export function armRoom(db: DatabaseSync, opts: { clamp?: Readonly<Record<string, number>>; standard?: RoundaboutStandard } = {}): ArmRoom[] {
  const js = db.prepare("select ID id, GUID g, REFERENCE_POINTS rp, GEOMETRY geom from INTERSECTIONS").all() as Row[];
  const at = new Map(js.map((j) => {
    const b = Buffer.from(j.rp as Uint8Array);
    const box = j.geom ? (parseFgf(Buffer.from(j.geom as Uint8Array)).points as number[][]) : [];
    return [String(j.g), { id: Number(j.id), x: b.readDoubleLE(8), y: b.readDoubleLE(16), box }];
  }));
  const out: ArmRoom[] = [];
  const arms = db.prepare(`select i.GUID ig, a.ARM_INDEX ix, a.FK_ASSET_GUID road, a.APPROACH_DIRECTION_MATCHES_ASSET d, a.BLEND_POINT_ENTRY_OFFSET o, r.NAME n, r.GEOMETRY geom
    from INTERSECTIONS i join INTERSECTION_ARMS a on a.FK_PARENT_GUID = i.GUID join ROADS r on r.FK_PARENT_GUID = a.FK_ASSET_GUID
    where i.INTERSECTION_TYPE = 1 order by i.ID, a.ARM_INDEX`).all() as Row[];
  for (const a of arms) {
    const line = parseFgf(Buffer.from(a.geom as Uint8Array)).points as number[][], c = at.get(String(a.ig))!, s0 = stationOn(line, c.x, c.y).s, up = Boolean(a.d);
    const side = (s: number) => (up ? s < s0 : s > s0);
    const others = (db.prepare("select distinct FK_PARENT_GUID p from INTERSECTION_ARMS where FK_ASSET_GUID = ? and FK_PARENT_GUID <> ?").all(String(a.road), String(a.ig)) as Row[])
      .map((o) => at.get(String(o.p))!).map((o) => ({ o, st: stationOn(line, o.x, o.y) })).filter((x) => x.st.d < 2 && side(x.st.s))
      .sort((p, q) => Math.abs(p.st.s - s0) - Math.abs(q.st.s - s0));
    if (!others.length) continue;
    const nxt = others[0]!, next = Math.abs(nxt.st.s - s0);
    // the body box's nearest corner on the arm's side of the roundabout centre
    const corners = nxt.o.box.map((p) => stationOn(line, p[0]!, p[1]!).s).filter(side).map((s) => Math.abs(s - s0));
    const edge = corners.length ? Math.min(...corners) : next;
    const blend = a.o == null ? IW_DEFAULT_ARM : Number(a.o), clamp = opts.clamp?.[`${c.id}:${a.ix}`] ?? null, room = edge - blend;
    const status: ArmRoom["status"] = blend > next - 10 ? "reaches the next junction" : blend > edge ? "inside the next junction's box" : "fits";
    const standard = opts.standard ? standardFitsArm(opts.standard, clamp ?? blend) : null;
    out.push({ id: c.id, arm: Number(a.ix), road: String(a.n), blend, nextId: nxt.o.id, next, edge, clamp, room, standard, status });
  }
  return out;
}

/**
 * Shortens roundabout arms that would run into the next junction on the same road ("Invalid roundabout
 * geometry - intersections overlap", Al Qairawan RA-5, 6 Nov 2026: arms of ~80 m, neighbours at 70 and
 * 80 m). The arm's blend point moves to the next junction minus `gap` metres along the road, at the
 * road's own level there; arms with room keep their length. The length is a modelling setting, not
 * design data (AICC decision, 6 Nov 2026: gap 25 m). Returns the arms changed.
 */
export function shortenArms(db: DatabaseSync, gap = 25, opts: { dry?: boolean } = {}): { id: number; arm: number; road: string; next: number; length: number }[] {
  const js = db.prepare("select ID id, GUID g, REFERENCE_POINTS rp from INTERSECTIONS").all() as Row[];
  const at = new Map(js.map((j) => { const b = Buffer.from(j.rp as Uint8Array); return [String(j.g), { id: Number(j.id), x: b.readDoubleLE(8), y: b.readDoubleLE(16) }]; }));
  const out: { id: number; arm: number; road: string; next: number; length: number }[] = [];
  const arms = db.prepare(`select i.GUID ig, a.GUID g, a.ARM_INDEX ix, a.FK_ASSET_GUID road, a.APPROACH_DIRECTION_MATCHES_ASSET d, a.BLEND_POINT_ENTRY_OFFSET o, r.NAME n, r.GEOMETRY geom
    from INTERSECTIONS i join INTERSECTION_ARMS a on a.FK_PARENT_GUID = i.GUID join ROADS r on r.FK_PARENT_GUID = a.FK_ASSET_GUID where i.INTERSECTION_TYPE = 1 order by i.ID, a.ARM_INDEX`).all() as Row[];
  if (!opts.dry) db.exec("savepoint arms");
  try {
    for (const a of arms) {
      const line = parseFgf(Buffer.from(a.geom as Uint8Array)).points as number[][], c = at.get(String(a.ig))!, s0 = stationOn(line, c.x, c.y).s, up = Boolean(a.d);
      const others = (db.prepare("select distinct FK_PARENT_GUID p from INTERSECTION_ARMS where FK_ASSET_GUID = ? and FK_PARENT_GUID <> ?").all(String(a.road), String(a.ig)) as Row[])
        .map((o) => at.get(String(o.p))!).map((o) => stationOn(line, o.x, o.y)).filter((o) => o.d < 2 && (up ? o.s < s0 : o.s > s0)).map((o) => Math.abs(o.s - s0));
      if (!others.length) continue;
      const next = Math.min(...others), want = next - gap, current = a.o == null ? IW_DEFAULT_ARM : Number(a.o);
      if (want >= current) continue;
      if (!(want > 10)) throw new Error(`intersection ${c.id} arm ${a.ix} (${a.n}): next junction ${next.toFixed(1)} m away, no room for an arm`);
      out.push({ id: c.id, arm: Number(a.ix), road: String(a.n), next, length: want });
      if (!opts.dry) db.prepare("update INTERSECTION_ARMS set BLEND_POINT_ENTRY_OFFSET = ?, BLEND_POINT_ENTRY = ? where GUID = ?").run(want, pt3(...pointAt(line, up ? s0 - want : s0 + want)), String(a.g));
    }
    if (!opts.dry) db.exec("release arms");
  } catch (e) { if (!opts.dry) db.exec("rollback to arms; release arms"); throw e; }
  return out;
}