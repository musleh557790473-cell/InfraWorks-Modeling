/**
 * Al Narjis: one colour (Material) and one pipe style (Pipeline) per IUC corridor, with Parsons' exact
 * colours, written into the model's own style library as InfraWorks 2026 writes a style made in the
 * Style Palette (seen 11 Nov 2026: the user's "IUC Telecom", x7CA500FF):
 *   <model>.files\unver\Content\Styles\Material\Colors\CORRIDOR color\IUC <name>.ACItem (+ .png)
 *   <model>.files\unver\Content\Styles\Material\CORRIDOR color\IUC <name>.ACItem (+ .png)
 *   <model>.files\unver\Content\Styles\Pipeline\IUC <name>.ACItem (+ .png), tube = that colour
 * "ambient" is half the colour, as InfraWorks set it. Existing styles are left as they are.
 * The data sources then take RULE_STYLE 'Pipeline/IUC <name>' (scripts/narjis/corridor-styles.cjs).
 *
 *   node scripts/narjis/corridor-style-library.cjs "<model>.files" [--dry]
 */
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const zlib = require("node:zlib");

/** corridor file slug -> [style name, RRGGBB] (IUC-DWG-10000 layer colours; CORRIDOR_COLOURS.txt) */
const CORRIDORS = {
  storm: ["IUC Storm", "0000FF"],
  storm_cb: ["IUC Storm CB", "003FFF"],
  sewer: ["IUC Sewer", "FF00FF"],
  irrigation: ["IUC Irrigation", "00FF00"],
  irrigation_secondary: ["IUC Irrigation Secondary", "009900"],
  water: ["IUC Water", "00BFFF"],
  telecom: ["IUC Telecom", "7CA500"],
  hv: ["IUC Electrical HV", "808080"],
  mv: ["IUC Electrical MV", "FF9F7F"],
  lv: ["IUC Electrical LV", "997300"],
  house_connection: ["IUC House Connection", "CC0033"],
  trees_sl: ["IUC Trees SL", "808080"],
  trees_irs: ["IUC Trees IRS", "BFFF7F"],
  trees_irs_sl: ["IUC Trees IRS SL", "7FBFFF"],
};

/** a 64 x 64 PNG of one colour (the palette thumbnail) */
function png(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const w = 64, raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const half = (hex) => [0, 2, 4].map((i) => Math.floor(parseInt(hex.slice(i, i + 2), 16) / 2).toString(16).padStart(2, "0").toUpperCase()).join("");
const head = (name, uri, domain) => ({
  GlobalName: `${name}_Style`, LocalName: `${name} Style [localizable]`, LocalDescription: `${name} Style - Description [localizable]`,
  Uri: `${uri}.ACItem`, GalleryImage: `${uri}.png`, ContentType: "Style", ContentDomain: domain,
  CompatibleStandards: ["Undefined"], Keywords: ["Undefined"], AciSchemaVersion: "1.0",
});
const material = (name, hex, uri) => ({ ...head(name, uri, "Material"), References: [{ Uri: `/Resources/x${hex}FF` }], EmbeddedData: { styleType: "Material", uri: `x${hex}FF`, ambient: `x${half(hex)}FF` } });
const pipeline = (name) => ({
  ...head(name, `/Styles/Pipeline/${name}`, "Pipeline"),
  References: [{ Uri: `/Styles/Material/Colors/CORRIDOR color/${name}.ACItem` }],
  EmbeddedData: { styleType: "Pipeline", type: "Circle", geometry: { size: [0.5, 0.5], heightOffset: 0 }, materials: { tube: `Material/Colors/CORRIDOR color/${name}`, cap: "" } },
});

module.exports = { CORRIDORS };
if (require.main !== module) return;

const [files, ...rest] = process.argv.slice(2);
const dry = rest.includes("--dry");
if (!files || !existsSync(files) || !/\.files$/i.test(files)) { console.error('usage: node corridor-style-library.cjs "<model>.files" [--dry]'); process.exit(2); }
if (existsSync(files.replace(/\.files$/i, ".lock"))) { console.error("the model is open in InfraWorks (.lock): close it first"); process.exit(2); }
const S = join(files, "unver", "Content", "Styles");
let made = 0, kept = 0;
const put = (dir, name, json, hex) => {
  const f = join(S, dir, `${name}.ACItem`);
  if (existsSync(f)) { kept++; return; }
  made++;
  if (dry) return;
  mkdirSync(join(S, dir), { recursive: true });
  if (!existsSync(join(S, dir, ".keepme")) && dir.startsWith("Material")) writeFileSync(join(S, dir, ".keepme"), "keepme\r\n");
  // InfraWorks writes tab-indented JSON
  writeFileSync(f, JSON.stringify(json, null, "\t"));
  writeFileSync(join(S, dir, `${name}.png`), png(hex));
};
for (const [name, hex] of Object.values(CORRIDORS)) {
  // InfraWorks also wrote a copy under Material\CORRIDOR color; the pipe styles use only the one under
  // Material\Colors, and the user removed the other (11 Nov 2026): not written.
  put(join("Material", "Colors", "CORRIDOR color"), name, material(name, hex, `/Styles/Material/Colors/CORRIDOR color/${name}`), hex);
  put("Pipeline", name, pipeline(name), hex);
}
console.log(`${made} style file(s) ${dry ? "would be " : ""}written, ${kept} already there`);
