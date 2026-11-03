// Write every road that is in the alignments file but not yet in the model (cdnew.cjs), skipping
// roads whose PVIs need review. --dry only reports what would be written.
// Usage: node addnew.cjs <model.sqlite> <aq_road_alignments.json> <aq-road-pvis.json> <sections.json> <xfall.json> [--dry]
const fs = require("fs"), path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("child_process");
const [model, alignPath, pviPath, secPath, xfPath, ...flags] = process.argv.slice(2);
const TPL = "f501f75e-d927-4312-b06b-93cc4b55e402";
// Roads to leave out until reviewed. Empty since pvis.cjs filters the neighbouring profile's labels
// with the road's own FG line (all 250 roads consistent, 3 Nov 2026); a PVI without a level still
// stops cdnew.cjs.
const REVIEW = (process.env.REVIEW || "").split(/[ ,]+/).filter(Boolean);
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
