# InfraWorks-Modeling: notes for Claude

Read this first in every session, on either laptop. The README describes the tool; this file
holds how we work and what has been learned the hard way.

## Working with the user

- Reply in Arabic, briefly. Code, comments, commit messages and docs stay in English.
- The user is a BIM/infrastructure lead (AICC JV, LDIP / Tawazun program, Parsons as designer).
  They test every result in InfraWorks themselves and send screenshots: wait for them.
- Merge a PR only when the user says "Merge" / "ادمج". Opening PRs is done by Cursor: after
  pushing a branch, give the user a prompt for Cursor (repo, head/base branch, commits expected,
  title, PR body; "do not merge, do not change code, do not disable certificate checks").
  To merge: `git merge --no-ff origin/<branch>` on main with "Merge pull request #N from
  musleh557790473-cell/<branch>", push main, then check `git ls-remote origin refs/heads/main`.
- Every fix or trick found on real data goes into the code with a test, not just into a reply.

## Two laptops, one repository

- Code comes only from GitHub. Work in `C:\dev\InfraWorks-Modeling` (a clone outside OneDrive).
  The old OneDrive checkout (`Documents\AI\Github\InfraWorks-Modeling`) is abandoned: OneDrive
  conflict copies (`-AYNLAP1201`, `-Musleh`) broke `.git` there in Oct 2026.
- `git pull` before any work, push after. Never leave commits only on one laptop.
- Shared data (uploads, packages, store) is the OneDrive folder
  `Documents\AI\InfraWorks-Modeling-Data`, set per laptop in `.env` as `DATA_DIR=` (no quotes).
  The tool is never run on both laptops at once.
- The company network intercepts TLS: git fails with `CRYPT_E_NO_REVOCATION_CHECK` (schannel)
  or "self-signed certificate in certificate chain" (OpenSSL). Ask the user to switch network
  (phone hotspot). Never disable certificate verification, never save git TLS settings.
- On the user's laptop Node, Git and pnpm are portable installs: prepend
  `$env:LOCALAPPDATA\Programs\node-v24.22.1-win-x64` and `$env:LOCALAPPDATA\Programs\MinGit\cmd`
  to PATH, and call `pnpm.cmd` (PowerShell blocks `.ps1`).
- A plugin hook (guard.py) may block Read/Edit/Write when Git Bash is missing: edit through
  PowerShell or small Node scripts then, checking each replaced snippet occurs exactly once.
- `next build` rewrites `apps/web/next-env.d.ts`: `git restore` it before committing.

## Commands

```bash
pnpm install && pnpm build && pnpm test          # expect 0 failures
pnpm package:build "<drawing.dxf | model.stsw.sqlite>" [--profile parsons-ldip-roads]
pnpm gate:model "<model>.sqlite" --package <package.zip>      # Gate G3, on a closed model
pnpm model:names "<model>.sqlite" --package <package.zip> [--out "<copy>.sqlite"]
```

## Inputs from Parsons

- DWG from Civil 3D: AUDIT, then EXPORTTOAUTOCAD, then Export DXF to a folder outside OneDrive.
  A plain export stops at Civil 3D objects and leaves a DXF without EOF (`DXF_TRUNCATED`);
  EXPORTTOAUTOCAD may set `$INSUNITS` to feet while coordinates stay UTM metres.
- Sheets bind the design in as xrefs (`<xref>$0$<layer>`): read through the bound xref.
- Projects are in UTM 38N (EPSG:32638, InfraWorks `UTM84-38N`): Riyadh (Al Narjis, Al Qairawan).
  NEOM is UTM 36N. A model created in the wrong zone fails G3-002 / G3-006.
- Prefer the designer's own data to drawing labels: SewerGEMS / WaterGEMS models
  (`<model>.stsw.sqlite`, `<model>.wtg.sqlite`) hold every pipe and node with sizes and levels.
  Source order for attributes: model data, then labels, then title block / general notes, then
  schedules shipped with the drawings. If none gives a value (e.g. a depth), ask; never invent it.

## InfraWorks facts (verified in InfraWorks 2026 models)

- A model is `<name>.sqlite` + `<name>.files`; `<name>.lock` while open. Work on copies only.
- InfraWorks keeps a Shapefile field only when mapped in Configure, and maps nothing by itself
  (not even a field called NAME). Rows keep the Shapefile record number in `EXTERNAL_ID`
  (mapping `EXTERNAL_ID = FeatId`), so `model:names` fills columns on a copy and records each
  mapping in `DATA_SOURCES.CONFIG` (JSON `propertyMappings`), which a Refresh then keeps.
- InfraWorks' own triggers use double-quoted literals (`"INVALID"`): write with `node:sqlite`
  and `enableDoubleQuotedStringLiterals: true`; better-sqlite3 rejects them (read-only is fine).
- Type names: Roads, Coverage Areas, Parcels, Water Areas, Streams, Pipelines,
  Pipeline Connectors, Points of Interest.
- Pipelines: `SIZE_X/SIZE_Y` in metres, `PIPE_MATERIAL` text, `NETWORKNAME`; `ELEV_FROM/ELEV_TO`
  are offsets from the terrain at each end. Pipe connectors stand on the terrain and rise by
  `HEIGHT`; `ELEVATION_OFFSET = -depth` makes them span invert to rim.
- `UTILITY_TYPE`, `PART_TYPE` are read-only Int32 codes InfraWorks sets itself
  (`.files/styles/panels/CorePanelSchema.json`): never map them. The utility leads NETWORKNAME.
- A ring with no area (a 1 mm hole) makes InfraWorks drop the whole polygon.

## OpenFlows (SewerGEMS / WaterGEMS) databases

- `HMIModelingElement`: `Label`, `IsDeleted` (read only `IsDeleted = 0`).
- Geometry `*_HmiDataSetGeometry_Data.HMIGeometry`: WKB XY, in FEET. `HMIRealGeometry` is XYZ
  and often empty: do not use it. Topology `BaseLink_HMIDataSetTopology_Data`.
- Data tables `<Type>_<Group>_Data` keyed by `DomainElementID` + `AlternativeID`; all lengths,
  levels and diameters in feet internally (x 0.3048).
- Models often draw pipes against the flow: name ends start/end as drawn, record the flow.

## Where things stand (2 Nov 2026)

- main `a5e1dce`: PRs #1-#13 merged. Al Narjis and Al Qairawan roads, Al Qairawan plots
  (6,555, numbered), road reserve, blocks, asphalt; Al Qairawan sewer from SewerGEMS (902 pipes,
  901 manholes) with names, sizes, materials, network name and depths, all checked by G3 and
  seen in InfraWorks ("Al qirawan test 3 (depth)").
- Next: potable water and irrigation from WaterGEMS
  (`...\Al-Qairawan Grading\01 Submission Folder\Vol. 01_Drawings\Potable Water\Potable Water Hydraulic Model.zip`,
  `...\Irrigation\Hydraulic Model_IRR.zip`). Explore the schema first: WaterGEMS is a pressure
  model with no inverts. Then storm drainage and dry utilities from drawings (no models found).