/**
 * Component roads written straight into an InfraWorks model (closed in InfraWorks), cloned from a
 * template road converted in InfraWorks itself (its CONSTRAINED_DEFINITIONS GUID).
 *
 * Tables: CONSTRAINED_DEFINITIONS (one per road), ROADS (name, 3D centreline, MANUAL_STYLE with the
 * componentStyle), H_CONSTRAINTS (3 straight / 4 arc by start-mid-end), V_CONSTRAINTS (15 tangent with
 * (station, level) points, 18 curve with PARAM_1 = length), CONSTRAINED_DEF_GEOM_LOCATIONS (start/end),
 * CONSTRAINED_DEF_RPSYSTEMS (centreline, length, range hash), and the body InfraWorks draws:
 * PRIMITIVES (one strip per component, marking lines) and TERRAIN_OPERATIONS (grading ring, CutOut).
 *
 * InfraWorks draws the body rows as stored and rebuilds them only when that one road is edited: the
 * rows are computed here from each road's own geometry. The template's range hash is zeroed so its
 * cached shapes are not taken as valid for the new road.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Section } from "@infraworks/domain";
import type { RoadPlan, XYZ } from "./plan.js";

type Row = Record<string, unknown>;

/**
 * Replaces only a road's section (componentStyle and lane counts in its MANUAL_STYLE); its other style
 * settings, geometry, body, GUIDs and junction links stay. InfraWorks builds the new section when the
 * road is next edited. Returns false when there is no road of that name.
 */
export function restyleRoad(db: DatabaseSync, name: string, sec: Section): boolean {
  const r = db.prepare("select GUID, MANUAL_STYLE m from ROADS where NAME=?").get(name) as Row | undefined;
  if (!r) return false;
  const s = JSON.parse(String(r.m));
  s.componentStyle = JSON.stringify(sec.componentStyle);
  s.lanes = { ...s.lanes, countForward: sec.lanes, countBackward: sec.lanes };
  db.prepare("update ROADS set MANUAL_STYLE=? where GUID=?").run(JSON.stringify(s, null, "\t"), String(r.GUID));
  return true;
}

/**
 * Deletes a road by name: its definition, constraints, start/end locations, reference system and
 * body. These are the only rows that point at a road (checked on Al Qairawan's 7 rings), besides
 * intersection links: clear those after with pruneDanglingIntersections. Returns the rows removed.
 */
export function removeRoad(db: DatabaseSync, name: string): number {
  let n = 0;
  for (const r of db.prepare("select GUID, FK_PARENT_GUID from ROADS where NAME=?").all(name) as Row[]) {
    for (const t of ["PRIMITIVES", "TERRAIN_OPERATIONS"]) n += Number(db.prepare(`delete from ${t} where FK_PARENT_GUID=?`).run(String(r.GUID)).changes);
    for (const t of ["H_CONSTRAINTS", "V_CONSTRAINTS", "CONSTRAINED_DEF_GEOM_LOCATIONS", "CONSTRAINED_DEF_RPSYSTEMS", "ROADS"]) n += Number(db.prepare(`delete from ${t} where FK_PARENT_GUID=?`).run(String(r.FK_PARENT_GUID)).changes);
    n += Number(db.prepare("delete from CONSTRAINED_DEFINITIONS where GUID=?").run(String(r.FK_PARENT_GUID)).changes);
  }
  return n;
}

const ptBlob = (x: number, y: number) => { const b = Buffer.alloc(32); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); b.writeDoubleLE(x, 8); b.writeDoubleLE(y, 16); return b; };
const pt3Blob = (x: number, y: number, z: number) => { const b = ptBlob(x, y); b.writeDoubleLE(z, 24); return b; };
export const lineBlob = (pts: readonly (readonly number[])[]) => {
  const b = Buffer.alloc(12 + 24 * pts.length);
  b.writeUInt32LE(2, 0); b.writeUInt32LE(1, 4); b.writeUInt32LE(pts.length, 8);
  pts.forEach((p, i) => p.forEach((v, k) => b.writeDoubleLE(v, 12 + 24 * i + 8 * k)));
  return b;
};
/** bbox polygon blob (3, 0, 1, 5 + five XY points), grown by m */
const bboxBlob = (pts: readonly (readonly number[])[], m: number) => {
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m;
  const b = Buffer.alloc(96);
  [3, 0, 1, 5].forEach((v, i) => b.writeUInt32LE(v, 4 * i));
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].forEach((p, i) => { b.writeDoubleLE(p[0]!, 16 + 16 * i); b.writeDoubleLE(p[1]!, 24 + 16 * i); });
  return b;
};
const num = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const jpts = (pts: readonly (readonly number[])[]) => "[" + pts.map((p) => `[ ${p.map(num).join(", ")} ]`).join(",") + "]";
const json = (b: unknown) => JSON.parse(Buffer.from(b as Uint8Array).toString("utf8"));

