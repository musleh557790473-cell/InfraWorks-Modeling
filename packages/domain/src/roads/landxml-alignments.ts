/**
 * Roads from a Civil 3D LandXML export of the designer's alignments and profiles (Namar 60 %:
 * `C3D_Nemar_Aligments_Profiles.dwg`; the layout sheets hold the centrelines only as Civil 3D alignments,
 * which a DXF does not carry). Exact geometry and names, no chaining and no direction guess:
 *
 *   <Alignment name length staStart>
 *     <CoordGeom> <Line><Start>N E</Start><End>N E</End></Line>
 *                 <Curve rot="cw|ccw" radius><Start/><Center/><End/></Curve> ... </CoordGeom>
 *     <Profile> <ProfAlign name> <PVI>sta z</PVI> <ParaCurve length>sta z</ParaCurve> ... </ProfAlign> </Profile>
 *   </Alignment>
 *
 * Nothing is invented: an alignment with a spiral, without a design profile, with several design profiles
 * and no way to choose, or with an unsymmetrical vertical curve is left out and named in `skipped`.
 */
import type { Alignment } from "./alignments.js";
import { arcOf, dist, first, last, near, pieceLen, trimTo, type P2, type Seg } from "./geometry.js";
import type { Pvi } from "./profiles.js";

export interface LandXmlRoads {
  roads: Alignment[];
  pvis: Record<string, Pvi[]>;
  /** one line per alignment read, with what was adjusted */
  report: string[];
  skipped: { name: string; why: string }[];
  /** roundabout rings (closed alignments of arcs about one centre), also when their profile was not read:
   *  Namar RA-01 carries an unsymmetrical vertical curve, and a ring is not written as a road anyway */
  rings: { name: string; c: P2; r: number }[];
}

export interface LandXmlRoadOptions {
  /** only alignments whose name matches (Civil 3D also exports offset and kerb-return alignments) */
  match?: RegExp;
  /** the design profile's name, when an alignment carries several ProfAlign */
  profile?: RegExp;
}

const attrs = (s: string): Record<string, string> =>
  Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")]));
/** LandXML points are "northing easting [z]". */
const ne = (body: string, tag: string): P2 | null => {
  const m = body.match(new RegExp(`<${tag}\\b[^>]*>([^<]+)</${tag}>`));
  if (!m) return null;
  const [n, e] = m[1]!.trim().split(/\s+/).map(Number);
  return isFinite(n!) && isFinite(e!) ? [e!, n!] : null;
};

/** Segments of one CoordGeom; arcs are split at 90 degrees (a ring exported as one curve would have an infinite bulge). */
function coordGeom(body: string): Seg[] {
  const segs: Seg[] = [];
  for (const m of body.matchAll(/<(Line|Curve|Spiral|IrregularLine|Chain)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const kind = m[1]!, a = attrs(m[2]!), b = m[3]!;
    if (kind !== "Line" && kind !== "Curve") throw new Error(`a ${kind} element (only lines and circular curves are read)`);
    const s = ne(b, "Start"), e = ne(b, "End");
    if (!s || !e) throw new Error(`a ${kind} without Start / End`);
    if (kind === "Line") { if (dist(s, e) > 1e-6) segs.push({ a: s, b: e, bulge: 0 }); continue; }
    const c = ne(b, "Center");
    if (!c || (a.rot !== "cw" && a.rot !== "ccw")) throw new Error("a Curve without Center or rot");
    const r = dist(s, c), a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]), TAU = 2 * Math.PI;
    if (Math.abs(dist(e, c) - r) > 0.005) throw new Error(`a Curve whose ends are ${Math.abs(dist(e, c) - r).toFixed(3)} m apart in radius`);
    let th = (((a.rot === "ccw" ? a1 - a0 : a0 - a1) % TAU) + TAU) % TAU;
    if (th < 1e-9) th = TAU; // start = end: a full circle
    th *= a.rot === "ccw" ? 1 : -1;
    const n = Math.max(1, Math.ceil(Math.abs(th) / (Math.PI / 2) - 1e-9)), dt = th / n;
    const P = (t: number): P2 => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
    for (let k = 0; k < n; k++) segs.push({ a: k ? P(a0 + dt * k) : s, b: k === n - 1 ? e : P(a0 + dt * (k + 1)), bulge: Math.tan(dt / 4) });
  }
  return segs;
}

