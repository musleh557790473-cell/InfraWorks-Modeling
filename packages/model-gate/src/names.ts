import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import AdmZip from "adm-zip";

import { findSources } from "./gate.js";
import { dataSources, openModel } from "./read.js";
import { EXPECTED_TABLE } from "./types.js";

/**
 * Names and attributes into an InfraWorks model, on a copy.
 *
 * InfraWorks keeps a Shapefile field only when it is mapped in Configure, and does not map a
 * field called NAME (or SIZE_M...) by itself. Its rows keep the Shapefile record number
 * (EXTERNAL_ID, from the mapping EXTERNAL_ID = FeatId), so each row's values can be taken from
 * the same record of the package's .dbf. This copies the model, fills each mapped column where
 * it is empty (NAME, and the layer's other columns: SIZE_X, PIPE_MATERIAL, HEIGHT...), and records
 * <column> = <field> in each data source's Configure settings, so a Refresh in InfraWorks keeps them.
 */

export interface ColumnFill {
  column: string;
  field: string;
  filled: number;
  /** Rows that already had another value: left as they were. */
  kept: number;
  /** Why this column was left alone, when it was. */
  skipped?: string;
}

export interface NameFillLayer {
  file: string;
  /** The .dbf field Name was filled from. */
  field: string;
  dataSource: string;
  table: string;
  rows: number;
  /** Rows given a Name. */
  filled: number;
  /** Rows that already had a different name: left as they were. */
  kept: number;
  /** Every column filled, Name first. */
  columns: ColumnFill[];
  /** Why the layer was left alone, when it was. */
  skipped?: string;
  /**
   * Records with no row of the source left: a road converted to a component road in InfraWorks
   * leaves its data source (Al Narjis ROAD-01, 10 Nov 2026), the others still match by record number.
   */
  missing?: number;
}

export interface NameFillResult {
  output: string;
  /** The model's companion folder (<model>.files: styles, version history), copied beside the output. */
  filesFolder?: string;
  layers: NameFillLayer[];
}

/** Read one field of a .dbf, by record (index 0 = record 1), as text. */
export function readDbfField(dbf: Buffer, field: string): (string | null)[] {
  const records = dbf.readUInt32LE(4);
  const headerLen = dbf.readUInt16LE(8);
  const recordLen = dbf.readUInt16LE(10);
  let offset = 1; // deletion flag
  let found: { offset: number; length: number } | undefined;
  for (let p = 32; p < headerLen - 1 && dbf[p] !== 0x0d; p += 32) {
    const name = dbf.subarray(p, p + 11).toString("latin1").replace(/\0.*$/, "");
    const length = dbf[p + 16]!;
    if (name.toUpperCase() === field.toUpperCase()) found = { offset, length };
    offset += length;
  }
  if (!found) throw new Error(`field ${field} not in the .dbf`);
  const out: (string | null)[] = [];
  for (let r = 0; r < records; r++) {
    const start = headerLen + r * recordLen + found.offset;
    const v = dbf.subarray(start, start + found.length).toString("utf8").replace(/\0+$/, "").trim();
    out.push(v === "" ? null : v);
  }
  return out;
}

interface ManifestLayer {
  format: string;
  path: string;
  infraFeatureClass: string;
  nameField?: string;
  fields?: Record<string, string>;
}