export class RoadWriter {
  private readonly tCD: Row; private readonly tRoad: Row; private readonly tH: Row; private readonly tV: Row;
  private readonly tLoc: Row[]; private readonly tRps: Row; private readonly tPrim: Row[]; private readonly tTop: Row[];
  /** Planning roads (imported centrelines) replaced by a component road of the same name. */
  readonly replacedPlanning: string[] = [];

  /**
   * src: where the template road is read (default the model itself). Once InfraWorks has rebuilt the
   * template road in the working model its rows are InfraWorks' own (R.6.E.1, 6 Nov 2026: 4 terrain
   * operations instead of 5), so the template is read from the base model the roads were written from.
   */
  constructor(private readonly db: DatabaseSync, private readonly template: string, src: DatabaseSync = db) {
    const from = (q: string, ...a: string[]) => { const s = src.prepare(q); s.setReadBigInts(true); return s.all(...a) as Row[]; };
    const one = (q: string, ...a: string[]) => { const r = from(q, ...a)[0]; if (!r) throw new Error(`template ${template}: nothing for "${q}"`); return r; };
    this.tCD = one("select * from CONSTRAINED_DEFINITIONS where GUID=?", template);
    this.tRoad = one("select * from ROADS where FK_PARENT_GUID=?", template);
    this.tH = one("select * from H_CONSTRAINTS where FK_PARENT_GUID=? and CONSTRAINT_TYPE=3", template);
    this.tV = one("select * from V_CONSTRAINTS where FK_PARENT_GUID=? and CONSTRAINT_TYPE=15", template);
    this.tLoc = from("select * from CONSTRAINED_DEF_GEOM_LOCATIONS where FK_PARENT_GUID=? order by TYPE", template);
    this.tRps = one("select * from CONSTRAINED_DEF_RPSYSTEMS where FK_PARENT_GUID=?", template);
    this.tPrim = from("select * from PRIMITIVES where FK_PARENT_GUID=?", String(this.tRoad.GUID));
    this.tTop = from("select * from TERRAIN_OPERATIONS where FK_PARENT_GUID=?", String(this.tRoad.GUID));
  }

  private all(q: string, ...a: string[]): Row[] {
    const s = this.db.prepare(q);
    s.setReadBigInts(true);
    return s.all(...a) as Row[];
  }