function profAlign(body: string, sta0: number): Pvi[] {
  const out: Pvi[] = [];
  for (const m of body.matchAll(/<(PVI|ParaCurve|CircCurve|UnsymParaCurve)\b([^>]*)>([^<]+)<\/\1>/g)) {
    const [s, z] = m[3]!.trim().split(/\s+/).map(Number), a = attrs(m[2]!);
    if (!isFinite(s!) || !isFinite(z!)) throw new Error(`a ${m[1]} without station and level`);
    if (m[1] === "UnsymParaCurve") throw new Error(`an unsymmetrical vertical curve at ${s}`);
    const L = m[1] === "PVI" ? 0 : +a.length!;
    if (!isFinite(L)) throw new Error(`a ${m[1]} without length at ${s}`);
    out.push({ s: +(s! - sta0).toFixed(4), z: z!, L });
  }
  return out.sort((p, q) => p.s - q.s);
}

export function readLandXmlRoads(xml: string, opt: LandXmlRoadOptions = {}): LandXmlRoads {
  const res: LandXmlRoads = { roads: [], pvis: {}, report: [], skipped: [], rings: [] };
  for (const m of xml.matchAll(/<Alignment\b([^>]*)>([\s\S]*?)<\/Alignment>/g)) {
    const a = attrs(m[1]!), name = (a.name ?? "").trim(), body = m[2]!;
    if (!name || (opt.match && !opt.match.test(name))) continue;
    const skip = (why: string) => res.skipped.push({ name, why });
    if (res.roads.some((r) => r.name === name)) { skip("a second alignment of the same name"); continue; }
    try {
      if (/<StaEquation\b/.test(body)) throw new Error("a station equation");
      const cg = body.match(/<CoordGeom\b[^>]*>([\s\S]*?)<\/CoordGeom>/);
      let segs = cg ? coordGeom(cg[1]!) : [];
      if (!segs.length) throw new Error("no geometry");
      segs.forEach((g, i) => { if (i && !near(segs[i - 1]!.b, g.a, 0.005)) throw new Error(`a gap of ${dist(segs[i - 1]!.b, g.a).toFixed(3)} m before element ${i + 1}`); });
      const ring = ringOf({ name, length: 0, segs });
      if (ring) res.rings.push({ name, ...ring });
      const profs = [...body.matchAll(/<ProfAlign\b([^>]*)>([\s\S]*?)<\/ProfAlign>/g)].map((p) => ({ name: attrs(p[1]!).name ?? "", body: p[2]! }));
      if (!profs.length) throw new Error("no design profile");
      const named = opt.profile ? profs.filter((p) => opt.profile!.test(p.name)) : profs;
      if (named.length !== 1) throw new Error(`${named.length} design profiles to choose from (${profs.map((p) => p.name).join(", ")})`);
      const pv = profAlign(named[0]!.body, +(a.staStart ?? 0) || 0);
      if (pv.length < 2) throw new Error(`profile "${named[0]!.name}" has ${pv.length} PVI`);
      const L = pieceLen(segs), notes: string[] = [], sEnd = last(pv).s;
      if (a.length && Math.abs(+a.length - L) > 0.01) notes.push(`stated length ${(+a.length).toFixed(3)}`);
      if (first(pv).s > 0.3) throw new Error(`the profile starts at ${first(pv).s.toFixed(3)} m`);
      if (sEnd > L + 0.01) throw new Error(`the profile ends at ${sEnd.toFixed(3)} m, the alignment at ${L.toFixed(3)} m`);
      // a profile stopping before the alignment's end: the road ends where the profile ends (as R.0.D.5)
      if (sEnd < L - 0.01) { segs = trimTo(segs, sEnd); notes.push(`alignment ${L.toFixed(3)} m cut to the profile end`); }
      if (/<CircCurve\b/.test(named[0]!.body)) notes.push("circular vertical curve(s) written as parabolas of the same length");
      const len = pieceLen(segs);
      res.roads.push({ name, length: len, segs });
      res.pvis[name] = pv;
      res.report.push(`${name}: plan ${len.toFixed(3)} m, ${segs.length} elements, profile "${named[0]!.name}" ${pv.length} PVIs${notes.length ? `; ${notes.join("; ")}` : ""}`);
    } catch (e) { skip(e instanceof Error ? e.message : String(e)); }
  }
  return res;
}

/** A closed alignment made of arcs about one centre (a roundabout ring): its circle. */
export function ringOf(al: Alignment): { c: P2; r: number } | null {
  if (!near(first(al.segs).a, last(al.segs).b) || al.segs.some((g) => !g.bulge)) return null;
  const arcs = al.segs.map(arcOf), o = arcs[0]!;
  return arcs.every((q) => Math.hypot(q.cx - o.cx, q.cy - o.cy) < 0.01 && Math.abs(q.r - o.r) < 0.01) ? { c: [o.cx, o.cy], r: o.r } : null;
}
