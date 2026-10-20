# Validation Rules Specification

**Status:** Draft for implementation · **Version:** 0.1.0 · **Date:** 2026-10-20

This document specifies the validation layer for `@infraworks/domain`. It is the agreed
source of truth for `packages/domain/src/validate.ts` and the profile system it depends on.

---

## 0. How to use this document

**For the implementing agent (Cursor):**

1. Read this file in full before writing any code.
2. Produce an **implementation plan** first — file list, new modules, signature changes,
   test list. Do not write code until that plan is approved.
3. Implement rule by rule. Every rule gets **one function and at least one test**.
4. Where this document says `[DECISION PENDING]`, **stop and ask**. Do not choose a value,
   do not infer one from the existing code, and do not leave a `TODO` with a guess in it.
5. Never introduce a numeric constant that is not either (a) defined in a profile, or
   (b) traceable to a numbered rule in this document. A bare `const TOLERANCE = 0.05`
   is a review failure regardless of whether the value is correct.

---

## 1. Product principle — the core is project-agnostic

This repository is a **general-purpose product** for turning 2D CAD plus tabular reports
into an InfraWorks-ready import package. It is not a project-specific tool.

Therefore:

| Layer | Knows about |
|---|---|
| `packages/domain` core | Geometry, CAD parsing, CRS mathematics, packaging. **No project constants.** |
| Profiles | One project's CRS, envelopes, tolerances, layer mappings, expected counts |
| Fixtures | Real-world sample data used to prove the product works |

**Current violation to fix.** `packages/domain/src/types.ts` hardcodes
`DEFAULT_EPSG = 32638`, `INFRAWORKS_CRS_HINT = "UTM84-38N"` and a
`DEFAULT_MAPPING_PROFILE` named `"LDIP / Al Narjis default"`. These are one project's
values sitting in the core. They move to a profile (§2). The core shall have **no default
EPSG at all** — a project without a declared CRS is an error, not a case for a default.

---

## 2. Profile system

### 2.1 Schema

Create `packages/domain/src/profile.ts`:

```ts
export const SiteEnvelope = z.object({
  id: z.string(),                 // e.g. "site-a"
  name: z.string(),
  minE: z.number(), maxE: z.number(),
  minN: z.number(), maxN: z.number(),
  minZ: z.number().optional(), maxZ: z.number().optional(),
});

export const ExpectedCount = z.object({
  datasetId: z.string(),          // e.g. "residential-plots"
  infraFeatureClass: InfraFeatureClass,
  expected: z.number().int(),
  source: z.string(),             // where the number came from — required, free text
});

export const ProjectProfile = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string(),
  name: z.string(),

  crs: z.object({
    epsg: z.number().int(),
    name: z.string(),
    infraWorksCrsHint: z.string(),
    verticalDatum: z.string().optional(),
  }),

  siteEnvelopes: z.array(SiteEnvelope).default([]),

  tolerances: z.object({
    horizontalMetres: z.number().optional(),      // cadastral / registration tolerance
    boundaryBufferMetres: z.number().optional(),  // required data extent beyond boundary
    translationDetectMetres: z.number().optional(),
    translationSpreadMetres: z.number().optional(),
    sliverRatio: z.number().optional(),
  }).default({}),

  expectedCounts: z.array(ExpectedCount).default([]),
  layers: z.array(LayerMapping),
  reportJoins: z.array(ReportJoin).default([]),

  rules: z.record(z.object({
    enabled: z.boolean().default(true),
    severity: z.enum(["blocking", "warning", "info"]).optional(),
  })).default({}),
});
```

### 2.2 Shipped profiles

| File | Purpose |
|---|---|
| `profiles/generic.ts` | No site envelopes, no expected counts, no cadastral tolerance. Structural rules only (§4 groups A, B partial, C, E). This is what an unknown project gets. |
| `profiles/ldip.ts` | One worked example, used by the fixture suite. Not special-cased anywhere in the core. |

### 2.3 The LDIP example profile

Supplied as a **fixture profile**, to prove the schema carries a real project. These values
come from the AICC JV survey control register for the LDIP / Tawazun programme.

