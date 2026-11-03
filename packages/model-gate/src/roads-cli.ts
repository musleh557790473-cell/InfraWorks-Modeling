#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  assemblePvis, buildAlignments, buildSection, classifySections, crossfallSides, loadLandXmlSurface, orientRoads, readDxfBlock, readProfileViews,
  type NamedStart,
} from "@infraworks/domain";

import { junctionSteps, levelProblems, roadRows } from "./roads/checks.js";
import { planRoad } from "./roads/plan.js";
import { RoadWriter } from "./roads/write.js";

const USAGE = `
model-roads - Parsons roads as InfraWorks component roads, written into a model (closed in InfraWorks)

  model-roads <model.sqlite> --template <constrained-definition GUID>
      --layout <ROD-DWG-10200 .dxf> --profiles <ROD-DWG-40000 .dxf> --surface <grading LandXML>
      [--package <roads package road_centerline (no extension)>] [--out-dir <folder for the JSON results>]
      [--layout-block "Xref Road Layout Al Qairawan"] [--profiles-block "Xref Al Qairawan Profiles"]
      [--surface-name "Al_Qairawan_Mass Grading"] [--only R.6.E.1,R.6.F.1] [--dry]

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
  if (!layoutPath || !profilesPath || !surfacePath || (!dry && !template)) { process.stderr.write("model-roads: --layout, --profiles, --surface and --template are required (see --help)\n"); return 2; }
  try {
    const say = (s: string) => process.stdout.write(s + "\n");
    const profEnts = readDxfBlock(readFileSync(profilesPath, "latin1"), flag("--profiles-block") ?? "Xref Al Qairawan Profiles");
    const { views, errors } = readProfileViews(profEnts);
    const pv = assemblePvis(profEnts, views);
    say(`profiles: ${views.length} views, ${Object.keys(pv.roads).length} roads${errors.length ? `; not read: ${errors.join(", ")}` : ""}; PVI issues ${pv.issues.length}`);
    const layout = readDxfBlock(readFileSync(layoutPath, "latin1"), flag("--layout-block") ?? "Xref Road Layout Al Qairawan");
    const pkg = flag("--package");
    const al = buildAlignments(layout, views, pkg ? packageNames(pkg) : []);
    say(`alignments: ${al.roads.length} of ${Object.keys(pv.roads).length} roads chained to their profile length`);
    const surface = loadLandXmlSurface(readFileSync(surfacePath, "utf8"), flag("--surface-name") ?? "Al_Qairawan_Mass Grading");
    const or = orientRoads(al.roads, pv.roads, surface);
    say(`direction: ${or.reversed.length} reversed (${or.reversed.join(" ")}); loops re-started: ${or.restarted.map((r) => r.name).join(" ") || "none"}`);
    const sections = classifySections(layout, al.roads);
    const xfall = crossfallSides(al.roads, sections, surface);
    say(`sections: ${Object.values(sections).filter((s) => s.type).length} typed, ${Object.values(sections).filter((s) => !s.type).length} on the template section`);
    const outDir = flag("--out-dir");
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      const w = (f: string, v: unknown) => writeFileSync(join(outDir, f), typeof v === "string" ? v : JSON.stringify(v, null, 1));
      w("road-profiles.json", views); w("road-pvis.json", pv.roads); w("road-alignments.json", al.roads); w("road-sections.json", sections); w("road-xfall.json", xfall);
      w("road-report.txt", [...al.report, "", ...pv.issues.map((i) => `PVI ${i}`), "", ...or.report].join("\n") + "\n");
      say(`results: ${outDir}`);
    }
    if (dry) return 0;
    if (existsSync(model.replace(/\.sqlite$/i, ".lock"))) throw new Error("the model is open in InfraWorks (its .lock is there): close it first");
    if (!existsSync(model)) throw new Error(`model not found: ${model}`);
    const db = new DatabaseSync(model, { enableDoubleQuotedStringLiterals: true } as ConstructorParameters<typeof DatabaseSync>[1]);
    const writer = new RoadWriter(db, template!);
    const failed: string[] = [];
    let written = 0;
    for (const a of al.roads) {
      if (only && !only.includes(a.name)) continue;
      try {
        const plan = planRoad(a, pv.roads[a.name] ?? []);
        const type = sections[a.name]?.type ?? null, fall = xfall[a.name]?.fall ?? undefined;
        writer.write(plan, type ? buildSection(type, { fall }) : null);
        written++;
      } catch (e) { failed.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    say(`written ${written} roads${failed.length ? `; failed ${failed.length}:\n  ${failed.join("\n  ")}` : ""}`);
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
