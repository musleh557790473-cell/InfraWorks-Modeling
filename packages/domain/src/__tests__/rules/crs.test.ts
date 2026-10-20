import { describe, it, expect } from "vitest";
import { crs001, crs002, crs003, crs004, crs005, crs006 } from "../../rules/crs/index.js";
import { runRules } from "../../rules/registry.js";
import { baseCollection, ldipProfile, genericProfile } from "../helpers.js";

describe("CRS rules", () => {
  it("CRS-001: missing EPSG → blocking", () => {
    const issues = crs001.run({
      profile: genericProfile({ crs: { epsg: 0, name: "UNDECLARED", infraWorksCrsHint: "UNDECLARED" } }),
      collection: baseCollection({ crs: { epsg: 0, name: "UNDECLARED" } }),
    });
    expect(issues[0]?.code).toBe("CRS-001");
    expect(issues[0]?.severity).toBe("blocking");
  });

  it("CRS-002: coordinate outside UTM envelope → blocking", () => {
    const issues = crs002.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "bad",
            infraFeatureClass: "road_centerline",
            geometry: { type: "Point", coordinates: [50, 50] },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues[0]?.code).toBe("CRS-002");
  });

  it("CRS-003: outside siteEnvelopes listed; skipped if none", () => {
    const withEnv = crs003.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "far",
            infraFeatureClass: "parcel",
            geometry: { type: "Point", coordinates: [700000, 2800000] },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(withEnv[0]?.code).toBe("CRS-003");
    expect(crs003.appliesWhen(genericProfile(), { profile: genericProfile(), collection: baseCollection() })).toBe(
      false,
    );
  });

  it("CRS-004: uniform displacement vs reference → blocking with ΔE ΔN spread n", () => {
    const profile = ldipProfile();
    const issues = crs004.run({
      profile,
      collection: baseCollection({
        features: [
          {
            id: "a",
            infraFeatureClass: "road_centerline",
            geometry: { type: "Point", coordinates: [663801, 2756700] },
            attributes: { asset_id: "CP1" },
            provenance: { sourceFile: "x.dxf", sourceEntityId: "CP1" },
          },
          {
            id: "b",
            infraFeatureClass: "road_centerline",
            geometry: { type: "Point", coordinates: [663901, 2756800] },
            attributes: { asset_id: "CP2" },
            provenance: { sourceFile: "x.dxf", sourceEntityId: "CP2" },
          },
        ],
      }),
      reference: {
        kind: "controlPoints",
        points: [
          { id: "CP1", e: 663800, n: 2756700 },
          { id: "CP2", e: 663900, n: 2756800 },
        ],
      },
    });
    expect(issues[0]?.code).toBe("CRS-004");
    expect(issues[0]?.details).toMatchObject({ sampleSize: 2 });
    expect(String(issues[0]?.message)).toMatch(/ΔE=/);
  });

  it("CRS-005: undeclared non-zero transform → blocking", () => {
    const issues = crs005.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      transforms: [{ offsetE: 10, declaredInProfile: false, writtenToManifest: false }],
    });
    expect(issues[0]?.severity).toBe("blocking");
  });

  it("CRS-006: Z outside envelope → warning; skipped without Z bounds", () => {
    const issues = crs006.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "z",
            infraFeatureClass: "annotation",
            geometry: { type: "Point", coordinates: [663800, 2756700, 900] },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
        noElevationData: false,
      }),
    });
    expect(issues[0]?.code).toBe("CRS-006");
    expect(crs006.appliesWhen(genericProfile(), { profile: genericProfile(), collection: baseCollection() })).toBe(
      false,
    );
  });

  it("generic profile lists Group D as skipped", () => {
    const result = runRules({
      profile: genericProfile(),
      collection: baseCollection(),
    });
    const skippedIds = result.skipped.map((s) => s.id);
    expect(skippedIds).toEqual(expect.arrayContaining(["REC-001", "REC-003", "REC-004"]));
  });
});
