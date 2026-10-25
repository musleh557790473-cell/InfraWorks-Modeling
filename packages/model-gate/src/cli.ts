#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";

import { runModelGate } from "./gate.js";
import { toConsole, toMarkdown } from "./report.js";

const USAGE = `
model-gate — check an InfraWorks model after import (Gate G3)

  model-gate <model.sqlite> [--package <package.zip|folder>] [--imx <export.imx>] [options]

Options
  --package <path>     the import package the model was built from
  --imx <path>         the Civil 3D IMX export its design roads came from
  --max-offset <m>     allowed position shift (default 1)
  --max-loss <ratio>   allowed missing road length, e.g. 0.01 = 1 % (default)
  --md <path>          also write a Markdown report
  --json <path>        also write the raw JSON report
  --quiet              suppress the console report

Close the model in InfraWorks first, or run on a copy: the database is opened read-only.

Exit codes: 0 no blocking findings · 1 blocking findings · 2 bad usage
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(USAGE);
    return args.length ? 0 : 2;
  }
  const model = args[0]!;
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const num = (n: string) => {
    const v = flag(n);
    if (v === undefined) return undefined;
    const x = Number(v);
    if (!(x >= 0)) throw new Error(`${n} expects a non-negative number, got "${v}"`);
    return x;
  };

  let opts;
  try {
    opts = { packagePath: flag("--package"), imxPath: flag("--imx"), maxOffsetM: num("--max-offset"), maxLengthLoss: num("--max-loss") };
    for (const p of [model, opts.packagePath, opts.imxPath]) if (p && !existsSync(p)) throw new Error(`file not found: ${p}`);
  } catch (err) {
    process.stderr.write(`model-gate: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const report = runModelGate(model, opts);
  if (!args.includes("--quiet")) process.stdout.write(toConsole(report));
  const md = flag("--md");
  if (md) writeFileSync(md, toMarkdown(report), "utf8");
  const json = flag("--json");
  if (json) writeFileSync(json, JSON.stringify(report, null, 2), "utf8");
  return report.ok ? 0 : 1;
}

process.exitCode = main(process.argv);
