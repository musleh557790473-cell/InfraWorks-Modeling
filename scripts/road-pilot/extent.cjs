// Model extent (MODEL_INFO / terrain surfaces) against road extents: roads that run past the
// model's terrain end in walls hanging down to nowhere.
// Usage: node extent.cjs <model.sqlite>
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tabs = db.prepare("select name from sqlite_master where type='table' and name not like '__journal%'").all().map((t) => t.name);
for (const t of tabs.filter((t) => /MODEL|EXTENT|SETTING|PROJECT|TERRAIN_SURFACES/i.test(t))) {
  const cols = db.prepare(`pragma table_info("${t}")`).all().map((c) => c.name);
  console.log("##", t, cols.join(","));
  for (const r of db.prepare(`select * from "${t}" limit 20`).all()) {
    const o = {}; for (const c of cols) { const v = r[c]; if (v == null) continue; if (v instanceof Uint8Array) { if (v.length >= 96 && v.readUInt32LE?.(0) === 3) o[c] = "polygon"; else o[c] = `blob ${v.length}`; continue; } const s = String(v); if (s.length) o[c] = s.length > 160 ? s.slice(0, 160) + "..." : s; }
    console.log("  ", JSON.stringify(o));
  }
}
