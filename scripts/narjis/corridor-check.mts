/**
 * Al Narjis: is each network in the place the utility corridor plan (IUC-DWG-10000) gives it? For every
 * metre of a network, the nearest corridor line among ALL corridors decides: its own place, another
 * network's place (named), or outside every corridor (none within 2 m) (`corridorAssignment`). Per
 * network, in this order: the corridor, the network as the sheets draw it, the hydraulic model (WaterGEMS /
 * SewerGEMS) where there is one. Reads the packages in DATA_DIR\exports.
 *
 *   pnpm exec tsx scripts/narjis/corridor-check.mts [--out scripts/narjis/corridor-check.md]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corridorAssignment, resolveDataDir, type Line, type NamedLine } from "@infraworks/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const exportsDir = join(resolveDataDir(root), "exports");
type Feature = { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };
const layer = (pkg: string, name: string): Feature[] => JSON.parse(readFileSync(join(exportsDir, pkg, "layers", `${name}.geojson`), "utf8")).features;
const lines = (fs: Feature[]): Line[] => fs.flatMap((f) => (f.geometry.type === "LineString" ? [f.geometry.coordinates as Line] : f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as Line[]) : []));
const lengthOf = (ls: readonly Line[]) => ls.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p[0]! - l[i]![0]!, p[1]! - l[i]![1]!), 0), 0);

// --district narjis (default) | namar: package prefix, corridor package, sheet and model names
const DISTRICTS = {
  narjis: {
    title: "Al Narjis", p: "Al-Narjis", corridors: "Al-Narjis-corridors-shp-v2", sheet: "IUC-DWG-10000",
    sheets: { water: "IPW-DWG-10000", irr: "IRW-DWG-10000", sewer: "ISE-DWG-10000", storm: "ISW-DWG-10000", mv: "IMV-DWG-10000", lv: "ILV-DWG-10000", tel: "ITE-DWG-10000", sec: "IIC-DWG-13000", sl: "" },
    models: { water: "alnarjes hydraulic model REV02", irr: "Narjis Model", sewer: "AL-NARJIS_option 5" },
  },
  namar: {
    title: "Namar", p: "Namar", corridors: "Namar-corridors-shp-v1", sheet: "UTL-DWG-10000",
    sheets: { water: "PWT-DWG-10000", irr: "IRR-DWG-10000", sewer: "SWN-DWG-10000", storm: "STO-DWG-10000", mv: "EMV-DWG-10000", lv: "ELV-DWG-10000", tel: "TEL-DWG-10000", sec: "SEC-DWG-10000 / 10100", sl: "SLT-DWG-10000" },
    models: { water: "PW_CD_Model", irr: "Nemer Hydraulic Model", sewer: "Rev.01_Op.4" },
  },
  // Namar 60 % DD (scripts/namar/HANDOVER-60.md): one package per sheet, so each layer names its package
  namar60: {
    title: "Namar (60 % DD)", p: "Namar60", corridors: "Namar60-corridors-shp-v1", sheet: "UTL-DWG-10000 (60 %)",
    sheets: { water: "PWT-DWG-10000", irr: "IRR-DWG-10000", sewer: "", storm: "StormCAD model DD60-R00", mv: "EMV-DWG-10000", lv: "ELV-DWG-10000", tel: "TEL-DWG-10000", sec: "ICT-DWG-10000", sl: "SLT-MOD-90000-001" },
    models: { water: "PW_Model-Rev 04", irr: "Nemer Hydraulic Model (60 %)", sewer: "Sewage Model-Rev 04" },
    layers: {
      "pipes-dwg/water_pipes_dwg": ["Namar60-fittings-shp-v1", "water_pipes_dwg"],
      "pipes-dwg/irrigation_pipes_dwg": ["Namar60-fittings-shp-v1", "irrigation_pipes_dwg"],
      "irrigation-dwg/irrigation_control_cable": ["Namar60-fittings-shp-v1", "irrigation_control_cable"],
      "pipes-dwg/sewer_pipes_dwg": null,
      "storm/storm_pipes": ["Namar60-storm-model-shp-v1", "storm_pipes"],
      "dry/lv_cables": ["Namar60-power-shp-v1", "lv_cables"],
      "dry/mv_cables": ["Namar60-power-shp-v1", "mv_cables"],
      "dry/streetlight_cables": ["Namar60-streetlighting-shp-v1", "streetlight_cables"],
      "dry/telecom_ducts": ["Namar60-telecom-shp-v1", "telecom_ducts"],
      "dry/security_ducts": ["Namar60-ict-shp-v1", "ict_ducts"],
    },
  },
} as const;
const dArg = process.argv.indexOf("--district");
const D = DISTRICTS[(dArg >= 0 ? process.argv[dArg + 1] : "narjis") as keyof typeof DISTRICTS];
if (!D) throw new Error(`--district: one of ${Object.keys(DISTRICTS).join(", ")}`);
const pkg = (name: string) => `${D.p}-${name}-shp-v1`;
const exists = (p: string, name: string) => { try { return readdirSync(join(exportsDir, p, "layers")).includes(`${name}.geojson`); } catch { return false; } };
/** A layer by its 30 % package key, or where the district's own map puts it (null: no such layer). */
const where = (key: string, name: string): readonly [string, string] | null => {
  const map = ("layers" in D ? D.layers : {}) as Record<string, readonly [string, string] | null>;
  return `${key}/${name}` in map ? map[`${key}/${name}`]! : [pkg(key), name];
};
const has = (key: string, name: string) => { const w = where(key, name); return w !== null && exists(w[0], w[1]); };
const L = (key: string, name: string): Feature[] => { const w = where(key, name); return w && exists(w[0], w[1]) ? layer(w[0], w[1]) : []; };

