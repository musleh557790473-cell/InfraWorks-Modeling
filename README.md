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
pnpm fixture:pipeline  # sample DWG + CSV → ZIP under data/artifacts/
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
| `packages/aps-client` | APS auth / Model Derivative (mocked without credentials) |
| `fixtures/` | Sample DWG/DXF + `roads_report.csv` |

## Conversion gates

Beyond packaging, the repo carries a set of gates that check an exchange **before** it
can go wrong, because the failures that matter in Civil 3D ⇄ InfraWorks are silent: the
import succeeds, and part of the model is simply absent.

| Gate | Runs on | Status |
| --- | --- | --- |
| G1 | DWG / LandXML, before export | planned |
| **G2** | **`.imx`, after export and before import** | **`packages/imx-gate`** |
| G3 | InfraWorks `.sqlite`, after import | planned |

```bash
pnpm --filter @infraworks/imx-gate gate export.imx --crs 32636 --repair
```

See [`packages/imx-gate/README.md`](packages/imx-gate/README.md) for the rule list and
what the auto-repair is allowed to touch.

## Success check

Upload fixture DWG + `roads_report.csv`, map layers, run build → download ZIP with `validation_report.json` and zero blocking issues.

MCP tools: `create_project`, `upload_input`, `set_mapping_profile`, `run_build`, `get_job`, `get_validation`, `get_package_url`.

## Package contents

- `manifest.json` / `crs.json` / `validation_report.json`
- `layers/*.geojson` by InfraWorks feature class
- `overlay/` 2D DWG/DXF when provided
- `IMPORT_CHECKLIST.txt`
