/**
 * Which roads model:roads writes. Roundabouts are not written as roads: in InfraWorks a roundabout
 * is an intersection of the component roads through its centre, converted to the roundabout type
 * (Autodesk help "To convert an intersection to a roundabout"). Parsons draws each RA as a ring
 * centreline; written as a closed road it drew stray grading bands, approach intersections inside
 * the ring and sidewalks across the approach roads (4 Nov 2026).
 */
export interface RoadChoice<T> { write: T[]; skipped: { name: string; why: string }[] }

export function roadsToWrite<T extends { name: string }>(roads: T[], roundabouts: Set<string>, opts: { only?: string[]; roundaboutsAsRoads?: boolean } = {}): RoadChoice<T> {
  const write: T[] = [], skipped: { name: string; why: string }[] = [];
  for (const r of roads) {
    if (opts.only && !opts.only.includes(r.name)) continue;
    if (roundabouts.has(r.name) && !opts.roundaboutsAsRoads) { skipped.push({ name: r.name, why: "roundabout: an InfraWorks intersection of the roads through its centre" }); continue; }
    write.push(r);
  }
  return { write, skipped };
}
