/**
 * Checks of the roads written into a model: levels (NaN or out of range in the centreline, the body
 * strips, the grading) and level steps at junctions (a road end lying on another road's centreline).
 */
import type { DatabaseSync } from "node:sqlite";

type P3 = [number, number, number];

const lineOf = (blob: unknown): P3[] => {
  const g = Buffer.from(blob as Uint8Array), n = g.readUInt32LE(8), p: P3[] = [];
  for (let i = 0; i < n; i++) p.push([g.readDoubleLE(12 + 24 * i), g.readDoubleLE(20 + 24 * i), g.readDoubleLE(28 + 24 * i)]);
  return p;
};
const zsOf = (v: unknown, out: number[] = []): number[] => {
  if (Array.isArray(v)) { if (v.length === 3 && v.every((x) => typeof x === "number")) out.push(v[2] as number); else v.forEach((x) => zsOf(x, out)); }
  else if (v && typeof v === "object") Object.values(v).forEach((x) => zsOf(x, out));
  return out;
};

export interface RoadRow { name: string; guid: string; line: P3[] }

export function roadRows(db: DatabaseSync, like = "R%"): RoadRow[] {
  // Component roads only: planning roads (no definition, 2D geometry) such as Al Narjis' "EXTERNAL ROAD"
  // stay outside the level checks.
  return (db.prepare("select NAME, GUID, GEOMETRY from ROADS where NAME like ? and FK_PARENT_GUID is not null").all(like) as { NAME: string; GUID: string; GEOMETRY: Uint8Array }[]).map((r) => ({ name: r.NAME, guid: r.GUID, line: lineOf(r.GEOMETRY) }));
}

/** Roads with NaN in their body rows, or levels far from their own centreline range. */
export function levelProblems(db: DatabaseSync, roads: RoadRow[]): string[] {
  const bad: string[] = [];
  for (const r of roads) {
    const z = r.line.map((p) => p[2]), lo = Math.min(...z), hi = Math.max(...z), issues: string[] = [];
    if (z.some((v) => !isFinite(v)) || hi - lo > 30) issues.push(`centreline z ${lo.toFixed(2)}..${hi.toFixed(2)}`);
    for (const p of db.prepare("select JSON_DATA from PRIMITIVES where FK_PARENT_GUID=?").all(r.guid) as { JSON_DATA: Uint8Array }[]) {
      const s = Buffer.from(p.JSON_DATA).toString("utf8");
      if (s.includes("NaN") || s.includes("null")) { issues.push("NaN in a body strip"); break; }
      const pz = zsOf(JSON.parse(s).path ?? []);
      if (pz.length && (Math.min(...pz) < lo - 1 || Math.max(...pz) > hi + 1)) { issues.push(`body strip z ${Math.min(...pz).toFixed(2)}..${Math.max(...pz).toFixed(2)}`); break; }
    }
    for (const t of db.prepare("select TERRAIN_OPERATION from TERRAIN_OPERATIONS where FK_PARENT_GUID=?").all(r.guid) as { TERRAIN_OPERATION: Uint8Array }[]) {
      const s = Buffer.from(t.TERRAIN_OPERATION).toString("utf8");
      if (s.includes("NaN")) { issues.push("NaN in the grading"); break; }
      const j = JSON.parse(s), tz = zsOf(j.footprint?.coordinates ?? []);
      if (tz.length && (Math.min(...tz) < lo - 1 || Math.max(...tz) > hi + 1)) { issues.push(`${j.type} z ${Math.min(...tz).toFixed(2)}..${Math.max(...tz).toFixed(2)}`); break; }
    }
    if (issues.length) bad.push(`${r.name}: ${issues.join("; ")}`);
  }
  return bad;
}

export interface JunctionStep { road: string; at: "start" | "end"; on: string; z: number; zOn: number; step: number }

/**
 * `--tie-ends R.4.G.2@R.0.D.11,...`: for each road, the end lying on the named road and the level to
 * give it (the named road's level there). Refuses a missing junction or a step over `maxStep`.
 */
export function parseTieEnds(spec: string): { road: string; on: string }[] {
  return spec.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [road, on] = s.split("@");
    if (!road || !on) throw new Error(`--tie-ends: "${s}" is not ROAD@ROAD_IT_ENDS_ON`);
    return { road, on };
  });
}

export function tieLevels(roads: RoadRow[], ties: { road: string; on: string }[], maxStep = 0.1): Map<string, { startZ?: number; endZ?: number; step: number; on: string }> {
  const steps = junctionSteps(roads), out = new Map<string, { startZ?: number; endZ?: number; step: number; on: string }>();
  for (const t of ties) {
    const j = steps.find((s) => s.road === t.road && s.on === t.on);
    if (!j) throw new Error(`--tie-ends: ${t.road} has no end on ${t.on}`);
    if (Math.abs(j.step) > maxStep) throw new Error(`--tie-ends: ${t.road} is ${j.step.toFixed(3)} m off ${t.on}, more than ${maxStep} m: not a small disagreement`);
    out.set(t.road, { ...(j.at === "start" ? { startZ: j.zOn } : { endZ: j.zOn }), step: j.step, on: t.on });
  }
  return out;
}

/** Every road end lying (within 1 m) on another road's centreline, with the level step there. */
export function junctionSteps(roads: RoadRow[]): JunctionStep[] {
  const near = (q: P3[], x: P3) => {
    let best: { d: number; z: number } | null = null;
    for (let i = 1; i < q.length; i++) {
      const a = q[i - 1]!, b = q[i]!, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((x[0] - a[0]) * dx + (x[1] - a[1]) * dy) / l2)), d = Math.hypot(x[0] - a[0] - dx * t, x[1] - a[1] - dy * t);
      if (!best || d < best.d) best = { d, z: a[2] + (b[2] - a[2]) * t };
    }
    return best;
  };
  const out: JunctionStep[] = [];
  for (const r of roads) for (const end of [0, r.line.length - 1]) {
    const x = r.line[end]!;
    for (const o of roads) { if (o === r) continue; const m = near(o.line, x); if (m && m.d < 1.0) out.push({ road: r.name, at: end ? "end" : "start", on: o.name, z: x[2], zOn: m.z, step: x[2] - m.z }); }
  }
  return out;
}