const corridorPkg = D.corridors;
const corridors: NamedLine[] = readdirSync(join(exportsDir, corridorPkg, "layers"))
  .filter((f) => f.startsWith("corridor_"))
  .flatMap((f) => layer(corridorPkg, f.replace(/\.geojson$/, "")))
  .flatMap((f) => lines([f]).map((line) => ({ name: String(f.properties.network), line })));

const lv = L("dry", "lv_cables");
const IRR = ["Corridor - Irrigation", "Corridor - Irrigation Secondary", "Corridor - Trees and Irrigation", "Corridor - Trees, Irrigation and Street Lighting"];
const S = D.sheets, M = D.models;
const groups: { network: string; own: string[]; sources: { kind: string; from: string; features: Feature[] }[] }[] = [
  { network: "Potable water", own: ["Corridor - Water"], sources: [
    { kind: "Drawing", from: S.water, features: L("pipes-dwg", "water_pipes_dwg") },
    { kind: "WaterGEMS model", from: M.water, features: L("water", "water_pipes") }] },
  { network: "Irrigation", own: IRR, sources: [
    { kind: "Drawing", from: `${S.irr} (main, secondary, tie-ins)`, features: L("pipes-dwg", "irrigation_pipes_dwg") },
    { kind: "Drawing", from: `${S.irr} control cable`, features: L("irrigation-dwg", "irrigation_control_cable") },
    { kind: "WaterGEMS model", from: M.irr, features: L("irrigation", "irrigation_pipes") }] },
  // Namar draws a sewer force main corridor (-02-Sewer FM) beside the gravity one
  { network: "Sewer", own: ["Corridor - Sewer", ...(D.p === "Namar" ? ["Corridor - Sewer FM"] : [])], sources: [
    { kind: "Drawing", from: S.sewer, features: L("pipes-dwg", "sewer_pipes_dwg") },
    { kind: "SewerGEMS model", from: M.sewer, features: L("sewer", "sewer_pipes") }] },
  { network: "Storm", own: ["Corridor - Storm", "Corridor - Storm Catch Basins"], sources: [
    { kind: "Drawing", from: D.p === "Namar60" ? S.storm : `${S.storm} (no model issued)`, features: L("storm", "storm_pipes") }] },
  { network: "Electrical MV", own: ["Corridor - Electrical MV"], sources: [{ kind: "Drawing", from: S.mv, features: L("dry", "mv_cables") }] },
  { network: "Electrical LV", own: ["Corridor - Electrical LV"], sources: [{ kind: "Drawing", from: `${S.lv} cables`, features: lv.filter((f) => f.properties.conn_type !== "House Connection") }] },
  { network: "LV house connections", own: ["Corridor - House Connection", "Corridor - Electrical LV"], sources: [{ kind: "Drawing", from: S.lv, features: lv.filter((f) => f.properties.conn_type === "House Connection") }] },
  ...(has("dry", "streetlight_cables") ? [{ network: "Street lighting", own: ["Corridor - Street Lighting", "Corridor - Trees and Street Lighting", "Corridor - Trees, Irrigation and Street Lighting"], sources: [{ kind: "Drawing", from: S.sl, features: L("dry", "streetlight_cables") }] }] : []),
  { network: "Telecom", own: ["Corridor - Telecom"], sources: [{ kind: "Drawing", from: S.tel, features: L("dry", "telecom_ducts") }] },
  { network: "Security (no corridor of its own: telecom's)", own: ["Corridor - Telecom"], sources: [
    { kind: "Drawing", from: S.sec, features: [...L("dry", "security_ducts"), ...(has("security-secondary", "security_ducts_secondary") ? L("security-secondary", "security_ducts_secondary") : [])] }] },
];

const pct = (v: number, of: number) => (of ? `${((v / of) * 100).toFixed(0)} %` : "-");
const rows: string[] = [
  "| Network | Source | From | Length (m) | In its own place | In another network's place | Outside every corridor (> 2 m) |",
  "| --- | --- | --- | ---: | ---: | --- | ---: |",
];
for (const g of groups) {
  const mine = corridors.filter((c) => g.own.includes(c.name));
  rows.push(`| **${g.network}** | Corridor | ${D.sheet}: ${g.own.map((n) => n.replace("Corridor - ", "")).join(", ")} | ${lengthOf(mine.map((c) => c.line)).toFixed(0)} | | | |`);
  for (const s of g.sources.filter((x) => x.features.length)) {
    const a = corridorAssignment(lines(s.features), corridors, g.own, { outside: 2 });
    const others = Object.entries(a.others).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([n, v]) => `${n.replace("Corridor - ", "")} ${pct(v, a.length)}`).join(", ");
    rows.push(`| | ${s.kind} | ${s.from} | ${a.length.toFixed(0)} | ${pct(a.own, a.length)} | ${others || "-"} | ${pct(a.outside, a.length)} |`);
  }
}
const table = rows.join("\n");
process.stdout.write(table + "\n");
const out = process.argv.indexOf("--out");
if (out >= 0) {
  writeFileSync(resolve(process.argv[out + 1]!), [
    `# ${D.title}: each network against the utility corridors (${D.sheet})`,
    "",
    `Generated by \`scripts/narjis/corridor-check.mts${D.p === "Namar" ? " --district namar" : ""}\` from the packages in DATA_DIR\\exports. For every metre of a`,
    "network (plan only) the nearest corridor line among all corridors decides: its own place, another",
    "network's place, or outside every corridor when none lies within 2 m. Parsons spaces the corridors 0.40-1.80 m",
    `apart (${D.p === "Namar" ? "UTL-DWG-30000" : "IUC-30001"}), so the nearest line is the place the plan gives that metre.`,
    "",
    table,
    "",
  ].join("\n"));
}
