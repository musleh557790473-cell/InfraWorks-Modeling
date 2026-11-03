// List a model's data sources (name, type, file) and the terrain extent, read-only.
// Usage: node sources.cjs <model.sqlite>
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const cols = db.prepare("pragma table_info(DATA_SOURCES)").all().map((c) => c.name);
console.log("DATA_SOURCES columns:", cols.join(", "));
for (const r of db.prepare("select * from DATA_SOURCES").all()) {
  const cfg = String(r.CONFIG || "");
  const pick = (k) => (cfg.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`)) || [])[1];
  console.log("-", r.NAME ?? r.SOURCE_NAME ?? "", "|", r.FEATURE_CLASS ?? r.TYPE ?? pick("featureClass") ?? pick("type") ?? "", "|", (r.CONNECTION_STRING ?? pick("file") ?? pick("path") ?? "").toString().slice(0, 120));
}
const tables = db.prepare("select name from sqlite_master where type='table' and (name like '%TERRAIN%' or name like '%SURFACE%' or name like '%DEM%')").all().map((t) => t.name);
for (const t of tables) console.log("table", t, db.prepare(`select count(*) n from "${t}"`).get().n);