```ts
export const LDIP_PROFILE: ProjectProfile = {
  schemaVersion: "1.0.0",
  id: "ldip-tawazun",
  name: "LDIP / Tawazun — example profile",
  crs: {
    epsg: 32638,
    name: "WGS 84 / UTM zone 38N",
    infraWorksCrsHint: "UTM84-38N",
    verticalDatum: "Riyadh Amanah Datum / MSL",
  },
  siteEnvelopes: [
    { id: "nrjs", name: "Al Narjis",
      minE: 663_700, maxE: 664_200, minN: 2_756_600, maxN: 2_757_300,
      minZ: 640, maxZ: 700 },
    { id: "nmar", name: "Dahiyat Namar",
      minE: 655_000, maxE: 658_500, minN: 2_712_000, maxN: 2_715_000,
      minZ: 660, maxZ: 790 },
  ],
  tolerances: {
    horizontalMetres: 0.02,          // REGA plot registration
    boundaryBufferMetres: 25,
    translationDetectMetres: 0.50,
    translationSpreadMetres: 0.05,
    sliverRatio: 0.02,               // [DECISION PENDING — see §6.3]
  },
  expectedCounts: [
    { datasetId: "nrjs-plots", infraFeatureClass: "parcel", expected: 117,
      source: "DLUS.csv — Al Narjis" },
    { datasetId: "nmar-plots", infraFeatureClass: "parcel", expected: 765,
      source: "DLUS.csv — Dahiyat Namar" },
  ],
  layers: [ /* as current DEFAULT_MAPPING_PROFILE */ ],
  reportJoins: [ /* as current */ ],
  rules: {},
};
```

> **Note — profile values are evidence, not configuration.** Every `siteEnvelope`,
> `expectedCount` and tolerance in a real profile traces to an issued document. The
> `source` field on `ExpectedCount` is required for that reason. Envelopes should carry
> the same; add `source: z.string()` to `SiteEnvelope`.

---

## 3. Severity and status model

| Severity | Meaning | Effect |
|---|---|---|
| `blocking` | The package would misrepresent the source data | **Build refuses.** No ZIP produced. |
| `warning` | Package is usable but something needs a human decision | Build proceeds, issue recorded |
| `info` | Observation worth recording | Build proceeds |

Two rules on severity:

1. A profile may **raise** a severity (`warning` → `blocking`) but may **never lower**
   a rule marked `minimumSeverity: blocking` in §4. Those are product integrity rules.
2. `ValidationReport.ok === true` requires `blockingCount === 0`. A build that produced a
   ZIP while `ok === false` is a bug.

---

## 4. Rules

Rule IDs are stable. Never renumber. Deprecate instead.

### Group A — Ingest integrity (`IGN`)

These exist because the current parser can silently substitute invented geometry for real
input. That is the highest-severity class of defect this product can have: it produces a
package that looks authoritative and is fiction.

| ID | Rule | Severity | Min |
|---|---|---|---|
| **IGN-001** | A parser shall never substitute synthetic geometry when parsing a user-supplied file. On zero parsed entities it throws `ParseError("IGN_001_NO_ENTITIES")`. | blocking | blocking |
| **IGN-002** | Any feature generated by a demo or stub path carries `attributes.__synthetic === true`. The packager refuses any collection containing one. | blocking | blocking |
| **IGN-003** | Entity types encountered but not parsed are counted by type and reported. Non-zero → warning naming the types and counts. | warning | info |
| **IGN-004** | If the profile declares `siteEnvelopes[].minZ`, at least one parsed entity shall carry a Z value. Zero → blocking. | blocking | warning |
| **IGN-005** | Entities whose extrusion direction (DXF 210/220/230) is not `(0,0,1)` shall be transformed OCS → WCS. If the transform is not implemented for that entity type, the entity is **rejected**, not passed through untransformed. | blocking | blocking |
| **IGN-006** | Drawing units (`$INSUNITS`) shall be read. If present and not metres, blocking. If absent, warning. | blocking | warning |
| **IGN-007** | Parse results record, per source file: entity count by type, layer list with counts, and the parser path taken (`dxf`, `dwg`, `demo`). | info | info |

