# Namar 60 % DD: session log

Goal: a NEW InfraWorks 2026 model of Namar (Dahiyat Namar, Package 3, code DN) from Parsons' 60 % Detailed Design
submission, from the best source per element (route agreed by the user, 13 Nov 2026). The 30 % run (`HANDOVER.md`,
model `C:\IW\Namar`) is the template and stays untouched as the reference.

## Session 1 (13 Nov 2026)

Branch `feat/namar-60` from main `2e1b2a0` (PR #29).

### Where the data is

OneDrive `Documents\03 WIP\TAWAZUN PROGRAM\03_Parsons\Submission\Namar\01 Submission Folder 60%` (1 479 files). Sheet
names `LDIP-RCRC-SAP-03-DN-<DISC>-DWG-<nnnnn>-<sss>-<rev>` (rev `00`). Al Narjis files mixed in (NRJS) are left out.

| Volume | Content used | Not modelled (reason) |
| --- | --- | --- |
| 01 Drawings | ROD 10200..10900, 30000, 30100, 40000 (13); SWN, STO, PWT, IRR, ELV, EMV, SLT, TEL, ICT, TRF, UTL plans (-000 + cut sheets) | ARC, Building-Mechanical, STR, MEP, ICA, FLS: buildings (irrigation pump station, sewage lift stations SLS-1/2), not InfraWorks infrastructure layers |
| 02 Reports | `LDIP-RCRC-SAP-03-DN-DES-RPT-00003-001-00.pdf` (60 % DD report, 12 Nov 2026, 609 pages) | STR calculation report |
| 04 Models | hydraulic models (4), `Roads Profiles\C3D_Nemar_Aligments_Profiles.dwg`, ROD-MOD-90000-001..004, utility MOD-90000 DWG / IFC | Federated NWD, NWC, DWFx (viewing formats); building RVT |
| 08 CRS | PMC comments on the 30 % package with Parsons' replies | |

### Hydraulic models (13 Nov 2026)

7-Zip is not installed, but Windows' own `tar` (bsdtar 3.8.9, libarchive) reads the `.7z` archives: extracted with
`tar -xf` to `DATA_DIR\inputs\namar-60\hydraulic\<sewer|water|irrigation|storm>`.

| Model | Package | Content | Warnings |
| --- | --- | --- | --- |
| Sewer `Sewage Model-Rev 04.stsw.sqlite` | `Namar60-sewer-shp-v1` | 168 pipes (9.21 km), 171 manholes / outfalls | ASSET_ID_DUPLICATE CO-27 (2 pipes) |
| Storm `Dahiyat Nemar-SWD-DD60-R00.stsw.sqlite` (new: none at 30 %) | `Namar60-storm-model-shp-v1` | 111 pipes (4.75 km), 111 manholes + 4 outfalls; 1 pond and 340 catchments not shipped | |
| Water `PW_Model-Rev 04.wtg.sqlite`, cover 1.2 m | `Namar60-water-shp-v1` | 195 pipes (10.82 km), 76 structures (reservoir + hydrants) | ASSET_ID_DUPLICATE FH-75 |
| Irrigation `Nemer Hydraulic Model.wtg.sqlite` (differs from 30 %), cover 1.2 m | `Namar60-irrigation-shp-v1` | 233 pipes (8.97 km), 8 structures | |

Fix on real data: the SewerGEMS reader named every layer `sewer_*`; with `--utility Storm` it now ships `storm_pipes` /
`storm_manholes` (prefix from the utility, as the WaterGEMS reader; test in `sewer.test.ts`).

The storm package also holds two Civil 3D LandXML road surfaces, both "TOP ROADS_COMBINED": `C3D_Nemar Land_Main Design
File 9.xml` (19 Sep, no CRS, one point at Z -0.147) and `Namar Roads Design Surface.xml` (28 Oct, EPSG 32638 stated).

### Covers and depths: 60 % report (13 Nov 2026)

Text pulled with the new `scripts/pdf-text.cjs` (ToUnicode maps, object streams; no PDF tool on this laptop).

| Item | Value | Section | Change from 30 % |
| --- | --- | --- | --- |
| LV / MV burial depth (cable centre) | 0.65 / 0.80 m | §3.3.3 | none (was §2.3.3) |
| Potable water cover | >= 1.2 m under traffic, >= 1.0 m outside | §6.3.14 | none (was §5.3.14) |
| Sewer cover to the pipe top | 1.5 m without protection, 0.5 m with (Table 8.2) | §7.3.1.2 | 1.2 -> 1.5 m (model has inverts) |
| Irrigation cover | mainline and secondary 1.2 m (NWC), tertiary 0.6 m | §8.2.2 | none |
| Storm soil cover over the crown | >= 1.2 m | §10.2.7 | none (model has inverts) |
| Telecom trenches | 600 mm deep, concrete backfill above the conduits (STC) | §14.5.1 | new |
| MIFON / security ducts | microduct bundles in concrete-encased duct banks, no depth | §14.7.2 | no depth still |

Water and irrigation keep the user's 30 % choice of 1.2 m (AICC, 11 Nov 2026).

### New model, DXF conversion (13-14 Nov 2026)

- `C:\IW\Namar 60\Namar 60.sqlite` + `.files`: robocopy of the OneDrive base model `TAWAZUN PROGRAM\Infraworks\Package 3 -
  Site 04 Dahiyat Namar` (1 + 1 882 files; sqlite hash 64F8942C..., the same base as the 30 % copy), renamed. Integrity ok,
  proposal `master`, `.files` clean. Still holds the September layers (sources 5-18, 43 roads, 767 parcels): for the user
  to remove (Data Sources panel, Remove Data Source).
- 39 sheets (plans -000, ROD 30000 / 30100 / 40000, UTL 30000) and the 14 DN model DWGs copied to `C:\Temp\namar60-dwg`,
  converted with `dwg-to-dxf.cjs` to `C:\Temp\dxf\namar60` (log `C:\Temp\dxf\namar60-convert.log`).

### Surfaces (14 Nov 2026)

- ROD-MOD-90000-001 (190 553 faces, NGL), -002 Site Grading (62 420), -003 Roads Surface (287 471; it crashed
  accoreconsole at 30 %, converts now), -004 905 3DSOLIDs (no surface: not used). EXPORTTOAUTOCAD leaves each TIN inside an
  `AecObjExplode_<drawing>_Vport_<n>` block, so `readDxfFaces` read nothing: it now takes the faces of blocks inserted in
  ENTITIES, placed by the insert (test in `tin.test.ts`).
- `C:\IW\data\namar60\DN-ROD-MOD-90000-002 Site Grading (60).xml` ("DN Site Grading (60)"): 30 795 points, 59 740 faces,
  the same counts as the 30 % file: Site Grading unchanged.
- `C:\IW\data\namar60\DN-ROD-MOD-90000-003 Roads Surface (60).xml` ("DN Roads Surface (60)"): 146 457 points, 270 338 faces.
- Against the hydraulic rims (`rim - surface`): sewer 166 rims med 0.000 (-0.670..0.000) on the Roads Surface, med +0.697
  on the Site Grading; storm 108 rims med 0.000 (-0.495..+0.039) on the Roads Surface. **At 60 % the manhole rims sit on the
  finished roads surface** (at 30 % on the mass grading). Parsons' own LandXML `Namar Roads Design Surface.xml` (28 Oct,
  in the storm package) equals the converted -003 (grid of 4 524 points: med 0.000, max 2.50 m at a few edge cells).
