/**
 * InfraWorks intersections in a closed model file.
 *
 * InfraWorks stores an intersection as one INTERSECTIONS row, one INTERSECTION_ARMS row per arm
 * (a road leaving the junction; a road passing through gives two arms, one per direction) and one
 * INTERSECTION_REGIONS row per kerb return between two arms. Arms and regions point at roads by the
 * road's CONSTRAINED_DEFINITIONS GUID (FK_ASSET_GUID, FK_INCOMING/OUTGOING_ASSET_GUID).
 */
import type { DatabaseSync } from "node:sqlite";

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

/** Links (arm or region ends) that point at no road definition. */
export function danglingLinks(db: DatabaseSync): number {
  const q = `select count(*) n from (
    select FK_ASSET_GUID g from INTERSECTION_ARMS
    union all select FK_INCOMING_ASSET_GUID from INTERSECTION_REGIONS
    union all select FK_OUTGOING_ASSET_GUID from INTERSECTION_REGIONS
  ) where g is not null and g not in (select GUID from CONSTRAINED_DEFINITIONS)`;
  return Number((db.prepare(q).get() as Row).n);
}