**IGN-001 implementation note.** The demo generator stays in the repo — it is useful for
the fixture suite and for a first-run experience. It moves behind an explicit entry point
(`generateDemoCollection(profile)`) that is reachable only from `scripts/` and from code
guarded by `DEMO_MODE=1`. It is never reachable from the upload path.

### Group B — Coordinate integrity (`CRS`)

| ID | Rule | Severity | Min |
|---|---|---|---|
| **CRS-001** | The project declares an EPSG code and it resolves to a known projected CRS. Unresolvable or absent → blocking. There is no default. | blocking | blocking |
| **CRS-002** | All coordinates fall inside the declared projection's valid envelope. For UTM: `E ∈ [100000, 900000]`, `N ∈ [0, 10000000]`. Outside → blocking. | blocking | blocking |
| **CRS-003** | If the profile defines `siteEnvelopes`, every feature falls inside at least one. Features outside are counted and listed. | warning | info |
| **CRS-004** | **Translation detection.** Where a reference dataset is available, compute the offset vector of each matched vertex. If the standard deviation of the offset vectors is below `translationSpreadMetres` and the mean magnitude exceeds `translationDetectMetres`, the dataset is uniformly displaced. Report ΔE, ΔN, the spread, and the sample size. | blocking | blocking |
| **CRS-005** | Any offset, rotation or scale applied during ingest is zero, or is explicitly declared in the profile and written into `manifest.json`. An undeclared non-zero transform → blocking. | blocking | blocking |
| **CRS-006** | Z values, where present, fall inside `siteEnvelopes[].minZ..maxZ` when defined. Outside → warning with the measured range. | warning | info |

**CRS-004 is the rule that matters most in practice.** A uniform displacement is not a
survey error — it is a base-point or source-CRS error, and it is invisible to every other
check because the geometry is internally perfect. The signature is a near-zero spread with
a large mean. Report all three numbers; a magnitude alone is not evidence.

`[DECISION PENDING — see §6.1]` on where the reference dataset comes from.

### Group C — Geometry integrity (`GEO`)

| ID | Rule | Severity | Min |
|---|---|---|---|
| **GEO-001** | Replace `Geometry.coordinates: z.any()` with discriminated schemas per geometry type, so an array of the wrong depth fails at parse. | blocking | blocking |
| **GEO-002** | Polygon rings are closed (first vertex equals last, exactly). | blocking | warning |
| **GEO-003** | No ring self-intersects. | blocking | warning |
| **GEO-004** | No degenerate features: LineString with < 2 distinct vertices, Polygon with < 4 ring vertices, zero-area polygon, zero-length line. | blocking | warning |
| **GEO-005** | No duplicate consecutive vertices beyond a coincidence threshold. Threshold = `tolerances.horizontalMetres` if set, else `1e-6`. | warning | info |
| **GEO-006** | Sliver detection: polygons whose `4π·area / perimeter²` falls below `tolerances.sliverRatio`. Skipped when the tolerance is unset. | warning | info |
| **GEO-007** | Polygons of the same feature class do not overlap beyond `tolerances.horizontalMetres`. Skipped when unset. | warning | info |

### Group D — Dataset reconciliation (`REC`)

Every rule in this group is **skipped silently** when the profile does not supply its
parameter. A generic project runs none of them. Skipped rules are listed in the report so
the reader knows what was not checked.

| ID | Rule | Severity | Min |
|---|---|---|---|
| **REC-001** | Feature count per `expectedCounts[]` entry matches. Mismatch reports both numbers and the `source` string. | warning | info |
| **REC-002** | Report join completeness. Zero joined with rows present → blocking. Partial → warning with the ratio. (Existing behaviour; keep the codes.) | blocking | warning |
| **REC-003** | Where an external reference dataset is supplied, per-feature area or dimension agrees within `tolerances.horizontalMetres`. | warning | info |
| **REC-004** | **Boundary buffer.** Where a boundary feature and `boundaryBufferMetres` are both present, every other dataset extends at least that distance beyond the boundary on all sides. Report the achieved margin per side. | warning | info |
| **REC-005** | Every feature carries a non-empty `provenance.sourceFile`. | blocking | blocking |