- Proposed stack: Roads Surface (60) on top, Site Grading (60) below, survey `NAMAR` at the bottom (visible). Pipe offsets
  (water / irrigation cover 1.2 m) are then from the finished road, which is the "under traffic" case of §6.3.14.

### Roads: the 60 % layout (14 Nov 2026)

ROD-10200-000 (direct DXFOUT: EXPORTTOAUTOCAD crashed) binds `Xref Road Layout Dahiyat Nemar` and `Xref Dim_Names Dahiyat
Nemar` as at 30 %, but the layout xref's `_CL` holds 1 LWPOLYLINE + 1 LINE (47 at 30 %): the centrelines are now Civil 3D
alignments, which a DXF does not carry (the 30 % profile `parsons-dn-roads` finds 2). Kerbs `__Curb` 143, `__ROW` 44,
`Road edge` 105, RA-01 still drawn (circles on `__Curb` and `Road edge`). Roads therefore come from the alignments
(LandXML export of `C3D_Nemar_Aligments_Profiles.dwg`, asked of the user 13 Nov; the EXPORTTOAUTOCAD DXF of that DWG holds
them exploded, with 1 078 FG / EG profile labels, as the fall-back).

Plots: the baseplan xref `Ladun Dahiyat Namar Baseplan` bound into 10200 draws plot lines as 1 075 LINEs + 80 ARCs
(`MP-PLT-LIN`), 774 plot numbers (`MP-PLT-TXT`), villa footprints (`MP-VIL-FTP`, 3 017) and new facility footprints:
sewage lift stations `PS-SL1-FTP` / `PS-SL2-FTP`, irrigation pump station `PS-IRR-FTP`.

