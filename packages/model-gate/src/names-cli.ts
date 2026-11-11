#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { fillNames } from "./names.js";

const USAGE = `
model-names - put the package's names into an InfraWorks model (a copy)

  model-names <model.sqlite> --package <package.zip|folder> [--out <copy.sqlite>]

InfraWorks keeps a Shapefile field only when Name is mapped in Configure. This writes a copy of the
model with NAME filled from each layer's NAME field and Name = NAME recorded in its Configure
settings, so a Refresh keeps them. The model itself is never changed.

Close the model in InfraWorks first (it refuses while <model>.lock is there). Default output:
"<model> (names).sqlite" next to it, with a copy of its <model>.files folder.
Then open the copy in InfraWorks and check it with: pnpm gate:model "<copy>" --package <package>
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(USAGE);
    return args.length ? 0 : 2;
  }
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const model = args[0]!;
  const pkg = flag("--package");
  if (!pkg) {
    process.stderr.write("model-names: --package is required\n");
    return 2;
  }
  const out = flag("--out") ?? join(dirname(model), `${basename(model, extname(model))} (names)${extname(model) || ".sqlite"}`);
  try {
    if (!existsSync(model)) throw new Error(`model not found: ${model}`);
    const r = fillNames(model, pkg, out);
    process.stdout.write(`\nCopy written: ${r.output}${r.filesFolder ? `\n         and: ${r.filesFolder}` : ""}\n\n`);
    for (const l of r.layers) {
      if (l.skipped) {
        process.stdout.write(`  ${l.file} ("${l.dataSource}"): left alone, ${l.skipped}\n`);
        continue;
      }
      process.stdout.write(`  ${l.file} ("${l.dataSource}", ${l.table}, ${l.rows} rows${l.missing ? `; ${l.missing} record(s) with no row left: converted or deleted in InfraWorks` : ""})\n`);
      for (const c of l.columns) {
        process.stdout.write(
          c.skipped
            ? `      ${c.column}: not filled, ${c.skipped}\n`
            : `      ${c.column} = ${c.field}: ${c.filled} filled${c.kept ? `, ${c.kept} kept their own value` : ""}\n`,
        );
      }
    }
    process.stdout.write("\nEach filled column is recorded as a mapping in Configure.\n");
    process.stdout.write("\nOpen the copy in InfraWorks. A Refresh of these data sources keeps the names.\n");
    return r.layers.some((l) => l.skipped || l.columns.some((c) => c.skipped)) ? 1 : 0;
  } catch (err) {
    process.stderr.write(`model-names: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv);