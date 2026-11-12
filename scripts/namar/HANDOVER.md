# Namar (Dahiyat Namar): session log

Goal: one Namar InfraWorks model (Riyadh, UTM 38N, InfraWorks `UTM84-38N`) on the path of Al Narjis
(`scripts/narjis/HANDOVER.md`): component roads, junctions, utility networks, plots, corridors, each
checked by Gate G3.

## Session 1 (11 Nov 2026): inventory of Parsons' deliverables (read only)

Prerequisite: main at `1ac4750` (PR #28). Branch `feat/namar-start` made locally; `git pull` failed on
the company network (CRYPT_E_NO_REVOCATION_CHECK), to redo on the hotspot before pushing.

### Where the data is

OneDrive `Documents\03 WIP\TAWAZUN PROGRAM\03_Parsons\Submission\Namar` (615 files), two submissions:

- **`10-2026`** (sheets dated 11 Oct 2026): sheet names `LDIP-RCRC-SAP-03-DN-<DISC>-DWG-<nnnnn>-<sss>-<rev>`,
  district code **DN** (Dahiyat Namar, Package 3). Disciplines ROD, SWN, STO, PWT, IRR, ELV, EMV, SLT,
  TEL, SEC, UTL. The newest and most complete set (adds the utility corridor sheets): the proposed base.
  `Drawings.zip` / `Reports.zip` in the same folder are the same files zipped (266 entries).
- `2026.09.08_30% Concept Design Submission D Namar` (Sep 2026): the first 30% CD, names
  `LDIP-RCRC-SAP-03-NMAR-<IRO|ISE|...>-DWG-00-<nnnnn>` (code **NMAR**, as Al Narjis' NRJS), plus
  `Models\Roads` (3 x DWG / IFC / NWC / DWFx), the BOQ (`Package 1_Dahiyat Namar _ 30% CD Rev.00.xlsx`)
  and report `SAPL-DSN-LDN-RPT-000002.pdf` (Sep). Superseded by 10-2026 except the BOQ.
- `(WF's of 30% Concept Design for Dahiyat Namar.zip`: 12 transmittal PDFs (one per package).
- `to infraworks\PARSONS_SAPL_NMAR_Submission*`: an earlier AICC extraction (9 Sep) of one DWG
  (`...NMAR-IRO-DWG-001-0001.dwg`) into 15 Shapefiles (765 plots, 46 centrelines, ROW, asphalt...).
  Pre-30% CD; not a source for this model.

### Inventory (Al Narjis input -> Namar, 10-2026 set)

| Discipline | Namar files (10-2026) | Count | Notes |
| --- | --- | --- | --- |
| Roads: index / legend / notes | ROD-DWG-00001..00003 | 3 | |
| Roads: layout plans | ROD-DWG-10200 (key plan -000 + cut sheets -001..005) | 6 | Al Narjis IRO-11000 equivalent (to confirm on DXF) |
| Roads: further plan series | ROD-DWG-10300, 10400, 10500, 10600 (each -000..005) | 24 | titles to read on DXF / PDF (signage, marking, grading?); 10600 is 34-58 MB per sheet |
| Roads: typical sections | ROD-DWG-30000-001 | 1 | |
| Roads: profiles | ROD-DWG-40000-001..014 | 14 | |
| Roads: other | ROD-DWG-50000-001, 50200-001, 60000-001..003 | 5 | details |
| Roads: 3D models | ROD-MOD-90000-001 NGL, -002 Site Grading, -003 Roads Surface (DWG, IFC, NWC, DWFx) | 3 | Civil 3D surfaces in DWG; **no LandXML**. InfraWorks 2026 reads Civil 3D 2026 DWG on this laptop (Civil 3D 2026 installed), or a LandXML export |
| Sewer | SWN-DWG-00001/00002, 10000-000..005 + SewerGEMS `Rev.01_Op.4.stsw.sqlite` (SWN-MOD-00001) | 8 + 1 | model preferred |
| Potable water | PWT-DWG-00001/00002, 10000-000..005 + WaterGEMS `PW_CD_Model.wtg.sqlite` (PWT-MOD-00001) | 8 + 1 | cover source needed |
| Irrigation | IRR-DWG-00001/00002, 10000-000..005 + WaterGEMS `Nemer Hydraulic Model.wtg.sqlite` (IRR-MOD-00001) | 8 + 1 | cover source needed |
| Storm | STO-DWG-00001/00002, 10000-000..005 | 8 | drawing only |
| LV | ELV-DWG-00001/00002, 10000-000..005, 60000-001 | 9 | one file name starts with `'` |
| MV | EMV-DWG-00001/00002, 10000-000..005, 60000-001 | 9 | |
| Street lighting | SLT-DWG-00001/00002, 10000-000..005, 60000-001 | 9 | |
| Telecom | TEL-DWG-00001/00002, 10000-000, 10100-000 | 4 | |
| Security | SEC-DWG-00001/00002, 10000-000, 10100-000 | 4 | |
| Utility corridors | UTL-DWG-00001/00002, 10000-000..005, 30000-001/002 | 10 | |
| Design report | `10-2026\Reports\LDIP-RCRC-SAP-03-DN-DES-RPT-00001.pdf` (78 MB) | 1 | depths, sizes, covers |
| BOQ | Sep `BOQ\Package 1_Dahiyat Namar _ 30% CD Rev.00.xlsx` | 1 | quantities to cross-check |

Total 10-2026: 130 DWG (+ the same as PDF), 3 hydraulic models, 3 road surface models, 1 report.

### Existing Namar InfraWorks model

`TAWAZUN PROGRAM\Infraworks\Package 3 - Site 04 Dahiyat Namar.sqlite` + `.files` (OneDrive, 1 Oct
2026, 9.7 MB, no `.lock`), with backups of 13 Sep. Read only: data sources `Namar Topo C3D - SURFACES`
(survey), `Dahiyat Namar Site Grading - SURFACES` (Sep grading), and Sep-era layers
`NMR_Plots_Residential_v02`, `SAP_Facilities`, `SAP_Asphalt_Areas`, `NMR_Survey_Wadi_Edges`,
`NMR_Official_Boundary_S7`, `NMR_Road_Hierarchy_v02`, `NMR_ROW_Areas_v02` (43 roads, 767 parcels, no
pipes). Terrain surfaces `NAMAR` (off) and `Nemer Mass Grading` (on). As for Al Narjis: base = its
survey terrain; the Sep layers do not belong in the design model; the grading to be replaced by the
10-2026 Site Grading / Roads Surface model.

### Agreed order (user, 11 Nov 2026)

The 10-2026 (DN) set, in the order proposed: DXF conversion; model `C:\IW\Namar`; sewer; roads and
plots, component roads, junctions, kerbs; storm, dry networks, water / irrigation fittings; corridors
and colours; water and irrigation once the cover is agreed.

### DXF conversion (started 11 Nov 2026)

The 130 DWGs of `10-2026\Drawings` copied with robocopy to `C:\Temp\namar-dwg` (713 MB); converting with
`node scripts/dwg-to-dxf.cjs C:\Temp\namar-dwg C:\Temp\dxf\namar` (log `C:\Temp\dxf\namar-convert.log`).

### Hydraulic models (read dry, 11 Nov 2026)

Extracted to `DATA_DIR\inputs\namar\hydraulic` from the 10-2026 zips (all inside E 656 662-657 939,
N 2 714 038-2 714 883: one site of about 1.3 x 0.85 km, UTM 38N):

| Model | Live | Left out | Sizes |
| --- | --- | --- | --- |
| Sewer `Rev.01_Op.4.stsw.sqlite` (SWN-MOD-00001) | 164 pipes (9.26 km), 166 manholes / outfalls | 22 deleted | corrugated HDPE 149 x 200, 15 x 250 mm; 1 node without a usable rim |
| Water `PW_CD_Model.wtg.sqlite` (PWT-MOD-00001), scenario "Peak Daily + FF" | 121 pipes (10.87 km), reservoir | 113 deleted | HDPE 105 x 160, 15 x 200, 1 x 250 |
| Irrigation `Nemer Hydraulic Model.wtg.sqlite` (IRR-MOD-00001), scenario "Peak Distribution" | 291 pipes (9.45 km), 8 structures (reservoir, 3 air valves, 3 isolation valves, pump) | 2 switched off | HDPE 157 x 90, 109 x 75, 11 x 110, 10 x 160, 3 x 200, 1 x 71 (odd size); 26 labels used twice |

### Depths and sizes from Namar's report (11 Nov 2026)

`10-2026\Reports\LDIP-RCRC-SAP-03-DN-DES-RPT-00001.pdf` ("30% Concept Design Report for Dahiyat Namar",
Sep 2026). Text pulled from the PDF streams; its subset TrueType fonts store glyph ids, read as
id + 29 = ASCII (the bullets of §5.3.14 are in that font).

| Item | Value | Section |
| --- | --- | --- |
| LV / MV burial depth (to the cable centre) | 0.65 m / 0.80 m | §2.3.3 (design parameters table) |
| MV ducts | concrete-encased duct banks, 200 mm | §2.3.9.3 |
| LV road crossings | concrete-encased 110 mm ducts | §2.3.10.3 |
| Street lighting ducts | 110 mm O.D. uPVC duct banks | §2.3.12.2.4.1 |
| Potable water cover | >= 1.2 m under traffic, >= 1.0 m outside traffic (or the maker's, whichever is greater) | §5.3.14 |
| Sewer cover to the pipe top | 1.2 m without protection, 0.5 m with | §6.3.3, Table 6.2 (the model has inverts) |
| Irrigation cover | mainline and secondary 1.2 m (NWC), tertiary 0.6 m | §8.2.2 design criteria table; tertiary laterals are designed in LANDFX, not in the WaterGEMS model |
| Storm soil cover over the crown | >= 1.2 m | §10.2.7 |

Same values as Al Narjis' and Al Qairawan's reports. Water: which of 1.2 / 1.0 m applies is for AICC
(pipes in the road reserve).

### Sewer package (11 Nov 2026)

`exports\Namar-sewer-shp-v1` (+ zip) from `Rev.01_Op.4.stsw.sqlite`: 164 pipes, 166 manholes / outfalls,
network "Sewer - Rev.01_Op.4". Validation OK, no warnings.

### Working model (11 Nov 2026)

`C:\IW\Namar\Package 3 - Site 04 Dahiyat Namar.sqlite` + `.files`: robocopy of the OneDrive model
(1 + 1 882 files; same sqlite hash 64F8942C...), integrity ok, proposal `master` (the only one), `.files`
clean. Every data source in UTM84-38N. Terrain: `NAMAR` survey (Z 666.7-785.2, hidden) and `Nemer Mass
Grading` (Sep, Z 750.9-781.6, visible).
Surfaces of the 10-2026 set extracted to `C:\IW\data\namar`: `...ROD-MOD-90000-002.dwg` (Site Grading,
4.6 MB) and `...ROD-MOD-90000-003.dwg` (Roads Surface, 14.8 MB), to add as Civil 3D DWG (Civil 3D 2026
on this laptop; Autodesk "To add Autodesk Civil 3D data to an InfraWorks Model").

### Water and irrigation packages (11 Nov 2026)

- Cover chosen by the user (AICC, 11 Nov): water **1.2 m** (report §5.3.14, under traffic: the pipes run in
  the road reserve); irrigation **1.2 m** (§8.2.2, mainline and secondary). Each pipe keeps its source in
  `cover_src`.
- `exports\Namar-water-shp-v1` (+ zip) from `PW_CD_Model.wtg.sqlite`: 121 pipes (HDPE 160 / 200 / 250),
  1 structure (reservoir), network "Water - PW_CD_Model", centre 1.280-1.325 m below the terrain. OK, no
  warnings.
- `exports\Namar-irrigation-shp-v1` (+ zip) from `Nemer Hydraulic Model.wtg.sqlite`: 291 pipes, 8 structures,
  network "Irrigation - Nemer Hydraulic Model", centre 1.235-1.300 m below the terrain. OK; warning
  ASSET_ID_DUPLICATE: 26 pipe labels used twice in Parsons' model (P-46, P-47, ... Tie In- 140): Parsons
  question.

### DXF conversion done (11 Nov 2026)

130 of 130 sheets to `C:\Temp\dxf\namar` (same folders as `C:\Temp\namar-dwg`). 120 through EXPORTTOAUTOCAD;
10 crashed accoreconsole there and are direct DXFOUT (Civil 3D objects stay custom objects): IRR-10000-001..005
(cut sheets; the 10000-000 general plan is clean), ROD-60000-001..003 (details), UTL-30000-001/002 (corridor
sections). The run ended on EPERM removing `_work` (a file still held): `dwg-to-dxf.cjs` now retries and
leaves the folder with a message instead of failing.

### Road layout DXF, first look (11 Nov 2026)

`ROD-DWG-10200-000` binds `Xref Road Layout Dahiyat Nemar` (insert `..._1`) and `Xref Dim_Names Dahiyat Nemar`
(spelt "Nemar"; the title block says "Namar"). Layers differ from Al Narjis again: centrelines `_CL`
(45 LWPOLYLINE, not RD_CL), ROW `__ROW` (43), edges `Road edge` (not RD_Edge), kerbs `__Curb` (ARC / LINE /
LWPOLYLINE; no RD_CURB_RETURN layer). Names: `0-Alignment Name` MTEXT (90) in Dim_Names; ROW widths
15 / 18 / 25 m as blocks `15MROW` / `18MROW` / `25MROW`. No plot baseplan xref in 10200 (to find in
another sheet). The readers need these names (a Namar profile, not a copy of Al Narjis').

### Imports and LandXML from the surface models (11 Nov 2026)

- User (screenshot 11 Nov): Sep layers removed; imported `sewer_*`, `water_*`, `irrigation_*` (Pipelines /
  Pipeline Connectors) and one `LDIP-RCRC-SAP-03-DN-ROD-MOD-90...` Civil 3D DWG source; terrain sources
  `Namar Topo C3D`, `Dahiyat Namar Site Grading` (IMX, Sep) kept. The user asked for LandXML of the two surface
  models instead.
- Civil 3D's LandXML export is a dialog only, so not headless. Route used: `dwg-to-dxf.cjs` on the surface DWG
  (EXPORTTOAUTOCAD writes the TIN as 3DFACEs when the surface style shows triangles), then the faces to a
  LandXML TIN (`<Pnts>` northing easting elevation, `<Faces>`; CRS UTM84-38N stated in the file).
- **Site Grading** (ROD-MOD-90000-002, 10-2026): 62 420 3DFACEs -> `C:\IW\data\namar\DN-ROD-MOD-90000-002 Site
  Grading.xml`, surface "DN Site Grading", 30 795 points, 59 740 faces (degenerate slivers under 1 mm dropped),
  E 656 614-657 973, N 2 714 016-2 714 916, Z 750.913-781.566. The same surface as September's: 61 965 of its
  triangles equal the Sep IFC's to 1 mm, same extent and Z range, and the same Z range as the model's existing
  `Nemer Mass Grading`.
- **Roads Surface** (ROD-MOD-90000-003): accoreconsole crashes opening the 10-2026 DWG ("ErrorStatus=53" while
  regenerating, also with `/product C3D`), so no DXF. The IFC beside it in the 10-2026 zip is byte-identical to
  September's IFC (`NMAR-IRO-MOD-00-00003.ifc`, 8 Sep): 232 203 faces, E 656 654-657 945, N 2 714 025-2 714 882,
  Z 753.976-780.637. The 10-2026 DWG differs from the Sep DWG by hash, so the IFC may be older than the DWG.
- **Roads Surface from the September IFC** (user's choice, 11 Nov): the IFC is a thin solid per surface: up-facing
  faces = the surface, down-facing = a copy 1 mm lower, plus edge walls. Checked on Site Grading: its IFC up faces hold
  61 792 of the 62 203 DXF triangles but also 62 707 m2 of overlapping extras (so Site Grading stays from the DXF).
  Roads Surface up faces: 81 927, 180 528 m2, plan overlap 55 m2 (edge sampling only). Written to
  `C:\IW\data\namar\NMAR-IRO-MOD-00-00003 Roads Surface (Sep IFC).xml`, surface "NMAR Roads Surface (Sep IFC)":
  57 540 points, 81 503 faces, E 656 654-657 945, N 2 714 025-2 714 882, Z 753.98-780.64.
- Both files read by `loadLandXmlSurface` (model:roads). Against the 165 SewerGEMS rims: rim - Site Grading median
  0.000 m (-1.494 to +0.126); rim - Roads Surface median -0.631 m (-1.519 to -0.199; 3 manholes outside it). Sewer
  rims sit on the mass grading; the roads surface is the finished road ~0.6 m above it (as Al Qairawan). Proposed
  stack: Site Grading on top, survey below; Roads Surface for reference (component roads build their own body).
  The water / irrigation offsets are from the terrain in the model: with Site Grading as terrain, the 1.2 m cover is
  from the mass grading, not the finished road.
- Converter now in the repo: `pnpm surface:landxml <surface.dxf|.ifc> <out.xml> --name "<surface>"` (domain `roads/tin.ts`,
  test `tin.test.ts`): DXF 3DFACEs, or an IFC's up faces; it stops when the faces overlap in plan (> 100 m2), as the
  Site Grading IFC does. Both files above regenerated with it (same counts).

### Networks named and checked (11 Nov 2026)

- User imported the Roads Surface LandXML (source `NMAR-IRO-MOD-00-00003 Roads Surface (Sep IFC) - Surfaces`, terrain
  `NMAR Roads Surface (Sep IFC)`; TERRAIN_SURFACES shows MIN_Z / MAX_Z 0 for it, to see in InfraWorks). Earlier the
  Civil 3D DWG source was ROD-MOD-90000-002 (surface `3D_PR_TR_RDSR_N`, Z 750.91-781.57: the Site Grading, the same as
  the Sep IMX). Surface layers at close: `NAMAR` survey hidden (priority 1), Mass Grading, 3D_PR_TR_RDSR_N, Roads
  Surface visible (2, 3, 4). The survey should be visible below the grading (site-edge walls otherwise; CLAUDE.md).
- Model closed, proposal master, 10 data sources, `.files` clean. model:names on scratchpad copies with the sewer,
  water and irrigation packages: every NAME, size, material, network filled; sewer ELEV_FROM / ELEV_TO 163 of 164 (the
  pipe at the manhole without a rim in SewerGEMS). G3 on the copy: sewer 166/166 + 164/164 (9 260 m), water 1/1 +
  121/121 (10 868 m), irrigation 8/8 + 291/291 (9 453 m), offsets 0.00 m, all named: **PASS, 0 warnings** each.
  Installed after the hash check (1FD93213... -> E10AEC27...); integrity ok; G3 on the working copy: all three PASS,
  0 warnings.

### Roads, blocks, road reserve and plots packages (11 Nov 2026)

- Where things are (10-2026 DXFs): `ROD-DWG-10200-000` binds the layout xref `Xref Road Layout Dahiyat Nemar` and
  the names xref `Xref Dim_Names Dahiyat Nemar` (the only sheets with names). Layout layers: `_CL` (45 LWPOLYLINE,
  a LINE, a CIRCLE = RA-01), `__ROW` 43, `G-ASPHALT ROAD` 22 (all open), `Residential plots` 770 closed, `GR`
  (HATCH / REGION here), the project boundary = `NOTES & LEGEND ROAD-NHC-DMM$0$RD-PVT-MRK` nested in the layout
  ("PROJECT BOUNDARY" in the legend). Names RD-01..RD-38, RD-M-01..03, RA-01, "WADI FATIMAH ROAD". The plot numbers
  (MP-PLT-TXT, 774, all unique) are only in the network sheets' baseplan xref `Ladun Dahiyat Namar Baseplan`;
  SLT-DWG-10000-000's layout xref has 767 plots (10200's has 770: two versions of the layout xref).
- The sheets also hold a legend sample of each layer (bare `_CL`, `__ROW`, the boundary) and a scaled copy of the
  layout in the title block's key plan: every Namar rule names its layer with the layout-xref prefix.
- Generalised: `parsonsDistrictRoadsProfile` / `parsonsDistrictPlotsProfile` (types.ts) build a district's
  profiles from its layer names (`ParsonsDistrictLayout`); Namar = `NAMAR_LAYOUT`, profiles `parsons-dn-roads`,
  `parsons-dn-plots`. Al Qairawan / Al Narjis profiles untouched.
- Fixes on real data (tests in namar.test.ts): Namar's road names stand 11-12 m off the centreline (25 m ROW):
  `labelDistance` per district (Namar 15 m; next-nearest labels are >= 20 m away), 10 m kept as the default. The
  reader did not open an xref holding only asset-number texts, so all plots came out unnumbered: the asset text
  layers now count as content when deciding which xrefs to open (dwg.ts).
- `exports\Namar-10200-shp-v1` (+ zip) from 10200-000: 47 centrelines, 44 named (unnamed: a zero-length `_CL` LINE,
  pieces of 145 m at E 656 649 N 2 714 001 and 44 m at E 657 308 N 2 714 261 with no label); RA-01 the circle;
  RD-33 and WADI FATIMAH ROAD in two pieces each. Blocks 34 (closed `__ROW`), road reserve 1 (boundary less the
  blocks). OK; warnings: 31 open lines left out (9 `__ROW`, 22 asphalt), DIMENSION / REGION / HATCH skipped,
  unmapped layers. Asphalt not shipped (no closed areas).
- `exports\Namar-plots-shp-v1` (+ zip) from SLT-DWG-10000-000: 767 plots, all numbered; ASSET_ID_DUPLICATE: 58 and
  225 each on two equal plots side by side (one of each pair has no number of its own and takes its neighbour's).
  774 numbers for 767 plots. Green space `GR`: 3 open polylines, not shipped. Parsons questions.

### Roads and plots imported; template RD-M-03 (11 Nov 2026)

- First import: `road_reserve` taken as Roads (a road along the reserve's outline, jumping between its 34 block holes)
  and converted to a component road; `road_centerline` not imported. User removed both and re-imported:
  `road_centerline` (Roads), `road_reserve` and `blocks` (Coverage Areas), `plots` (Parcels); then converted
  **RD-M-03** (package record 40, ROADS.ID 41) to a component road: the template, CD GUID
  `5a70af88-e21f-4da0-b681-d29eb61bf771`.
- Model closed, proposal master, integrity ok. The conversion (and the deleted triangle) left 6 arms + 4 regions
  without an INTERSECTIONS row (the Al Narjis crash pattern). On a scratchpad copy: `model:intersections` (dry run
  first) removed the 10 rows (7 dangling links -> 0); model:names with the 10200 package (43 of 46 rows named; the
  template has left its source) and the plots package (767); the template named RD-M-03 (it lost its name in the
  conversion). G3 on the copy: 10200 47/47 roads (11 813 m, 44/44 named), road reserve 1/1, blocks 34/34; plots
  767/767; sewer, water, irrigation as before: all **PASS, 0 warnings**. Installed (7C73B35D... -> 5F07EC55...);
  integrity ok; G3 on the working copy: all five PASS, 0 warnings.
- 1 535 CONSTRAINED_DEFINITIONS rows without a road: normal (Al Narjis 147 of 154).

### Component roads (11 Nov 2026)

- Inputs: layout ROD-DWG-10200-000 blocks "Xref Road Layout Dahiyat Nemar_1|Xref Dim_Names Dahiyat Nemar"; profiles
  ROD-DWG-40000-001 block "Profiles Layout-Dahiyat Nemar" (each of the 14 profile sheets binds the whole profile
  drawing: 46 views, 42 roads); surface `NMAR-IRO-MOD-00-00003 Roads Surface (Sep IFC).xml` "NMAR Roads Surface (Sep
  IFC)"; package `Namar-10200-shp-v1\shp\road_centerline`; template RD-M-03 (CD 5a70af88-...).
- Typical sections ROD-30000-001 = Al Qairawan's A1 (15 m local), A2 (18 m local), B1 (25 m neighbourhood collector,
  median 1.20, sidewalks 4.60): no new section type.
- Reader fixes (tests in namar-roads.test.ts): centrelines `_CL`, edges `Road edge`; profile views: the first (and
  last) station label of a Namar view stands ~1 m off its tick, so scale = median label step (second label to last
  when only two steps) and origin = median over the labels; FG lines up to 50 m past the last label (labels stop up
  to 43 m short of the end); titles of one row up to 5 m apart in height (RD-29 is 2.6 m above RD-28). Alignments: a
  single piece up to 2 cm short of its profile is extended along its end tangent (RD-32: plan 541.603, profile end
  label 0+541.614); a piece whose far end lies inside a roundabout ring (CIRCLE on the centreline layer) is cut at
  the profile end (RD-M-01: 8.219 m into RA-01).
- Dry run: 41 of 42 roads chained to their profile length (RA-01 is the ring: left to InfraWorks as a roundabout
  junction; WADI FATIMAH ROAD has no profile and stays a planning road); PVI issues 3 (RD-33 / RD-35 tangents 6-7 mm,
  RA-01 a PVI without PVC / PVT); 21 reversed against the drawing direction, each matching the surface to <= 0.04 m;
  sections: RD-M-01 / M-02 / M-03 B1, RD-13 / 19 / 25 / 26 A2, the rest A1 (RD-35 from one side).
- Written on a scratchpad copy: 41 roads, 40 planning roads replaced (and the template), 0 level problems, 0 junction
  steps >= 0.3 m. G3 --layout PASS (all 42 drawn roads; no junction rows left over); 10200 (47/47, 41 counted as
  component roads), plots, sewer, water, irrigation PASS, 0 warnings. Installed (5F07EC55... -> 727F77A9...); G3
  --layout on the working copy PASS. Do not Refresh `road_centerline` (planning roads would come back).

### Network packages from the drawings (11 Nov 2026, side session)

Same path as Al Narjis (profiles `parsons-dn-*`, packages in `DATA_DIR\exports`). Depths and sizes from report
LDIP-RCRC-SAP-03-DN-DES-RPT-00001: storm cover 1.2 m §10.2.7; LV / MV 0.65 / 0.80 m to the cable centre §2.3.3; MV duct
banks 200 mm §2.3.9.3; street lighting ducts 110 mm O.D. uPVC §2.3.12.2.4.1; water 1.2 m §5.3.14 (AICC choice);
irrigation 1.2 m §8.2.2. §17.2 gives the security ducts as microduct bundles in duct banks with no depth: telecom and
security stay on the terrain at the 0.1 m display size.

Generalised: `districtNet`, `buriedFor`, `drawnPipeFor`, `corridorFor` (types.ts) build the parts every district
repeats; Al Narjis' profiles are built from them and serialise exactly as before (checked against HEAD). Rules stay per
district (xref and layer names differ). `scripts/narjis/corridor-bands.mts` takes `--src --out --district --sheet`.

Fixes on real data (tests in `namar-networks.test.ts`):
- OCS elevation: the reader dropped the elevation term of the OCS -> WCS transform ("exact for ±Z"). PWT-10000's 119
  water valves have extrusion (0.012, -0.022, 0.9997) and OCS Z -52 308 m: all landed about 1 km south-east of the site
  (as did 24 irrigation gate valves). With the term, all are on the network. Al Narjis' Parsons question 10 (19 valves
  about 1 km south-east) is very likely the same: its water-fittings package would move them on site if rebuilt.
- `skipBlocks` (profile): storm, security and much of irrigation sit on bare layer names, and each legend draws a sample
  on those names ("Notes & Legend", "Xref Storm Legend", "NOTES&LEGEND"): the Namar profiles skip `*Legend*` blocks.
- `dedupePoints` (rule): the street-light poles are arrays of AAM inserts, 47 laid exactly over another: kept once.

| Package | Sheet(s) | Content | Warnings |
| --- | --- | --- | --- |
| `Namar-storm-shp-v1` | STO-10000-000 (block system-01) | 142 pipes (6.09 km; 400-1100 mm from the layer names, cover 1.2 m), 142 manholes + 4 outfalls (depth to the deepest pipe within 2 m) | unmapped layers |
| `Namar-water-fittings-shp-v1` | PWT-10000-000 (xref LDIP-N~1) | 123 valves (119 valves, 3 washouts, 1 air valve), 74 fire hydrants; all on site | HATCH / MULTILEADER skipped |
| `Namar-irrigation-dwg-shp-v1` | IRR-10000-000 (block Irrigation Routing) | valves 64 (54 buried gate, 6 air, 4 washout; 3 drawn twice), structures 195 (151 pull boxes, 44 quick couplings), two-wire decoder cable 205 lines (9.88 km, on the terrain) | HATCH / LEADER skipped; end-cap symbols on the cable layer left out |
| `Namar-pipes-dwg-shp-v1` | PWT + IRR + SWN -10000-000 | water 123 (10.83 km; 160 / 200 / 250 mm, cover 1.2 m), irrigation 251 (10.10 km: 98 network 90-200 mm, 44 x 50 mm secondary, 108 x 75 mm tie-ins, the 160 mm transmission line; 1.2 m), sewer 166 (9.27 km, on the terrain); networks "<utility> - Namar (drawing)" | |
| `Namar-dry-shp-v1` | ELV, EMV, SLT, TEL -10000-000, SEC-10000-000 | LV 4 361 lines (45.67 km; 333 cables + 4 028 house connections, 0.65 m), 212 mini pillars; MV 19 cables (3.80 km, 0.80 m, 200 mm), 16 substations; street lighting 43 cables (8.79 km, 110 mm), 292 lights, 5 panels; telecom 874 ducts (63.34 km), 62 handholes; security 47 ducts (8.00 km), 44 handholes | 1 telecom handhole outside the CRS left out; HATCH skipped |
| `Namar-security-secondary-shp-v1` | SEC-10100-000 | 111 secondary security ducts (8.60 km) | |
| `Namar-corridors-shp-v1` | UTL-10000-000 | 15 corridor Shapefiles (one per corridor, 0.15 m, lifted 1.0 m), colours in `CORRIDOR_COLOURS.txt`; adds sewer FM and street lighting, no HV | |
| `Namar-corridor-bands-shp-v1` | from the corridors | 15 Coverage Areas Shapefiles, half widths 0.09-1.0 m (display only, no manifest: outside G3) | |

Notes: TEL-10100 repeats 841 of TEL-10000's 874 ducts (not read); SEC-10100's ducts are distinct from SEC-10000's (own
package). The LV xref repeats the substations, the MV loop and the lighting panels: read from their own xrefs. Off site:
2 street lights and the lighting panel at E 656 676 N 2 712 923. Questions in `parsons-questions.md`.

### Blocks closed by the project boundary (11 Nov 2026)

- User's screenshots: the road reserve (cyan) covered several blocks of plots. 9 `__ROW` lines in 10200 are open: some
  pieces meet end to end, but most blocks along the site edge are closed by the project boundary, not by `__ROW`.
- `polygonize` fill mode (`with`, `keep`, `avoid`; dwg.ts, test in namar.test.ts): the closed `__ROW` blocks stay as
  drawn; faces of `__ROW` plus the boundary are added where they hold plots no drawn block holds, unless they hold a
  road centreline. 10200: 34 as drawn + 4 closed by the boundary = 38 blocks. One face is left out: a row of 63 plots
  with no ROW line between them and their road (the face holds the centreline): Parsons question.
- Road reserve = boundary less the blocks and the plots outside them (`subtract` now leaves out cutters lying inside a
  cutter of an earlier entry; with every plot as a cutter the clipper failed on shared edges): 0.570 -> 0.281 km2.
- `exports\Namar-10200-shp-v2` (+ zip): blocks 38, road reserve 1 (9 parts), centrelines as v1. Only `blocks` and
  `road_reserve` are to be re-imported (not `road_centerline`: the planning roads would come back).

### Junctions, cleanup and kerb returns (11 Nov 2026)

- User: blocks / road_reserve replaced with v2 (Coverage Areas), Grading Limit edits on the roads. Model closed, master,
  integrity ok: 55 junctions, 181 arms, 126 corners; RA-01 not converted yet (0 roundabouts).
- G3 --layout on a copy after model:names (v2): G3-021 FAIL, 16 links to no road definition, and G3-022, 20 arm /
  region rows without a junction: all 20 were arms / corners InfraWorks started against RA-01's planning ring (the
  `_CL` circle imported as a planning road) and never tied to a junction. `model:intersections` (dry run first) removed
  them: 0 dangling links, G3 --layout PASS.
- Kerb returns: Namar draws the kerb line on `__Curb` at the design radii (10.00 x93, 15.00 x14, 12.00 x11, larger at
  RA-01), `Road edge` 0.30 m out (10.30, 12.30): `kerbLayer` now picks `__Curb` (test in curb-returns.test.ts).
  `model:intersections --curb-returns <10200> --layout-block "Xref Road Layout Dahiyat Nemar_1"`: 118 corners on 55
  junctions; set 96 (10 m x88, 12 m x8), 1 already at the drawn value, 5 ambiguous (nearest arc taken: junctions 3,
  10, 25, 29), 16 without a drawn arc (InfraWorks' radius kept; mostly junctions 51-55).
- G3 on the copy: --layout PASS (G3-025: 102 at the drawn radius, 16 without an arc); 10200 v2, plots, sewer, water,
  irrigation PASS, 0 warnings. Installed (440D012C... -> 60D8CA20...); G3 --layout on the working copy PASS.

### Remaining packages imported; names, G3, IUC colours (12 Nov 2026)

- User imported the remaining packages (52 sources; 66 in the model, no duplicates): storm, water fittings, irrigation
  (drawing), drawn pipes, dry, security secondary, corridors (15) and corridor bands (15, Coverage Areas).
- model:names chained on scratchpad copies with the seven packages: every column filled (storm 8, fittings 2,
  irrigation-dwg 5, pipes-dwg 16, dry 24, security-secondary 3, corridors 75). model:names does not overwrite an
  existing --out file: clear old copies first.
- G3 on the copy: --layout and all twelve packages PASS; 2 warnings G3-004, import types: `irrigation_structures_dwg`
  came in as Pipelines (should be Pipeline Connectors) and `street_lights` as Pipeline Connectors (should be Points of
  Interest): to re-import. Installed (07E922FC... -> D0EBC98F...).
- IUC colours: the shared table (`scripts/narjis/corridor-style-library.cjs`) gains Namar's two extra corridors (IUC
  Sewer FM A50052, IUC Street Lighting 808080; colours from UTL-DWG-10000, the rest equal to Al Narjis'); street
  lighting cables take their corridor colour; `network-styles.cjs --files <model>.files` writes the PipeConnector
  styles into the working model's library while restyling a copy. 32 style files written into
  `C:\IW\Namar\...files\unver\Content\Styles` (unversioned: `.files` Git clean); 30 corridor sources and 16 network
  sources styled on a copy; G3 all packages PASS (the same 2 G3-004); installed (D0EBC98F... -> 3DED661B...).

### RA-01 prepared for the roundabout (12 Nov 2026)

- RA-01 in ROD-10200: ring centreline circle r 20.212 (ICD ~40.4 m), island kerb `__Curb` circle r 12.00, carriageway
  r 12.30-19.90 ("Road edge"), lane line r 16.10 (two ring lanes). Arms RD-M-01 (bearing 295), RD-M-02 (112), RD-13 (44),
  RD-32 (213) all end on the ring; no junction at the centre, so nothing InfraWorks could convert.
- User decision (12 Nov): deviation D1 (`parsons-deviations.md`). `model:roads --merge` may now cross a roundabout ring
  through its centre, and `--to-centre ROAD@THROUGH` carries a road from the ring to the centre at the through road's
  level (merge.ts, tests in roads-merge.test.ts).
- The user deleted the RA-01 planning ring in InfraWorks (model opened 08:59-09:12); a second planning copy (road 5, a
  3-vertex arc on the ring, no links) deleted on the copy. Then `--merge RD-M-01=RD-M-01+RD-M-02` (1 662.245 m, 16 PVIs,
  B1; 24 junction links of RD-M-02 moved to RD-M-01) and `--only RD-13,RD-32 --to-centre RD-13@RD-M-01,RD-32@RD-M-01`
  (20.501 / 20.200 m, level 766.272): 0 level problems, 0 junction steps >= 0.3 m. Junction 10's kerb corner re-read
  after the merge (15 m). G3 --layout PASS, 0 warnings (102 of 118 corners at the drawn radius); the 10200 package now
  warns G3-005 / G3-010 for the three road_centerline records no longer separate roads (RA-01 ring, its arc copy,
  RD-M-02 inside RD-M-01): expected. Installed (E7CE9D43... -> 895D3B12...).

### RA-01 roundabout written in the file (12 Nov 2026)

- User converted junction 56 (RA-01 centre) in the Stack: FHWA 2010 Rural Double Lane and FHWA 2000 Urban Compact both
  refused, "Invalid roundabout geometry - insufficient space for arm lengths, or arm radii"; log
  (`AIW_26.0_2026-11-12_08-59-00`): "[Create Roundabout Fail] The blend point offset is less than Inner Zone Of
  Influence Radius" on arms 1 and 3. Saved state: ROUNDABOUTS row (Urban Compact, ICD 30, island 18, STATUS -1).
- Room (`--arm-room`): next junctions at 61.4 (11) and 64.4 m (10) on RD-M-01, 61.1 m (50) on RD-13, 236.8 m (12) on
  RD-32; InfraWorks' clamp seen in Al Qairawan = next centre - 14.4 m, i.e. 47.0 / 50.0 / 46.7 m, about Urban
  Compact's 47.57 m.
- On a copy: `--roundabout 56 --icd 36 --island 24 --apron 0 --lanes 1 --lane-width 6 --standard urban-compact`
  (2 x 4.1 m refused by the tool: Urban Compact keeps one 6 m lane), arms reset and set to the clamp with
  `--shorten-arms --arm-gap 14.4 --arm-ids 56` (47.0, 50.0, 46.7, 76.9 m). Deviation D2. G3 --layout PASS with
  G3-024 (arms not built until InfraWorks builds) and G3-025 (junction 10 corner back to 22.3 after the user's edit).
  Installed (E2B650C2... -> 230675A3...). Next: one roundel edit in InfraWorks.
