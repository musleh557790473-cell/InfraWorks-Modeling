#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  applySectionDecisions, assemblePvis, buildAlignments, buildRoundaboutSection, parseSectionDecisions, buildSection, classifySections, crossfallSides, loadLandXmlSurface, measureRoundabouts, orientRoads,
  readDxfBlock, readLandXmlRoads, readProfileViews, type Alignment, type NamedStart, type ProfileView, type Pvi, type Section,
} from "@infraworks/domain";

import { junctionSteps, levelProblems, parseTieEnds, roadRows, tieLevels } from "./roads/checks.js";
import { planRoad } from "./roads/plan.js";
import { pruneDanglingIntersections, repointLinks, splitLinks } from "./roads/intersections.js";
import { parseFgf } from "@infraworks/imx-gate";
import { extendToCentre, mergeRoads, missingDrawnRoads, parseMerges, partsDescription, setDescription, type Ring } from "./roads/merge.js";
import { roadsToWrite } from "./roads/select.js";
import { RoadWriter, removeRoad, restyleRoad } from "./roads/write.js";

const USAGE = `
model-roads - Parsons roads as InfraWorks component roads, written into a model (closed in InfraWorks)

  model-roads <model.sqlite> --template <constrained-definition GUID>
      --layout <ROD-DWG-10200 .dxf> --profiles <ROD-DWG-40000 .dxf> --surface <grading LandXML>
      [--package <roads package road_centerline (no extension)>] [--out-dir <folder for the JSON results>]
      [--layout-block "Xref Road Layout Al Qairawan"] [--profiles-block "Xref Al Qairawan Profiles"]
      [--surface-name "Al_Qairawan_Mass Grading"] [--only R.6.E.1,R.6.F.1] [--dry]
      [--section R.9.G.6=A1,R.9.G.7=A1]   (AICC decisions for roads the drawing does not type)
      [--merge R.0.C.2=R.0.C.1+R.0.C.2]   (join roads that continue each other into one road, named
                                  after one of them; only these are written, the others are deleted
                                  and their intersection links moved to the joined road)
      [--template-from <base model.sqlite>]   (read the template road there: once InfraWorks rebuilt it
                                  in the working model its rows no longer fit)
      [--record-merges R.0.D.2=R.0.D.1+R.0.D.2]   (record the drawn parts of a merge written earlier)
      [--restyle divided | R.0.C.2,R.0.D.2]   (replace only the section of those roads, "divided" = every
                                  B1 / C1 / C2 road; InfraWorks builds it when the road is next edited)
      [--split R.0.C.2=R.0.C.1+R.0.C.2]   (undo a merge: write the roads again as the drawing has
                                  them and move each junction link to the part it lies on)
      [--roundabouts-as-roads]   (write RA rings as closed roads; by default they are left to
                                  InfraWorks as intersections of the roads through their centres)
      [--tie-ends R.4.G.2@R.0.D.11,...]   (with --only: give the end of each road lying on the named road
                                  that road's level there, when the profiles disagree by up to 0.10 m)
      [--alignments <Civil 3D LandXML of the alignments and profiles>]   (instead of --profiles: exact plan
                                  geometry, names and PVIs from the designer's alignments; the layout still
                                  gives the kerbs and right-of-way for the sections. Namar 60 %)
      [--alignments-match <regex>] [--profile-name <regex>]   (which alignments are roads; which ProfAlign
                                  is the design profile when an alignment carries several)
      [--to-centre RD-13@RD-M-01,...]   (with --only: carry a road ending on a roundabout ring (a centreline
                                  circle) straight on to the ring's centre, ending on the named through road
                                  at its level there; --merge joins two roads across such a ring)

Reads the profiles (FG line, PVI and curve labels), chains each road's centreline (its length must
equal its profile length), checks every road's direction against the grading surface and the levels at
junctions, types each road (A1-C2) from its right-of-way width and reads the crossfall side from the
surface. Then writes every road into the model, replacing a road of the same name; the template road
(converted in InfraWorks) gives the rows to clone. --dry writes only the JSON results.

The model is changed in place: keep one working copy on a short path (C:\\IW), closed in InfraWorks.
`;

