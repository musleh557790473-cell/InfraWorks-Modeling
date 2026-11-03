// Write every road that is in the alignments file but not yet in the model (cdnew.cjs), skipping
// roads whose PVIs need review. --dry only reports what would be written.
// Usage: node addnew.cjs <model.sqlite> <aq_road_alignments.json> <aq-road-pvis.json> <sections.json> <xfall.json> [--dry]
const fs = require("fs"), path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("child_process");
const [model, alignPath, pviPath, secPath, xfPath, ...flags] = process.argv.slice(2);
const TPL = "f501f75e-d927-4312-b06b-93cc4b55e402";
// PVI labels that do not agree with each other (pvis.cjs): left out until reviewed
const REVIEW = "R.6.G.11 R.0.C.1 R.0.C.4 R.0.D.4 R.1.G.3 R.1.G.12 R.2.F.5 R.3.G.6 R.3.G.8 R.14.E.2 R.14.F.3 R.14.G.11 R.14.G.15 R.4.G.9 R.5.G.8 R.7.G.8 R.9.E.1 R.10.G.4 R.12.G.4 R.13.E.2 R.11.G.6".split(" ");
const db = new DatabaseSync(model, { readOnly: true });
const have = new Set(db.prepare("select NAME from ROADS").all().map((r) => r.NAME)); db.close();
const todo = JSON.parse(fs.readFileSync(alignPath, "utf8")).map((r) => r.name).filter((n) => !have.has(n));
const res = { written: [], review: [], failed: [] };
for (const n of todo) {
  if (REVIEW.includes(n)) { res.review.push(n); continue; }
  const r = spawnSync(process.execPath, [path.join(__dirname, "cdnew.cjs"), model, TPL, n, alignPath, pviPath, "--sections", secPath, "--xfall", xfPath, ...(flags.includes("--dry") ? ["--dry"] : [])], { encoding: "utf8" });
  if (r.status !== 0) res.failed.push(`${n}: ${((r.stderr || "").split("\n").find((l) => /Error/.test(l)) || "").replace(/^.*Error: /, "")}`);
  else res.written.push(n);
}
console.log(`${flags.includes("--dry") ? "would write" : "written"} ${res.written.length}: ${res.written.join(" ")}`);
console.log(`PVI review, left out ${res.review.length}: ${res.review.join(" ")}`);
console.log(`failed ${res.failed.length}:`); res.failed.forEach((l) => console.log("  ", l));
