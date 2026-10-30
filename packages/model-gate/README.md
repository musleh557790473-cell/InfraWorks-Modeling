# @infraworks/model-gate

**Gate G3** — check an InfraWorks model **after** import against what was sent to it.

InfraWorks imports fail quietly. A layer read as WGS 84 degrees lands far from the site, a
data source left unconfigured imports nothing, a design road stops building at one bad
cross-section and the rest of it is simply absent. The import dialog reports success in every
case. This gate reads the model's own database and compares it with the import package (and,
for design roads, with the Civil 3D IMX export).

## Use

```bash
pnpm --filter @infraworks/model-gate build

# the model file is "<Model>.sqlite" in the InfraWorks models folder
model-gate "Al Qairawan Test.sqlite" --package 1a2b3c-infraworks-package.zip
model-gate "Model.sqlite" --package pkg.zip --imx export.imx --md g3.md --json g3.json
```

| Option | Meaning |
| --- | --- |
| `--package <zip or folder>` | The package the model was built from |
| `--imx <file>` | The Civil 3D IMX export its design roads came from (enables G3-008) |
| `--max-offset <m>` | Allowed position shift, default 1 m |
| `--max-loss <ratio>` | Allowed missing road length, default 0.01 (1 %); over 0.10 is blocking |
| `--md` / `--json` | Also write a Markdown or JSON report |

The database is opened **read-only**. Close the model in InfraWorks first (or run on a copy).
Exit code `0` = no blocking finding, `1` = blocking findings, `2` = bad usage.

## Rules

| Rule | Checks | Severity |
| --- | --- | --- |
| G3-001 | The file is an InfraWorks model (DATA_SOURCES, spatial_ref_sys, ROADS) | blocking |
| G3-002 | The model's UTM zone and hemisphere match the package EPSG | blocking |
| G3-003 | Every package layer has a data source in the model (matched by file name) | blocking |
| G3-004 | Each layer was imported as the expected type, and read in the package CRS — not as WGS 84 degrees or another zone | warning / blocking |
| G3-005 | The features arrived (count in the model vs the package) | blocking if none, else warning |
| G3-006 | The features sit where the package put them (extent centre offset) | blocking |
| G3-007 | Linear layers arrived complete (plan length in the model vs the package) | warning; blocking over 10 % |
| G3-008 | Design roads were built over their full length (sections per region vs the IMX) | blocking |
| G3-009 | Every road in the IMX arrived in the model (matched by name) | warning |

## How it reads the model

An InfraWorks model is a SQLite database (`SCHEMA_VERSION` 17.x on InfraWorks 2025/2026):

- `DATA_SOURCES` — one row per import: `CONNECTION_STRING` (the source file), `TARGET_CLASS_NAME`
  (ROADS, COVERAGES, PARCELS, WATER_AREAS, PIPELINES, POIS …) and `SOURCE_CS` (the coordinate
  system the source was read in).
- Feature tables carry `DATA_SOURCE_ID` (the data source GUID) and `GEOMETRY` in **FDO FGF**, in
  model coordinates — decoded with the IMX gate's FGF reader.
- `spatial_ref_sys` holds the model CRS; InfraWorks writes `sr_name = "Default"` and keeps the code
  (e.g. `UTM84-38N`) in `auth_name` and in the WKT.
- `ALIGNMENT_REGIONS` / `ALIGNMENT_CROSS_SECTIONS` (`FK_REGION_GUID`, `REGION_DISTANCE_2D`) hold the
  design-road sections InfraWorks built.

## What has been verified

- Table layout, data sources, CRS and FGF geometry were read from a real InfraWorks model
  (schema 17.18.0, 380 roads / 210 km, 0 unreadable geometries).
- The rules are tested against a model database built to that layout and filled from a real package.
- **G3-008 on a real corridor** (NEOM PKG 4 C1-P3, IMX 2.1, UTM84-36N): all 6 regions and 2327
  sections matched, built over their full length. InfraWorks gives each imported region a **new
  GUID**, so regions pair **by name**; the GUID is still tried first. The report says how each
  region was matched; unmatched regions are reported, never passed silently.
- **G3-009** came from the same import: the IMX carried 3 roads, the model 2. The missing one,
  `TRN_COR_C1P3_AAC`, is a plain road with no design definition (the corridor's outline); whether
  InfraWorks skips such roads or the import filtered it out is not yet known, so it is a warning.
