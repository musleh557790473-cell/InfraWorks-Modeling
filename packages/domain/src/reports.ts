import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export type ReportRow = Record<string, string>;

export function parseCsvReport(filePath: string): ReportRow[] {
  const text = readFileSync(filePath, "utf8");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ReportRow[];
  return records;
}

/** Minimal PDF text scrape for key=value / table-like lines. Prefer CSV/XLSX in MVP. */
export function parsePdfReportStub(filePath: string): ReportRow[] {
  const buf = readFileSync(filePath);
  const text = buf.toString("latin1");
  const rows: ReportRow[] = [];
  const lineRe = /([A-Za-z0-9_-]+)\s*[|=,]\s*([^\n\r]+)/g;
  let match: RegExpExecArray | null;
  const bag: ReportRow = {};
  while ((match = lineRe.exec(text)) !== null) {
    bag[match[1]!] = match[2]!.trim();
  }
  if (Object.keys(bag).length) rows.push(bag);
  return rows;
}

export function indexRowsByKey(rows: ReportRow[], key: string): Map<string, ReportRow> {
  const map = new Map<string, ReportRow>();
  for (const row of rows) {
    const value = row[key];
    if (value) map.set(String(value), row);
  }
  return map;
}
