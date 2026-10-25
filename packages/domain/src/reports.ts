import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export type ReportRow = Record<string, string>;

export interface ReportTable {
  columns: string[];
  rows: ReportRow[];
  /** Excel only: every sheet in the workbook. */
  sheets?: string[];
  /** Excel only: the sheet that was read. */
  sheet?: string;
  /** CSV only: how the bytes were decoded. */
  encoding?: string;
}

/**
 * Decode CSV bytes from whatever a team's tools wrote: UTF-8 (with or without BOM),
 * UTF-16 (Excel "Unicode text"), or — when the bytes are not valid UTF-8 — Windows-1256,
 * the Arabic code page older Excel versions save "CSV" in. CSV_FALLBACK_ENCODING overrides.
 */
export function decodeText(buf: Buffer, fallback = process.env.CSV_FALLBACK_ENCODING || "windows-1256") {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder(fallback).decode(body), encoding: fallback };
  }
}

/** Pick the separator that splits the header line into the most columns. */
function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => [d, header.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 1 ? counts[0]![0] : ",";
}

export function parseCsvReport(filePath: string): ReportRow[] {
  return readCsvTable(filePath).rows;
}

export function readCsvTable(filePath: string): ReportTable {
  const { text, encoding } = decodeText(readFileSync(filePath));
  const records = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    delimiter: detectDelimiter(text),
    relax_column_count: true,
  }) as ReportRow[];
  const columns = records[0] ? Object.keys(records[0]) : [];
  return { columns, rows: records, encoding };
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result?: unknown }).result ?? ""); // formula
  return String(cell.text ?? "").trim();
}

/** Read an .xlsx sheet: the first non-empty row is the header, empty rows are skipped. */
export async function readXlsxTable(filePath: string, sheet?: string): Promise<ReportTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = wb.worksheets.map((w) => w.name);
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) {
    throw new Error(`Sheet "${sheet}" not found in ${filePath.split(/[\\/]/).pop()} — sheets: ${sheets.join(", ")}`);
  }
  let columns: string[] | null = null;
  const rows: ReportRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) values.push(cellText(row.getCell(c)));
    if (!values.some((v) => v !== "")) return;
    if (!columns) {
      columns = values.map((v, i) => v || `column_${i + 1}`);
      return;
    }
    const rec: ReportRow = {};
    columns.forEach((col, i) => (rec[col] = values[i] ?? ""));
    rows.push(rec);
  });
  return { columns: columns ?? [], rows, sheets, sheet: ws.name };
}

/** Minimal PDF text scrape for key=value / table-like lines. Prefer CSV/XLSX. */
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

/** Any supported report as a table. */
export async function readReport(filePath: string, kind: string, sheet?: string): Promise<ReportTable> {
  if (kind === "xlsx") return readXlsxTable(filePath, sheet);
  if (kind === "pdf") {
    const rows = parsePdfReportStub(filePath);
    return { columns: rows[0] ? Object.keys(rows[0]) : [], rows };
  }
  return readCsvTable(filePath);
}

export function indexRowsByKey(
  rows: ReportRow[],
  key: string,
  normalize: (v: string) => string = (v) => v,
): Map<string, ReportRow> {
  const map = new Map<string, ReportRow>();
  for (const row of rows) {
    const value = row[key];
    if (value) map.set(normalize(String(value)), row);
  }
  return map;
}
