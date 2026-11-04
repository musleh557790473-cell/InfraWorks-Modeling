#!/usr/bin/env node
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { danglingLinks, pruneDanglingIntersections } from "./roads/intersections.js";

const USAGE = `
model-intersections - InfraWorks intersections in a closed model, written in place

  model-intersections <model.sqlite> [--dry]

Removes the intersections left pointing at a deleted road, as InfraWorks does when a road is
deleted: one where fewer than two roads still meet goes with its arms and regions; one that still
joins two roads or more is listed and left for a rebuild in InfraWorks. --dry only reports.
Close the model in InfraWorks first (it refuses while <model>.lock is there).
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") { process.stdout.write(USAGE); return args.length ? 0 : 2; }
  const model = args[0]!, dry = args.includes("--dry");
  const say = (s: string) => process.stdout.write(`${s}\n`);
  try {
    if (!existsSync(model)) throw new Error(`model not found: ${model}`);
    if (!dry && existsSync(model.replace(/\.sqlite$/i, ".lock"))) throw new Error("the model is open in InfraWorks (its .lock is there): close it first");
    const db = new DatabaseSync(model, { readOnly: dry, enableDoubleQuotedStringLiterals: true } as ConstructorParameters<typeof DatabaseSync>[1]);
    say(`dangling links before: ${danglingLinks(db)}`);
    const r = pruneDanglingIntersections(db, { dry });
    for (const i of r.removed) say(`${dry ? "would remove" : "removed"} intersection ${i.id} (${i.arms} arms, ${i.regions} regions; left: ${i.roads.join(" ") || "none"})`);
    for (const i of r.kept) say(`kept, rebuild in InfraWorks: intersection ${i.id} (roads ${i.roads.join(" ")})`);
    if (r.orphans) say(`${dry ? "would remove" : "removed"} ${r.orphans} arm/region rows without an intersection`);
    if (!dry) say(`dangling links after: ${danglingLinks(db)}`);
    db.close();
    return r.kept.length ? 1 : 0;
  } catch (err) {
    process.stderr.write(`model-intersections: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv);