  private insert(table: string, tpl: Row, over: Row) {
    const row: Row = { ...tpl, ...over };
    delete row.ID;
    const cols = Object.keys(row);
    this.db.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...(cols.map((c) => row[c]) as never[]));
  }

  exists(name: string): boolean { return this.all("select GUID from ROADS where NAME=?", name).length > 0; }

  /** Delete a road (definition, constraints, body). */
  remove(name: string) {
    if (this.all("select GUID from ROADS where NAME=? and FK_PARENT_GUID=?", name, this.template).length) throw new Error(`${name} is the template road`);
    removeRoad(this.db, name);
  }

  private styleOf(sec: Section | null): Row {
    if (!sec) return {};
    const s = JSON.parse(String(this.tRoad.MANUAL_STYLE));
    s.componentStyle = JSON.stringify(sec.componentStyle);
    s.lanes = { ...s.lanes, countForward: sec.lanes, countBackward: sec.lanes };
    return { MANUAL_STYLE: JSON.stringify(s, null, "\t"), MAX_SPEED: sec.speed ?? Number(this.tRoad.MAX_SPEED) };
  }

  /** Is this road the template (converted in InfraWorks, its constraints are kept)? */
  isTemplate(name: string): boolean { return this.all("select GUID from ROADS where NAME=? and FK_PARENT_GUID=?", name, this.template).length > 0; }

  /**
   * The template road keeps its definition and constraints (from InfraWorks' own conversion); its
   * centreline, section, speed and body are refreshed. Other roads are cloned from the template's
   * rows as read when this writer was made, so the result does not depend on this refresh.
   */
  refreshTemplate(plan: RoadPlan, sec: Section | null) {
    this.db.exec("SAVEPOINT road_write");
    try {
      const road = this.tRoad, guid = String(road.GUID), rps = String(this.tRps.GUID);
      for (const t of ["PRIMITIVES", "TERRAIN_OPERATIONS"]) this.db.prepare(`delete from ${t} where FK_PARENT_GUID=?`).run(guid);
      this.insertBody(guid, rps, rps, plan.line, sec);
      const style = this.styleOf(sec);
      this.db.prepare("update ROADS set GEOMETRY=? where GUID=?").run(lineBlob(plan.line), guid);
      if (sec) this.db.prepare("update ROADS set MANUAL_STYLE=?, MAX_SPEED=? where GUID=?").run(String(style.MANUAL_STYLE), Number(style.MAX_SPEED), guid);
      this.db.prepare("update CONSTRAINED_DEF_RPSYSTEMS set GEOMETRY=? where GUID=?").run(lineBlob(plan.line), rps);
      this.db.exec("RELEASE road_write");
    } catch (e) {
      this.db.exec("ROLLBACK TO road_write; RELEASE road_write");
      throw e;
    }
  }

  /**
   * Intersection rows that point at a road (InfraWorks' INTERSECTION_ARMS / INTERSECTION_REGIONS).
   * They hold the road's CONSTRAINED_DEFINITIONS GUID (all 385 links in Al Qairawan), not ROADS.GUID.
   */
  intersectionLinks(definitionGuid: string): number {
    let n = 0;
    for (const [t, cols] of [["INTERSECTION_ARMS", ["FK_ASSET_GUID"]], ["INTERSECTION_REGIONS", ["FK_INCOMING_ASSET_GUID", "FK_OUTGOING_ASSET_GUID"]]] as const) {
      try { n += Number((this.db.prepare(`select count(*) n from ${t} where ${cols.map((c) => `${c}=?`).join(" or ")}`).get(...cols.map(() => definitionGuid)) as { n: number | bigint }).n); }
      catch { /* a model without that table */ }
    }
    return n;
  }

  /**
   * Write a road (a road of that name is replaced). Unclassified roads (sec null) keep the template section.
   * A replaced road keeps its ROADS and CONSTRAINED_DEFINITIONS GUIDs: InfraWorks' intersections point
   * at a road's definition GUID (INTERSECTION_ARMS.FK_ASSET_GUID, INTERSECTION_REGIONS incoming /
   * outgoing; 44 roads in Al Qairawan), and a new GUID would leave them pointing at nothing. A road
   * InfraWorks split into pieces (RA-1 after a rebuild) is refused when a piece other than the first
   * carries intersections.
   */
  write(plan: RoadPlan, sec: Section | null) {
    const { name, H, pvis, total, line } = plan;
    if (this.isTemplate(name)) { this.refreshTemplate(plan, sec); return; }
    // A planning road of that name (imported centreline, no definition: Al Narjis, 10 Nov 2026) is
    // replaced by the component road. Junction rows InfraWorks made when a crossing road was converted
    // point at the planning road's ROADS.GUID (Al Narjis: 12 arms, 8 regions on ROAD-01's crossings),
    // so the new definition takes that GUID and the links stay valid.
    const plan0 = this.all("select GUID from ROADS where NAME=? and FK_PARENT_GUID is null order by ID", name)[0];
    const old = this.all("select GUID, FK_PARENT_GUID from ROADS where NAME=? and FK_PARENT_GUID is not null order by ID", name);
    const linked = old.slice(1).filter((r) => this.intersectionLinks(String(r.FK_PARENT_GUID)) > 0);
    if (linked.length) throw new Error(`${name}: ${old.length} rows, and ${linked.length} piece(s) besides the first carry intersections; not replaced`);
    this.db.exec("SAVEPOINT road_write");
    try {
      if (this.db.prepare("delete from ROADS where NAME=? and FK_PARENT_GUID is null").run(name).changes) this.replacedPlanning.push(name);
      if (old.length) this.remove(name);
      const style = this.styleOf(sec);
      const gCD = old[0] ? String(old[0].FK_PARENT_GUID) : plan0 ? String(plan0.GUID) : randomUUID(), gRoad = old[0] ? String(old[0].GUID) : randomUUID(), gRps = randomUUID();
      const start = line[0]!, end = line[line.length - 1]!;
      this.insert("CONSTRAINED_DEFINITIONS", this.tCD, { GUID: gCD, NAME: name, FK_DEFAULT_ASSET_GUID: gRoad, REFERENCE_POINT: pt3Blob(...start) });
      this.insert("ROADS", this.tRoad, { GUID: gRoad, NAME: name, FK_PARENT_GUID: gCD, GEOMETRY: lineBlob(line), ...style });
      const nulls = (tpl: Row, keep: string[]) => Object.fromEntries(Object.keys(tpl).filter((k) => !keep.includes(k)).map((k) => [k, null]));
      const hG = H.map(() => randomUUID());
      const hBase = nulls(this.tH, ["FK_PARENT_TABLE"]);
      H.forEach((e, i) => this.insert("H_CONSTRAINTS", hBase, {
        GUID: hG[i], FK_PARENT_TABLE: this.tH.FK_PARENT_TABLE, FK_PARENT_GUID: gCD,
        FK_PREV_H_CONSTRAINTS_GUID: hG[i - 1] ?? null, FK_NEXT_H_CONSTRAINTS_GUID: hG[i + 1] ?? null,
        CONSTRAINT_TYPE: e.kind === "line" ? 3 : 4, CONSTRAINT_TYPE_DEFINITION: e.kind === "line" ? 0 : 2,
        PASSTHROUGH_PT_1: ptBlob(...e.a), PASSTHROUGH_PT_2: ptBlob(...(e.kind === "line" ? e.b : e.m)), PASSTHROUGH_PT_3: e.kind === "arc" ? ptBlob(...e.b) : null,
      }));
      // vertical chain: tangents PVI -> PVI, a curve row (18) at each PVI with L > 0
      type V = { type: 15; p: { s: number; z: number }; q: { s: number; z: number }; g: string } | { type: 18; curve: number; L: number; g: string };
      const chain: V[] = [];
      for (let i = 0; i + 1 < pvis.length; i++) {
        const p = pvis[i]!, q = pvis[i + 1]!;
        if (i > 0 && p.L > 0) {
          const a = pvis[i - 1]!, gin = (p.z - a.z) / (p.s - a.s), gout = (q.z - p.z) / (q.s - p.s);
          chain.push({ type: 18, curve: gout > gin ? 4096 : 4097, L: p.L, g: randomUUID() });
        }
        chain.push({ type: 15, p, q, g: randomUUID() });
      }
      const vBase = nulls(this.tV, ["FK_PARENT_TABLE"]);
      chain.forEach((c, k) => this.insert("V_CONSTRAINTS", vBase, {
        GUID: c.g, FK_PARENT_TABLE: this.tV.FK_PARENT_TABLE, FK_PARENT_GUID: gCD,
        FK_PREV_V_CONSTRAINTS_GUID: chain[k - 1]?.g ?? null, FK_NEXT_V_CONSTRAINTS_GUID: chain[k + 1]?.g ?? null,
        CONSTRAINT_TYPE: c.type, CONSTRAINT_TYPE_DEFINITION: 0,
        ...(c.type === 15
          ? { GEOMETRY: lineBlob([[...plan.xy(c.p.s), c.p.z], [...plan.xy(c.q.s), c.q.z]]), PASSTHROUGH_PT_1: ptBlob(c.p.s, c.p.z), PASSTHROUGH_PT_2: ptBlob(c.q.s, c.q.z) }
          : { CURVE_TYPE: c.curve, PARAM_1: c.L }),
      }));
      for (const l of this.tLoc) {
        const isEnd = Number(l.TYPE) === 3, p = isEnd ? end : start;
        const g = Buffer.alloc(36);
        g.writeUInt32LE(2, 0); g.writeUInt32LE(1, 4); g.writeUInt32LE(1, 8); g.writeDoubleLE(p[0], 12); g.writeDoubleLE(p[1], 20); g.writeDoubleLE(0, 28);
        this.insert("CONSTRAINED_DEF_GEOM_LOCATIONS", l, { GUID: randomUUID(), FK_PARENT_GUID: gCD, GEOMETRY: g, FK_REFERENCE_H_CONSTRAINTS_GUID: isEnd ? hG[hG.length - 1] : hG[0], SUB_ELEMENT: isEnd ? H.length : 1, PARAM: isEnd ? 1 : 0, STATION: isEnd ? total : 0 });
      }
      // JSON_RANGE_HASH is InfraWorks' cache key for the body rows: copied as is it says the template's
      // cached shapes are valid (the new road was not drawn); zeroed, InfraWorks takes the stored rows
      const staleHash = Buffer.from(Buffer.from(this.tRps.JSON_RANGE_HASH as Uint8Array).toString("utf8").replace(/"Value": "[0-9A-F]{32}"/g, `"Value": "${"0".repeat(32)}"`), "utf8");
      this.insert("CONSTRAINED_DEF_RPSYSTEMS", this.tRps, { GUID: gRps, FK_PARENT_GUID: gCD, GEOMETRY: lineBlob(line), LENGTH_2D: total, JSON_RANGE_HASH: staleHash });
      this.insertBody(gRoad, String(this.tRps.GUID), gRps, line, sec);
      this.db.exec("RELEASE road_write");
    } catch (e) {
      this.db.exec("ROLLBACK TO road_write; RELEASE road_write");
      throw e;
    }
  }

  /** The body rows: one strip per component, marking lines, grading ring (keys = corners) and CutOut. */
  private insertBody(roadGuid: string, rpsOld: string, rpsNew: string, line: XYZ[], sec: Section | null) {
    const d = bodyRows(this.tPrim, line, sec);
    for (const p of d.prims) this.insert("PRIMITIVES", p.t, { GUID: randomUUID(), FK_PARENT_GUID: roadGuid, ...(p.part != null ? { PARENT_PART_ID: p.part } : {}), GROUP_URN: String(p.t.GROUP_URN).replace(rpsOld, rpsNew), JSON_DATA: p.json, GEOMETRY: p.geom });
    const grading = JSON.parse(String(this.tRoad.GRADING_DATA || "{}")).gradingComponent || {};
    const m = (grading.gradingLimit || 5) + 2;
    const K = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const bbox3 = (pts: XYZ[]) => [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]!))).concat([0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]!))));
    const gradingJson = (coords: XYZ[], comp: unknown) => `{"type": "Grading","footprint": {"type": "LineString","bbox": [ ${bbox3(coords).map(num).join(", ")} ],"coordinates": ${jpts(coords)}},"gradingComponent": ${JSON.stringify(comp)}}`;
    // Template rows by type: Al Qairawan's R.6.E.1 has 4 Gradings (start, end, right, left) then a
    // CutOut; Al Narjis' ROAD-01, converted in InfraWorks 2026 on 10 Nov, has 3 x (Grading, Grading,
    // CutOut). The rows differ only in their operation, which is written here.
    const ops = this.tTop.slice().sort((a, b) => Number(a.ID) - Number(b.ID));
    const typeOf = (t: Row) => json(t.TERRAIN_OPERATION).type;
    const gr = ops.filter((t) => typeOf(t) === "Grading"), tC = ops.find((t) => typeOf(t) === "CutOut");
    if (!gr.length || !tC) throw new Error("template road: expected Grading and CutOut terrain operations");
    const [tS, tE, tR, tL] = [0, 1, 2, 3].map((k) => gr[k] ?? gr[0]!);
    const compOf = (t: Row) => json(t.TERRAIN_OPERATION).gradingComponent;
    const rows: [Row, string, XYZ[], string | null, string | null][] = [
      [tS!, gradingJson(d.startT, compOf(tS!)), d.startT, K[0]!, K[1]!],
      [tE!, gradingJson(d.endT, compOf(tE!)), d.endT, K[2]!, K[3]!],
      [tR!, gradingJson(d.rightEdge, compOf(tR!)), d.rightEdge, K[1]!, K[2]!],
      [tL!, gradingJson(d.leftEdgeRev, compOf(tL!)), d.leftEdgeRev, K[3]!, K[0]!],
      [tC, `{"type": "CutOut","footprint": {"type": "Polygon","bbox": [ ${bbox3(d.cut).map(num).join(", ")} ],"coordinates": [${jpts(d.cut)}]}}`, d.cut, null, null],
    ];
    for (const [t, j, pts, k1, k2] of rows) this.insert("TERRAIN_OPERATIONS", t, { GUID: randomUUID(), FK_PARENT_GUID: roadGuid, GROUP_URN: String(t.GROUP_URN).replace(rpsOld, rpsNew), TERRAIN_OPERATION: Buffer.from(j, "utf8"), GEOMETRY: bboxBlob(pts, t === tC ? 0 : m), START_POINT_KEY: k1, END_POINT_KEY: k2 });
  }
}

