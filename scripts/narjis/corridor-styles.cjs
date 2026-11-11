/**
 * Al Narjis: give each corridor data source its IUC colour, as InfraWorks itself writes it when a style is
 * picked in Data Sources > Configure > Common (seen 11 Nov 2026 in the model's .files history):
 * DATA_SOURCES.CONFIG propertyMappings.RULE_STYLE = { expression: "'<style>'" }, and the same value in
 * RULE_STYLE of each feature row of that source.
 * - Coverage Areas (corridor_band_*): a colour code 'xRRGGBBAA' (exact IUC colour).
 * - Pipelines (corridor_*): the model's own style 'Pipeline/IUC <name>' in the exact colour.
 * Usage (model closed, on a copy first):  node scripts/narjis/corridor-styles.cjs "<model>.sqlite" [--dry]
 */
const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");

// Exact IUC colours: the lines take the model's own "IUC <name>" pipe styles, made by
// scripts/narjis/corridor-style-library.cjs (run it first); the bands take the colour code.
const { CORRIDORS } = require("./corridor-style-library.cjs");
const COLOURS = Object.fromEntries(Object.entries(CORRIDORS).map(([slug, [name, hex]]) => [slug, [hex, name]]));

const [model, ...rest] = process.argv.slice(2);
const dry = rest.includes("--dry");
if (!model) { console.error("usage: node corridor-styles.cjs <model.sqlite> [--dry]"); process.exit(2); }
if (existsSync(model.replace(/\.sqlite$/i, ".lock"))) { console.error("the model is open in InfraWorks (.lock): close it first"); process.exit(2); }
const db = new DatabaseSync(model, { readOnly: dry, enableDoubleQuotedStringLiterals: true });
const sources = db.prepare("select GUID, NAME, TARGET_CLASS_NAME t, CONFIG from DATA_SOURCES").all();
let n = 0;
if (!dry) db.exec("begin");
try {
  for (const s of sources) {
    // "corridor_irrigation (2)": the same file imported a second time
    const m = /^corridor_(band_)?(.+?)(?: \(\d+\))?$/.exec(String(s.NAME));
    if (!m || !COLOURS[m[2]]) continue;
    const [hex, pipe] = COLOURS[m[2]];
    const style = m[1] ? `x${hex}FF` : `Pipeline/${pipe}`;
    if ((m[1] && s.t !== "COVERAGES") || (!m[1] && s.t !== "PIPELINES")) { console.log(`skip ${s.NAME}: imported as ${s.t}`); continue; }
    const cfg = JSON.parse(s.CONFIG || "{}");
    cfg.propertyMappings = { ...(cfg.propertyMappings || {}), RULE_STYLE: { expression: `'${style}'` } };
    const rows = dry ? db.prepare(`select count(*) c from "${s.t}" where DATA_SOURCE_ID = ?`).get(s.GUID).c : db.prepare(`update "${s.t}" set RULE_STYLE = ? where DATA_SOURCE_ID = ?`).run(style, s.GUID).changes;
    if (!dry) db.prepare("update DATA_SOURCES set CONFIG = ? where GUID = ?").run(JSON.stringify(cfg, null, "\t"), s.GUID);
    console.log(`${String(s.NAME).padEnd(34)} ${style.padEnd(24)} ${rows} feature(s)`);
    n++;
  }
  if (!dry) db.exec("commit");
} catch (e) { if (!dry) db.exec("rollback"); throw e; }
console.log(`${n} corridor source(s) ${dry ? "would be" : ""} styled${dry ? " (--dry: nothing written)" : ""}`);
