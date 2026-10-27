import type { ModelGateReport } from "./types.js";

const MARK: Record<string, string> = { blocking: "FAIL", warning: "WARN", info: "INFO" };
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length));

export function toConsole(r: ModelGateReport): string {
  const out: string[] = ["", "MODEL GATE (G3) — InfraWorks model after import", "─".repeat(72)];
  out.push(`Model         ${r.model}`);
  out.push(`Schema        ${r.schemaVersion ?? "(unknown)"}   CRS ${r.modelCrs ?? "(none)"}`);
  if (r.package) out.push(`Package       ${r.package}`);
  if (r.imx) out.push(`IMX           ${r.imx}`);
  out.push("");
  for (const f of r.findings) {
    out.push(`[${MARK[f.severity]}] ${f.ruleId} ${f.rule}`);
    out.push(`        ${f.message}`);
    out.push("");
  }
  if (r.layers.length) {
    out.push(pad("layer", 20) + pad("model table", 14) + pad("features", 14) + pad("length (m)", 22) + "offset");
    for (const l of r.layers) {
      out.push(
        pad(l.layer, 20) +
          pad(l.dataSource?.targetTable ?? "not imported", 14) +
          pad(`${l.modelCount}/${l.packageCount}`, 14) +
          pad(l.packageLength ? `${l.modelLength.toFixed(0)}/${l.packageLength.toFixed(0)}` : "-", 22) +
          (l.centreOffset === null ? "-" : `${l.centreOffset.toFixed(2)} m`),
      );
    }
    out.push("");
  }
  out.push("─".repeat(72));
  out.push(r.ok ? `PASS — ${r.warningCount} warning(s).` : `FAIL — ${r.blockingCount} blocking, ${r.warningCount} warning(s).`);
  out.push("");
  return out.join("\n");
}

export function toMarkdown(r: ModelGateReport): string {
  const out: string[] = [`# Model Gate (G3) — ${r.model.split(/[\\/]/).pop()}`, ""];
  out.push(`**Result** ${r.ok ? "PASS" : "FAIL"} · ${r.blockingCount} blocking · ${r.warningCount} warning`);
  out.push(`**Generated** ${r.generatedAt} · **Schema** ${r.schemaVersion ?? "?"} · **CRS** ${r.modelCrs ?? "?"}`, "");
  out.push("| Rule | Severity | Finding |", "| --- | --- | --- |");
  for (const f of r.findings) out.push(`| ${f.ruleId} | ${f.severity} | ${f.message.replace(/\|/g, "\\|")} |`);
  if (r.layers.length) {
    out.push("", "| Layer | Model table | Features (model/package) | Length m (model/package) | Offset m |", "| --- | --- | --- | --- | --- |");
    for (const l of r.layers) {
      out.push(
        `| ${l.layer} | ${l.dataSource?.targetTable ?? "not imported"} | ${l.modelCount}/${l.packageCount} | ` +
          `${l.packageLength ? `${l.modelLength.toFixed(1)}/${l.packageLength.toFixed(1)}` : "-"} | ${l.centreOffset?.toFixed(3) ?? "-"} |`,
      );
    }
  }
  if (r.regions.length) {
    out.push("", "| Region | IMX sections / span m | Model sections / span m |", "| --- | --- | --- |");
    for (const g of r.regions) {
      out.push(`| ${g.name} | ${g.imxSections} / ${g.imxSpan.toFixed(1)} | ${g.modelSections ?? "—"} / ${g.modelSpan?.toFixed(1) ?? "—"} |`);
    }
  }
  return out.join("\n") + "\n";
}