/** Body geometry of one road (exported for tests): strips, transitions, edges and the CutOut ring. */
export function bodyRows(tPrim: Row[], line: XYZ[], sec: Section | null) {
  const n = line.length, p0 = line[0]!, p1 = line[1]!, pn = line[n - 1]!, pm = line[n - 2]!;
  const path: XYZ[] = [[2 * p0[0] - p1[0], 2 * p0[1] - p1[1], p1[2]], ...line, [2 * pn[0] - pm[0], 2 * pn[1] - pm[1], pm[2]]];
  // left normal at each vertex (average of the adjacent segment directions)
  const nrm = line.map((_, i) => { const a = line[Math.max(0, i - 1)]!, b = line[Math.min(n - 1, i + 1)]!; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [-dy / l, dx / l] as const; });
  // cross-section offset d > 0 lies right of the direction of travel
  const off = (d: number, dz = 0): XYZ[] => line.map((p, i) => [p[0] - nrm[i]![0] * d, p[1] - nrm[i]![1] * d, p[2] + dz]);
  type Prim = { t: Row; part?: bigint; json: Buffer; geom: Buffer };
  const ring = (right: XYZ[], left: XYZ[]) => [...right, ...left.slice().reverse(), right[0]!];
  if (sec) {
    const tStrip = tPrim.find((t) => json(t.JSON_DATA).type === "multiMorphingCrossSection");
    const tMark = tPrim.find((t) => json(t.JSON_DATA).type === "symbolizedPath");
    if (!tStrip || !tMark) throw new Error("template road: expected a multiMorphingCrossSection and a symbolizedPath");
    const strip = json(tStrip.JSON_DATA), mark = json(tMark.JSON_DATA);
    const part = (id: number) => (3n << 56n) | BigInt(id);
    const prims: Prim[] = sec.parts.map((p) => {
      const xs = p.crossSection.map((q) => q[0]);
      const j = { ...strip, path, vertexIndices: [0, n - 1], crossSections: [p.crossSection, p.crossSection], material: p.material, startCapMaterial: p.material, endCapMaterial: p.material };
      return { t: tStrip, part: part(p.id), json: Buffer.from(JSON.stringify(j), "utf8"), geom: bboxBlob([...off(Math.min(...xs)), ...off(Math.max(...xs))], 0.5) };
    });
    const laneId = sec.parts.find((p) => p.role === "lane")!.id;
    for (const x of sec.marking) { const ln = off(x); prims.push({ t: tMark, part: part(laneId), json: Buffer.from(JSON.stringify({ ...mark, path: [ln[0], ...ln, ln[n - 1]] }), "utf8"), geom: bboxBlob(ln, 0.5) }); }
    const B = sec.bound, left = off(B[0]![0], B[0]![1]), right = off(B[B.length - 1]![0], B[B.length - 1]![1]);
    const startT = B.map(([x, y]) => off(x, y)[0]!), endT = B.slice().reverse().map(([x, y]) => off(x, y)[n - 1]!);
    return { prims, startT, endT, rightEdge: right, leftEdgeRev: left.slice().reverse(), cut: ring(right, left) };
  }
  const prims: Prim[] = tPrim.map((t) => {
    const j = json(t.JSON_DATA);
    let geomPts: XYZ[];
    if (j.type === "multiMorphingCrossSection") {
      const xs = (j.crossSections as number[][][]).flat().map((q) => q[0]!), lo = Math.min(...xs), hi = Math.max(...xs);
      j.path = path; j.vertexIndices = [0, n - 1]; geomPts = [...off(lo), ...off(hi)];
    } else { j.path = [line[0], ...line, line[n - 1]]; geomPts = line; }
    return { t, json: Buffer.from(JSON.stringify(j), "utf8"), geom: bboxBlob(geomPts, 0.5) };
  });
  const allX = tPrim.flatMap((t) => { const j = json(t.JSON_DATA); return j.crossSections ? (j.crossSections as number[][][]).flat().map((q) => q[0]!) : []; });
  const left = off(Math.min(...allX)), right = off(Math.max(...allX));
  const xsUp = [...new Set(allX)].sort((a, b) => a - b);
  return { prims, startT: xsUp.map((x) => off(x)[0]!), endT: xsUp.slice().reverse().map((x) => off(x)[n - 1]!), rightEdge: right, leftEdgeRev: left.slice().reverse(), cut: ring(right, left) };
}
