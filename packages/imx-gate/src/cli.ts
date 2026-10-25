#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";

import { runGate } from "./gate.js";
import { toConsole, toMarkdown } from "./report.js";
import { DEFAULT_MAX_STATION_GAP_M } from "./types.js";

const USAGE = `
imx-gate — validate and repair a Civil 3D IMX export before importing it into InfraWorks

  imx-gate <file.imx> [options]

Options
  --repair             write a corrected copy and re-check it
  --out <path>         path for the corrected copy (default <name>_FIXED.imx)
  --crs <epsg>         expected projected CRS, e.g. 32636 or 32638
  --max-gap <metres>   section spacing above which IMX-006 is raised (default ${DEFAULT_MAX_STATION_GAP_M})
  --md <path>          also write a Markdown report
  --json <path>        also write the raw JSON report
  --quiet              suppress the console report

Exit codes
  0  no blocking findings
  1  blocking findings remain
  2  bad usage
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(USAGE);
    return args.length ? 0 : 2;
  }

  const file = args[0]!;
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const epsgRaw = flag("--crs");
  const gapRaw = flag("--max-gap");

  // A typo here must not silently switch a check off.
  const epsg = epsgRaw === undefined ? undefined : Number(epsgRaw.replace(/^EPSG:/i, ""));
  if (epsg !== undefined && !(Number.isInteger(epsg) && epsg > 0)) {
    process.stderr.write(`imx-gate: --crs expects an EPSG code such as 32638, got "${epsgRaw}"\n`);
    return 2;
  }
  const maxStationGapM = gapRaw === undefined ? undefined : Number(gapRaw);
  if (maxStationGapM !== undefined && !(maxStationGapM > 0)) {
    process.stderr.write(`imx-gate: --max-gap expects a positive number of metres, got "${gapRaw}"\n`);
    return 2;
  }
  if (!existsSync(file)) {
    process.stderr.write(`imx-gate: file not found: ${file}\n`);
    return 2;
  }

  const report = runGate(file, {
    repair: args.includes("--repair"),
    out: flag("--out"),
    epsg,
    maxStationGapM,
  });

  if (!args.includes("--quiet")) process.stdout.write(toConsole(report));

  const md = flag("--md");
  if (md) writeFileSync(md, toMarkdown(report), "utf8");
  const json = flag("--json");
  if (json) writeFileSync(json, JSON.stringify(report, null, 2), "utf8");

  return report.ok ? 0 : 1;
}

process.exitCode = main(process.argv);
