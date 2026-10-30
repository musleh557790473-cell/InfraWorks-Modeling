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
  `RD_PR_CNRL*` → roads, `Project Boundary` → coverage). Start from one and save it as your team's profile.
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
- Features read but none on a mapped layer → `NOTHING_MAPPED` blocks the build (the package would
  be empty); the message names the most used layers to map.
- GeoJSON layers carry a `crs` member (`urn:ogc:def:crs:EPSG::<code>`) so InfraWorks/GDAL read
  them in the project CRS, not as WGS 84 degrees.

MCP tools: `create_project`, `upload_input`, `list_mapping_profiles`, `save_mapping_profile`, `scan_layers`, `list_report_columns`, `set_mapping_profile`, `run_build`, `get_job`, `get_validation`, `get_package_url`.

## Package contents

- **`shp/*.shp`** — what InfraWorks imports (it has no GeoJSON reader). One Shapefile per
  feature class and geometry kind (`road_centerline.shp`, or `water_line.shp` + `water_area.shp`),
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
  Streams, Pipelines, Points of Interest), the coordinate system check, then Gate G3.
