# InfraWorks Modeling

MVP that turns **2D DWG + CSV/XLSX/PDF reports** into an **InfraWorks-ready import package** (not a hosted InfraWorks model). Same flow via **web UI**, **REST API**, and **MCP**.

Autodesk has no reliable public API to create an InfraWorks model from arbitrary 2D DWG. This product validates CRS/geometry/joins and ships a ZIP a coordinator can import (GeoJSON layers, overlay DWG, `manifest.json`, import checklist).

## Defaults (LDIP / Al Narjis)

- CRS: **EPSG:32638** (`UTM84-38N` in InfraWorks)
- Outputs are **NOT FOR ISSUE** until Human Review Gate approval

## Modes: Local free vs APS live

| Mode | UI label | When | Behavior |
| --- | --- | --- | --- |
| **Local free** (default) | Local free · محلي مجاني | UI toggle **or** `APS_MODE=local` / `?previewMode=local` | **Never calls APS.** Local DXF parse (DWG stub) → 2D SVG map of GeoJSON layers. Package ZIP build unchanged. Works with empty `APS_*` keys. |
| **APS live** | APS live · APS حي | UI toggle **or** `?previewMode=aps` with credentials | Real 2-legged OAuth, OSS upload, Model Derivative SVF2 + Viewer. Clear **401** if keys missing. DA workitems only if `APS_DA_ACTIVITY_ID` is set. |

Server default: `APS_MODE=local|auto|live` in `.env` (default **local**). Per-request override: query `previewMode=local|aps`, header `X-Preview-Mode`, or JSON body `{ "previewMode": "…" }`.

`GET /health` reports `previewMode`, `apsMode` (`off` \| `mock` \| `live`), `apsConfigured`, and `badge` (e.g. `FREE · local`).

```bash
cp .env.example .env   # APS_MODE=local — free use, no keys required

# Optional APS live
# APS_CLIENT_ID=...
# APS_CLIENT_SECRET=...
# APS_BUCKET=optional-override
# APS_DA_ACTIVITY_ID=YourClientId.ListLayersActivity+dev
# APS_MODE=local   # keep free default; switch to live in the UI when needed
```

Useful endpoints: `GET /health`, `GET /projects/:id/preview?previewMode=local|aps`, `GET /aps/token?previewMode=aps`, `GET /projects/:id/layers-da`.

## Quick start

```bash
git clone https://github.com/musleh557790473-cell/InfraWorks-Modeling.git
cd InfraWorks-Modeling
cp .env.example .env   # LOCAL_MODE=1, APS_MODE=local
pnpm install
pnpm --filter @infraworks/domain build && pnpm --filter @infraworks/aps-client build
pnpm fixture:pipeline  # sample DWG + CSV → ZIP under data/artifacts/
pnpm dev               # web :3000 · API :8787 · worker · MCP (stdio)
```

- **UI (recommended):** http://127.0.0.1:8787/ — API reverse-proxies Next so one port works in Try Live
- Direct Next: http://127.0.0.1:3000 (also dual-stack)
- OpenAPI: http://127.0.0.1:8787/openapi.json
- Health: http://127.0.0.1:8787/health

### Test Local free (no APS keys)

1. Leave `APS_*` empty; keep `APS_MODE=local`.
2. `pnpm fixture:pipeline` → ZIP with zero blocking issues.
3. `pnpm dev` → UI badge **FREE · local** → **Local preview** shows 2D layer map → run build → download ZIP.

### Test APS live

1. Set `APS_CLIENT_ID` and `APS_CLIENT_SECRET` in `.env`.
2. Restart API. Switch UI toggle to **APS live · APS حي** (or `?previewMode=aps`).
3. Upload a real `.dwg` → **APS preview** waits for MD, then Autodesk Viewer.
4. Optional: set `APS_DA_ACTIVITY_ID` for live Design Automation during build.

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
