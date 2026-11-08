// Fingerprint the road / junction tables of an InfraWorks model (read-only), to prove they did not change.
// Usage: node roadprint.cjs <model.sqlite>
// Prints rows and a SHA-256 prefix per table (ROADS, CONSTRAINED_DEFINITIONS, INTERSECTIONS, arms,
// regions, ROUNDABOUTS, TERRAIN_SURFACES) and for junctions 9 and 41. Run before and after an import:
// equal hashes = the import did not touch the roads (session 10, utilities into the roads model).
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
const tables = ["ROADS", "CONSTRAINED_DEFINITIONS", "INTERSECTIONS", "INTERSECTION_ARMS", "INTERSECTION_REGIONS", "ROUNDABOUTS", "TERRAIN_SURFACES"].filter((t) => have.has(t));
const ser = (v) => (v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v);
for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY ID`).all();
  const h = createHash("sha256");
  for (const r of rows) h.update(JSON.stringify(Object.entries(r).map(([k, v]) => [k, ser(v)])));
  console.log(`${t.padEnd(24)} rows=${String(rows.length).padStart(5)} sha=${h.digest("hex").slice(0, 16)}`);
}
for (const id of [9, 41]) {
  const r = db.prepare("SELECT * FROM INTERSECTIONS WHERE ID = ?").get(id);
  const h = createHash("sha256").update(JSON.stringify(Object.entries(r ?? {}).map(([k, v]) => [k, ser(v)]))).digest("hex").slice(0, 16);
  console.log(`junction ${id}: ${r ? "present" : "MISSING"} sha=${h}`);
}
const ra = have.has("ROUNDABOUTS") ? db.prepare("SELECT COUNT(*) n FROM ROUNDABOUTS").get().n : 0;
const cr = db.prepare("SELECT COUNT(*) n FROM ROADS WHERE FK_PARENT_TABLE = 'CONSTRAINED_DEFINITIONS'").get().n;
console.log(`component roads=${cr} roundabouts=${ra}`);
