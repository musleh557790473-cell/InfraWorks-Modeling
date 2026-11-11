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

const corridorPkg = "Al-Narjis-corridors-shp-v2";
const corridors: NamedLine[] = readdirSync(join(exportsDir, corridorPkg, "layers"))
  .filter((f) => f.startsWith("corridor_"))
  .flatMap((f) => layer(corridorPkg, f.replace(/\.geojson$/, "")))
  .flatMap((f) => lines([f]).map((line) => ({ name: String(f.properties.network), line })));

const lv = layer("Al-Narjis-dry-shp-v1", "lv_cables");
const IRR = ["Corridor - Irrigation", "Corridor - Irrigation Secondary", "Corridor - Trees and Irrigation", "Corridor - Trees, Irrigation and Street Lighting"];
const groups: { network: string; own: string[]; sources: { kind: string; from: string; features: Feature[] }[] }[] = [
  { network: "Potable water", own: ["Corridor - Water"], sources: [
    { kind: "Drawing", from: "IPW-DWG-10000", features: layer("Al-Narjis-pipes-dwg-shp-v1", "water_pipes_dwg") },
    { kind: "WaterGEMS model", from: "alnarjes hydraulic model REV02", features: layer("Al-Narjis-water-shp-v1", "water_pipes") }] },
  { network: "Irrigation", own: IRR, sources: [
    { kind: "Drawing", from: "IRW-DWG-10000 (main, secondary, tie-ins)", features: layer("Al-Narjis-pipes-dwg-shp-v1", "irrigation_pipes_dwg") },
    { kind: "Drawing", from: "IRW-DWG-10000 control cable", features: layer("Al-Narjis-irrigation-dwg-shp-v1", "irrigation_control_cable") },
    { kind: "WaterGEMS model", from: "Narjis Model", features: layer("Al-Narjis-irrigation-shp-v1", "irrigation_pipes") }] },
  { network: "Sewer", own: ["Corridor - Sewer"], sources: [
    { kind: "Drawing", from: "ISE-DWG-10000", features: layer("Al-Narjis-pipes-dwg-shp-v1", "sewer_pipes_dwg") },
    { kind: "SewerGEMS model", from: "AL-NARJIS_option 5", features: layer("Al-Narjis-sewer-shp-v1", "sewer_pipes") }] },
  { network: "Storm", own: ["Corridor - Storm", "Corridor - Storm Catch Basins"], sources: [
    { kind: "Drawing", from: "ISW-DWG-10000 (no model issued)", features: layer("Al-Narjis-storm-shp-v1", "storm_pipes") }] },
  { network: "Electrical MV", own: ["Corridor - Electrical MV"], sources: [{ kind: "Drawing", from: "IMV-DWG-10000", features: layer("Al-Narjis-dry-shp-v1", "mv_cables") }] },
  { network: "Electrical LV", own: ["Corridor - Electrical LV"], sources: [{ kind: "Drawing", from: "ILV-DWG-10000 cables", features: lv.filter((f) => f.properties.conn_type !== "House Connection") }] },
  { network: "LV house connections", own: ["Corridor - House Connection", "Corridor - Electrical LV"], sources: [{ kind: "Drawing", from: "ILV-DWG-10000", features: lv.filter((f) => f.properties.conn_type === "House Connection") }] },
  { network: "Telecom", own: ["Corridor - Telecom"], sources: [{ kind: "Drawing", from: "ITE-DWG-10000", features: layer("Al-Narjis-dry-shp-v1", "telecom_ducts") }] },
  { network: "Security (no corridor of its own: telecom's)", own: ["Corridor - Telecom"], sources: [{ kind: "Drawing", from: "IIC-DWG-13000", features: layer("Al-Narjis-dry-shp-v1", "security_ducts") }] },
];

const pct = (v: number, of: number) => (of ? `${((v / of) * 100).toFixed(0)} %` : "-");
const rows: string[] = [
  "| Network | Source | From | Length (m) | In its own place | In another network's place | Outside every corridor (> 2 m) |",
  "| --- | --- | --- | ---: | ---: | --- | ---: |",
];
for (const g of groups) {
  const mine = corridors.filter((c) => g.own.includes(c.name));
  rows.push(`| **${g.network}** | Corridor | IUC-DWG-10000: ${g.own.map((n) => n.replace("Corridor - ", "")).join(", ")} | ${lengthOf(mine.map((c) => c.line)).toFixed(0)} | | | |`);
  for (const s of g.sources) {
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
    "# Al Narjis: each network against the utility corridors (IUC-DWG-10000)",
    "",
    "Generated by `scripts/narjis/corridor-check.mts` from the packages in DATA_DIR\\exports. For every metre of a",
    "network (plan only) the nearest corridor line among all corridors decides: its own place, another",
    "network's place, or outside every corridor when none lies within 2 m. Parsons spaces the corridors 0.40-1.80 m",
    "apart (IUC-30001), so the nearest line is the place the plan gives that metre.",
    "",
    table,
    "",
  ].join("\n"));
}
