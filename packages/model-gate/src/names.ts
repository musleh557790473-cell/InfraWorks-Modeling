import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import AdmZip from "adm-zip";

import { findSources } from "./gate.js";
import { dataSources, openModel } from "./read.js";
import { EXPECTED_TABLE } from "./types.js";

/**
 * Names into an InfraWorks model, on a copy.
 *
 * InfraWorks keeps a Shapefile field only when it is mapped in Configure, and does not map a
 * field called NAME by itself. Its rows keep the Shapefile record number (EXTERNAL_ID, from the
 * mapping EXTERNAL_ID = FeatId), so each row's name can be taken from the same record of the
 * package's .dbf. This copies the model, fills NAME where it is empty, and records Name = <field>
 * in each data source's Configure settings, so a Refresh in InfraWorks keeps the names.
 */

export interface NameFillLayer {
  file: string;
  field: string;
  dataSource: string;
  table: string;
  rows: number;
  filled: number;
  /** Rows that already had a different name: left as they were. */
  kept: number;
  /** Why the layer was left alone, when it was. */
  skipped?: string;
}

export interface NameFillResult {
  output: string;
  /** The model's companion folder (<model>.files: styles, version history), copied beside the output. */
  filesFolder?: string;
  layers: NameFillLayer[];
}

/** Read one text field of a .dbf, by record (index 0 = record 1). */
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
  const manifest = JSON.parse(read("manifest.json").toString("utf8")) as {
    layers: { format: string; path: string; infraFeatureClass: string; nameField?: string }[];
  };
  const named = manifest.layers.filter((l) => l.format === "shp" && l.nameField);
  if (!named.length) throw new Error("the package has no layer with a name field (nameField in manifest.json): build it again with the current tool");

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
    {
      for (const l of named) {
        const file = l.path.split("/").pop()!;
        const names = readDbfField(read(l.path.replace(/\.shp$/i, ".dbf")), l.nameField!);
        for (const src of findSources(sources, file)) {
          const table = src.TARGET_CLASS_NAME ?? "";
          const entry: NameFillLayer = { file, field: l.nameField!, dataSource: src.NAME ?? src.GUID, table, rows: 0, filled: 0, kept: 0 };
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
          const rows = db.prepare(`select ID, EXTERNAL_ID, NAME from "${table}" where DATA_SOURCE_ID = ?`).all(src.GUID) as unknown as {
            ID: number;
            EXTERNAL_ID: string | null;
            NAME: string | null;
          }[];
          entry.rows = rows.length;
          if (rows.length !== names.length) {
            entry.skipped = `${rows.length} row(s) in the model against ${names.length} record(s) in the file: re-import it before naming`;
            continue;
          }
          const set = db.prepare(`update "${table}" set NAME = ? where ID = ?`);
          for (const r of rows) {
            const i = Number(r.EXTERNAL_ID) - 1;
            const name = Number.isInteger(i) && i >= 0 ? names[i] : undefined;
            if (!name) continue;
            const now = (r.NAME ?? "").trim();
            if (now && now !== name) {
              entry.kept++;
              continue;
            }
            if (now === name) continue;
            set.run(name, r.ID);
            entry.filled++;
          }
          config.propertyMappings = { ...(config.propertyMappings ?? {}), NAME: { expression: l.nameField! } };
          db.prepare("update DATA_SOURCES set CONFIG = ? where GUID = ?").run(JSON.stringify(config, null, "\t"), src.GUID);
        }
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
      // Never leave a half-named copy behind.
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