# Al Narjis: session log

Goal: one Al Narjis InfraWorks model (Riyadh, UTM 38N, InfraWorks `UTM84-38N`) on the path proven
for Al Qairawan (`scripts/road-pilot/HANDOVER.md`): component roads, junctions, utility networks,
plots, each checked by Gate G3.

## Session 1 (9 Nov 2026): inventory of Parsons' deliverables (read only)

Prerequisite checked: main at `4cf5a20` (PR #26: `--skip-layers`, `--tie-ends`, G3-026).

### Where the data is

- Parsons' 30% CD submission, Package 1 Al Narjis, district code **NRJS**:
  OneDrive `Documents\03 WIP\TAWAZUN PROGRAM\03_Parsons\Submission\Narjis` (179 files, both
  laptops): `Files_01 Submission Folder_2026-09-16_07-30-44am` (173 files, DWG + PDF, no DXF; the
  same names and sizes as the copy in this laptop's `Downloads\01 Submission Folder`) and `Al-Narjis
  Rough Grading Plan (19-08-26)` (grading plan LAI-LDIP-01-CIV-DWG-00001, its CRS reply, and the
  designer's grading LandXML + DWG). Read in place; not copied to `DATA_DIR\inputs`.
- Early trials: `C:\Temp\iwg3\narjis` (sheet `10001-0A.dxf`, truncated; package of 11 centrelines +
  project boundary, G3 PASS on model `Nurjis test`), `C:\Temp\iwg3\narjis2` (despite the name, Al
  Qairawan 10100: 332 centrelines at x 657 096-660 125).
- `Nurjis test.sqlite` (OneDrive `03 WIP\Neom\10_AI Tools & Scripts\InfraWorks Test Model`, 1.5 MB,
  29 Oct): the trial import only. Not a base for the real model.
- This laptop: AutoCAD 2026 + Civil 3D 2026 Object Enabler, InfraWorks; no Civil 3D, no ODA File
  Converter, no PDF text tool (PDF sheets could not be read in this session).

### What the data says

- **The site is small.** Project boundary 376 x 542 m (x 663 754-664 130, y 2 756 689-2 757 231).
  The bound xref `Xref Road Layout Al Narjis` in sheet 10001 holds the whole layout drawing (a bound
  xref carries all of it): 7 roads on `RD_CL`, 4 on `RD_CL External Road` (11 centrelines, 3.09 km),
  ROW `__ROW`, edges `RD_Edge`, kerb returns `RD_CURB_RETURN`, `Project Boundary`. All three hydraulic
  models fall inside the same window. So Parsons question 11 ("one sheet window only") is most
  likely answered: there is no larger layout. To confirm on the sheet index (IRO-00002) or with
  Parsons.
- Layer names differ from Al Qairawan (`RD_PR_CNRL`, `RD_ROW`, `-RD_Edges`, `0-Alignment Name`):
  model:roads and the gate's `--layout` read Al Qairawan's names, so they need an Al Narjis profile.
- The 10001 DXF is cut off (`DXF_TRUNCATED`): only sub-blocks of `Xref Dim_Names Al Narjis` (road
  names) and `Xref Ladun AlNarjis Baseplan` (plot types Townhouse, Single-Side Duplex, Villa A / B)
  survived, so names and plots need a clean DXF export.
- Hydraulic models (read with `readHydraulicModel`, dry; all `quick_check` ok, UTM 38N):
  | Model | Live | Deleted | Notes |
  | --- | --- | --- | --- |
  | Sewer `AL-NARJIS_option 5.stsw.sqlite` | 20 pipes (1.25 km), 21 manholes / outfalls | 46 pipes | inverts and rims present |
  | Water `alnarjes hydraulic model REV02.wtg.sqlite` | 41 pipes (1.38 km), reservoir | 42 pipes | scenario "Peak Daily + FF (Static)"; no cover |
  | Irrigation `Narjis Model.wtg.sqlite` | 47 pipes (1.25 km), 3 valves, pump, reservoir | 133 pipes, 2 switched off | scenario "Peak Distibution"; no cover |
- Roads 3D models `Vol. 04_Models\Roads` MOD-00001..00003 (DWG, IFC2X3, NWC, DWFx, 14 Sep 2026):
  IFC meshes only (9 266 / 44 051 / 17 182 faces, Z up to 679.6 / 677.8 / 676.4 m), unnamed
  proxies. Probably Civil 3D surfaces / corridors; which is the finished grade is not stated in
  the files. No LandXML in the submission.

### Inventory (Al Qairawan input -> Al Narjis)

| Al Qairawan input | Al Narjis file | State |
| --- | --- | --- |
| Road layout 10200 (centrelines, names, ROW, kerb edges) | IRO-DWG-00-10001 / 10002 (xref `Road Layout Al Narjis`, names in `Dim_Names`) | partial: geometry read (11 CL, ROW, edges, kerb returns); names lost in the truncated DXF; needs a clean DXF |
| Profiles 40000 | IRO-DWG-00-40001, 40002 | DWG only: DXF needed |
| Typical sections 30000 | IRO-DWG-00-30001 | DWG only: DXF needed |
| Plots / blocks 10100 | none as a separate drawing; xref `Ladun AlNarjis Baseplan` in 10001 | partial: plot-type blocks only; DXF needed (or the baseplan drawing) |
| Grading surface (LandXML) | `Al-Narjis Rough Grading Plan (19-08-26)\Grading Files From Designer (Attachment)\AL-Narjis Grading_ Roads TOS.xml` (surface "Compiled Grading", Civil 3D 2024, 17 Aug 2026) | present: 7 788 points, 15 413 faces, E 663 748-664 132, N 2 756 684-2 757 238 (covers the project boundary), Z 670.42-677.75, CRS UTM84-38N in the file |
| SewerGEMS `.stsw.sqlite` | `Sewer\Hydraulic Model.zip` | present (20 pipes, 21 MH) |
| WaterGEMS water `.wtg.sqlite` + cover source | `Potable Water\Hydraulic Model.zip` | present; cover source missing (Al Qairawan: PWT-10000 note 5) |
| WaterGEMS irrigation + cover source | `Irrigation\Hydraulic Model_IRRNarjis.zip` | present; cover source missing |
| STO storm | ISW-DWG-00-00001..10003 | DWG only |
| SWN sewer drawings | ISE-DWG-00-00001..10002 | DWG only (model above preferred) |
| PWT / IRR drawings (valves, hydrants) | IPW-DWG-00-*, IRW-DWG-00-* | DWG only |
| ELV / EMV | ILV-DWG-00-*, IMV-DWG-00-* | DWG only |
| SLT | ISL-DWG-00-* | DWG only |
| TEL / SEC | ITE-DWG-00-*, IIC-DWG-00-* (Digital Infrastructure) | DWG only; which is telecom / security to confirm |
| Utility corridor sections (UTL-30000) | IUC-DWG-00-30001 | DWG / PDF |
| Design report (depths) | `Vol. 02_Reports\SAPL-DSN-LDN-RPT-000003.pdf` | present, not read (no PDF tool here); Al Narjis or shared report? |
| - | BOQ `Vol. 07_BOQ\Package 1_Al Narjis_30% CD Rev.00.xlsx` | present (quantities to cross-check) |

### Existing Al Narjis model (Sep 2026)

`TAWAZUN PROGRAM\Infraworks\ALNARJIS\Al Narjis.sqlite` (OneDrive, 10 Sep; a stale `.lock` of
16 Sep), UTM84-38N. Sources: Model Builder (`elevation`, `imagery`, OSM `roads` 92 / `landuse` /
`waterways`), the survey surface `Narjis Survey C3D - SURFACES` (E 663 577-664 226, N 2 756 541-
2 757 558: a wide terrain around the whole site), `Al Narjis grading.tif` (surface + textures),
and 12 `NRJ_*_SHIFTED` layers (plots 112, facilities 14, parking, landscape, road areas).
- The `_SHIFTED` layers came from the land-subdivision plan `20260114_LSD_Al Narjis Land
  Subdivision Plan_v00.dwg`, whose new layer tree sat 1 108.09 m off (dE -1 107.5615, dN +34.3112,
  no rotation or scale; README in `Claude outputs\NRJ_Shifted_to_Survey.zip`). After the shift the
  boundary is E 663 754.3-664 130 / N 2 756 689-2 757 231: exactly the 30% CD project boundary.
  So **the 30% CD submission is already in place on the survey; no shift for it.**
- Base for the new model: its survey + DEM terrain (as Al Qairawan's base model); its OSM roads and
  `_SHIFTED` layers do not belong in the design model.

### Working copy (9 Nov 2026)

`C:\IW\Al Narjis.sqlite` + `.files`: robocopy of the model above (InfraWorks not running, the
`.lock` gone by then). Same sqlite hash (17903AA9...), 1 205 / 1 205 `.files` files, integrity ok,
`.files` Git clean, one proposal (`master`). To do in InfraWorks (user): remove the Model Builder
`roads` / `landuse` / `waterways` and the twelve `NRJ_*_SHIFTED` sources (Manage > Content > Data
Sources, Remove Data Source), add the grading LandXML on top of the survey surface (Surface Layers).

Other copies found (compared read-only with `C:\IW\Al Narjis`, 9 Nov):
- `C:\IW\Al Narjis\Al Narjis.sqlite` + `.files`: byte-identical sqlite, same `.files` commit; a
  duplicate of the working copy; deleted (user, 9 Nov).
- **Working copy now `C:\IW\Al Narjis\Al Narjis.sqlite` + `.files`**: the user moved it into the
  folder at 13:13 and opened it there (cleanup below).

### Cleanup in InfraWorks (user, 9 Nov 13:13-)

Removed: Model Builder `roads`, `landuse`, `waterways`; `NRJ_*_SHIFTED` plots 20x15 / 25x12 / 30x10,
facilities, landscape, road areas. Left at the screenshot: coverage `NRJ_Boundary_ProjectSite (2)`;
imagery `imagery`, `Al Narjis grading.tif (2)` / `(3)`; parcels `NRJ_Plots_All_SHIFTED`; parking
`NRJ_Parking_Areas_SHIFTED`; project site `NRJ_Boundary_ProjectSite_SHIFTED`; terrain `elevation`,
`Narjis Survey C3D - SURFACES` (IMX), `Al Narjis grading.tif` (raster, 3 Sep, source not recorded).
Then (13:20-13:28) the user removed the rest of the `_SHIFTED` sources and `NRJ_Boundary_ProjectSite
(2)`, and imported the grading LandXML straight from the OneDrive folder: source `AL-Narjis Grading_
Roads TOS - Surfaces`, CRS UTM84-38N read from the file; surface layers edited (4 `.files` commits).
Resource `Resources\LandXML\4d174c16-...\Compiled Grading.aecc.<hex>.pnt/.tri`, longest `.files`
path 145 characters (the model sits on `C:\IW`, so the source's long path does not matter). Kept:
imagery `imagery`, `Al Narjis grading.tif (2)` / `(3)`; terrain `elevation`, survey IMX,
`Al Narjis grading.tif`, the LandXML.
Surface Layers (user's screenshot): Ground Surface = `Compiled Grading` (LandXML, top, on),
`Al Narjis grading.tif` (off), `NARJIS` (survey, on), `elevation` (DEM, on): grading on top of a
wider terrain, as in Al Qairawan.
- `Documents\Autodesk InfraWorks Models\Autodesk 360\2266988\Al Narjis.sqlite` (29 Oct, the cloud
  model's local cache): the same model plus the trial `road_centerline` source (11 planning roads,
  ROADS 92 -> 103, 2 intersections). Nothing in it that the 30% CD path does not redo.
- `Documents\Autodesk InfraWorks Models\Al Narjis1.sqlite` (31 Aug): the survey surface
  `Narjis Survey C3D - NARJIS` only.

### Packages built

| Package | Source | Content | Validation |
| --- | --- | --- | --- |
| `DATA_DIR\exports\Al-Narjis-sewer-shp-v1` (+ zip) | `inputs\narjis\hydraulic\AL-NARJIS_option 5.stsw.sqlite` (from the submission zip) | 20 pipes (200 mm HDPE-Corrugated, depths 1.60-7.08 m), 21 manholes (rim 671.87-675.63, depth 1.70-7.18), network "Sewer - AL-NARJIS_option 5" | OK, no warnings |

| `DATA_DIR\exports\Al-Narjis-irrigation-shp-v1` (+ zip) | `inputs\narjis\hydraulic\Narjis Model.wtg.sqlite`, scenario "Peak Distibution" | 47 pipes (1.25 km; HDPE 2 x 110, 26 x 90, 19 x 75 mm), 5 structures (reservoir, 3 isolation valves, pump), network "Irrigation - Narjis Model"; cover 0.80 m ASSUMED (centre 0.837-0.855 m below terrain) | OK, no warnings |

Irrigation cover: the IRW-00001/00002 general notes (user screenshot, 9 Nov) give none; they state HDPE
PE100 SDR11 PN16 and nominal outside diameters, which match the sizes read from the model (inside
diameter x 11/9). 0.80 m is an AICC assumption (as Al Qairawan), pending Parsons; likely in a trench
detail. Water (`alnarjes hydraulic model REV02.wtg.sqlite`) still waits for a cover source (IPW notes).

### Sewer imported (9 Nov 2026)

- User (13:32): `sewer_pipes` (Pipelines) and `sewer_manholes` (Pipeline Connectors) from
  `exports\Al-Narjis-sewer-shp-v1\shp`, UTM84-38N; seen on the grading surface along the roads.
- Model closed, proposal `master` (the only one), `.files` clean. `model:names` with the package
  zip into a scratchpad copy: NAME, sizes, depth, network, offsets filled (manholes 21, pipes 20;
  outfall O-1 has no size: none in the SewerGEMS model). G3 on the copy: **PASS, 0 warnings**
  (21/21 manholes, 20/20 pipes, 1 251 m, offset 0.00 m, all named). Installed after checking the
  working file was unchanged (hash E86B62D8... -> 60630133...); integrity ok; G3 rerun on the
  working copy: PASS, 0 warnings.

### Irrigation imported (9 Nov 2026)

- User: `irrigation_pipes` (Pipelines) and `irrigation_structures` (Pipeline Connectors) from
  `exports\Al-Narjis-irrigation-shp-v1\shp`. Model closed, proposal `master`, `.files` HEAD
  unchanged by the copy. `model:names` into a scratchpad copy: structures 5 (NAME, NETWORKNAME),
  pipes 47 (NAME, sizes, material, network, ELEV_FROM/TO). G3 on the copy: **PASS, 0 warnings**
  (5/5, 47/47, 1 251 m, all named). Installed (hash B5B2860B... -> E3680A78...); integrity ok;
  G3 on the working copy with the irrigation and the sewer packages: both PASS, 0 warnings.

### Water package (10 Nov 2026)

- Cover from the user (AICC, 10 Nov): **1.20 m from the finished road surface to the pipe crown,
  NWC typical value**. The model terrain there is Parsons' grading (Roads TOS), so the offsets are
  taken from it.
- `exports\Al-Narjis-water-shp-v1` (+ zip) from `alnarjes hydraulic model REV02.wtg.sqlite`:
  41 pipes (HDPE SDR11: 22 x 160, 15 x 200, 4 x 250 mm; nominal from inside diameter), 1 structure
  (reservoir), centre 1.280-1.325 m below terrain. Validation OK, no warnings.
- Imported by the user (`water_pipes` Pipelines, `water_structures` Pipeline Connectors). Model
  closed, proposal `master`, `.files` HEAD unchanged. `model:names` on a scratchpad copy: 1 + 41
  rows filled (NAME, sizes, material, network, ELEV_FROM/TO). G3 on the copy: **PASS, 0 warnings**
  (1/1, 41/41, 1 378 m). Installed (hash 72BF2107... -> 0BB60C02...); integrity ok; G3 on the
  working copy with the water, irrigation and sewer packages: all PASS, 0 warnings.

### DXF exports (10 Nov 2026, AYNLAP1201)

- The 77 DWGs of `Vol. 01_Drawings` copied with robocopy to `C:\Temp\narjis-dwg`, converted by
  `scripts/dwg-to-dxf.cjs` to `C:\Temp\dxf\narjis` (same folders). 69 through EXPORTTOAUTOCAD (IRO-10001:
  AUDIT fixed 573 errors, Civil 3D surface and styles inside); 8 crashed accoreconsole in
  EXPORTTOAUTOCAD and are direct DXFOUT: ILV/IMV-10001/10002, ISW-10001/10002/10003, IRO-60001.
- The 1:500 cut sheets 10001/10002 hold the same bound network as the 10000 general plan (same counts
  per layer on LV): read the 10000 sheets.
- The plans bind `Ladun AlNarjis Baseplan` (plots MP-PLT-LIN 192 lines, MP-PLT-TXT 123 numbers, as Al
  Qairawan) and `Ladun AlNarjis Road Layout`; IRO-10001 binds `Xref Road Layout Al Narjis` (RD_CL,
  __ROW, RD_Edge, RD_CURB_RETURN) and `Xref Dim_Names Al Narjis`.
- ODA comparison asked of the other laptop: samples in `DATA_DIR\inputs\narjis\dxf-acad`, result to
  `oda-compare.md` there.

### Roads and plots package (10 Nov 2026)

- Road names are MTEXT on `0-Alignment Name` in the bound `Xref Dim_Names Al Narjis`, present in the
  cut sheets 11000-14002 only (10001 has L1-L9 dimension labels instead). The reader now opens an xref
  that holds only label texts, and `RD_CL*` reads names like `RD_PR_CNRL` (test in sheet.test.ts).
- `exports\Al-Narjis-11000-shp-v1` (+ zip) from `C:\Temp\dxf\narjis\Roads\BIND\...IRO-DWG-00-11000-0A.dxf`:
  - 11 centrelines (Roads), all named: ROAD-01 (15m / 18m R.O.W), ROAD-02 (15m / 18m), ROAD-03, -04,
    -05 (18m) and 4 x EXTERNAL ROAD. Lengths match the profile EPs (ROAD-01 18m 492.1 vs 0+492.073,
    ROAD-05 114.3 vs 0+114.345, ROAD-02 15m 88.7 vs 0+088.706).
  - 145 plots (Parcels) from MP-PLT-LIN, 123 numbered (300-8,596 m2, no duplicates); 22 without a
    number on the plan (20 strips of 70-148 m2, one 328 m2, two of 3,706 / 4,118 m2).
  - Project Boundary (Coverage Areas). Validation OK; warnings: 22 plots without a number,
    50 DIMENSION entities skipped, unmapped layers.
- Not shipped yet: blocks / road reserve (Al Narjis draws the ROW on `__ROW`, not RD_ROW).

### Component roads (10 Nov 2026)

- User imported `Al-Narjis-11000-shp-v1` (Roads, Parcels, Coverage Areas) and converted ROAD-01
  (18m R.O.W) to a component road (right-click > Convert to Component Road): the template, CD GUID
  `05049575-6277-44fc-8952-2e38f48b0df7`. The conversion took the road out of its data source
  (EXTERNAL_ID and DATA_SOURCE_ID null, no name), and InfraWorks made 12 arms + 8 regions linking it to
  the planning roads it crosses, by their ROADS.GUID.
- Tool changes (each with a test): model:names fills a source with fewer rows than records when every
  row keeps its own record number; `readDxfBlock` reads "A|B" and "*Model_Space" (the profile sheets
  explode each Civil 3D view into an anonymous *U block); alignments read RD_CL (and LINE pieces);
  sections read __ROW / RD_Edge; PVC / PVT labels split into two TEXTs ("PVC 0+045.188", "ELEV
  673.594") are paired (ROAD-03's sag was dropped, leaving a 0.97 m step at ROAD-05's end); the writer
  replaces a planning road of the same name, its definition taking the planning road's GUID so those
  junction rows stay valid, and picks template terrain operations by type (the converted road has
  3 x Grading, Grading, CutOut); G3-013 counts component roads of the same name as arrived.
- Inputs: layout `IRO-DWG-00-11000-0A.dxf` blocks "Xref Road Layout Al Narjis|Xref Dim_Names Al
  Narjis_1"; profiles `IRO-DWG-00-40001-0A.dxf` "*Model_Space" (40002 is the same sheet); surface
  `AL-Narjis Grading_ Roads TOS.xml` "Compiled Grading". 7 profiles, 0 PVI issues; 7 of 7 alignments
  equal their profile length; none reversed. Sections A1 (15 m) / A2 (18 m) per IRO-30001 (same as
  Al Qairawan: lanes 3.30, kerb 0.30, 2 %); 6 typed from __ROW, ROAD-02 (15m R.O.W) = A1 from its name
  and the plan's "15.00m R.O.W." label (its ROW is not drawn as polylines). Crossfall from the surface.
- On a scratchpad copy: model:names, template named, then
  `model:roads ... --section "ROAD-02 (15m R.O.W)=A1"`: 7 written, 6 planning roads replaced, 0 level
  problems, 0 junction steps >= 0.3 m. The 4 "EXTERNAL ROAD" stay planning roads (no profile).
  Installed (hash EE644B06... -> 75141E48...); integrity ok. G3 on the working copy: --layout PASS
  (1 warning: G3-022, the 20 arm / region rows InfraWorks made without INTERSECTIONS rows, already
  there before the write); 11000 (11/11 roads, 145/145 plots), sewer, irrigation, water: PASS, 0
  warnings. Do not Refresh `road_centerline`: it would bring the replaced planning roads back.

### Order proposed

1. Copy the submission into `DATA_DIR\inputs\narjis` (stable shared place).
2. Model `C:\IW\Al Narjis` in UTM84-38N with a wide terrain; the grading surface on top once a
   LandXML (or the right Vol. 04 surface) is available.
3. Sewer now (model complete); water and irrigation once the cover is sourced.
4. DXF exports (AUDIT, EXPORTTOAUTOCAD, DXFOUT to `C:\Temp\dxf`) of 10001, 40001, 40002, 30001 and the
   utility plan sheets: then names, plots, dry networks, storm, and the roads.

### Crash on the first Grading Limit edit (10 Nov 2026)

- The user's Grading Limit edit (5.000 -> 5.1) crashed InfraWorks three times: access violation in
  AIM_ModelRoad.dll+0xa7f28 (read near null; dump `%LOCALAPPDATA%\Temp\InfraWorks_error.dmp` 14:11,
  read with `scripts/road-pilot/minidump.cjs`). The model held 12 arms + 8 regions with no
  INTERSECTIONS row (made by InfraWorks at the ROAD-01 conversion; G3-022 warned of them).
- `model:intersections` on a copy removed the 20 rows; G3 --layout PASS, 0 warnings; installed
  (7AB8AFD4... -> B3ADB366...). model:roads now prunes such rows after every write.

### Junctions and kerb returns (10 Nov 2026)

- After the cleanup the user's Grading Limit edits worked on every road: InfraWorks built 7 junctions
  (21 arms, 14 corners); G3 --layout PASS, 0 warnings.
- Kerb returns: Al Narjis draws them on RD_CURB_RETURN at the dimensioned radii (R12.00, R11.00; the
  RD_Edge arcs lie 0.30 m out); `kerbLayer` picks that layer when present (Al Qairawan has none, keeps
  -RD_Edges; test in curb-returns.test.ts). `model:intersections --curb-returns <11000.dxf>
  --layout-block "Xref Road Layout Al Narjis"` on a copy: 12 corners set (11 x 12 m, 1 x 11 m), 1
  already 11 m, 1 without a drawn arc (junction 4, region 7: ROAD-05's end on ROAD-03, corner at 200
  deg; InfraWorks' 9 m kept; to ask Parsons). Installed (41A3FE5A... -> E6BE04FB...). G3 --layout PASS
  (G3-025: 13 at the drawn radius, 1 without an arc), 11000 / sewer / irrigation / water PASS, 0 warnings.

### Dry networks and storm packages (10 Nov 2026)

- Depths and sizes from Al Narjis' own report `SAPL-DSN-LDN-RPT-000003` ("30% Concept Design Report
  for Al Narjis", Vol. 02_Reports; text pulled from the PDF's streams): §2.3.3 burial depth to the cable
  centre 0.65 m LV / 0.80 m MV; §2.3.9 MV conduits 200 mm; §2.3.23.2.2.1 street lighting ducts 110 mm
  O.D. uPVC; §5.6.7 storm soil cover over the crown >= 1.2 m. Same values as Al Qairawan's report.
- New profiles `parsons-nrjs-dry-utilities` / `parsons-nrjs-wet-utilities` (Al Qairawan's untouched;
  networks named "<utility> - Al Narjis"; tests in narjis.test.ts).
- `exports\Al-Narjis-storm-shp-v1` from ISW-10000 (block SYSTEM-01): 54 pipes (400-800 mm from the layer
  names, cover 1.2 m), 44 manholes + 2 outfalls (depth to the deepest pipe within 2 m). OK, 1 warning
  (unmapped layers).
- `exports\Al-Narjis-dry-shp-v1` from ILV / IMV / ISL / ITE -10000 and IIC-13000: LV 60 cables + 589
  house connections (0.65 m), 31 mini pillars, MV 10 cables (0.80 m, 200 mm), 4 substations, 37 street
  lights + 1 panel (no cable lines drawn), telecom 150 ducts + 13 handholes, security 142 ducts + 9
  handholes. Telecom / security / LV sizes 0.1 m for display; their depths are not in the documents
  (drawn on the terrain). OK, 2 warnings (HATCH skipped, unmapped layers).
- Each pillar is an "LV Panel" dynamic block on MINI-PILLAR-0 holding the pillar symbol (MINI-PILLAR-2)
  and 19 house connections: opened (`explode: true`). The lighting panel is drawn again in the LV xref:
  that copy is left out.
- Off site, kept as drawn (to ask Parsons): an LV group ~450 m south of the site (substation SSNA001
  1000 kVA, DP1-1: a pillar, 19 house connections, 9 cables), one substation and a storm line with an
  outfall ~200 m east of the site.

### Storm and dry networks imported (10 Nov 2026)

- User imported both packages (12 data sources). Model closed, proposal master. model:names with the
  storm package, then the dry one, on chained scratchpad copies: every size, network, depth and offset
  column filled. G3 on the copy with --layout and all seven packages (11000, sewer, irrigation, water,
  storm, dry): PASS, 0 warnings; integrity ok, 27 data sources. Installed (018340F1... -> BD157E7A...).

### Blocks and road reserve package (10 Nov 2026)

- __ROW (IRO-11000, bound road layout) closes around 8 blocks: some drawn closed, some with meeting
  ends; the rest are loose edges, left out. Profile `parsons-nrjs-areas`: blocks = closed __ROW,
  road reserve = Project Boundary less the blocks (test in areas.test.ts).
- `exports\Al-Narjis-areas-shp-v1`: blocks 8 (3,252-27,265 m2, none overlapping), road reserve 1
  (21,577 m2 plus two slivers of 12 and 8 m2 between block edges and the boundary). OK; warnings:
  8 open __ROW lines left out, unmapped layers. Both import as Coverage Areas.

### Blocks and road reserve imported; all checks (11 Nov 2026)

- User imported `Al-Narjis-areas-shp-v1` (blocks, road_reserve as Coverage Areas). Model closed,
  proposal master, 29 data sources, integrity ok. G3 on the working copy with --layout and the eight
  packages (areas, 11000, sewer, irrigation, water, storm, dry): all PASS, 0 warnings (G3-025: 13 of 14
  corners at the drawn radius, 1 without a drawn arc). Questions for Parsons: `parsons-questions.md`.

### Water valves and fire hydrants package (11 Nov 2026)

- Found missing after the "all checks" entry: IPW-10000 carries water fittings the WaterGEMS model lacks
  (and IRW-10000 irrigation valves, not done yet). Rules added to `parsons-nrjs-wet-utilities`:
  valves on `Xref Potable$0$C-WATR-APPT`, air valve, washout (drawn on C-STRM-STRC, matched with the
  xref prefix so it is no storm outfall), fire hydrants = the circle on C-PW-FIRE HYDRANT COVER CATCH in
  anonymous blocks on layer 0. The reader now opens a block whose only content is an `asPoint` shape
  (test in narjis.test.ts).
- `exports\Al-Narjis-water-fittings-shp-v1`: 12 fire hydrants (on site), 21 valves: air valve and
  washout on site, 19 valves ~1 km south-east of the site with no pipe drawn there (kept as drawn,
  Parsons question 10). OK; warnings: HATCH / MULTILEADER skipped, unmapped layers.

### Water fittings imported (11 Nov 2026)

- User imported `Al-Narjis-water-fittings-shp-v1` (water_hydrants 12, water_valves 21, Pipeline
  Connectors). model:names on a copy: NETWORKNAME filled (12 + 21). G3 on the copy with --layout and the
  nine packages: PASS, 0 warnings; integrity ok, 31 data sources. Installed (1767DCA2... -> ABAF6226...).
- Still to do: irrigation valves from IRW-10000 (Parsons question 11).

### Irrigation valves package (11 Nov 2026)

- IRW-10000 (block "Xref Irrigation_1", nested network xrefs): rules in `parsons-nrjs-wet-utilities`
  for isolation valves (layer "Isolation valve", each a block holding the gate and butterfly symbols),
  air valve, washout valve, flow sensor / master valve chambers (L-IRRG-CHMB). Test in narjis.test.ts.
  Not taken: pull boxes, quick couplings, two-wire decoder cable, tie-ins (no valves).
- `exports\Al-Narjis-irrigation-valves-shp-v1`: 13 (9 isolation, 2 flow sensor / master valve, 1 air,
  1 washout); 2 isolation valves 100-300 m south of the site (Parsons question 11). OK; warnings:
  DIMENSION / HATCH / LEADER skipped, unmapped layers.

### Irrigation valves imported (11 Nov 2026)

- User imported `Al-Narjis-irrigation-valves-shp-v1` (13, Pipeline Connectors). model:names on a
  copy: NETWORKNAME 13. G3 with --layout and the ten packages: PASS, 0 warnings; integrity ok, 32 data
  sources. Installed (8DDA3526... -> 4B574D37...). Not modelled: irrigation pull boxes, quick
  couplings, two-wire decoder cable and tie-ins; utility corridor sheets (IUC, widths only). Open
  items for Parsons: parsons-questions.md.

### Irrigation extras and utility corridors (11 Nov 2026)

- `parsons-nrjs-wet-utilities` also reads IRW-10000's pull boxes (25), quick couplings (8), tie-ins (18)
  and the two-wire decoder cable (24 lines, on the terrain). `exports\Al-Narjis-irrigation-dwg-shp-v1`
  (built with --skip-layers irrigation_valves, already imported): irrigation_structures_dwg 51
  (Pipeline Connectors), irrigation_control_cable 24 (Pipelines).
- New profile `parsons-nrjs-corridors`: the IUC-10000 corridor lines of the bound
  "Xref_Al Narjis_Utilities Corridor" (legend copies left out) as display-only Pipelines
  "Corridor - <utility>" (5 cm, no depth). `exports\Al-Narjis-corridors-shp-v1`: 414 lines, 13 corridors.
- `corridorFit` (domain) and `scripts/narjis/corridor-check.mts`: share of each network within 1 / 2 m
  of its corridor. Results and reading in `corridor-check.md`: sewer and MV follow theirs; water and
  irrigation (WaterGEMS) follow the sewer corridor; storm a third. Parsons questions 12, 13.
- Corridors v1 (one Shapefile) showed every corridor in one colour, hidden under the road body (user,
  11 Nov). `exports\Al-Narjis-corridors-shp-v2`: one Shapefile per corridor (13), 0.15 m wide, lifted
  1.0 m above the terrain (new `depth.liftM`; roads stand ~0.6 m above the grading surface), each with
  its IUC layer colour in `CORRIDOR_COLOURS.txt`. The v1 source is to be removed from the model.

### Drawn pipes, corridor bands, nearest-corridor check (11 Nov 2026)

- Drawn pipes beside the hydraulic models: rules in `parsons-nrjs-wet-utilities` (IPW layers "160" /
  "200" / "250", IRW "Irrigation Network-HDPE-<mm>", 50 mm secondary, 75 mm tie-ins, ISE "SS_Pipe Dia
  200"; networks "<utility> - Al Narjis (drawing)", covers as the WaterGEMS packages, sewer on the
  terrain). `exports\Al-Narjis-pipes-dwg-shp-v1`: water 10 (1,778 m), irrigation 33 (1,428 m), sewer 20
  (1,251 m), all Pipelines.
- `corridorBands` + `scripts/narjis/corridor-bands.mts`: `exports\Al-Narjis-corridor-bands-shp-v1`, one
  Coverage Areas Shapefile per corridor (13), each line widened by half the spacing to the nearest other
  corridor (0.17-0.90 m each side, cap 1.0 m). No manifest: display only, outside G3.
- `corridorAssignment` (nearest corridor among all) replaces the 1 m tolerance in `corridor-check.mts`;
  order per network: corridor, drawing, model. Findings in `corridor-check.md`; questions 12-13 updated.

### Corridor colours (11 Nov 2026)

- User coloured corridor_irrigation (Pipelines) and corridor_band_irrigation (Coverage Areas) by hand:
  InfraWorks wrote DATA_SOURCES.CONFIG propertyMappings.RULE_STYLE = "'Pipeline/Green Circle'" and
  "'x00FF00FF'" (a colour code, RGBA), and the same value in each feature's RULE_STYLE (`.files` commit
  a095490). `scripts/narjis/corridor-styles.cjs` writes the IUC colours the same way: exact codes on the
  bands, the nearest of InfraWorks' 11 pipeline styles on the lines (LocalLibrary\Styles\Pipeline).
  Its dry run reproduces the user's two choices. The other 12 + 12 corridor files and the drawn pipes
  are not imported yet.
- Coverage Areas drape on the terrain (Draping Options: Drape or one Set Elevation): they cannot follow
  the road surface; the lifted Pipelines are the corridors seen above the roads.
- Exact colours (11 Nov): the user made one style in the Style Palette ("IUC Telecom", x7CA500FF).
  InfraWorks keeps such styles in the model: `<model>.files\unver\Content\Styles\Material\Colors\CORRIDOR
  color\`, `...\Material\CORRIDOR color\` and `...\Pipeline\` (.ACItem JSON + .png). The Pipeline style is a
  copy of Green Circle whose tube material is the new colour; "ambient" is half the colour.
  `scripts/narjis/corridor-style-library.cjs` writes the 14 "IUC <name>" styles the same way (its Telecom
  matches InfraWorks' own file for file); `corridor-styles.cjs` now gives each corridor line
  'Pipeline/IUC <name>'. 39 style files written into the working copy; corridors not yet all imported.
- Corridors imported by the user (13 + 13; corridor_irrigation twice: "corridor_irrigation (2)" to
  remove, G3-011). The user removed the Material\CORRIDOR color copy; the library script no longer
  writes it. corridor-styles.cjs on a copy: 27 sources styled (Pipeline/IUC <name> on the lines, the
  exact colour code on the bands); then model:names with irrigation-dwg and corridors-v2 (NETWORKNAME,
  sizes, ELEV_FROM/TO = the 1.0 m lift). Installed (9D3AD37B... -> 11CF6921... -> 50BB736A...). G3: layout
  and every package PASS, 0 warnings, except corridors-v2: G3-011 for the duplicate source.

### Networks in Parsons' utility colours (11 Nov 2026)

- The network sheets colour by layer (telecom and security alike: primary duct blue, secondary red);
  IUC-DWG-10000 is the submission's one per-network colour scheme. `scripts/narjis/network-styles.cjs`
  gives pipes and cables "Pipeline/IUC <name>" and the network nodes (sewer / storm manholes, water and
  irrigation structures) new "PipeConnector/IUC <name>" styles (Circle, tube and cap in the colour, as
  InfraWorks' Orange Circle), written into the model's style library. Valves, hydrants, pillars,
  handholes, substations, street lights keep their 3D shapes; security keeps its own (no IUC corridor).
- On a copy: 12 sources restyled, integrity ok; installed (50BB736A... -> C8C2E56D...), 4 PipeConnector
  styles added. G3 with the network packages PASS.
