import { describe, it, expect } from "vitest";
import { Geometry } from "../../types.js";
import { parseGeometryOrThrow } from "../../validate.js";
import { ParseError } from "../../parse-error.js";
import { geo001, geo002, geo003, geo004, geo005, geo006, geo007 } from "../../rules/geo/index.js";
import { baseCollection, ldipProfile } from "../helpers.js";

describe("GEO rules", () => {
  it("GEO-001: wrong-depth coordinates fail Zod parse", () => {
    const bad = { type: "Polygon", coordinates: [[[1, 2]]] }; // ring too short / wrong
    expect(Geometry.safeParse(bad).success).toBe(false);
    expect(() => parseGeometryOrThrow(bad, "f")).toThrow(ParseError);
    const issues = geo001.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "bad",
            infraFeatureClass: "parcel",
            // bypass type system to simulate corrupt data
            geometry: { type: "Polygon", coordinates: [1, 2, 3] } as never,
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues.some((i) => i.code === "GEO-001")).toBe(true);
  });

  it("GEO-002: open ring → issue; closed → pass", () => {
    const open = geo002.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "p",
            infraFeatureClass: "parcel",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                ],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(open[0]?.code).toBe("GEO-002");
    const closed = geo002.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "p",
            infraFeatureClass: "parcel",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(closed).toHaveLength(0);
  });

  it("GEO-003: self-intersecting ring → issue", () => {
    const issues = geo003.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "x",
            infraFeatureClass: "parcel",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [2, 2],
                  [0, 2],
                  [2, 0],
                  [0, 0],
                ],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues[0]?.code).toBe("GEO-003");
  });

  it("GEO-004: degenerate geometry → issue", () => {
    const issues = geo004.run({
      profile: ldipProfile(),
      collection: baseCollection({
        features: [
          {
            id: "d",
            infraFeatureClass: "road_centerline",
            geometry: {
              type: "LineString",
              coordinates: [
                [1, 1],
                [1, 1],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues[0]?.code).toBe("GEO-004");
  });

  it("GEO-005: duplicate consecutive vertices → warning", () => {
    const issues = geo005.run({
      profile: ldipProfile({ tolerances: { horizontalMetres: 0.02 } }),
      collection: baseCollection({
        features: [
          {
            id: "d",
            infraFeatureClass: "road_centerline",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [0, 0],
                [1, 0],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues[0]?.code).toBe("GEO-005");
  });

  it("GEO-006: sliver below ratio → warning; skipped if unset", () => {
    expect(
      geo006.appliesWhen(ldipProfile(), { profile: ldipProfile(), collection: baseCollection() }),
    ).toBe(false);
    const profile = ldipProfile({
      tolerances: { ...ldipProfile().tolerances, sliverRatio: 0.5 },
    });
    const issues = geo006.run({
      profile,
      collection: baseCollection({
        features: [
          {
            id: "s",
            infraFeatureClass: "parcel",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [100, 0],
                  [100, 0.1],
                  [0, 0.1],
                  [0, 0],
                ],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues[0]?.code).toBe("GEO-006");
  });

  it("GEO-007: same-class overlap → warning; skipped if unset", () => {
    const profile = ldipProfile();
    const issues = geo007.run({
      profile,
      collection: baseCollection({
        features: [
          {
            id: "a",
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
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
          {
            id: "b",
            infraFeatureClass: "parcel",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [5, 5],
                  [15, 5],
                  [15, 15],
                  [5, 15],
                  [5, 5],
                ],
              ],
            },
            attributes: {},
            provenance: { sourceFile: "x.dxf" },
          },
        ],
      }),
    });
    expect(issues[0]?.code).toBe("GEO-007");
  });
});