ROD-10300-000 ("Overall road centerline setting-out plan") has no centreline geometry either: same xrefs as 10200.

Sheet titles (from the PDFs, `pdf-text.cjs`): 10200 road layout with curb setting-out, 10300 centreline setting-out, 10400
existing contours, 10500 road grading contours, 10600 roads cut and fill, 10700 sections, 10800 rough grading cut / fill
stake-out, 10900-001 intersection visibility, **10900-002 "Roundabout geometric design check, Roundabout-01"** (new);
ICT-10000 / 10100 = ICT and smart-city microducts (primary 2 x 7-way 20/16 mm, secondary 1 x 2-way); TEL-10100 = telecom
secondary civil network. STO-10000-000 and ROD-10900 converted in a second run (`C:\Temp\dxf\namar60\sheets2`; the first
filter missed sheet names without the revision suffix).

RA-01 at 60 % (ROD-10900-002, xref `Xref Round about Checks Nemar`): same centre E 657 300.4 N 2 714 451.4, ICD 40.40 m,
ring centreline r 20.20, island kerb r 12.00 (road edge 12.30), ring carriageway 7.60 m, lane line r 16.10, entry / exit
radii R15 / R20 / R25, fastest-path radii R22.85-R49.45: the ring is unchanged from 30 %. Question 15 depends on whether
the neighbouring junctions moved (to check on the 60 % alignments).

### Dry networks: models vs drawings (14 Nov 2026)

- 3D model DWGs (ELV / EMV / SLT / TEL-MOD) after EXPORTTOAUTOCAD: the cables are flat 2D LINE / ARC pieces
  (`PRN_PR_LV_CAB`, `PRN_PR_MV_CAB`, `PRN_PR_SL_CAB`, `PI_PR_TE_DCT`); only the pillars, substations and panels are solids
  standing on the ground. No depths there; the drawings stay the source of the routes.
- The IFCs carry levels. Against the 60 % Roads Surface (IFC points inside the site, after `IFCRIGIDOPERATION`): LV cable
  segments (3 273 IfcPipeSegment, EPSG 32638) p10-p90 -0.72..-0.61 m, median -0.68 (report §3.3.3: 0.65 m to the cable
  centre); **telecom ducts (1 319, EPSG 32738 = UTM 38 South, wrong hemisphere as AICC's review found; the offsets are
  the 38N values) a constant -0.50 m**; irrigation (785) median -1.04 m. Street lighting and water IFCs place their
  points relative to local placements (no site offset): not read.
- So telecom depth (Parsons question 9) has an answer in Parsons' own model: duct axis 0.50 m below the finished road,
  inside the report's 600 mm trench (§14.5.1).
