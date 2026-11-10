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
