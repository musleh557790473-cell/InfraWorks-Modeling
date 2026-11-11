/**
 * Al Narjis: colour the modelled networks in Parsons' utility colours (IUC-DWG-10000, the only per-network
 * colour scheme in the submission; the network sheets colour by layer, e.g. telecom and security alike),
 * so each network shows in its corridor's colour. Pipes and cables take the model's "Pipeline/IUC <name>"
 * styles; the network nodes (manholes, structures) new "PipeConnector/IUC <name>" styles (written here,
 * as InfraWorks' own Orange Circle). Valves, hydrants, pillars, handholes, substations and street lights
 * keep their 3D shapes; security keeps its own (IUC has no security corridor).
 * As InfraWorks writes a picked style: CONFIG.propertyMappings.RULE_STYLE and each feature's RULE_STYLE.
 *
 *   node scripts/narjis/network-styles.cjs "<model>.sqlite" [--dry]      (model closed, a copy first)
 */
const { DatabaseSync } = require("node:sqlite");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { CORRIDORS, png, pipeConnector } = require("./corridor-style-library.cjs");

/** data source -> IUC corridor slug (the pipe or node takes that corridor's colour) */
const PIPES = {
  sewer_pipes: "sewer", sewer_pipes_dwg: "sewer",
  water_pipes: "water", water_pipes_dwg: "water",
  irrigation_pipes: "irrigation", irrigation_pipes_dwg: "irrigation", irrigation_control_cable: "irrigation",
  storm_pipes: "storm",
  mv_cables: "mv", lv_cables: "lv",
  telecom_ducts: "telecom",
};
const NODES = { sewer_manholes: "sewer", storm_manholes: "storm", water_structures: "water", irrigation_structures: "irrigation" };

const [model, ...rest] = process.argv.slice(2);
const dry = rest.includes("--dry");
if (!model || !/\.sqlite$/i.test(model)) { console.error('usage: node network-styles.cjs "<model>.sqlite" [--dry]'); process.exit(2); }
if (existsSync(model.replace(/\.sqlite$/i, ".lock"))) { console.error("the model is open in InfraWorks (.lock): close it first"); process.exit(2); }

// the PipeConnector styles the nodes need, in the model's own library (next to the .sqlite: <model>.files)
const lib = join(model.replace(/\.sqlite$/i, ".files"), "unver", "Content", "Styles", "PipeConnector");
for (const slug of new Set(Object.values(NODES))) {
  const [name, hex] = CORRIDORS[slug];
  const f = join(lib, `${name}.ACItem`);
  if (existsSync(f)) continue;
  console.log(`style PipeConnector/${name}${dry ? " (would be written)" : ""}`);
  if (dry) continue;
  mkdirSync(lib, { recursive: true });
  writeFileSync(f, JSON.stringify(pipeConnector(name), null, "\t"));
  writeFileSync(join(lib, `${name}.png`), png(hex));
}

const db = new DatabaseSync(model, { readOnly: dry, enableDoubleQuotedStringLiterals: true });
let n = 0;
if (!dry) db.exec("begin");
try {
  for (const s of db.prepare("select GUID, NAME, TARGET_CLASS_NAME t, CONFIG from DATA_SOURCES").all()) {
    const base = String(s.NAME).replace(/ \(\d+\)$/, "");
    const slug = PIPES[base] ?? NODES[base];
    if (!slug) continue;
    const kind = PIPES[base] ? "Pipeline" : "PipeConnector";
    if ((kind === "Pipeline" && s.t !== "PIPELINES") || (kind === "PipeConnector" && s.t !== "PIPE_CONNECTORS")) { console.log(`skip ${s.NAME}: imported as ${s.t}`); continue; }
    const style = `${kind}/${CORRIDORS[slug][0]}`;
    const cfg = JSON.parse(s.CONFIG || "{}");
    const was = cfg.propertyMappings?.RULE_STYLE?.expression ?? "-";
    cfg.propertyMappings = { ...(cfg.propertyMappings || {}), RULE_STYLE: { expression: `'${style}'` } };
    const rows = dry ? db.prepare(`select count(*) c from "${s.t}" where DATA_SOURCE_ID = ?`).get(s.GUID).c : db.prepare(`update "${s.t}" set RULE_STYLE = ? where DATA_SOURCE_ID = ?`).run(style, s.GUID).changes;
    if (!dry) db.prepare("update DATA_SOURCES set CONFIG = ? where GUID = ?").run(JSON.stringify(cfg, null, "\t"), s.GUID);
    console.log(`${String(s.NAME).padEnd(26)} ${String(was).padEnd(36)} -> ${style.padEnd(32)} ${rows} feature(s)`);
    n++;
  }
  if (!dry) db.exec("commit");
} catch (e) { if (!dry) db.exec("rollback"); throw e; }
console.log(`${n} network source(s) ${dry ? "would be " : ""}restyled${dry ? " (--dry: nothing written)" : ""}`);
