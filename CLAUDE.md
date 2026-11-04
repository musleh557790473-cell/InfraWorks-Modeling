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
- Before telling the user how to do something in InfraWorks, look it up in Autodesk's help
  (https://help.autodesk.com/view/INFMDR/ENU/, topics under `cloudhelp/ENU/InfraWorks-Basics/`;
  fetch with WebFetch, the built-in browser blocks the site) and cite it. Never guess menu paths.

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
pnpm package:build "<drawing.dxf | model.stsw.sqlite | model.wtg.sqlite>" [--profile parsons-ldip-roads]
#   WaterGEMS: --utility <Water|Irrigation> --cover <m> --cover-source "<where the cover comes from>"
pnpm gate:model "<model>.sqlite" --package <package.zip>      # Gate G3, on a closed model
pnpm model:names "<model>.sqlite" --package <package.zip> [--out "<copy>.sqlite"]
pnpm model:roads "<model>.sqlite" --template <guid> --layout <10200.dxf> --profiles <40000.dxf> --surface <grading.xml> [--package <road_centerline>] [--dry]
#   Al Qairawan: add --section R.9.G.6=A1,R.9.G.7=A1 (AICC decision for the two roads the drawing does not type)
pnpm model:intersections "<model>.sqlite" [--dry]               # drop intersections left on a deleted road
```

## Inputs from Parsons

- DWG from Civil 3D: AUDIT, then EXPORTTOAUTOCAD, then Export DXF to a folder outside OneDrive.
  A plain export stops at Civil 3D objects and leaves a DXF without EOF (`DXF_TRUNCATED`);
  EXPORTTOAUTOCAD may set `$INSUNITS` to feet while coordinates stay UTM metres.
- Sheets bind the design in as xrefs (`<xref>$0$<layer>`): read through the bound xref.
  EXPORTTOAUTOCAD may rename an xref block (`Xref Storm Network_1`) while its layers keep the old
  prefix; the reader accepts both.
- ODA File Converter is installed on one laptop only. On the other, ask the user for DXF exports
  (to `C:\Temp\dxf`); never invent a converter or download one unasked.
- Depths missing from drawings come from the design report `LDIP-RCRC-SAP-01-AQ-DES-RPT-00001`
  (Vol. 02_Reports): storm min cover 1.2 m (§8), LV 0.65 m / MV 0.80 m to cable centre (§3.3.3).
  Utility corridor sections (UTL-DWG-30000) give widths only, no depths.
- Projects are in UTM 38N (EPSG:32638, InfraWorks `UTM84-38N`): Riyadh (Al Narjis, Al Qairawan).
  NEOM is UTM 36N. A model created in the wrong zone fails G3-002 / G3-006.
- Prefer the designer's own data to drawing labels: SewerGEMS / WaterGEMS models
  (`<model>.stsw.sqlite`, `<model>.wtg.sqlite`) hold every pipe and node with sizes and levels.
  Source order for attributes: model data, then labels, then title block / general notes, then
  schedules shipped with the drawings. If none gives a value (e.g. a depth), ask; never invent it.

## InfraWorks facts (verified in InfraWorks 2026 models)

- A model is `<name>.sqlite` + `<name>.files`; `<name>.lock` while open. Work on copies only.
- Keep ONE working copy per task and update it in place; do not make a new copy for each fix
  (the user asked: too many copies cause confusion). Never write while its `.lock` exists: ask the
  user to close the model first. Road pilot working copy: `C:\IW\Al Qairawan Roads (Parsons 6 junctions)`.
- Keep models on a short path outside OneDrive (e.g. `C:\IW`). `.files` is a Git repo that
  InfraWorks commits on every edit; a LandXML import writes
  `Resources\LandXML\<guid>\<surface>.aecc.<32 hex>.pnt`, and past 260 characters its Git fails
  ("Filename too long") and the model no longer opens. Copy such a model with robocopy to a
  short path and open it there. Copy-Item also fails on OneDrive online-only files.
- InfraWorks 2026 imports Civil 3D DWG only with Civil 3D 2026 installed; with another release
  use the LandXML export of the surface (set UTM84-38N by hand: the file carries no CRS).
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
- Component-road H arcs are stored by start / mid / end point: split arcs over 90 degrees, or a
  near-closed arc (a roundabout drawn as one arc) becomes undefined (length 0.0 m).
- Walls hanging under the terrain at the site edge: only Parsons' Mass Grading (site only) was
  visible (`TERRAIN_SURFACES.LAYERS` visibility); features past its edge have no ground. Keep a
  wider terrain visible below it (survey / DEM), Mass Grading on top: Manage > Display > Surface
  Layers, light bulb = visible, drag to reorder, Apply regenerates (Autodesk help "To add or
  modify surface layers"). Check with `scripts/road-pilot/extent.cjs <model>`.
- Scripting Console in InfraWorks 2026: **Ctrl+2** (Utilities "Scripts"; the gear opens Application
  Options, Ctrl+9). Read from AIM_Toolbar.dll; the help's "Utilities > Glyph > Scripts" path is gone.
  The output pane cannot be copied: return short lines and read them on screen. API seen
  (`scripts/road-pilot/iw-probe.js`): `app.ActiveModel.RoadModel` (readRoadModel, regenModel,
  invalidateModel, saveUpdates, getRoadID, addPVI, createRoad...), `app.ActiveModel.Intersections`
  (updateIntersections, findIntersectionById), `app.ActiveModelDb` (Table, BeginTransaction,
  ExecuteSqlCommand), `app.Regenerate`. Autodesk calls this API unofficial.
  Signatures come from the Qt metadata in `AIM_JavaScriptAPI.dll` (every method reports length 0).
  `RoadModel.readRoadModel(id)` takes the road's CONSTRAINED_DEFINITIONS.ID (RA-2: 299), not
  ROADS.ID (280, the "ID" in the properties panel): with 280 it returns false and stays empty.
- InfraWorks' intersections point at roads by the road's CONSTRAINED_DEFINITIONS GUID
  (INTERSECTION_ARMS.FK_ASSET_GUID, INTERSECTION_REGIONS.FK_INCOMING/OUTGOING_ASSET_GUID), not
  ROADS.GUID. model:roads keeps both GUIDs when it replaces a road, so they stay valid.
- `<model>.files` keeps every InfraWorks edit as text rows (`exploded/<TABLE>/<n>`): diff its Git
  history to see what InfraWorks wrote, read-only, without opening the model.
- InfraWorks rebuilds a component road (body, and the intersections where it meets other roads)
  only on a single-road edit. Rebuilding RA-1 split it into 4 pieces between its arms and created
  9 intersections; the one-piece closed ring model:roads writes draws a stray band until then.
- Find a feature by name (Autodesk help "To select features in the model"): Model Explorer >
  right-click the class (Surface Layers > Roads) > Select By Filter, expression `NAME = 'R.5.G.1'`
  (single quotes, `=`), OK; then F (Zoom to Selection). The class must be unlocked (padlock).
  Model Explorer lists classes and subsets only, not single features.

## OpenFlows (SewerGEMS / WaterGEMS) databases

- `HMIModelingElement`: `Label`, `IsDeleted` (read only `IsDeleted = 0`).
- Geometry `*_HmiDataSetGeometry_Data.HMIGeometry`: WKB XY, in FEET. `HMIRealGeometry` is XYZ
  and often empty: do not use it. Topology `BaseLink_HMIDataSetTopology_Data`.
- Data tables `<Type>_<Group>_Data` keyed by `DomainElementID` + `AlternativeID`; all lengths,
  levels and diameters in feet internally (x 0.3048).
- Models often draw pipes against the flow: name ends start/end as drawn, record the flow.
- Real live elements only: `IsDeleted = 0`, `ElementType = 3` (9 is a prototype), and active in
  the model's active scenario, child alternatives overriding their parent (irrigation's
  Peak-Distribution switches the transmission pipe off). Zero-length pipes are left out.
- WaterGEMS (pressure) has no inverts: depth only from a stated cover (`--cover`, with
  `--cover-source`): centre = cover + half the outside diameter below the terrain. PE pipes
  carry the bore: an inside diameter within 1.5 mm of a standard size x 9/11 is that SDR 11
  nominal size (130.8 mm is 160), per the PWT notes "HDPE PE100-SDR11".

## Where things stand (3 Nov 2026)

main after PR #20 (`aac7e3d`). Al Qairawan, all in UTM 38N, checked by Gate G3 and seen in
InfraWorks unless noted:

- Component roads (PR #20, `pnpm model:roads`): all 250 Parsons roads with name, plan elements,
  PVIs and vertical curves, typical section A1-C2 and crossfall side, written into the working
  copy `C:\IW\Al Qairawan Roads (Parsons 6 junctions)` (base for rebuilds: `... (Parsons 2)`,
  template road R.6.E.1, GUID `f501f75e-d927-4312-b06b-93cc4b55e402`). Checks: no level problems,
  one junction step >= 0.3 m (R.1.G.24 on R.1.G.23, 0.53 m). Untyped, template section: RA-1..RA-7
  (roundabouts), R.9.G.6, R.9.G.7. Junctions not modelled (approach roads run through the
  roundabout centres). Inputs: `DATA_DIR\inputs\road-pilot` (10200 and 40000 DXF), the grading
  LandXML `C:\IW\data\LDIP-RCRC-LAI-LDIP-01-CIV-DWG-00002-01.xml`; history in
  `scripts/road-pilot/HANDOVER.md`.

- Roads (332 centrelines, 280 named), plots (6,555, 5,944 numbered), road reserve, blocks,
  asphalt. Al Narjis: one sheet window only (11 centrelines).
- Sewer from SewerGEMS: 902 pipes, 901 manholes; names, sizes, materials, depths.
- Potable water from WaterGEMS: 895 pipes (74.07 km), reservoir R-2; cover 1.0 m
  (PWT-DWG-10000-001 note 5).
- Irrigation from WaterGEMS: 1,074 pipes (51.75 km), valves, pump, reservoir; cover 0.80 m
  ASSUMED by AICC, pending confirmation from Parsons.
- From the drawings (PR #14, checked in PR #18, no hydraulic model): storm drainage (648 GRP
  pipes sized from layer names, cover 1.2 m; 663 manholes/outfalls deep to the deepest pipe),
  water valves (818) and hydrants (351), irrigation valves (199), and dry networks: LV (0.65 m)
  and MV (0.80 m, 200 mm) cables, street lighting (110 mm), telecom, security, substations,
  pillars, CCTV and street lights (Points of Interest). LV/HV/telecom/security sizes are 0.1 m
  for display only. Model `Al qirwan test 4 (names)`: G3 PASS, 0 warnings.

Open points: confirm the irrigation cover with Parsons; depths of telecom, security and
street-lighting ducts (not in the Parsons documents, drawn on the terrain); the full Al Narjis road layout
(`Xref Road Layout Al Narjis.dwg`) from Parsons; Al Narjis and other districts through the same path.
Roads: junctions and roundabouts as InfraWorks intersections; the roundabout circulatory width;
a band InfraWorks draws away from RA-1 when it is selected (not in its stored rows; test: change
its Grading Limit and undo); to raise with Parsons: R.3.G.1 stands 5 m above their grading surface
over its first 100 m, and R.1.G.24 starts 0.535 m below loop R.1.G.23 (both profiles as printed).
