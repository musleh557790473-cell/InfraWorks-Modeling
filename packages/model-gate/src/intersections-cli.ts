#!/usr/bin/env node
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { danglingLinks, pruneDanglingIntersections, writeRoundabout } from "./roads/intersections.js";
import { removeRoad } from "./roads/write.js";

const USAGE = `
model-intersections - InfraWorks intersections in a closed model, written in place

  model-intersections <model.sqlite> [--delete-roads RA-1,RA-3] [--dry]
      [--roundabout 41 --icd 40.4 --island 24.0 --apron 2.0 --lanes 1 --lane-width 8.2]

--roundabout turns that intersection into a roundabout as InfraWorks stores one (sizes from the
designer; nothing is assumed: every size must be given). InfraWorks builds the body.

--delete-roads deletes those roads (definition, constraints, body) first.
Then removes the intersections left pointing at a deleted road, as InfraWorks does when a road is
deleted: one where fewer than two roads still meet goes with its arms and regions; one that still
joins two roads or more is listed and left for a rebuild in InfraWorks. --dry only reports.
All in one transaction. Close the model in InfraWorks first (refused while <model>.lock is there).
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") { process.stdout.write(USAGE); return args.length ? 0 : 2; }
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const model = args[0]!, dry = args.includes("--dry");
  const del = flag("--delete-roads")?.split(",").filter(Boolean) ?? [];
  const say = (s: string) => process.stdout.write(`${s}\n`);
  try {
    if (!existsSync(model)) throw new Error(`model not found: ${model}`);
    if (existsSync(model.replace(/\.sqlite$/i, ".lock"))) throw new Error("the model is open in InfraWorks (its .lock is there): close it first");
    const db = new DatabaseSync(model, { enableDoubleQuotedStringLiterals: true } as ConstructorParameters<typeof DatabaseSync>[1]);
    db.exec("begin");
    let kept = 0;
    try {
      for (const name of del) {
        const n = removeRoad(db, name);
        if (!n) throw new Error(`no road named ${name}`);
        say(`deleted road ${name} (${n} rows)`);
      }
      say(`dangling links before: ${danglingLinks(db)}`);
      const r = pruneDanglingIntersections(db);
      for (const i of r.removed) say(`removed intersection ${i.id} (${i.arms} arms, ${i.regions} regions; left: ${i.roads.join(" ") || "none"})`);
      for (const i of r.kept) say(`kept, rebuild in InfraWorks: intersection ${i.id} (roads ${i.roads.join(" ")})`);
      if (r.orphans) say(`removed ${r.orphans} arm/region rows without an intersection`);
      say(`dangling links after: ${danglingLinks(db)}`);
      kept = r.kept.length;
      const ra = flag("--roundabout");
      if (ra) {
        const num = (f: string) => Number(flag(f));
        const idx = writeRoundabout(db, Number(ra), { inscribedCircleDiameter: num("--icd"), islandDiameter: num("--island"), apronWidth: num("--apron"), lanes: num("--lanes"), laneWidth: num("--lane-width") });
        say(`roundabout on intersection ${ra}: ${idx.size} arms, ICD ${flag("--icd")} m, island ${flag("--island")} m, apron ${flag("--apron")} m, ${flag("--lanes")} x ${flag("--lane-width")} m`);
      }
      db.exec(dry ? "rollback" : "commit");
      if (dry) say("--dry: nothing written");
    } catch (e) {
      db.exec("rollback");
      throw e;
    }
    db.close();
    return kept ? 1 : 0;
  } catch (err) {
    process.stderr.write(`model-intersections: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv);
