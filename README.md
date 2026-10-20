# InfraWorks Modeling

MVP that turns **2D DWG + CSV/XLSX/PDF reports** into an **InfraWorks-ready import package** (not a hosted InfraWorks model). Same flow via **web UI**, **REST API**, and **MCP**.

Autodesk has no reliable public API to create an InfraWorks model from arbitrary 2D DWG. This product validates CRS/geometry/joins and ships a ZIP a coordinator can import (GeoJSON layers, overlay DWG, `manifest.json`, import checklist).

## Defaults (LDIP / Al Narjis)

- CRS: **EPSG:32638** (`UTM84-38N` in InfraWorks)
- Outputs are **NOT FOR ISSUE** until Human Review Gate approval

## APS: mock vs live

| Mode | When | Behavior |
| --- | --- | --- |
| **Mock** | `APS_CLIENT_ID` or `APS_CLIENT_SECRET` empty | 2-legged token, OSS upload, Model Derivative URN, and Design Automation layer list are mocked. Package pipeline and web preview still work (`LOCAL_MODE=1`). |
| **Live** | Both credentials set | Real 2-legged OAuth, OSS signed upload, MD SVF2 translate + manifest, Viewer token (`viewables:read`). DA workitems run only if `APS_DA_ACTIVITY_ID` is set (AutoCAD ListLayers-style activity). |

Patterns adapted from Autodesk APS samples (simple viewer Node, Design Automation Node, list-layers DA) — copied into `packages/aps-client`, not linked as a submodule.

```bash
# Mock (default)
cp .env.example .env   # leave APS_* empty

# Live preview
# APS_CLIENT_ID=...
# APS_CLIENT_SECRET=...
# APS_BUCKET=optional-override
# APS_DA_ACTIVITY_ID=YourClientId.ListLayersActivity+dev   # optional
# APS_CALLBACK_URL=http://127.0.0.1:8787/oauth/callback    # optional 3LO
```

Useful endpoints: `GET /health` (`apsMode`), `GET /aps/token`, `GET /projects/:id/preview`, `GET /projects/:id/layers-da`.

## Quick start

```bash
git clone https://github.com/musleh557790473-cell/InfraWorks-Modeling.git
cd InfraWorks-Modeling
cp .env.example .env   # LOCAL_MODE=1, APS mocked
pnpm install
pnpm --filter @infraworks/domain build && pnpm --filter @infraworks/aps-client build
pnpm fixture:pipeline  # sample DWG + CSV → ZIP under data/artifacts/
pnpm dev               # web :3000 · API :8787 · worker · MCP (stdio)
```

- **UI (recommended):** http://127.0.0.1:8787/ — API reverse-proxies Next so one port works in Try Live
- Direct Next: http://127.0.0.1:3000 (also dual-stack)
- OpenAPI: http://127.0.0.1:8787/openapi.json
- Health: http://127.0.0.1:8787/health

### Test without APS keys

1. Leave `APS_CLIENT_ID` / `APS_CLIENT_SECRET` empty.
2. `pnpm fixture:pipeline` → ZIP with zero blocking issues.
3. `pnpm dev` → upload fixture DWG + CSV → **DWG preview** shows mock URN → run build → download ZIP.

### Test with APS keys

1. Set `APS_CLIENT_ID` and `APS_CLIENT_SECRET` in `.env` (APS app with OSS + Model Derivative + optional Design Automation).
2. Restart API/worker. `GET /health` should report `apsMode: "live"`.
3. Upload a real `.dwg`, open **DWG preview** — waits for MD translation, then Autodesk Viewer loads the URN.
4. Optional: set `APS_DA_ACTIVITY_ID` to your ListLayers (or overlay-normalize) activity to submit live DA workitems during build.

## Monorepo layout

| Path | Role |
| --- | --- |
| `apps/web` | Next.js upload → preview → map → build → download |
| `apps/api` | Hono + OpenAPI REST (+ `/aps/token`, preview) |
| `apps/worker` | Polls queued jobs; uses aps-client hooks |
| `apps/mcp` | MCP tools mirroring the API |
| `packages/domain` | Domain model, DWG/DXF + report ingest, validation, ZIP package |
| `packages/aps-client` | 2-legged OAuth, OSS, Model Derivative, DA stub (mock without credentials) |
| `fixtures/` | Sample DWG/DXF + `roads_report.csv` |

## Success check

Upload fixture DWG + `roads_report.csv`, map layers, run build → download ZIP with `validation_report.json` and zero blocking issues.

MCP tools: `create_project`, `upload_input`, `set_mapping_profile`, `run_build`, `get_job`, `get_validation`, `get_package_url`.

## Package contents

- `manifest.json` / `crs.json` / `validation_report.json`
- `layers/*.geojson` by InfraWorks feature class
- `overlay/` 2D DWG/DXF when provided
- `IMPORT_CHECKLIST.txt`
