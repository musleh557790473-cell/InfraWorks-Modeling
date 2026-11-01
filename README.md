# InfraWorks Modeling

MVP that turns **2D DWG + CSV/XLSX/PDF reports** into an **InfraWorks-ready import package** (not a hosted InfraWorks model). Same flow via **web UI**, **REST API**, and **MCP**.

Autodesk has no reliable public API to create an InfraWorks model from arbitrary 2D DWG. This product validates CRS/geometry/joins and ships a ZIP a coordinator can import (GeoJSON layers, overlay DWG, `manifest.json`, import checklist).

## Defaults (LDIP / Al Narjis)

- CRS: **EPSG:32638** (`UTM84-38N` in InfraWorks)
- APS Model Derivative preview is **mocked** when `APS_CLIENT_ID` / secret are missing
- Outputs are **NOT FOR ISSUE** until Human Review Gate approval

## Quick start

```bash
git clone https://github.com/musleh557790473-cell/InfraWorks-Modeling.git
cd InfraWorks-Modeling
cp .env.example .env   # LOCAL_MODE=1
pnpm install
pnpm --filter @infraworks/domain build && pnpm --filter @infraworks/aps-client build
pnpm fixture:pipeline  # sample DXF + CSV → ZIP under data/artifacts/
# DWG input needs ODA File Converter (free) — see “CAD input” below
pnpm dev               # web :3000 · API :8787 · worker · MCP (stdio)
```

- Web: http://127.0.0.1:3000
- OpenAPI: http://127.0.0.1:8787/openapi.json

Build a package from one drawing without the web app:

```bash
pnpm package:build "C:\temp\drawing.dxf" --profile parsons-ldip-roads --name "Al Qairawan 10100"
```

## Working from two machines

Code and data travel separately:

| What | Where | Moves by |
| --- | --- | --- |
| The repo (code, `.git`) | a clone outside OneDrive on each machine, e.g. `C:\dev\InfraWorks-Modeling` | `git pull` / `git push` |
| The data folder (uploads, packages, converted drawings, project database) | one OneDrive folder, e.g. `Documents\AI\InfraWorks-Modeling-Data` | OneDrive |
| InfraWorks models, DWG / DXF / IMX inputs | OneDrive project folders | OneDrive |

Each machine's own `.env` (not committed) points at the shared data folder, without quotes:

```
DATA_DIR=C:\Users\<you>\OneDrive - <org>\Documents\AI\InfraWorks-Modeling-Data
```

The API, worker, `pnpm package:build` and `pnpm fixture:pipeline` all read it. Paths inside the
project database are stored relative to the data folder, so it opens on either machine even when
the user name or OneDrive path differs.

Keep the repo itself out of OneDrive: OneDrive does not understand git, and a machine that comes
back online with old files writes them over newer ones as `name-<PC>` conflict copies (inside
`.git` too), and locks files mid-checkout. Work on one machine at a time and let OneDrive show
"Up to date" before starting on the other, since the project database is a set of JSON files.

## Monorepo layout

| Path | Role |
| --- | --- |
| `apps/web` | Next.js upload → map → build → download |
| `apps/api` | Hono + OpenAPI REST |
| `apps/worker` | Polls queued jobs (inline in LOCAL_MODE via API) |
| `apps/mcp` | MCP tools mirroring the API |
| `packages/domain` | Domain model, DWG/DXF + report ingest, validation, ZIP package |
| `packages/imx-gate` | **Gate G2** — validate and repair a Civil 3D IMX export before import |
| `packages/model-gate` | **Gate G3** — check the InfraWorks model after import against the package (and IMX) |
| `packages/aps-client` | APS auth / Model Derivative (mocked without credentials) |
| `fixtures/` | Sample DXF; real DWGs built by `make_fixtures.py` (`sample.dwg`, `team-b.dwg`); `roads_report.csv` |

## Conversion gates

Beyond packaging, the repo carries a set of gates that check an exchange **before** it
can go wrong, because the failures that matter in Civil 3D ⇄ InfraWorks are silent: the
import succeeds, and part of the model is simply absent.

| Gate | Runs on | Status |
| --- | --- | --- |
| G1 | DWG / LandXML, before export | planned |
| **G2** | **`.imx`, after export and before import** | **`packages/imx-gate`** |
| **G3** | **InfraWorks `.sqlite`, after import** | **`packages/model-gate`** |

