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
| G3-012 | Attributes arrived: each column the layer fills (`fields` in the manifest: SIZE_X, PIPE_MATERIAL, HEIGHT...) has values in the model; says whether it is mapped | warning |
| G3-013 | Roads now component roads: package roads missing from their data source but in the model as component roads of the same name (converted in InfraWorks, or written by `model:roads`) count as arrived, and are listed | info |
| G3-011 | Each package layer is imported once (a second data source on the same file doubles its features) | warning |
| G3-010 | Names arrived: the layer's name field (checklist: *Common → Name*) is in the model's `NAME` and matches the package | warning |

## Names and attributes into the model: `model-names`

```bash
pnpm model:names "model.sqlite" --package package.zip [--out "copy.sqlite"]
```

InfraWorks keeps a Shapefile field only when it is mapped in Configure, and does not map `NAME` by
itself. This writes `<model> (names).sqlite` (and a copy of `<model>.files`) with `NAME` filled from
each layer's `NAME` field and every other column the layer lists (`fields`: SIZE_X, PIPE_MATERIAL,
HEIGHT...), matched row by row on `EXTERNAL_ID` (the Shapefile record number, from
InfraWorks' default mapping `EXTERNAL_ID = FeatId`), and *Name = NAME* recorded in each data
source's `CONFIG`, so a Refresh keeps the names. Rows that already have another name are kept.

- The model itself is never changed; it refuses while `<model>.lock` is there (open in InfraWorks).
- A layer is left alone, and said so, when its row count differs from the file's record count or
  `EXTERNAL_ID` is mapped to something other than `FeatId`.
- Writes go through Node's SQLite (`node:sqlite`, Node 22.16+ / 24) with double-quoted literals
  allowed: InfraWorks' own triggers use them, and better-sqlite3 rejects them. InfraWorks' journal
  triggers log the edits as they do for its own.

## Parsons roads as component roads: `model-roads`

```bash
pnpm model:roads "C:\IW\<working copy>.sqlite" --template <constrained-definition GUID> \
  --layout <ROD-DWG-10200>.dxf --profiles <ROD-DWG-40000>.dxf --surface <grading>.xml \
  [--package <roads package>/shp/road_centerline] [--out-dir <folder>] [--dry]
```

Writes every road of the Parsons road layout into the model as a component road, with its name,
Parsons' horizontal elements (straights and arcs), PVIs and vertical curves, typical section (A1-C2)
and crossfall side, replacing a road of the same name. The template is a road converted in
InfraWorks itself (its `CONSTRAINED_DEFINITIONS` GUID); its constraints are kept, its body refreshed.

The chain (pure functions in `@infraworks/domain`, `src/roads/`):

1. Profile views from the profiles block (FG line, level grid, station labels), checked against the
   printed PGL row; PVIs and curves from the labels, each label checked against the road's own FG line
   (labels of the neighbouring profile on the sheet are dropped; missing PVC/PVT or tangent grades
   are read on the FG line).
2. Plan alignments from the layout block: each road chained from its 0+000 end through its own,
   unnamed and name-labelled pieces; a chain is kept only when its length equals the profile
   length (1 cm). A confirmed alignment longer than its profile is cut at the profile end.
3. Direction: each road's profile against the grading surface (steady pavement offset) and the
   levels at junctions; reversed when they agree, repeated until nothing changes. Loop roads get the
   start that fits.
4. Section type from the right-of-way width; crossfall side from the grading surface.
5. Writing (`src/roads/`): arcs over 90 degrees split (a near-closed arc is undefined in InfraWorks),
   stations 1 mm apart merged (NaN edges), stray PVIs past the end dropped, and the body rows
   (strips, grading ring, CutOut) computed per road, since InfraWorks draws them as stored.

Then it checks the model: level problems in each road's rows, and level steps at junctions.
The model is changed in place (one working copy on a short path, closed in InfraWorks).

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
