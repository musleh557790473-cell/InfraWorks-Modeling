/**
 * A designer's TIN surface to LandXML, when Civil 3D's Export to LandXML (a dialog) cannot run headless:
 *   pnpm surface:landxml <surface.dxf | surface.ifc> <out.xml> --name "<surface name>" [--source "<note>"] [--epsg 32638]
 * DXF: the 3DFACEs EXPORTTOAUTOCAD writes for the surface (scripts/dwg-to-dxf.cjs on the surface DWG).
 * IFC: Civil 3D's export of the surface as a thin solid; only its up-facing faces are kept, and the
 * run stops if they overlap in plan (some IFCs carry extra faces: use the DXF route then).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { planOverlapM2, readDxfFaces, readIfcFaces, splitByFacing, toLandXml } from "@infraworks/domain";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const [src, out] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const name = flag("--name");
if (!src || !out || !name) {
  console.error('usage: pnpm surface:landxml <surface.dxf|surface.ifc> <out.xml> --name "<surface>" [--source "<note>"] [--epsg 32638]');
  process.exit(2);
}
const text = readFileSync(src, "latin1");
const isIfc = /\.ifc$/i.test(src);
let tris = isIfc ? readIfcFaces(text) : readDxfFaces(text);
console.log(`${basename(src)}: ${tris.length} faces read`);
if (isIfc) {
  const g = splitByFacing(tris);
  console.log(`up ${g.up.length}, down ${g.down.length}, vertical ${g.vertical.length}: keeping the up faces`);
  tris = g.up;
}
const overlap = planOverlapM2(tris);
console.log(`plan overlap ${overlap.toFixed(0)} m2`);
if (overlap > 100) {
  console.error("faces overlap in plan: not a single TIN (an IFC with extra faces?); use the DXF route");
  process.exit(1);
}
const r = toLandXml(tris, { surface: name, source: flag("--source") ?? basename(src), epsg: Number(flag("--epsg") ?? 32638) });
writeFileSync(out, r.xml);
console.log(`wrote ${out}: ${r.points} points, ${r.faces} faces`);
