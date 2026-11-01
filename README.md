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
    `SIZE_Y`, `PIPE_MATERIAL`, `NETWORKNAME`, and depth: `ELEV_FROM` / `ELEV_TO` = the pipe centre's
    offset below ground at each end, `off_start_m` / `off_end_m`, from the rim of the node there,
    which SewerGEMS sets to the ground; for manholes `HEIGHT` = depth and `ELEVATION_OFFSET` = minus
    the depth, so the connector spans invert to rim; seen in InfraWorks on Al Qairawan: pipe CO-445 at
    -3.514 / -2.873 m enters the base of its manhole, MH-34 (depth 3.073 m) runs from the pipe up to
    the ground). `UTILITY_TYPE` is a
    read-only code InfraWorks sets itself, so the utility leads the network name (`Sewer - <model>`); the
    checklist lists them for the Table tab, `pnpm model:names` fills them on a copy, and Gate G3
    (`G3-012`) warns when they are empty. On Al Qairawan the pipe centres sit 1.4-5.2 m below ground.
  - Duplicate element labels in the model raise `ASSET_ID_DUPLICATE`.
  - Al Qairawan (Rev.03): 902 pipes (63.16 km, 200-800 mm, HDPE corrugated / ductile iron), 900
    manholes and 1 outfall; 258 deleted pipes left out; 15 labels used twice.
  - **WaterGEMS** (`<model>.wtg.sqlite`): a pressure model, with no inverts.

    ```bash
    pnpm package:build "<model>.wtg.sqlite" --utility Water --cover 1.0 --cover-source "<document>"
    ```

    The layers are `water_` or `irrigation_` (from `--utility`), with `NETWORKNAME` set to
    `<utility> - <model>`.
    - **Which elements:** only real, live elements, active in the model's active scenario.
      `ElementType = 3`, since 9 is a prototype (a template). Child alternatives override their
      parent: irrigation's *Peak-Distribution* switches its transmission pipe off.
    - **`<prefix>_pipes`** (Pipelines):
      - `diameter_mm` is the nominal size. WaterGEMS keeps the bore (`inside_mm`); a PE bore within
        1.5 mm of a standard size × 9/11 is that SDR 11 size, so 130.8 mm is Ø160. The PWT notes
        say "ALL PIPE DIAMETER ARE NOMINAL" and "HDPE PE100-SDR11". Other materials keep the bore.
      - Also `material`, `node_start` / `node_end`, and `elev_start_m` / `elev_end_m`, the nodes'
        Elevation.
      - **Depth only from a given `--cover`:** the pipe centre is cover + half the outside diameter
        below the terrain (`off_start_m` / `off_end_m` → `ELEV_FROM` / `ELEV_TO`), with the source
        kept in `cover_src`. Without `--cover` no depth is shipped, and `ELEV_FROM` / `ELEV_TO` are
        not listed.
    - **`<prefix>_structures`** (Pipeline Connectors): reservoirs, tanks, valves, pumps, hydrants
      (`kind`, `elev_m`). Junctions are only network points at bends and branches, so they do not
      ship.
    - **Al Qairawan potable water:**
      - 895 pipes (74.07 km): HDPE Ø160-630 (778 of them Ø160) and 5 ductile iron, plus reservoir
        R-2.
      - Left out: 6 deleted pipes and 1 prototype.
      - Cover 1.0 m: PWT-DWG-10000-001 note 5, "minimum cover above the crown".
      - Node Elevation lies about 0.5 m (0.3-0.9 m) below the sewer rims nearby, so it is probably
        another ground surface; it is kept as an attribute only.
    - **Al Qairawan irrigation:**
      - 1,074 pipes (51.75 km): HDPE Ø90-450, of which 736 are Ø90.
      - 14 structures: 8 air valves, 4 isolation valves, 1 pump and 1 reservoir.
      - Left out: 3,482 deleted pipes, 1 switched off and 4 of zero length.
      - Node Elevation matches the sewer rims (median +0.03 m).
      - Cover 0.80 m, **assumed by AICC pending confirmation**: no model, drawing or note gives one.
- **Networks from drawings** (what no hydraulic model carries). Several sheets combine into one
  package, which sets the project's `cadMode: "all"`; otherwise the newest drawing replaces earlier
  ones:

  ```bash
  pnpm package:build PWT.dwg STO.dwg IRR.dwg --profile parsons-ldip-wet-utilities
  pnpm package:build ELV.dwg EMV.dwg SLT.dwg TEL.dwg SEC.dwg --profile parsons-ldip-dry-utilities
  ```

  - **Wet** (*Parsons / LDIP wet utilities (drawings)*), for Al Qairawan:
    - storm drainage: 648 pipes, sizes from the layer names (`…SW_Pipe Dia 400`), and 663 manholes
      and outfalls. No storm model was issued.
    - potable water: 818 valves and 351 fire hydrants. The WaterGEMS model has neither.
    - irrigation: 199 gate and washout valves.

    Water, sewer and irrigation pipes come from their hydraulic models.
  - **Dry** (*Parsons / LDIP dry utilities (drawings)*), for Al Qairawan:

    | Network | Lines | Points |
    | --- | --- | --- |
    | Low voltage | 2,317 cables | 1,354 pillars |
    | Medium voltage | 149 cables | 102 substations |
    | Street lighting | 203 cables | 1,882 street lights, 2 panels |
    | Telecom | 510 ducts | 455 handholes |
    | Security | 352 ducts | 269 handholes, 685 CCTV cameras |

  - **What ships as what:** pipes and cables ship as Pipelines and nodes as Pipeline Connectors,
    each layer listing the InfraWorks columns its fields fill (`fields`, e.g. `SIZE_X` ← `size_m`,
    `NETWORKNAME` ← `network`). Street lights and cameras ship as Points of Interest.
  - **Rule options:**
    - `attributes`: constant fields, such as `utility` and `network` ("Storm - Al Qairawan").
    - `fields`: InfraWorks columns.
    - `size`: from the layer name or the nearest label, then carried along a run.
    - `symbols`: lines and symbols on one layer go to different package layers (`AAMSLCrdr` is the
      lighting cable and, as symbols, the poles).
    - `asPoint`: a shape ships as its centre (cameras drawn as circles).
    - `explode: false`: a layer's symbols stay one point each.
  - **The reader also learned** from these sheets:
    - A sheet that rotates its xrefs off the CRS (the storm sheet, 295° about a point off site) is
      read at the xrefs' own coordinates (`XREF_READ_AT_OWN_COORDINATES`).
    - A block of only inserts, or of geometry pasted in world coordinates at 0,0, is a group and is
      opened.
    - An xref holding only mapped symbols is opened, once.
    - A connector or point layer keeps each symbol as one point. A line layer ships no stray
      points, and its closed rings ship as lines.
    - A few stray features off the CRS among many placed right are left out, not blocking
      (`COORDS_OUTSIDE_CRS_LEFT_OUT`). There may be at most 5 (or 0.5 %), with 20 times as many
      inside.
    - A justified TEXT label is placed at its alignment point.
  - **Worth raising with Parsons:**
    - the sewer xref's "QIC Storm" pipes lie about 160 km away (another site);
    - one closed outline on `AAMSLCrdr` (46.7 km round) ships with the lighting cables;
    - the security handholes sit in an xref named "Narjes Overall Primary Security Network".
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
