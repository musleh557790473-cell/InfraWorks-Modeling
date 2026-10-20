import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCadInput } from "../../dwg.js";
import { ParseError } from "../../parse-error.js";
import { validateCollection } from "../../validate.js";
import { buildPackageZip } from "../../package.js";
import { createFileStore } from "../../store.js";
import { generateDemoCollection } from "../../demo.js";
import { baseCollection, ldipProfile } from "../helpers.js";
import { ign001, ign002, ign003, ign004, ign005, ign006, ign007 } from "../../rules/ign/index.js";

const emptyDxf = `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`;

describe("IGN rules", () => {
  it("IGN-001: zero entities throws ParseError IGN_001_NO_ENTITIES", () => {
    const dir = join(tmpdir(), `ign001-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "empty.dxf");
    writeFileSync(path, emptyDxf);
    expect(() => parseCadInput(path, "empty.dxf", ldipProfile())).toThrow(ParseError);
    try {
      parseCadInput(path, "empty.dxf", ldipProfile());
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).code).toBe("IGN_001_NO_ENTITIES");
    }
  });

  it("IGN-002: __synthetic features yield blocking and no ZIP", async () => {
    const profile = ldipProfile();
    const collection = generateDemoCollection(profile);
    const report = validateCollection(collection, profile);
    expect(report.issues.some((i) => i.code === "IGN-002" && i.severity === "blocking")).toBe(true);
    const store = createFileStore(join(tmpdir(), `ign002-${Date.now()}`));
    const project = store.createProject("t", { epsg: 32638, profileId: "ldip-tawazun" });
    const built = await buildPackageZip({
      project,
      profile,
      collection,
      validation: report,
      outDir: store.artifactDir,
    });
    expect(built.refused).toBe(true);
  });

  it("IGN-003: unsupported entity types reported as warning with counts", () => {
    const ctx = {
      profile: ldipProfile(),
      collection: baseCollection(),
      parseMeta: {
        entityCountsByType: { CIRCLE: 2 },
        layerCounts: {},
        parserPath: "dxf" as const,
        unsupportedEntityCounts: { CIRCLE: 2 },
      },
    };
    const issues = ign003.run(ctx);
    expect(issues[0]?.code).toBe("IGN-003");
    expect(issues[0]?.severity).toMatch(/warning|info/);
  });

  it("IGN-004: minZ profile + all 2D with noElevationData does not block", () => {
    const issues = ign004.run({
      profile: ldipProfile(),
      collection: baseCollection({ noElevationData: true }),
      parseMeta: {
        entityCountsByType: {},
        layerCounts: {},
        parserPath: "dxf",
        hasAnyZ: false,
      },
    });
    expect(issues).toHaveLength(0);
  });

  it("IGN-004: minZ + 2D without mark → issue", () => {
    const issues = ign004.run({
      profile: ldipProfile(),
      collection: baseCollection({ noElevationData: false }),
      parseMeta: {
        entityCountsByType: {},
        layerCounts: {},
        parserPath: "dxf",
        hasAnyZ: false,
      },
    });
    expect(issues.some((i) => i.code === "IGN-004")).toBe(true);
  });

  it("IGN-005: OCS rejected entities → blocking", () => {
    const issues = ign005.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      parseMeta: {
        entityCountsByType: {},
        layerCounts: {},
        parserPath: "dxf",
        ocsRejectedCount: 3,
      },
    });
    expect(issues[0]?.severity).toBe("blocking");
  });

  it("IGN-006: non-metres INSUNITS → blocking; absent → warning", () => {
    const blocking = ign006.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      parseMeta: { entityCountsByType: {}, layerCounts: {}, parserPath: "dxf", insunits: 4 },
    });
    expect(blocking[0]?.severity).toBe("blocking");
    const warn = ign006.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      parseMeta: { entityCountsByType: {}, layerCounts: {}, parserPath: "dxf", insunits: null },
    });
    expect(warn[0]?.severity).toBe("warning");
  });

  it("IGN-007: parse meta recorded as info", () => {
    const issues = ign007.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      parseMeta: {
        entityCountsByType: { LINE: 1 },
        layerCounts: { ROADS: 1 },
        parserPath: "dxf",
      },
    });
    expect(issues[0]?.severity).toBe("info");
    expect(issues[0]?.details).toMatchObject({ parserPath: "dxf" });
  });

  it("ign001 appliesWhen always true", () => {
    expect(ign001.appliesWhen(ldipProfile(), { profile: ldipProfile(), collection: baseCollection() })).toBe(true);
    expect(ign002.id).toBe("IGN-002");
  });
});
