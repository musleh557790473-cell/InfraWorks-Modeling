import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { shapefileOf, staleMappings } from "../src/gate.js";
import type { DataSourceRow } from "../src/read.js";

/** A .dbf header with these character fields and no records. */
function dbf(fields: string[]): Buffer {
  const headerLen = 32 + fields.length * 32 + 1;
  const b = Buffer.alloc(headerLen + 1);
  b[0] = 3;
  b.writeUInt32LE(0, 4);
  b.writeUInt16LE(headerLen, 8);
  b.writeUInt16LE(1 + fields.length * 10, 10);
  fields.forEach((f, i) => {
    b.write(f, 32 + i * 32, "latin1");
    b[32 + i * 32 + 11] = 0x43; // C
    b[32 + i * 32 + 16] = 10;
  });
  b[headerLen - 1] = 0x0d;
  b[headerLen] = 0x1a;
  return b;
}

const source = (shp: string, mappings: Record<string, string>): DataSourceRow =>
  ({
    ID: 1,
    GUID: "g",
    NAME: "storm_pipes",
    CONNECTION_STRING: `DefaultFileLocation="${shp}";`,
    TARGET_CLASS_NAME: "PIPELINES",
    SOURCE_CS: null,
    CONFIG: JSON.stringify({ propertyMappings: Object.fromEntries(Object.entries(mappings).map(([c, e]) => [c, { expression: e }])) }),
  }) as unknown as DataSourceRow;

test("G3-013 a source that reads an older export without the mapped fields is caught; the right one passes", () => {
  // Al Qairawan: imported from shp-v2, then model:names filled depths from the v3 package.
  const dir = mkdtempSync(join(tmpdir(), "iw-refresh-"));
  const v2 = join(dir, "v2_storm_pipes.shp");
  const v3 = join(dir, "v3_storm_pipes.shp");
  writeFileSync(v2.replace(/\.shp$/, ".dbf"), dbf(["NETWORK", "SIZE_M"]));
  writeFileSync(v3.replace(/\.shp$/, ".dbf"), dbf(["NETWORK", "SIZE_M", "MATERIAL", "OFF_START_", "OFF_END_M"]));
  const maps = { NETWORKNAME: "NETWORK", SIZE_X: "SIZE_M", PIPE_MATERIAL: "MATERIAL", ELEV_FROM: "OFF_START_", ELEV_TO: "OFF_END_M", EXTERNAL_ID: "FeatId" };

  assert.equal(shapefileOf(`DefaultFileLocation="${v2}";`), v2);
  const stale = staleMappings(source(v2, maps));
  // FeatId is InfraWorks' own record number, not a .dbf field: never reported.
  assert.deepEqual(stale, { file: v2, fields: ["MATERIAL", "OFF_START_", "OFF_END_M"], columns: ["PIPE_MATERIAL", "ELEV_FROM", "ELEV_TO"] });
  assert.equal(staleMappings(source(v3, maps)), null);
  // A file not on this machine (the other laptop's path) says nothing.
  assert.equal(staleMappings(source(join(dir, "gone.shp"), maps)), null);
});
