/**
 * Two or more Parsons roads joined into one road, for a junction where the roads only meet end to end.
 *
 * InfraWorks does not build a junction made of road ends only: at the Al Qairawan roundabout centres
 * every approach road ends at the centre and none passes through; InfraWorks marks the RA-2 centre
 * "Intersection not supported" and will not convert the RA-1 centre to a roundabout, while a T junction
 * with a through road converts (junction 4, 4 Nov 2026). Joining two roads that continue each other
 * gives the centre a through road. Plan and profile stay Parsons' own: the parts are chained as drawn.
 */
import type { Alignment, Pvi } from "@infraworks/domain";

export interface RoadPart { al: Alignment; pv: Pvi[] }

const TOL_XY = 0.05, TOL_Z = 0.005;

/** Chains the parts in order; refuses a gap, a part drawn the other way, a level step or a curve at a joint. */
export function mergeRoads(name: string, parts: RoadPart[]): RoadPart {
  if (parts.length < 2) throw new Error(`${name}: give two roads or more to merge`);
  const segs: Alignment["segs"] = [], pv: Pvi[] = [];
  let s0 = 0;
  parts.forEach((p, k) => {
    const prev = k ? parts[k - 1]! : null;
    if (prev) {
      const end = prev.al.segs.at(-1)!.b, start = p.al.segs[0]!.a;
      const gap = Math.hypot(start[0] - end[0], start[1] - end[1]);
      if (gap > TOL_XY) {
        const back = Math.hypot(p.al.segs.at(-1)!.b[0] - end[0], p.al.segs.at(-1)!.b[1] - end[1]);
        throw new Error(`${name}: ${p.al.name} does not start where ${prev.al.name} ends (${gap.toFixed(3)} m${back <= TOL_XY ? "; it is drawn the other way" : ""})`);
      }
      const zEnd = prev.pv.at(-1)!, zStart = p.pv[0]!;
      if (Math.abs(zEnd.s - prev.al.length) > TOL_XY || zStart.s > TOL_XY) throw new Error(`${name}: no level at the joint of ${prev.al.name} and ${p.al.name}`);
      if (zEnd.z == null || zStart.z == null || Math.abs(zEnd.z - zStart.z) > TOL_Z) throw new Error(`${name}: level step at the joint of ${prev.al.name} (${zEnd.z}) and ${p.al.name} (${zStart.z})`);
      if (zEnd.L || zStart.L) throw new Error(`${name}: a vertical curve at the joint of ${prev.al.name} and ${p.al.name}`);
    }
    segs.push(...p.al.segs);
    p.pv.forEach((v, i) => { if (!(prev && i === 0)) pv.push({ ...v, s: v.s + s0 }); });
    s0 += p.al.length;
  });
  return { al: { name, length: s0, segs }, pv };
}

/** "R.0.C.2=R.0.C.1+R.0.C.2,..." -> [{ name, parts }] */
export function parseMerges(spec: string): { name: string; parts: string[] }[] {
  return spec.split(",").filter(Boolean).map((m) => {
    const [name, rhs] = m.split("=");
    const parts = (rhs ?? "").split("+").map((s) => s.trim()).filter(Boolean);
    if (!name || parts.length < 2 || !parts.includes(name.trim())) throw new Error(`--merge ${m}: use NAME=ROAD1+ROAD2, NAME being one of the roads`);
    return { name: name.trim(), parts };
  });
}
