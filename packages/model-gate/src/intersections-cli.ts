#!/usr/bin/env node
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { IW_ARM_CLAMP_SEEN, IW_ROUNDABOUT_STANDARDS, armRoom, armsFromRoads, danglingLinks, deleteIntersection, fixBlendLevels, healZeroedArms, shortenArms, pruneDanglingIntersections, writeRoundabout, type RoundaboutStandard } from "./roads/intersections.js";
import { removeRoad } from "./roads/write.js";

const USAGE = `
model-intersections - InfraWorks intersections in a closed model, written in place

  model-intersections <model.sqlite> [--delete-roads RA-1,RA-3] [--dry]
      [--roundabout 41 --icd 40.4 --island 24.0 --apron 2.0 --lanes 1 --lane-width 8.2
        [--standard rural-double|urban-compact] [--keep-lane-width]]

--delete-junctions 135,161: delete those junctions (rows and body) so InfraWorks builds them afresh.
--shorten-arms [--arm-gap 25] [--arm-ids 309]: roundabout arms that would reach the next junction on
their road end that many metres before its centre (InfraWorks: "intersections overlap"); --arm-ids
limits it to those roundabouts (and gives their unset arms the default length). InfraWorks' own clamp
was 14.4 m on RA-5 (7 Nov 2026).
--heal-arms 309: arms InfraWorks zeroed in a failed build (offset 0, no lanes at the yield line) get
their lanes, widths and median back (from an arm of the same road on a built roundabout, else the road).
--arm-room [--arm-clamp 136:3=64.6,...] [--standard ...]: for every roundabout arm, the room before the
body of the next junction on the road, the longest arm InfraWorks allows there where measured (the
clamp; known ones from Al Qairawan, 6-7 Nov 2026, unless --arm-clamp is given) and, with --standard,
whether that standard's arm geometry is known to build or fail at that length (read-only).
--arms-from-roads: roundabout arms built without lanes get the lanes, lane width and median of their road.
Roundabout blend points InfraWorks left at height 0 get the road's level (always).
--roundabout turns that intersection into a roundabout as InfraWorks stores one (sizes from the
designer; nothing is assumed: every size must be given; apron may be 0). InfraWorks builds the body.
--standard picks the InfraWorks standard stored (default rural-double). --keep-lane-width writes the
designer's lane width although InfraWorks is expected to write the standard's back (a trial).

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
      for (const id of (flag("--delete-junctions") ?? "").split(",").filter(Boolean).map(Number)) say(`deleted junction ${id} (${deleteIntersection(db, id)} rows); InfraWorks creates it again when one of its roads is edited`);
      say(`dangling links before: ${danglingLinks(db)}`);
      const r = pruneDanglingIntersections(db);
      for (const i of r.removed) say(`removed intersection ${i.id} (${i.arms} arms, ${i.regions} regions; left: ${i.roads.join(" ") || "none"})`);
      for (const i of r.kept) say(`kept, rebuild in InfraWorks: intersection ${i.id} (roads ${i.roads.join(" ")})`);
      if (r.orphans) say(`removed ${r.orphans} arm/region rows without an intersection`);
      if (r.bodies) say(`removed ${r.bodies} body rows (PRIMITIVES, TERRAIN_OPERATIONS) of intersections that no longer exist`);
      say(`dangling links after: ${danglingLinks(db)}`);
      kept = r.kept.length;
      const ra = flag("--roundabout");
      const standardFlag = flag("--standard") as RoundaboutStandard | undefined;
      if (standardFlag && !(standardFlag in IW_ROUNDABOUT_STANDARDS)) throw new Error(`--standard ${standardFlag}: known standards are ${Object.keys(IW_ROUNDABOUT_STANDARDS).join(", ")}`);
      if (ra) {
        const num = (f: string) => Number(flag(f));
        const idx = writeRoundabout(db, Number(ra), { inscribedCircleDiameter: num("--icd"), islandDiameter: num("--island"), apronWidth: num("--apron"), lanes: num("--lanes"), laneWidth: num("--lane-width"), standard: standardFlag, keepLaneWidth: args.includes("--keep-lane-width") });
        say(`roundabout on intersection ${ra}: ${idx.size} arms, ICD ${flag("--icd")} m, island ${flag("--island")} m, apron ${flag("--apron")} m, ${flag("--lanes")} x ${flag("--lane-width")} m, standard ${IW_ROUNDABOUT_STANDARDS[standardFlag ?? "rural-double"].STANDARD_NAME}`);
      }
      if (args.includes("--arm-room")) {
        const clamp = flag("--arm-clamp") ? Object.fromEntries(flag("--arm-clamp")!.split(",").map((p) => { const [k, v] = p.split("="); return [k!, Number(v)]; })) : IW_ARM_CLAMP_SEEN;
        for (const a of armRoom(db, { clamp, standard: standardFlag })) say(`arm room: roundabout ${a.id} arm ${a.arm} (${a.road}) blend ${a.blend.toFixed(1)} m; next junction ${a.nextId} at ${a.next.toFixed(1)} m, its body from ${a.edge.toFixed(1)} m; InfraWorks' clamp ${a.clamp ?? "unknown"}; room ${a.room.toFixed(1)} m: ${a.status}${a.standard ? `; ${standardFlag}: ${a.standard}` : ""}`);
      }
      if (args.includes("--arms-from-roads")) for (const a of armsFromRoads(db)) say(`arm: intersection ${a.id} arm ${a.arm} (${a.road}) -> ${a.lanes} + ${a.lanes} lanes of ${a.laneWidth} m, median ${a.median} m`);
      if (flag("--heal-arms")) for (const a of healZeroedArms(db, flag("--heal-arms")!.split(",").map(Number))) say(`arm healed: roundabout ${a.id} arm ${a.arm} (${a.road}) -> ${a.yieldLanes} lanes at the yield line, width ${a.width}, median ${a.median} (from ${a.from})`);
      if (args.includes("--shorten-arms")) for (const a of shortenArms(db, Number(flag("--arm-gap") ?? 25), { only: flag("--arm-ids")?.split(",").map(Number) })) say(`arm shortened: roundabout ${a.id} arm ${a.arm} (${a.road}) -> ${a.length.toFixed(1)} m (next junction ${a.next.toFixed(1)} m)`);
      const fixed = fixBlendLevels(db);
      for (const f of fixed) say(`blend point height: intersection ${f.id} arm ${f.arm} -> ${f.z.toFixed(3)} (road ${f.off.toFixed(3)} m away)`);
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
