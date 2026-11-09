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
  duplicate of the working copy; deleted (user, 9 Nov). The working copy stays at
  `C:\IW\Al Narjis.sqlite` (user's decision).
- `Documents\Autodesk InfraWorks Models\Autodesk 360\2266988\Al Narjis.sqlite` (29 Oct, the cloud
  model's local cache): the same model plus the trial `road_centerline` source (11 planning roads,
  ROADS 92 -> 103, 2 intersections). Nothing in it that the 30% CD path does not redo.
- `Documents\Autodesk InfraWorks Models\Al Narjis1.sqlite` (31 Aug): the survey surface
  `Narjis Survey C3D - NARJIS` only.

### Packages built

| Package | Source | Content | Validation |
| --- | --- | --- | --- |
| `DATA_DIR\exports\Al-Narjis-sewer-shp-v1` (+ zip) | `inputs\narjis\hydraulic\AL-NARJIS_option 5.stsw.sqlite` (from the submission zip) | 20 pipes (200 mm HDPE-Corrugated, depths 1.60-7.08 m), 21 manholes (rim 671.87-675.63, depth 1.70-7.18), network "Sewer - AL-NARJIS_option 5" | OK, no warnings |

The water and irrigation `.wtg.sqlite` are extracted beside it, waiting for a cover source.

### Order proposed

1. Copy the submission into `DATA_DIR\inputs\narjis` (stable shared place).
2. Model `C:\IW\Al Narjis` in UTM84-38N with a wide terrain; the grading surface on top once a
   LandXML (or the right Vol. 04 surface) is available.
3. Sewer now (model complete); water and irrigation once the cover is sourced.
4. DXF exports (AUDIT, EXPORTTOAUTOCAD, DXFOUT to `C:\Temp\dxf`) of 10001, 40001, 40002, 30001 and the
   utility plan sheets: then names, plots, dry networks, storm, and the roads.