export function fillNames(modelPath: string, packagePath: string, outPath: string): NameFillResult {
  if (!existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`);
  if (existsSync(outPath)) throw new Error(`${outPath} already exists: choose another --out, or delete it first`);
  // An InfraWorks model is <name>.sqlite plus <name>.files; <name>.lock while it is open.
  const companion = (p: string, ext: string) => join(dirname(p), `${basename(p, extname(p))}${ext}`);
  const lock = companion(modelPath, ".lock");
  if (existsSync(lock)) {
    throw new Error(`the model is open in InfraWorks (${basename(lock)} is there): close it first. If InfraWorks is closed, the lock was left by a crash; delete it.`);
  }
  const filesIn = companion(modelPath, ".files");
  const filesOut = companion(outPath, ".files");
  if (existsSync(filesIn) && existsSync(filesOut)) throw new Error(`${filesOut} already exists: choose another --out, or delete it first`);

  const read = packageReader(packagePath);
  const manifest = JSON.parse(read("manifest.json").toString("utf8")) as { layers: ManifestLayer[] };
  const named = manifest.layers.filter((l) => l.format === "shp" && (l.nameField || (l.fields && Object.keys(l.fields).length)));
  if (!named.length) throw new Error("the package has no layer with a name field or InfraWorks fields (manifest.json): build it again with the current tool");

  copyFileSync(modelPath, outPath);
  const hasFiles = existsSync(filesIn);
  if (hasFiles) cpSync(filesIn, filesOut, { recursive: true });
  const h = openModel(outPath);
  const sources = dataSources(h);
  h.db.close();

  // InfraWorks' own triggers write "INVALID" in double quotes, which better-sqlite3 rejects; Node's
  // SQLite accepts it when asked (Node 22.16+ / 24). Its journal triggers then log each change,
  // as for an edit made in InfraWorks.
  const db = new DatabaseSync(outPath, { enableDoubleQuotedStringLiterals: true } as ConstructorParameters<typeof DatabaseSync>[1]);
  const layers: NameFillLayer[] = [];
  let done = false;
  try {
    db.exec("BEGIN");
    for (const l of named) {
      const file = l.path.split("/").pop()!;
      const dbf = read(l.path.replace(/\.shp$/i, ".dbf"));
      // Name first, then the layer's other columns; one column is filled once.
      const wanted = new Map<string, string>();
      if (l.nameField) wanted.set("NAME", l.nameField);
      for (const [col, field] of Object.entries(l.fields ?? {})) if (!wanted.has(col)) wanted.set(col, field);

      for (const src of findSources(sources, file)) {
        const table = src.TARGET_CLASS_NAME ?? "";
        const entry: NameFillLayer = {
          file,
          field: l.nameField ?? "",
          dataSource: src.NAME ?? src.GUID,
          table,
          rows: 0,
          filled: 0,
          kept: 0,
          columns: [],
        };
        layers.push(entry);
        let config: { propertyMappings?: Record<string, { expression?: string }> } = {};
        try {
          config = JSON.parse(src.CONFIG ?? "{}");
        } catch {
          entry.skipped = "its Configure settings could not be read";
          continue;
        }
        // Rows are matched to records by EXTERNAL_ID, which holds the record number only when
        // EXTERNAL_ID is mapped to FeatId (InfraWorks' default for a Shapefile).
        const ext = config.propertyMappings?.EXTERNAL_ID?.expression?.trim();
        if (ext && ext.toLowerCase() !== "featid") {
          entry.skipped = `EXTERNAL_ID is mapped to ${ext}, not FeatId, so rows cannot be matched to records`;
          continue;
        }
        if (!Object.values(EXPECTED_TABLE).flat().includes(table)) {
          entry.skipped = `unexpected table ${table || "(none)"}`;
          continue;
        }
        const columns = new Map(
          (db.prepare(`pragma table_info("${table}")`).all() as unknown as { name: string; type: string }[]).map((c) => [c.name.toUpperCase(), c.type.toUpperCase()]),
        );
        const select = [...wanted.keys()].filter((c) => columns.has(c));
        const rows = db.prepare(`select ID, EXTERNAL_ID${select.map((c) => `, "${c}"`).join("")} from "${table}" where DATA_SOURCE_ID = ?`).all(src.GUID) as unknown as Record<string, unknown>[];
        entry.rows = rows.length;
        const records = dbf.readUInt32LE(4);
        // Fewer rows than records is fine when each row still carries its own record number (a feature
        // converted or deleted in InfraWorks); more rows, or numbers out of range or repeated, mean the
        // file is not the one imported.
        const ids = rows.map((r) => Number(r.EXTERNAL_ID));
        const own = ids.every((i) => Number.isInteger(i) && i >= 1 && i <= records) && new Set(ids).size === ids.length;
        if (rows.length > records || !own) {
          entry.skipped = `${rows.length} row(s) in the model against ${records} record(s) in the file: re-import it before filling`;
          continue;
        }
        if (rows.length < records) entry.missing = records - rows.length;
        for (const [column, field] of wanted) {
          const fill: ColumnFill = { column, field, filled: 0, kept: 0 };
          entry.columns.push(fill);
          if (!columns.has(column)) {
            fill.skipped = `${table} has no ${column} column`;
            continue;
          }
          let values: (string | null)[];
          try {
            values = readDbfField(dbf, field);
          } catch (err) {
            fill.skipped = err instanceof Error ? err.message : String(err);
            continue;
          }
          const numeric = /REAL|INT|NUM|DOUBLE|FLOAT/.test(columns.get(column)!);
          const set = db.prepare(`update "${table}" set "${column}" = ? where ID = ?`);
          let textInNumber: string | undefined;
          for (const r of rows) {
            const i = Number(r.EXTERNAL_ID) - 1;
            const raw = Number.isInteger(i) && i >= 0 ? values[i] : undefined;
            if (raw === undefined || raw === null) continue;
            const value = numeric ? Number(raw) : raw;
            if (numeric && !Number.isFinite(value as number)) {
              textInNumber ??= raw;
              continue;
            }
            const now = r[column];
            const empty = now === null || now === undefined || String(now).trim() === "";
            if (!empty && String(now) !== String(value)) {
              fill.kept++;
              continue;
            }
            if (!empty) continue;
            set.run(value as string | number, r.ID as number);
            fill.filled++;
          }
          // InfraWorks keeps some columns as number codes (UTILITY_TYPE, PIPE_TYPE): text cannot go
          // in, and a mapping to a text field would put it there on the next Refresh. Leave both out.
          if (!fill.filled && !fill.kept && textInNumber !== undefined) {
            fill.skipped = `${table}.${column} holds a number code, and ${field} is text ("${textInNumber}"): not filled, not mapped`;
            continue;
          }
          config.propertyMappings = { ...(config.propertyMappings ?? {}), [column]: { expression: field } };
        }
        const name = entry.columns.find((c) => c.column === "NAME");
        entry.filled = name?.filled ?? 0;
        entry.kept = name?.kept ?? 0;
        db.prepare("update DATA_SOURCES set CONFIG = ? where GUID = ?").run(JSON.stringify(config, null, "\t"), src.GUID);
      }
    }
    db.exec("COMMIT");
    done = true;
  } finally {
    if (!done) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* nothing to roll back */
      }
    }
    db.close();
    if (!done) {
      // Never leave a half-filled copy behind.
      rmSync(outPath, { force: true });
      if (hasFiles) rmSync(filesOut, { recursive: true, force: true });
    }
  }
  return { output: outPath, layers, ...(hasFiles ? { filesFolder: filesOut } : {}) };
}

function packageReader(path: string): (rel: string) => Buffer {
  if (!existsSync(path)) throw new Error(`package not found: ${path}`);
  if (statSync(path).isDirectory()) return (rel) => readFileSync(join(path, rel));
  const zip = new AdmZip(path);
  return (rel) => {
    const e = zip.getEntry(rel);
    if (!e) throw new Error(`${rel} missing from ${path}`);
    return e.getData();
  };
}