```bash
pnpm gate:imx export.imx --crs 32636 --repair
pnpm gate:model "model.sqlite" --package package.zip --imx export.imx
```

See [`packages/imx-gate/README.md`](packages/imx-gate/README.md) and
[`packages/model-gate/README.md`](packages/model-gate/README.md) for the rule lists.

## Success check

Upload `fixtures/sample.dxf` + `fixtures/roads_report.csv`, map layers, run build → download ZIP with `validation_report.json` and zero blocking issues.

## CAD input

### DWG and DXF

A DWG is converted to DXF first, with free tools tried in this order:

| Engine | Licence | Notes |
| --- | --- | --- |
| **ODA File Converter** | Free download (registration) | Reads every DWG release; the most complete. Free for internal use — bundling it in a product you distribute needs an ODA licence. Found under `C:\Program Files\ODA\` or via `ODA_FILE_CONVERTER`. |
| **ezdwg** (Python) | MIT | DWG R2000–R2018. Much less complete (block content often missing), so fallback only. `pip install ezdwg==0.16.0`; `EZDWG_PYTHON` / `EZDWG_PYTHONPATH` point at a specific install. |

`CAD_CONVERTERS=oda,ezdwg` sets the order. The converted DXF is cached per upload, so scanning
layers and building do not convert twice. A DWG that no engine can read blocks the build
(`CAD_CONVERSION_FAILED`). Autodesk APS is not used.

The reader takes **model space only** (layouts and title blocks are ignored) and handles
`LINE`, `LWPOLYLINE` / `POLYLINE` (arcs kept as curves), `ARC`, `CIRCLE`, `POINT`, and
**blocks** (expanded with their position, rotation and scale; a block drawn on layer `0` takes
its insert's layer; symbol blocks — trees, poles, manholes — become one point carrying their
attributes). Anything else is listed in a warning.

**Civil 3D objects** (alignments, parcels, feature lines, corridors) cannot be read outside
Civil 3D: they arrive as proxy entities and raise `CIVIL3D_OBJECTS_NOT_READ`. Ask the team to
run `ExportToAutoCAD` before sending, or send LandXML.

**Plotted sheets** (a layout sheet with the design bound in as an xref, as in Parsons' submission
folders): when model space has nothing mapped, each bound xref that has mapped layers is read at
its own coordinates, and the title block and logos are left out. The report raises
`SHEET_XREF_EXTRACTED`, since a sheet often holds only the part of the design inside its
viewport: ask for the source drawing for the full layout. A DXF that ends before its `EOF` marker
raises `DXF_TRUNCATED`, and its half-written last entity is dropped. AutoCAD writes such files when
its DXF export meets objects it cannot write, usually Civil 3D ones: in Civil 3D run `AUDIT`, then
`EXPORTTOAUTOCAD`, and export the DXF from the drawing that creates. That drawing may report its
units as feet; when the coordinates already fit the project CRS the warning says so, and they are
used as they are. Unmapped symbols (title blocks and legends inserted at 0,0) are not exported, so
they never block a build.

### Drawings from many teams

Each team or consultant draws differently, so mapping is saved **per team** as a *mapping
profile* and reused for that team's next drawing:

- **Layer rules** are names or wildcards (`*ROAD*CNTR*`, `C-PROP-?`), case-insensitive, first
  match wins. Unmapped layers get a suggestion from common names (US National CAD Standard,
  Gulf practice, Arabic); a layer holding only text is treated as a label layer. Layers of a
  bound xref (`<xref>$0$RD_CL`) are matched and suggested by their own name (`RD_CL`).
- **Built-in profiles**: the LDIP default, and *Parsons / LDIP road layout* (`RD_CL*` and
  `RD_PR_CNRL*` → roads, `Project Boundary` → coverage; on Al Qairawan also `road_reserve`,
  `blocks`, `asphalt` and `plots`, below). Start from one and save it as your team's profile.
- **Areas around the roads**: a rule may name its own package layer (`outputLayer`), so rules of
  one class ship as separate Shapefiles, and may cut other layers' closed areas out of its own
  (`subtract`). Al Qairawan draws its right-of-way lines (`RD_ROW`) closed around the blocks
  between the roads, so the Parsons profile ships:
  - `blocks.shp` — the closed `RD_ROW` areas (171 blocks, 1.95 km² on sheet 10100);
  - `road_reserve.shp` — the site `Boundary` minus those blocks (one area with 162 holes, 1.68 km²);
  - `asphalt.shp` — the closed `G-ASPHALT ROAD` areas (most asphalt is drawn as open edges).

  On coverage, parcel and water layers a polyline whose ends meet within 1 cm counts as closed
  (42 of Al Qairawan's "open" blocks end under 1 cm from their start); open lines on coverage and
  parcel layers cannot become areas, so they stay out of the Shapefiles and `AREA_NOT_CLOSED` counts them.
- **Plots drawn as separate lines** (`polygonize`): a rule may build its areas from the faces its
  lines enclose. The lines are split where they cross or end on one another, loose ends are dropped,
  and `closeGaps` joins line ends that stop short of another line (drafting gaps) up to the given
  distance. Only a label *inside* an area names it, never a neighbour's. The Parsons profile builds
  `plots.shp` (Type: Parcels) from the baseplan's `MP-PLT-LIN` lines, numbered by the `MP-PLT-TXT`
  text inside each plot (`parcel_id`), with `closeGaps: 0.5`: on Al Qairawan 10100, 6,555 plots,
  5,944 numbered (5,938 of the 5,952 numbers alone in their plot); 442 gaps of up to 0.5 m closed.
- **Networks from hydraulic models**: a SewerGEMS model database (`<model>.stsw.sqlite`, next to the
  `.stsw`) is read directly, as the designer's own data, in preference to labels on a drawing:
  `pnpm package:build "<model>.stsw.sqlite"`, or upload it as kind `hydraulic`. Active elements only
  (`IsDeleted = 0`); OpenFlows stores feet internally, so everything is converted to metres.
  - `sewer_pipes.shp` (Type: Pipelines): `label`, `diameter_mm`, `size_m`, `material`,
    `inv_start_m` / `inv_end_m` (ends as drawn), `slope_pct`, `flow` (`start-to-end` or
    `end-to-start`: models often draw pipes against the flow), `length_m`, `node_start` / `node_end`.
  - `sewer_manholes.shp` (Type: Pipeline Connectors): `label`, `kind` (Manhole / Outfall), `rim_m`,
    `invert_m`, `depth_m`, `size_m`. A rim of 0 or below the invert counts as no level.
  - Each layer records the InfraWorks columns its fields fill (`fields` in the manifest: `SIZE_X`,
    `SIZE_Y`, `PIPE_MATERIAL`, `NETWORKNAME`; `HEIGHT` = depth for manholes). `UTILITY_TYPE` is a
    read-only code InfraWorks sets itself, so the utility leads the network name (`Sewer - <model>`); the
    checklist lists them for the Table tab, `pnpm model:names` fills them on a copy, and Gate G3
    (`G3-012`) warns when they are empty. Invert levels stay in the attributes and are not yet put
    into InfraWorks' elevation columns, whose meaning (offset or level) is still to be checked.
  - Duplicate element labels in the model raise `ASSET_ID_DUPLICATE`.
  - Al Qairawan (Rev.03): 902 pipes (63.16 km, 200-800 mm, HDPE corrugated / ductile iron), 900
    manholes and 1 outfall; 258 deleted pipes left out; 15 labels used twice.
- **Names beside the features** (`labels`): a rule may take a name from text written next to its
  features — each label goes to the nearest feature within `maxDistance`, and a feature named by
  several labels takes the name most of them give, so a link road never borrows a neighbour's
  name. The Parsons profile names Al Qairawan's centrelines from `0-Alignment Name` (`road_name`,
  e.g. `R.6.G.12`): 280 of 332 named.
- **Names in InfraWorks**: InfraWorks keeps a `.dbf` field only when it is mapped in *Configure*.
  Every Shapefile whose features have a name carries it first, in a text field called `NAME`
  (the road name, the plot number; `nameField` / `nameAttribute` in the manifest), the checklist
  says *Common tab: Name = NAME*, and Gate G3 (`G3-010`) reads the model's Configure settings and
  warns when the names did not arrive, saying whether Name was left unmapped or mapped elsewhere.
  InfraWorks does not map a field called `NAME` by itself (tried on Al Qairawan), so
  `pnpm model:names "<model>.sqlite" --package <package>.zip` does it on a **copy**: it copies the
  model and its `<model>.files` folder to `<model> (names)`, fills `NAME` row by row (InfraWorks
  keeps each row's Shapefile record number in `EXTERNAL_ID`), and records *Name = NAME* in each
  data source's Configure settings, so a Refresh keeps them. It refuses while the model is open
  (`<model>.lock`) and never changes the model itself. On Al Qairawan: 280/280 road names and
  5,944/5,944 plot numbers, G3 PASS with no warning.
- **Asset ids** are looked for in every usual place, in order:
  1. XDATA (`xdataApps`, default `INFRAWORKS`; `*` = any application)
  2. a block attribute (`attributeTags`, default `ASSET_ID, ROAD_ID, PARCEL_ID, PLOT_ID, PLOT_NO`)
  3. the nearest TEXT/MTEXT label within `textMaxDistance` on `textLayers`

  An id `pattern` (e.g. `^RD-\d{3}$`) filters all three and lets ids be found in any attribute
  or label. Ids are compared ignoring case and spaces by default (`normalize`), and the
  report's spelling becomes the feature's id.
- **Reports**: CSV (UTF-8, UTF-16, or Arabic Windows-1256; `,` `;` or tab separated) and
  **Excel** (`.xlsx`, any sheet; the header may sit below blank rows). Each report join names
  its id column.

In the web app: **Map layers for this team** → choose the team's profile → *Scan drawing
layers* → adjust → *Save as team profile* → *Apply to project*. The same is available over
REST (`/mapping-profiles`, `/projects/{id}/scan-layers`, `/projects/{id}/reports`) and MCP.

### Checks on every build

- Coordinates must fall inside the project CRS (`COORDS_OUTSIDE_CRS` blocks drawings left in local coordinates).
- Drawing units other than metres on a UTM project → `DRAWING_UNITS_NOT_METRES`.
- Features on id-carrying layers without an id → `ASSET_ID_MISSING`.
- One id on two features of a layer (two plots numbered alike in the drawing) → `ASSET_ID_DUPLICATE`.
- Features read but none on a mapped layer → `NOTHING_MAPPED` blocks the build (the package would
  be empty); the message names the most used layers to map.
- GeoJSON layers carry a `crs` member (`urn:ogc:def:crs:EPSG::<code>`) so InfraWorks/GDAL read
  them in the project CRS, not as WGS 84 degrees.

MCP tools: `create_project`, `upload_input`, `list_mapping_profiles`, `save_mapping_profile`, `scan_layers`, `list_report_columns`, `set_mapping_profile`, `run_build`, `get_job`, `get_validation`, `get_package_url`.

## Package contents

- **`shp/*.shp`** — what InfraWorks imports (it has no GeoJSON reader). One Shapefile per
  package layer (the feature class, or the rule's `outputLayer`) and geometry kind
  (`road_centerline.shp`, `road_reserve.shp`, or `water_line.shp` + `water_area.shp`),
  each with `.shx`, `.dbf`, `.prj` (project CRS as ESRI WKT) and `.cpg` (UTF-8, so Arabic text
  survives). Polygons follow the Shapefile winding rule.
- `shp/field_names.csv` — dBASE limits field names to 10 ASCII characters; this maps each
  `.dbf` field back to its original attribute name (Arabic column names become `FIELD_n`).
- `layers/*.geojson` — the same features for GIS tools and checks; not for InfraWorks.
- `manifest.json` — every layer with its feature count, extent, line length and the InfraWorks
  data source type to choose; Gate G3 compares the model with these numbers.
- `crs.json` / `validation_report.json` / `domain_features.json`
- `overlay/` — the source drawing, for an optional 2D overlay
- `IMPORT_CHECKLIST.txt` — step-by-step import written for this package's own files:
  Add File Data Source → SHP, the Type for each file (Roads, Coverage Areas, Parcels, Water Areas,
  Streams, Pipelines, Points of Interest), the field to map to Name on the Common tab, the
  coordinate system check, then Gate G3.
