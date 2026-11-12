/**
 * Two or more Parsons roads joined into one road, for a junction where the roads only meet end to end.
 *
 * InfraWorks does not build a junction made of road ends only: at the Al Qairawan roundabout centres
 * every approach road ends at the centre and none passes through; InfraWorks marks the RA-2 centre
 * "Intersection not supported" and will not convert the RA-1 centre to a roundabout, while a T junction
 * with a through road converts (junction 4, 4 Nov 2026). Joining two roads that continue each other
 * gives the centre a through road. Plan and profile stay Parsons' own: the parts are chained as drawn.
 */
import type { DatabaseSync } from "node:sqlite";

import type { Alignment, Pvi } from "@infraworks/domain";

export interface RoadPart { al: Alignment; pv: Pvi[] }

const TOL_XY = 0.05, TOL_Z = 0.005;

/** A roundabout ring drawn as a centreline circle (Namar RA-01: r 20.21). */
export interface Ring { c: [number, number]; r: number }
/** The ring whose circle a point lies on (within 1.5 m). */
export const ringAt = (p: readonly number[], rings: readonly Ring[]) => rings.find((g) => Math.abs(Math.hypot(p[0]! - g.c[0], p[1]! - g.c[1]) - g.r) < 1.5);

/**
 * Chains the parts in order; refuses a gap, a part drawn the other way, a level step or a curve at a joint.
 * One gap is allowed: across a roundabout ring, where both parts stop on the ring (Namar RD-M-01 and
 * RD-M-02 at RA-01, whose arms all end on the ring and none passes through). The joined road then runs
 * straight to the ring's centre and on to the next part, its level straight between the two ends: the
 * centre gets a through road InfraWorks can convert to a roundabout, which regrades the ring itself.
 */
export function mergeRoads(name: string, parts: RoadPart[], rings: readonly Ring[] = []): RoadPart {
  if (parts.length < 2) throw new Error(`${name}: give two roads or more to merge`);
  const segs: Alignment["segs"] = [], pv: Pvi[] = [];
  let s0 = 0;
  parts.forEach((p, k) => {
    const prev = k ? parts[k - 1]! : null;
    let bridged = false;
    if (prev) {
      const end = prev.al.segs.at(-1)!.b, start = p.al.segs[0]!.a;
      const gap = Math.hypot(start[0] - end[0], start[1] - end[1]);
      const ring = gap > TOL_XY ? ringAt(end, rings) : undefined;
      if (ring && ringAt(start, rings) === ring) {
        const zEnd = prev.pv.at(-1)!, zStart = p.pv[0]!;
        if (Math.abs(zEnd.s - prev.al.length) > TOL_XY || zStart.s > TOL_XY || zEnd.z == null || zStart.z == null) throw new Error(`${name}: no level at the ring ends of ${prev.al.name} and ${p.al.name}`);
        if (zEnd.L || zStart.L) throw new Error(`${name}: a vertical curve at the ring end of ${prev.al.name} or ${p.al.name}`);
        const across = [{ a: end, b: ring.c, bulge: 0 }, { a: ring.c, b: start, bulge: 0 }];
        segs.push(...across);
        s0 += Math.hypot(ring.c[0] - end[0], ring.c[1] - end[1]) + Math.hypot(start[0] - ring.c[0], start[1] - ring.c[1]);
        bridged = true;
      } else if (gap > TOL_XY) {
        const back = Math.hypot(p.al.segs.at(-1)!.b[0] - end[0], p.al.segs.at(-1)!.b[1] - end[1]);
        throw new Error(`${name}: ${p.al.name} does not start where ${prev.al.name} ends (${gap.toFixed(3)} m${back <= TOL_XY ? "; it is drawn the other way" : ""})`);
      }
      if (!bridged) {
        const zEnd = prev.pv.at(-1)!, zStart = p.pv[0]!;
        if (Math.abs(zEnd.s - prev.al.length) > TOL_XY || zStart.s > TOL_XY) throw new Error(`${name}: no level at the joint of ${prev.al.name} and ${p.al.name}`);
        if (zEnd.z == null || zStart.z == null || Math.abs(zEnd.z - zStart.z) > TOL_Z) throw new Error(`${name}: level step at the joint of ${prev.al.name} (${zEnd.z}) and ${p.al.name} (${zStart.z})`);
        if (zEnd.L || zStart.L) throw new Error(`${name}: a vertical curve at the joint of ${prev.al.name} and ${p.al.name}`);
      }
    }
    segs.push(...p.al.segs);
    // across a ring both end levels stay (the grade between them is the crossing); at a joint the shared one once
    p.pv.forEach((v, i) => { if (!(prev && i === 0 && !bridged)) pv.push({ ...v, s: v.s + s0 }); });
    s0 += p.al.length;
  });
  return { al: { name, length: s0, segs }, pv };
}

