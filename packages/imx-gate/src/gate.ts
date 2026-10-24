import { statSync } from "node:fs";

import {
  checkContent,
  checkCrs,
  checkGeometry,
  checkRebuildState,
  checkRegionContinuity,
  checkRegionJson,
  checkSections,
  checkStationSpacing,
  checkStructure,
  scanSections,
} from "./checks.js";
import { declaredCrs, imxVersion, openImx, readStats } from "./read.js";
import { repairImx } from "./repair.js";
import { DEFAULT_MAX_STATION_GAP_M } from "./types.js";
import type { GateOptions, ImxFinding, ImxGateReport } from "./types.js";

const ORDER: Record<ImxFinding["severity"], number> = { blocking: 0, warning: 1, info: 2 };

/**
 * Gate G2 — run every rule against a Civil 3D IMX export.
 *
 * With `repair: true` a corrected copy is written and the gate is re-run against it, so
 * the returned report describes the file the user will actually import.
 */
export function runGate(file: string, opts: GateOptions = {}): ImxGateReport {
  const maxGap = opts.maxStationGapM ?? DEFAULT_MAX_STATION_GAP_M;
  const first = inspect(file, opts, maxGap);

  const repairable = first.findings.some((x) => x.repairable);
  if (!opts.repair || !repairable) return first;

  const repair = repairImx(file, opts.out);
  const after = inspect(repair.outPath, opts, maxGap);

  for (const finding of first.findings) {
    if (!finding.repairable) continue;
    const stillThere = after.findings.some((x) => x.ruleId === finding.ruleId);
    finding.repaired = !stillThere;
  }

  after.findings = [
    ...first.findings.filter((x) => x.repaired),
    ...after.findings,
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));

  after.repairedFile = repair.outPath;
  after.repairedCount = repair.sectionsRepaired + repair.regionsRepaired;
  after.file = file;

  if (!repair.integrityOk) {
    after.findings.unshift({
      ruleId: "IMX-000",
      rule: "Repaired file integrity",
      code: "IMX_000",
      severity: "blocking",
      message: `SQLite integrity_check failed on ${repair.outPath} — do not import it.`,
      repairable: false,
    });
  }
  for (const fail of repair.failed) {
    after.findings.push({
      ruleId: "IMX-002",
      rule: "Corridor section JSON is readable",
      code: "IMX_002",
      severity: "blocking",
      message: `${fail.table} ID ${fail.id} could not be repaired automatically: ${fail.error}`,
      repairable: false,
    });
  }

  recount(after);
  return after;
}

function inspect(file: string, opts: GateOptions, maxGap: number): ImxGateReport {
  const h = openImx(file, true);
  try {
    const { stats, geometry } = readStats(h, maxGap);
    const sections = scanSections(h);

    const findings = [
      ...checkStructure(h),
      ...checkCrs(h, stats, opts),
      ...checkSections(sections),
      ...checkRegionJson(h),
      ...checkRebuildState(stats),
      ...checkRegionContinuity(stats),
      ...checkStationSpacing(stats, maxGap),
      ...checkGeometry(geometry),
      ...checkContent(stats),
    ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));

    const report: ImxGateReport = {
      ok: false,
      file,
      fileBytes: statSync(file).size,
      imxVersion: imxVersion(h),
      declaredCrs: declaredCrs(h).name,
      blockingCount: 0,
      warningCount: 0,
      infoCount: 0,
      repairedCount: 0,
      findings,
      stats,
      generatedAt: new Date().toISOString(),
    };
    recount(report);
    return report;
  } finally {
    h.db.close();
  }
}

function recount(r: ImxGateReport): void {
  const live = r.findings.filter((x) => !x.repaired);
  r.blockingCount = live.filter((x) => x.severity === "blocking").length;
  r.warningCount = live.filter((x) => x.severity === "warning").length;
  r.infoCount = live.filter((x) => x.severity === "info").length;
  r.ok = r.blockingCount === 0;
}
