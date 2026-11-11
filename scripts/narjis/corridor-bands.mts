/**
 * Al Narjis utility corridors as areas (Coverage Areas), one Shapefile per corridor: each IUC corridor line
 * of Al-Narjis-corridors-shp-v2 widened by half the spacing to the nearest other corridor (as Parsons spaced
 * them in IUC-30001), at most 1.0 m each side (`corridorBands`). Written to
 * DATA_DIR\exports\Al-Narjis-corridor-bands-shp-v1\shp with an IMPORT_CHECKLIST.txt.
 *
 *   pnpm exec tsx scripts/narjis/corridor-bands.mts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corridorBands, resolveDataDir, writeShapefile, type Line, type NamedLine } from "@infraworks/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ex = join(resolveDataDir(root), "exports");
const src = join(ex, "Al-Narjis-corridors-shp-v2", "layers");
const out = join(ex, "Al-Narjis-corridor-bands-shp-v1");
if (existsSync(out)) throw new Error(`${out} exists: choose a new version`);
mkdirSync(join(out, "shp"), { recursive: true });

type F = { geometry: { type: string; coordinates: Line }; properties: Record<string, unknown> };
const lines: (NamedLine & { file: string; colour: string })[] = [];
for (const f of readdirSync(src).filter((n) => n.startsWith("corridor_") && n.endsWith(".geojson"))) {
  for (const ft of (JSON.parse(readFileSync(join(src, f), "utf8")).features as F[])) {
    if (ft.geometry.type === "LineString") lines.push({ name: String(ft.properties.network), line: ft.geometry.coordinates, file: f.replace(/\.geojson$/, ""), colour: String(ft.properties.colour ?? "") });
  }
}
const bands = corridorBands(lines, { maxHalf: 1 });
const checklist: string[] = [
  "Al Narjis utility corridors as areas (IUC-DWG-10000), one Shapefile per corridor: give each data source its own colour",
  "(Data Sources > double-click > Common > Style Chooser; colours in CORRIDOR_COLOURS.txt of Al-Narjis-corridors-shp-v2).",
  "Each band: the corridor line widened by half the spacing to the nearest other corridor, at most 1.0 m each side. Display only.",
  "Coordinate system UTM84-38N (EPSG:32638, from the .prj).",
  "",
];
const files = [...new Set(lines.map((l) => l.file))].sort();
for (const file of files) {
  const mine = bands.filter((b, i) => lines[i]!.file === file);
  const name = `${file.replace(/^corridor_/, "corridor_band_")}`;
  writeShapefile(join(out, "shp", name), "area", mine.map((b) => ({ kind: "area", parts: [b.ring], attributes: { NAME: b.name, HALF_W_M: b.halfWidth } })), 32638);
  const hw = mine.map((b) => b.halfWidth).sort((p, q) => p - q);
  checklist.push(`- ${name}.shp -> Type: Coverage Areas (${mine.length} feature(s); half width ${hw[0]}-${hw[hw.length - 1]} m; ${lines.find((l) => l.file === file)!.colour})`);
}
writeFileSync(join(out, "IMPORT_CHECKLIST.txt"), checklist.join("\r\n") + "\r\n");
process.stdout.write(checklist.join("\n") + "\n");
