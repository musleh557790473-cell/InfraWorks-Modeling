import { describe, it, expect } from "vitest";
import { rec001, rec002, rec003, rec004, rec005 } from "../../rules/rec/index.js";
import { baseCollection, ldipProfile, genericProfile } from "../helpers.js";

describe("REC rules", () => {
  it("REC-001: count mismatch → warning with source", () => {
    const issues = rec001.run({
      profile: ldipProfile(),
      collection: baseCollection(),
    });
    expect(issues.some((i) => i.code === "REC-001")).toBe(true);
    expect(String(issues[0]?.message)).toMatch(/source:/);
  });

  it("REC-002: zero joins with rows → blocking; partial → warning", () => {
    const zero = rec002.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      joinStats: { joinedCount: 0, reportRowCount: 5 },
    });
    expect(zero[0]?.severity).toBe("blocking");
    const partial = rec002.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      joinStats: { joinedCount: 2, reportRowCount: 5 },
    });
    expect(partial[0]?.severity).toBe("warning");
  });

  it("REC-003: skipped without reference; runs with geojson reference", () => {
    expect(
      rec003.appliesWhen(genericProfile(), {
        profile: genericProfile(),
        collection: baseCollection(),
      }),
    ).toBe(false);
    const issues = rec003.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "p1",
            infraFeatureClass: "parcel",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 10],
                  [0, 0],
                ],
              ],
            },
            attributes: { asset_id: "p1" },
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
      reference: {
        kind: "geojson",
        features: [
          {
            id: "p1",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [100, 0],
                  [100, 100],
                  [0, 100],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      },
    });
    expect(issues[0]?.code).toBe("REC-003");
  });

  it("REC-004: reports margin per side", () => {
    const issues = rec004.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "f",
            infraFeatureClass: "coverage",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [663800, 2756700],
                  [663810, 2756700],
                  [663810, 2756710],
                  [663800, 2756710],
                  [663800, 2756700],
                ],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
      boundaryRing: [
        [663805, 2756705],
        [663806, 2756705],
        [663806, 2756706],
        [663805, 2756706],
        [663805, 2756705],
      ],
    });
    expect(issues[0]?.code).toBe("REC-004");
    expect(issues[0]?.details).toHaveProperty("marginsPerSide");
  });

  it("REC-005: empty sourceFile → blocking", () => {
    const issues = rec005.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "x",
            infraFeatureClass: "annotation",
            geometry: { type: "Point", coordinates: [663800, 2756700] },
            attributes: {},
            provenance: { sourceFile: "" },
          },
        ],
      }),
    });
    expect(issues[0]?.severity).toBe("blocking");
  });
});