**REC-004 note.** Report the margin per side, not a pass/fail. A margin of 3.6 m against a
25 m requirement and a margin of 24.9 m are both failures, and the reader needs to see
which one they have.

### Group E — Package integrity (`PKG`)

| ID | Rule | Severity | Min |
|---|---|---|---|
| **PKG-001** | `manifest.notForIssue === true` always. No configuration path sets it false. | blocking | blocking |
| **PKG-002** | Every file listed in `manifest.files` exists in the ZIP, and every file in the ZIP is listed. | blocking | blocking |
| **PKG-003** | The validation report is embedded in the package and references the same `generatedAt` as the manifest. | blocking | blocking |
| **PKG-004** | The build refuses to produce a ZIP when `blockingCount > 0`. It writes the validation report alone, so the user can see why. | blocking | blocking |
| **PKG-005** | The manifest records the profile `id` and `schemaVersion` used. | blocking | warning |

---

## 5. Required code changes

| # | Change | Files |
|---|---|---|
| 1 | Remove `DEFAULT_EPSG`, `INFRAWORKS_CRS_HINT`, `DEFAULT_MAPPING_PROFILE` from the core | `types.ts` |
| 2 | Add the profile schema and loader | `profile.ts` (new) |
| 3 | Add `profiles/generic.ts`, `profiles/ldip.ts` | new |
| 4 | Discriminated geometry schemas | `types.ts` |
| 5 | Remove the synthetic fallback; add `ParseError`; move the demo generator behind `DEMO_MODE` | `dwg.ts` |
| 6 | Rewrite `validateCollection` as a rule-registry interpreter over the profile | `validate.ts` |
| 7 | Refuse to build on blocking issues | `package.ts`, `pipeline.ts` |
| 8 | Carry the profile through the API, worker and MCP surfaces | `apps/*` |
| 9 | Add `vitest` and a test per rule | all |

**Rule registry shape.** `validate.ts` becomes a list of rule objects
`{ id, group, minimumSeverity, appliesWhen(profile), run(ctx) }`, iterated in ID order.
Adding a rule is adding one entry and one test, with no edit to the orchestrator. Rules
that `appliesWhen` returns false for are recorded as skipped, not omitted.

---

## 6. Decisions pending — do not guess

### 6.1 Reference dataset for CRS-004
Translation detection needs something to compare against. Options: (a) a reference
GeoJSON supplied with the profile; (b) a second upload tagged as reference; (c) a
control-point list in the profile with matching IDs in the CAD. **Which?**

### 6.2 Behaviour when no profile is supplied
Does the API reject the build, or fall back to `profiles/generic.ts` with a warning?
**Reject is the safer default — confirm.**

### 6.3 Sliver ratio
`0.02` in the LDIP example above is a placeholder with no source. **What is the real
threshold, and from which standard?**

### 6.4 Binary DWG path
IGN-001 makes binary DWG unusable until a real parser exists, because the stub is the
only thing that currently handles it. Options: (a) ODA File Converter as a local
dependency; (b) APS Design Automation for AutoCAD; (c) reject binary DWG with a clear
message until one of those lands. **Which, and on what timescale?**

### 6.5 Z-value policy for 2D sources
When the profile requires elevations (IGN-004) and the CAD is genuinely 2D, is that a
blocking error, or does the product accept a 2D package and mark it as having no
elevation data? This decides whether the product serves 2D-only workflows at all.

---

## 7. Acceptance criteria

The implementation is complete when:

1. Every rule in §4 has a function and at least one passing test.
2. A DXF containing no supported entities produces a `ParseError`, not a package.
3. A deliberately displaced fixture is detected by CRS-004, with ΔE, ΔN, spread and
   sample size in the report.
4. Running the pipeline with `profiles/generic.ts` produces a package with all Group D
   rules listed as skipped.
5. A collection containing one `__synthetic` feature produces no ZIP.
6. `pnpm test` passes and `pnpm typecheck` is clean.
7. No numeric constant exists in `packages/domain/src` that is not either a profile field
   or a named constant traceable to a rule ID in this document.