/** Start vertex and NAME of each record of a roads package shapefile. */
function packageNames(base: string): NamedStart[] {
  const shp = readFileSync(base + ".shp"), dbf = readFileSync(base + ".dbf");
  const nrec = dbf.readUInt32LE(4), hl = dbf.readUInt16LE(8), rl = dbf.readUInt16LE(10);
  const fields: { name: string; len: number }[] = [];
  for (let o = 32; dbf[o] !== 0x0d; o += 32) fields.push({ name: dbf.toString("latin1", o, o + 11).replace(/\0.*/, ""), len: dbf[o + 16]! });
  const names: string[] = [];
  for (let i = 0; i < nrec; i++) {
    let o = hl + i * rl + 1; const r: Record<string, string> = {};
    for (const f of fields) { r[f.name] = dbf.toString("utf8", o, o + f.len).trim(); o += f.len; }
    names.push(r.NAME || r.ROAD_NAME || "");
  }
  const out: NamedStart[] = [];
  for (let o = 100, k = 0; o < shp.length; k++) {
    const len = shp.readInt32BE(o + 4) * 2, c = o + 8, p0 = c + 44 + 4 * shp.readInt32LE(c + 36);
    out.push({ name: names[k] ?? "", start: [shp.readDoubleLE(p0), shp.readDoubleLE(p0 + 8)] });
    o = c + len;
  }
  return out.filter((p) => p.name);
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") { process.stdout.write(USAGE); return args.length ? 0 : 2; }
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const model = args[0]!, template = flag("--template"), layoutPath = flag("--layout"), profilesPath = flag("--profiles"), surfacePath = flag("--surface");
  const dry = args.includes("--dry"), only = flag("--only")?.split(",").filter(Boolean);
  const alignmentsPath = flag("--alignments");
  if (!layoutPath || (!profilesPath && !alignmentsPath) || !surfacePath || (!dry && !template)) { process.stderr.write("model-roads: --layout, --profiles (or --alignments), --surface and --template are required (see --help)\n"); return 2; }
  try {
    const say = (s: string) => process.stdout.write(s + "\n");
    const layout = readDxfBlock(readFileSync(layoutPath, "latin1"), flag("--layout-block") ?? "Xref Road Layout Al Qairawan");
    const surface = loadLandXmlSurface(readFileSync(surfacePath, "utf8"), flag("--surface-name") ?? "Al_Qairawan_Mass Grading");
    let views: ProfileView[] = [], al: { roads: Alignment[]; report: string[] }, pv: { roads: Record<string, Pvi[]>; issues: string[] }, or: { report: string[] } = { report: [] };
    let lxRings: { name: string; c: [number, number]; r: number }[] = [];
    if (alignmentsPath) {
      // the designer's own alignments: exact geometry, names and direction, so nothing is chained or turned
      const rx = (n: string) => { const v = flag(n); return v ? new RegExp(v, "i") : undefined; };
      const lx = readLandXmlRoads(readFileSync(alignmentsPath, "utf8"), { match: rx("--alignments-match"), profile: rx("--profile-name") });
      al = { roads: lx.roads, report: [...lx.report, ...lx.skipped.map((s) => `${s.name}: NOT READ, ${s.why}`)] };
      pv = { roads: lx.pvis, issues: [] };
      lxRings = lx.rings;
      say(`alignments (LandXML): ${lx.roads.length} roads with their profile; not read ${lx.skipped.length}`);
      for (const s of lx.skipped) say(`  ${s.name}: ${s.why}`);
    } else {
      const profEnts = readDxfBlock(readFileSync(profilesPath!, "latin1"), flag("--profiles-block") ?? "Xref Al Qairawan Profiles");
      const r = readProfileViews(profEnts);
      views = r.views;
      pv = assemblePvis(profEnts, views);
      say(`profiles: ${views.length} views, ${Object.keys(pv.roads).length} roads${r.errors.length ? `; not read: ${r.errors.join(", ")}` : ""}; PVI issues ${pv.issues.length}`);
      const pkg = flag("--package");
      al = buildAlignments(layout, views, pkg ? packageNames(pkg) : []);
      say(`alignments: ${al.roads.length} of ${Object.keys(pv.roads).length} roads chained to their profile length`);
      const o = orientRoads(al.roads, pv.roads, surface);
      or = o;
      say(`direction: ${o.reversed.length} reversed (${o.reversed.join(" ")}); loops re-started: ${o.restarted.map((r) => r.name).join(" ") || "none"}`);
    }
    const sections = classifySections(layout, al.roads);
    const decisions = flag("--section");
    if (decisions) {
      const d = applySectionDecisions(sections, parseSectionDecisions(decisions));
      say(`section decisions: ${d.applied.join(" ") || "none applied"}${d.refused.length ? `; refused: ${d.refused.join("; ")}` : ""}`);
      if (d.refused.length) throw new Error("a --section decision was refused (see above)");
    }
    const xfall = crossfallSides(al.roads, sections, surface);
    const ra = measureRoundabouts(layout, al.roads);
    const raOf = new Map(ra.roundabouts.map((r) => [r.name, r]));
    const untyped = Object.entries(sections).filter(([n, s]) => !s.type && !raOf.has(n)).map(([n]) => n);
    say(`sections: ${Object.values(sections).filter((s) => s.type).length} typed, ${ra.roundabouts.length} roundabouts, ${untyped.length} on the template section${untyped.length ? ` (${untyped.join(" ")})` : ""}`);
    for (const r of ra.roundabouts) say(`  ${r.name}: island r ${r.island}, outer edge r ${r.outer} (${r.outerDeg.toFixed(0)} deg drawn), width ${r.width} m, island ${r.side} of the chainage`);
    for (const p of ra.problems) say(`  roundabout: ${p}`);
    const sectionOf = (name: string): Section | null => {
      const t = sections[name]?.type;
      if (t) return buildSection(t, { fall: xfall[name]?.fall ?? undefined });
      const r = raOf.get(name);
      return r ? buildRoundaboutSection(r.width, r.side) : null;
    };
    const outDir = flag("--out-dir");
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      const w = (f: string, v: unknown) => writeFileSync(join(outDir, f), typeof v === "string" ? v : JSON.stringify(v, null, 1));
      w("road-profiles.json", views); w("road-pvis.json", pv.roads); w("road-alignments.json", al.roads); w("road-sections.json", sections); w("road-xfall.json", xfall);
      w("road-roundabouts.json", ra);
      w("road-report.txt", [...al.report, "", ...pv.issues.map((i) => `PVI ${i}`), "", ...or.report].join("\n") + "\n");
      say(`results: ${outDir}`);
    }
    // roundabout rings drawn as centreline circles (Namar RA-01): --merge may cross one, --to-centre ends at its centre
    const rings: Ring[] = layout.filter((e) => e.type === "CIRCLE" && e.r && (e.layer === "_CL" || e.layer === "RD_CL" || e.layer.endsWith("RD_PR_CNRL"))).map((e) => ({ c: [e.x[0]!, e.y[0]!], r: e.r! }));
    // ... or exported as a closed alignment of arcs (LandXML)
    for (const g of lxRings) if (!rings.some((q) => Math.hypot(q.c[0] - g.c[0], q.c[1] - g.c[1]) < 0.5)) { rings.push({ c: g.c, r: g.r }); say(`ring ${g.name}: centre E ${g.c[0].toFixed(2)} N ${g.c[1].toFixed(2)}, r ${g.r.toFixed(2)} (from the alignments)`); }
    const merges = parseMerges(flag("--merge") ?? "").map((m) => {
      const parts = m.parts.map((n) => {
        const a = al.roads.find((r) => r.name === n), v = pv.roads[n];
        if (!a || !v) throw new Error(`--merge: no alignment or profile for ${n}`);
        return { al: a, pv: v };
      });
      const t = new Set(m.parts.map((n) => `${sections[n]?.type}/${xfall[n]?.side}/${xfall[n]?.fall}`));
      if (t.size > 1) throw new Error(`--merge ${m.name}: the roads have different sections or crossfall (${[...t].join(", ")})`);
      const r = mergeRoads(m.name, parts, rings);
      say(`merge ${m.name} = ${m.parts.join(" + ")}: ${r.al.length.toFixed(3)} m, ${r.pv.length} PVIs, section ${sections[m.parts[0]!]?.type}`);
      return { ...m, road: r };
    });
    const splits = parseMerges(flag("--split") ?? "");
    for (const s of splits) for (const n of s.parts) if (!al.roads.find((r) => r.name === n) || !pv.roads[n]) throw new Error(`--split: no alignment or profile for ${n}`);
    if (splits.length) say(`split: ${splits.map((s) => `${s.name} -> ${s.parts.join(" + ")}`).join(", ")}`);
    if (dry) return 0;
    if (existsSync(model.replace(/\.sqlite$/i, ".lock"))) throw new Error("the model is open in InfraWorks (its .lock is there): close it first");
    if (!existsSync(model)) throw new Error(`model not found: ${model}`);
    const db = new DatabaseSync(model, { enableDoubleQuotedStringLiterals: true } as ConstructorParameters<typeof DatabaseSync>[1]);
    const tplFrom = flag("--template-from");
    const writer = new RoadWriter(db, template!, tplFrom ? new DatabaseSync(tplFrom, { readOnly: true }) : db);
    // --record-merges: a merge written earlier gets its parts recorded (no geometry is written)
    for (const m of parseMerges(flag("--record-merges") ?? "")) {
      const d = partsDescription(m.parts.map((n) => { const a = al.roads.find((r) => r.name === n); if (!a) throw new Error(`--record-merges: no alignment for ${n}`); return { name: n, length: a.length }; }));
      const n = setDescription(db, m.name, d);
      if (n !== 1) throw new Error(`--record-merges: ${n} roads named ${m.name}`);
      say(`${m.name}: ${d}`);
    }
    const missing = () => missingDrawnRoads(db.prepare("select NAME, DESCRIPTION from ROADS").all() as { NAME: string; DESCRIPTION: string | null }[], al.roads.map((r) => r.name).filter((n) => !raOf.has(n)));
    const restyle = flag("--restyle");
    if (restyle) {
      const names = restyle === "divided"
        ? (db.prepare("select NAME from ROADS").all() as { NAME: string }[]).map((r) => r.NAME).filter((n) => ["B1", "C1", "C2"].includes(String(sections[n]?.type)))
        : restyle.split(",").filter(Boolean);
      db.exec("begin");
      try {
        for (const n of names) {
          const sec = sectionOf(n);
          if (!sec) throw new Error(`--restyle: no section for ${n}`);
          if (!restyleRoad(db, n, sec)) throw new Error(`--restyle: no road ${n} in the model`);
        }
        db.exec("commit");
      } catch (e) { db.exec("rollback"); throw e; }
      say(`restyled ${names.length} road(s): ${names.join(" ")}`);
      db.close();
      return 0;
    }
    if (splits.length) {
      db.exec("begin");
      try {
        for (const s of splits) {
          const from = (db.prepare("select FK_PARENT_GUID g from ROADS where NAME=?").get(s.name) as { g: string } | undefined)?.g;
          if (!from) throw new Error(`--split: no road ${s.name} in the model`);
          for (const n of s.parts) writer.write(planRoad(al.roads.find((r) => r.name === n)!, pv.roads[n]!), sectionOf(n));
          const parts = s.parts.map((n) => {
            const r = db.prepare("select FK_PARENT_GUID g, GEOMETRY geom from ROADS where NAME=?").get(n) as { g: string; geom: Uint8Array };
            return { guid: r.g, line: parseFgf(Buffer.from(r.geom)).points as number[][] };
          });
          const moved = splitLinks(db, from, parts);
          say(`split ${s.name}: ${s.parts.map((n, k) => `${n} ${moved.get(parts[k]!.guid)} links moved`).join(", ")}`);
        }
        db.exec("commit");
      } catch (e) { db.exec("rollback"); throw e; }
      db.close();
      return 0;
    }
    if (merges.length) {
      db.exec("begin");
      try {
        for (const m of merges) {
          writer.write(planRoad(m.road.al, m.road.pv), sectionOf(m.parts[0]!));
          setDescription(db, m.name, partsDescription(m.parts.map((n) => ({ name: n, length: al.roads.find((r) => r.name === n)!.length }))));
          const to = String((db.prepare("select FK_PARENT_GUID g from ROADS where NAME=?").get(m.name) as { g: string }).g);
          for (const n of m.parts.filter((n) => n !== m.name)) {
            const from = db.prepare("select FK_PARENT_GUID g from ROADS where NAME=?").get(n) as { g: string } | undefined;
            const moved = from ? repointLinks(db, from.g, to) : 0;
            const rows = removeRoad(db, n);
            say(`  ${n}: ${moved} intersection links moved to ${m.name}, ${rows} rows deleted`);
          }
        }
        db.exec("commit");
      } catch (e) { db.exec("rollback"); throw e; }
      say(`written ${merges.length} merged road(s)`);
      const lost = missing();
      say(lost.length ? `drawn roads missing from the model: ${lost.join(" ")}` : "every drawn road is in the model (as a road or a recorded part)");
      db.close();
      return 0;
    }
    const failed: string[] = [];
    let written = 0;
    const choice = roadsToWrite(al.roads, new Set(raOf.keys()), { only, roundaboutsAsRoads: args.includes("--roundabouts-as-roads") });
    if (choice.skipped.length) say(`not written: ${choice.skipped.map((s) => s.name).join(" ")} (roundabouts are InfraWorks intersections; --roundabouts-as-roads writes them as roads)`);
    // --tie-ends: levels read from the model as it is, before any road is rewritten
    const ties = flag("--tie-ends") ? tieLevels(roadRows(db), parseTieEnds(flag("--tie-ends")!)) : new Map();
    for (const [n, t] of ties) {
      if (!choice.write.some((a) => a.name === n)) throw new Error(`--tie-ends: ${n} is not among the roads written (add it to --only)`);
      say(`tie ${n}: ${t.startZ != null ? "start" : "end"} on ${t.on}, step ${t.step.toFixed(3)} m -> 0`);
    }
    // --to-centre: the through road's level at the ring centre, read from the model as it is
    const toCentre = new Map(parseTieEnds(flag("--to-centre") ?? "").map((t) => [t.road, t.on]));
    const centreLevel = (on: string, c: [number, number]) => {
      const line = roadRows(db).find((r) => r.name === on)?.line;
      if (!line) throw new Error(`--to-centre: no component road ${on} in the model`);
      let best = { d: Infinity, z: NaN };
      for (let i = 1; i < line.length; i++) {
        const [ax, ay, az] = line[i - 1]!, [bx, by, bz] = line[i]!, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((c[0] - ax) * dx + (c[1] - ay) * dy) / l2)) : 0, d = Math.hypot(c[0] - ax - t * dx, c[1] - ay - t * dy);
        if (d < best.d) best = { d, z: az + t * (bz - az) };
      }
      if (best.d > 0.5) throw new Error(`--to-centre: ${on} does not pass through the ring centre (${best.d.toFixed(2)} m off)`);
      return best.z;
    };
    for (const [n, on] of toCentre) if (!choice.write.some((a) => a.name === n)) throw new Error(`--to-centre: ${n} is not among the roads written (add it to --only); through road ${on}`);
    for (const a0 of choice.write) {
      try {
        let a = a0, pvis = pv.roads[a0.name] ?? [];
        const on = toCentre.get(a0.name);
        if (on) {
          const end = a0.segs.at(-1)!.b, start = a0.segs[0]!.a, ring = rings.find((g) => [end, start].some((p) => Math.abs(Math.hypot(p[0] - g.c[0], p[1] - g.c[1]) - g.r) < 1.5));
          if (!ring) throw new Error(`--to-centre: ${a0.name} has no end on a roundabout ring`);
          const x = extendToCentre({ al: a0, pv: pvis }, rings, centreLevel(on, ring.c));
          a = x.al; pvis = x.pv;
          say(`  ${a0.name}: ${x.at} carried ${x.dist.toFixed(3)} m to the centre of the ring on ${on}, level ${x.pv[x.at === "end" ? x.pv.length - 1 : 0]!.z!.toFixed(3)}`);
        }
        const plan = planRoad(a, pvis, ties.get(a.name) ?? {});
        for (const note of plan.notes) say(`  ${a.name}: ${note}`);
        writer.write(plan, sectionOf(a.name));
        written++;
      } catch (e) { failed.push(`${a0.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    say(`written ${written} roads${failed.length ? `; failed ${failed.length}:\n  ${failed.join("\n  ")}` : ""}`);
    if (writer.replacedPlanning.length) say(`planning roads replaced by component roads: ${writer.replacedPlanning.length} (do not Refresh their data source: it would bring them back)`);
    // Junction rows with no junction crash InfraWorks on the next road edit (AIM_ModelRoad.dll+0xa7f28,
    // Al Narjis 10 Nov 2026: 12 arms + 8 regions from the ROAD-01 conversion, no INTERSECTIONS row).
    const pr = pruneDanglingIntersections(db);
    if (pr.orphans || pr.removed.length || pr.bodies) say(`junction rows cleaned: ${pr.orphans} arm/region rows without a junction, ${pr.removed.length} junction(s) on a deleted road, ${pr.bodies} body row(s)`);
    const rows = roadRows(db);
    const lv = levelProblems(db, rows), js = junctionSteps(rows).filter((j) => Math.abs(j.step) >= 0.3);
    say(`checks: ${rows.length} roads, ${lv.length} with level problems, ${js.length} junction steps >= 0.3 m`);
    for (const l of lv) say(`  ${l}`);
    for (const j of js) say(`  ${j.road} ${j.at} ${j.z.toFixed(3)} on ${j.on} ${j.zOn.toFixed(3)}: step ${j.step.toFixed(2)} m`);
    db.close();
    return failed.length || lv.length ? 1 : 0;
  } catch (err) {
    process.stderr.write(`model-roads: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv);
