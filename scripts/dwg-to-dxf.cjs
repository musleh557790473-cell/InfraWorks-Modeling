/**
 * Convert Civil 3D sheets (DWG) to DXF without opening AutoCAD, the way the readers need them:
 * AUDIT (fix), EXPORTTOAUTOCAD (Civil 3D objects to plain AutoCAD, xrefs bound as Insert), DXFOUT.
 * A plain DXFOUT of a Civil 3D drawing leaves a DXF that stops at the Civil 3D objects (DXF_TRUNCATED).
 *
 *   node scripts/dwg-to-dxf.cjs <folder of DWGs> <out folder> [name filter regex]
 *
 * Needs AutoCAD (accoreconsole.exe; ACCORECONSOLE overrides the path) and, for Civil 3D drawings,
 * the Civil 3D Object Enabler. Keep both folders on short paths outside OneDrive (copy the
 * submission with robocopy first: its OneDrive paths exceed 260 characters). The sources are only
 * read: each DWG is copied to a work folder first. Writes <out>\<relative folder>\<name>.dxf and
 * <name>.log; skips DXFs that already exist. (A .ps1 would be simpler, but company policy blocks
 * PowerShell scripts.)
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [src, out, filter] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: node scripts/dwg-to-dxf.cjs <folder of DWGs> <out folder> [name filter regex]");
  process.exit(2);
}
const acad = process.env.ACCORECONSOLE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2026\\accoreconsole.exe";
if (!fs.existsSync(acad)) throw new Error(`accoreconsole not found: ${acad}`);
// Extra accoreconsole arguments, e.g. ACCORECONSOLE_ARGS="/product C3D" to run as Civil 3D.
const extra = (process.env.ACCORECONSOLE_ARGS ?? "").split(/\s+/).filter(Boolean);
const TIMEOUT_MS = 15 * 60 * 1000;
const re = filter ? new RegExp(filter, "i") : null;

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : /\.dwg$/i.test(e.name) && (!re || re.test(e.name)) ? [p] : [];
  });
const root = path.resolve(src);
const files = walk(root);
const work = path.join(out, "_work");
fs.mkdirSync(work, { recursive: true });
const w = (n) => path.join(work, n);

const core = (dwg, scr, log) => {
  const r = spawnSync(acad, ["/i", dwg, "/s", scr, "/l", "en-US", ...extra], { cwd: work, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 28 }); // acad.err lands in cwd
  fs.writeFileSync(log, (r.stdout ?? Buffer.alloc(0)).toString("utf16le").replace(/\0/g, ""));
  return !r.error;
};
const tail = (f) => {
  const b = fs.readFileSync(f);
  return b.subarray(Math.max(0, b.length - 32)).toString("latin1").trim().split(/\s+/).pop();
};

let n = 0, failed = 0;
for (const f of files) {
  n++;
  const rel = path.relative(root, path.dirname(f));
  const base = path.basename(f, path.extname(f)).trim();
  const dir = path.join(out, rel);
  fs.mkdirSync(dir, { recursive: true });
  const dxf = path.join(dir, `${base}.dxf`);
  const tag = `[${n}/${files.length}] ${path.join(rel, base)}`;
  if (fs.existsSync(dxf)) { console.log(`${tag}  skip (exists)`); continue; }

  for (const x of ["in.dwg", "acad.dwg", "out.dxf"]) fs.rmSync(w(x), { force: true });
  fs.copyFileSync(f, w("in.dwg"));
  // -EXPORTTOAUTOCAD: Enter accepts the options (2018, bind xrefs as Insert), then the file name.
  fs.writeFileSync(w("exp.scr"), `FILEDIA 0\r\nAUDIT Y\r\n-EXPORTTOAUTOCAD\r\n\r\n${w("acad.dwg")}\r\nQUIT Y\r\n`, "ascii");
  // DXFOUT: file name, then Enter for 16 decimals, ASCII, current version.
  fs.writeFileSync(w("dxf.scr"), `FILEDIA 0\r\nDXFOUT\r\n${w("out.dxf")}\r\n\r\nQUIT Y\r\n`, "ascii");

  let ok = core(w("in.dwg"), w("exp.scr"), w("exp.log")) && fs.existsSync(w("acad.dwg"));
  let how = "";
  if (ok) ok = core(w("acad.dwg"), w("dxf.scr"), w("dxf.log"));
  else {
    // EXPORTTOAUTOCAD crashes accoreconsole on some sheets (Access Violation 0x01f0 while loading the
    // AECC modules; Al Narjis cut sheets 10001/10002, 9 Nov 2026). Fall back to AUDIT + DXFOUT of the
    // sheet itself: complete when the content comes from bound xrefs of plain AutoCAD objects.
    fs.writeFileSync(w("dxf.scr"), `FILEDIA 0\r\nAUDIT Y\r\nDXFOUT\r\n${w("out.dxf")}\r\n\r\nQUIT Y\r\n`, "ascii");
    ok = core(w("in.dwg"), w("dxf.scr"), w("dxf.log"));
    how = "  DIRECT DXFOUT (EXPORTTOAUTOCAD crashed: Civil 3D objects stay as custom objects)";
  }
  const log = [w("exp.log"), w("dxf.log")].filter((x) => fs.existsSync(x)).map((x) => fs.readFileSync(x, "utf8")).join("\n");
  fs.writeFileSync(path.join(dir, `${base}.log`), log);
  const audit = log.match(/Total errors found \d+ fixed \d+/)?.[0] ?? "";
  if (ok && fs.existsSync(w("out.dxf")) && tail(w("out.dxf")) === "EOF") {
    fs.renameSync(w("out.dxf"), dxf);
    console.log(`${tag}  ok  ${(fs.statSync(dxf).size / 2 ** 20).toFixed(1)} MB  ${audit}${how}`);
  } else {
    failed++;
    console.log(`${tag}  FAIL (see ${base}.log)`);
  }
  for (const x of ["exp.log", "dxf.log"]) fs.rmSync(w(x), { force: true });
}
// accoreconsole may still hold a file in the work folder (EPERM, Namar 11 Nov 2026): the DXFs are
// written by then, so leave the folder and say so rather than fail the run.
try {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 2000 });
} catch (e) {
  console.log(`work folder ${work} left in place (${e.code ?? e.message}); delete it later`);
}
console.log(`${files.length - failed} of ${files.length} converted or present, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
