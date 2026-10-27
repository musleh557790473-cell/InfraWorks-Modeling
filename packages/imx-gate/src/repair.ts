import { copyFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, basename, extname, join, resolve } from "node:path";

import Database from "better-sqlite3";

import { lintJson, repairJson } from "./jsonlint.js";

export interface RepairResult {
  outPath: string;
  sectionsRepaired: number;
  regionsRepaired: number;
  substitutions: number;
  /** Rows that could not be made valid; the gate keeps them as blocking findings. */
  failed: { table: string; id: number; error: string }[];
  integrityOk: boolean;
}

/**
 * True when both paths name the same file, however they are written
 * ("./a.imx" vs "a.imx", different case on Windows, symlinks).
 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const abs = existsSync(p) ? realpathSync.native(p) : resolve(p);
    return process.platform === "win32" ? abs.toLowerCase() : abs;
  };
  return norm(a) === norm(b);
}

export function defaultRepairPath(src: string): string {
  const ext = extname(src) || ".imx";
  return join(dirname(src), `${basename(src, ext)}_FIXED${ext}`);
}

/**
 * Write a repaired copy of the export.
 *
 * Only the JSON *parameter metadata* of corridor sections and regions is rewritten;
 * every geometry blob is copied byte for byte. The source file is never modified.
 */
export function repairImx(src: string, out?: string): RepairResult {
  const outPath = out ?? defaultRepairPath(src);
  if (samePath(outPath, src)) {
    throw new Error("Refusing to repair in place — choose a different output path");
  }
  copyFileSync(src, outPath);

  const db = new Database(outPath);
  const result: RepairResult = {
    outPath,
    sectionsRepaired: 0,
    regionsRepaired: 0,
    substitutions: 0,
    failed: [],
    integrityOk: false,
  };

  const jobs: { table: string; column: string; counter: "sectionsRepaired" | "regionsRepaired" }[] = [
    { table: "CONSTRAINED_DEF_CORRIDOR_SECTIONS", column: "JSON_CROSS_SECTION", counter: "sectionsRepaired" },
    { table: "CONSTRAINED_DEF_CORRIDOR_REGIONS", column: "JSON_ASSEMBLY_DATA", counter: "regionsRepaired" },
  ];

  const tables = new Set(
    db.prepare("select name from sqlite_master where type='table'").all().map((r) => (r as { name: string }).name),
  );

  const run = db.transaction(() => {
    for (const job of jobs) {
      if (!tables.has(job.table)) continue;
      const rows = db.prepare(`select ID, "${job.column}" as txt from "${job.table}"`).all() as {
        ID: number;
        txt: string | null;
      }[];
      const update = db.prepare(`update "${job.table}" set "${job.column}" = ? where ID = ?`);
      for (const row of rows) {
        if (!row.txt) continue;
        if (lintJson(row.txt).valid) continue;
        const fixed = repairJson(row.txt);
        if (!fixed.repaired) {
          result.failed.push({ table: job.table, id: row.ID, error: fixed.error ?? "unrepairable" });
          continue;
        }
        update.run(fixed.text, row.ID);
        result[job.counter]++;
        result.substitutions += fixed.substitutions;
      }
    }
  });
  run();

  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  result.integrityOk = integrity === "ok";
  db.close();

  return result;
}