- The 30 % dry profile on the 60 % sheets finds LV 4 434 lines (49.58 km), 215 pillars, 18 substations, 3 lighting
  panels, 43 security ducts / 104 handholes, but no MV, street lighting or telecom: the 60 % sheets wrap the design in an
  `AecObjExplode_<sheet>_Vport_<n>` block with the xrefs nested inside, and layers moved (MV cables now
  `Xref_Nemar_MV Network$0$Xref_Nemar_MV Network_Correct Corr$0$Xref_MV Network$0$MV Cables - Loop1 (PSS)`, 21; telecom on
  `Primary telecom x` / `TelNetPrimary`; ICT on `Primary Duct` 43, `Seconday Duct` 783, `Smart Primary Duct` 16; the
  corridors under `Ladun_Dahiyat Nemar_Utilities Corridor$0$` instead of `Xref-Ladun_...`). New 60 % profiles needed.

### 60 % drawing profiles and packages (14 Nov 2026)

One profile per sheet (types.ts, `parsons-dn60-*`; tests `namar60.test.ts`): bare layer names repeat across sheets
(TEL_HH is telecom on TEL sheets, ICT on ICT sheets), and the 30 % layer names moved. Fix on real data: `dedupePoints`
takes a tolerance in metres (each street-light pole is a 3D block and a plan symbol 4 cm apart).

| Package (`DATA_DIR\exports`) | Source | Content |
| --- | --- | --- |
| `Namar60-power-shp-v1` | ELV + EMV-10000-000 | LV 4 434 lines (49.58 km; cables + house connections, 0.65 m), 215 pillars; MV 21 cables (7.03 km, 0.80 m, 200 mm), 18 substations + 1 RMU |
| `Namar60-streetlighting-shp-v1` | SLT-MOD-90000-001 DWG | 60 cables (12.96 km, 110 mm, on the terrain), 313 street lights (POI), 4 panels |
| `Namar60-telecom-shp-v1` | TEL-10000-000 | 83 primary ducts (8.39 km, 0.50 m from the IFC), 60 handholes |
| `Namar60-telecom-secondary-shp-v1` | TEL-10100-000 | 776 secondary cables (52.48 km, 0.50 m) |
| `Namar60-ict-shp-v1` | ICT-10000-000 | 842 ducts (66.63 km: primary, smart primary, secondary, security), 44 handholes; on the terrain |
| `Namar60-fittings-shp-v1` | PWT + IRR-10000-000 | water valves 113, water pipes as drawn 493 (11.04 km, 1.2 m); irrigation gate valves + washouts 121, pull boxes + quick couplings 152, control cable 635 (9.08 km), pipes as drawn 725 (9.21 km; 23 without size) |
| `Namar60-areas-shp-v1` | ROD-10200-000 | plots 878 (774 numbered, no number twice; 104 unnumbered faces), blocks 39, road reserve 1 |
| `Namar60-corridors-shp-v1` | UTL-10000-000 | 13 corridor layers (no street-lighting or Tree_IRS_SL corridor at 60 %) |

Left out, with reason: ICT-10100 (repeats ICT-10000's secondary ducts; question 10); irrigation valve chambers (55, they
house the gate valves); water house connections (`Xref-Potable Water HC`, 3 442 lines, new at 60 %) and the corridors'
house-connection xref (161 per utility): service lines, not in the 30 % scope; STO-DWG-10000 (the storm model is the
source); ROD-MOD-90000-001 NGL (the survey is the existing ground) and -004 (905 solids, no surface); hydrants from
PWT-10000 (the WaterGEMS model has 75); the storm model's pond and 340 catchments.

### Corridor check (14 Nov 2026)

`corridor-check.mts --district namar60` (district `namar60`: each layer names its 60 % package; the 30 % Namar and Al
Narjis reports are unchanged): `scripts/namar/corridor-check-60.md`. Drawn networks 85-94 % in their own corridor (storm
model 95 %, sewer model 94 %); the WaterGEMS models are not: water 34 %, irrigation 36 %; irrigation control cable 3 %;
telecom 64 % and ICT 61 % (much of the rest in the house-connection place). Parsons questions 16, 17 stay open.

### CRS (Vol. 08)

PMC comments on the 30 % package with Parsons' replies (7 sheets). Relevant: Roads CRS row 17 (RA-01 geometry, ER
7.12(c)): "a Roundabout geometry check drawing will be added in the next submission", status Open.
