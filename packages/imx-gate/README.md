# @infraworks/imx-gate

**Gate G2** — validate, and where it is safe to do so repair, a Civil 3D **IMX** export
*before* it is imported into InfraWorks.

An `.imx` file is a SQLite database. Civil 3D writes the corridor, its regions and every
sampled cross-section into it, plus a JSON blob per section describing the assembly. If
any of those blobs is malformed, **InfraWorks stops building the road body for that
region at that station and discards every section after it, with no message in the UI.**
The road simply ends. This package finds that class of defect in seconds.

> Found in production on NEOM PKG 4 C1-P3 (2026-10-21): one bad record out of 2,327
> dropped **925 m of the 1,174 m southbound carriageway**. The export itself looked
> complete; the model did not.

## Use

```bash
pnpm --filter @infraworks/imx-gate build

# report only
imx-gate export.imx --crs 32636

# report, write a corrected copy, re-check it, and save both report formats
imx-gate export.imx --crs 32636 --repair --md gate.md --json gate.json
```

| Option | Meaning |
| --- | --- |
| `--repair` | Write `<name>_FIXED.imx` and re-run every rule against it |
| `--out <path>` | Choose the output path for the corrected copy |
| `--crs <epsg>` | Expected projected CRS, e.g. `32636` (NEOM) or `32638` (LDIP) |
| `--max-gap <m>` | Section spacing above which IMX-006 is raised (default 15) |
| `--md` / `--json` | Also write a Markdown or raw JSON report |
| `--quiet` | Suppress the console report |

Exit code is `0` when no blocking finding remains, `1` otherwise — so it drops straight
into CI or a pre-import hook.

```ts
import { runGate, toMarkdown } from "@infraworks/imx-gate";

const report = runGate("export.imx", { epsg: 32636, repair: true });
if (!report.ok) throw new Error(`${report.blockingCount} blocking finding(s)`);
```

## Rules

| Rule | Checks | Severity | Auto-repair |
| --- | --- | --- | --- |
| IMX-001 | Required tables and `IMX_VERSION` are present | blocking | — |
| IMX-002 | Every corridor section's `JSON_CROSS_SECTION` parses | blocking | **yes** |
| IMX-003 | Every region's `JSON_ASSEMBLY_DATA` parses | blocking | **yes** |
| IMX-004 | `corridorOutOfDate` / `baselineOutOfDate` are false | warning | — |
| IMX-005 | Regions on a baseline are continuous — no gap, no overlap | warning | — |
| IMX-006 | Section spacing is within tolerance | warning | — |
| IMX-007 | No runaway link slopes (the condition behind IMX-002) | warning | — |
| IMX-008 | Geometry blobs decode, are non-empty and finite | blocking | — |
| IMX-009 | Declared CRS matches `--crs`, coordinates sit inside the UTM envelope | blocking | — |
| IMX-010 | The export actually carries roads and surfaces | warning | — |
| IMX-011 | No region is left with zero sections | warning | — |
| IMX-012 | Sections cover the declared region span | warning | — |

Rule ids are stable. Add new rules with new numbers; never renumber a published one.

### What the repair touches

Only the JSON **parameter metadata** of corridor sections and regions: a non-finite
literal (`inf`, `nan`, `1.#IND`) becomes `0.0`, and its `formattedValue` becomes
`"0.000000"`. InfraWorks builds road geometry from each subassembly's `points`, `links`
and `shapes` arrays, never from `params`, so the repaired file produces exactly the
geometry Civil 3D intended.

The source file is never modified. The corrected copy is verified with
`PRAGMA integrity_check` and every rule is re-run against it, so the report you read
describes the file you will actually import. Regression tests assert that every
`GEOMETRY` and `SECTION_COORDINATES_3D` blob is byte-identical before and after.

IMX-002 is a symptom; **IMX-004 and IMX-007 are the cause**. Repairing the file unblocks
today's import — fixing the corridor in Civil 3D and rebuilding before export is what
stops it recurring.

## Why the defect happens

A subassembly link with zero horizontal run has an undefined slope. Civil 3D computes
`dy / 0`, gets infinity, and serialises it as the C literal `inf` — which is not legal
JSON. The usual trigger is a **cut/fill transition** where a daylight link meets existing
ground exactly at a sampled station, so the next link is left with no width at all.

That is also why IMX-006 matters: moving the sampled station by a few centimetres, or
driving the link by *slope + width* instead of *begin/end elevation*, removes the
condition entirely.

## Where this sits

```
G1  DWG / LandXML, before export      (planned)
G2  IMX, after export before import   <- this package
G3  InfraWorks .sqlite, after import  (planned)
```

G3 is the one that catches the *silent truncation* after the fact: comparing sections in
the source against slices actually built per region in `ALIGNMENT_CROSS_SECTIONS` is what
turns "part of the road is missing" into a number.

## Notes on the file format

- `.imx` is plain SQLite; `IMX_VERSION.VERSION` was `2.1` on Civil 3D 2026.
- `spatial_ref_sys.srtext` carries the WKT; the UTM zone is derived from
  `PARAMETER["central_meridian", …]` as `(cm + 183) / 6`.
- `GEOMETRY` columns are **FDO FGF** binary, decoded by `src/fgf.ts`:
  `int32 type` · `int32 dimensionality` (1 = XYZ) · `int32 count` · little-endian doubles.
- Corridor sections link to regions through `REGION_ID` → `CONSTRAINED_DEF_CORRIDOR_REGIONS.GUID`,
  not through `ID`.

## Development

```bash
pnpm --filter @infraworks/imx-gate test        # node:test, synthetic IMX fixtures
pnpm --filter @infraworks/imx-gate typecheck
pnpm --filter @infraworks/imx-gate gate <file.imx> --crs 32636
```