/**
 * A road whose end stops on a roundabout ring, carried on straight to the ring's centre, where it ends on
 * the through road at that road's level `zCentre` (Namar RD-13 and RD-32 at RA-01: their sections differ, so
 * they cannot be joined into one through road). The end keeps its own level; the grade runs from it to the
 * centre.
 */
export function extendToCentre(part: RoadPart, rings: readonly Ring[], zCentre: number): RoadPart & { at: "start" | "end"; dist: number } {
  const { al, pv } = part, a = al.segs[0]!.a, b = al.segs.at(-1)!.b;
  const ringEnd = ringAt(b, rings), ringStart = ringAt(a, rings);
  const ring = ringEnd ?? ringStart;
  if (!ring) throw new Error(`--to-centre: ${al.name} has no end on a roundabout ring`);
  if (ringEnd) {
    const d = Math.hypot(ring.c[0] - b[0], ring.c[1] - b[1]), last = pv.at(-1)!;
    if (last.L || Math.abs(last.s - al.length) > TOL_XY) throw new Error(`--to-centre: ${al.name} has no plain level at its ring end`);
    return { al: { ...al, length: al.length + d, segs: [...al.segs, { a: b, b: ring.c, bulge: 0 }] }, pv: [...pv, { s: +(al.length + d).toFixed(3), z: zCentre, L: 0 }], at: "end", dist: d };
  }
  const d = Math.hypot(a[0] - ring.c[0], a[1] - ring.c[1]), first = pv[0]!;
  if (first.L || first.s > TOL_XY) throw new Error(`--to-centre: ${al.name} has no plain level at its ring end`);
  return { al: { ...al, length: al.length + d, segs: [{ a: ring.c, b: a, bulge: 0 }, ...al.segs] }, pv: [{ s: 0, z: zCentre, L: 0 }, ...pv.map((v) => ({ ...v, s: +(v.s + d).toFixed(3) }))], at: "start", dist: d };
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

const station = (s: number) => `${Math.floor(s / 1000)}+${(s % 1000).toFixed(3).padStart(7, "0")}`;

/**
 * The designer's roads inside a merged road, for its DESCRIPTION (shown in the road's Stack):
 * "Parsons: R.0.C.1 0+000.000-0+780.422; R.0.C.2 0+780.422-1+231.277". A roundabout needs a road
 * through its centre (Al Qairawan RA-2, 5 Nov 2026: written back as two roads ending there, InfraWorks
 * dropped the roundabout's body), so merged roads stay; this keeps each drawn road traceable.
 */
export function partsDescription(parts: { name: string; length: number }[]): string {
  let s = 0;
  return "Parsons: " + parts.map((p) => { const t = `${p.name} ${station(s)}-${station(s + p.length)}`; s += p.length; return t; }).join("; ");
}

/** The part names recorded by partsDescription, or [] for any other description. */
export function partsFromDescription(d: string | null | undefined): string[] {
  const m = /^Parsons: (.+)$/.exec(d ?? "");
  return m ? m[1]!.split("; ").map((t) => t.split(" ")[0]!).filter(Boolean) : [];
}

/** Names of the drawing that are neither a road in the model nor a recorded part of a merged road. */
export function missingDrawnRoads(roads: { NAME: string; DESCRIPTION: string | null }[], drawn: string[]): string[] {
  const have = new Set<string>();
  for (const r of roads) { have.add(r.NAME); for (const n of partsFromDescription(r.DESCRIPTION)) have.add(n); }
  return drawn.filter((n) => !have.has(n));
}
/**
 * Writes a road's description where InfraWorks shows it: the road's Stack "Description" box stayed
 * empty with ROADS.DESCRIPTION set alone (R.0.C.2, 5 Nov 2026), so the road's definition row
 * (CONSTRAINED_DEFINITIONS.DESCRIPTION) gets it too. Returns the roads updated.
 */
export function setDescription(db: DatabaseSync, name: string, text: string): number {
  const n = Number(db.prepare("update ROADS set DESCRIPTION = ? where NAME = ?").run(text, name).changes);
  db.prepare("update CONSTRAINED_DEFINITIONS set DESCRIPTION = ? where GUID in (select FK_PARENT_GUID from ROADS where NAME = ?)").run(text, name);
  return n;
}