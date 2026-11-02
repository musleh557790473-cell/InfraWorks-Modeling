# Road design pilot (WIP, 2 Nov 2026)

Goal: turn Parsons' 2D road drawings into InfraWorks design roads (centreline + profile +
typical section), graded to a terrain, automatically. Pilot road: **R.6.E.1** (Al Qairawan).
These are exploration scripts, not product code: once the InfraWorks path is proven, move the
logic into `packages/domain` with tests (profile reader, PolylineZ writer, section from ROW).

## Inputs (shared data folder, `DATA_DIR\inputs\road-pilot`)

| File | Content |
| --- | --- |
| `ACAD-…-ROD-DWG-40000-001-0A.dxf` | All 266 profile views, in block `Xref Al Qairawan Profiles` |
| `ACAD-…-ROD-DWG-10200-001-0A.dxf` | Road layout xref: centrelines `RD_PR_CNRL`, names `0-Alignment Name`, chainage ticks `RD_C_CHAIN_*`, ROW `RD_ROW`, edges `-RD_Edges` |
| `ACAD-…-ROD-DWG-30000-001-0A.dxf` | Typical sections A1–A3, B1, C1, C2 (complete DXF) |
| `aq-road-profiles.json` | Output of `profread.cjs`: per view `{name, datum, pts:[[station, pgl]]}` |

The 40000 and 10200 DXFs are cut off after their single model-space INSERT (no EOF): read the
BLOCKS section, where the xref content is intact (`profblk.cjs <dxf> "<block>" <out.json>`).
On the laptop with ODA, a clean DXF of the DWGs may avoid this.

## What the drawings give

- Profile views: title MTEXT `R.x.y.z` on `RD_C_PROF_TITL`, "Datum: 685.000" 6 units below;
  stations every 25 m on `RD_C_PROF_STN-MAJR` (row 16 below the title), horizontal 1:1;
  vertical exaggeration x10, datum line at row + 5; design line `RD_C_PROF_FG` (LWPOLYLINE).
- Check: printed "PGL ELEVATION" row (`RD_C_PROF_TEXT-FG`). 256 of 266 views agree within
  2 mm (2,582 values). Left: `R.3.G.4`, `R.10.G.1` (no grid labels), 7 views with no FG found
  (`R.14.G.9/13/14`, `R.8.G.4`, `R.10.G.5/6`, `R.13.G.7`), `R.3.G.8` off by 0.55 m.
- Plan: centrelines are in UTM 38N already (block coordinates = world); a road may be several
  polylines (chain them by name from the 0+000 tick). R.6.E.1: one 128.163 m line = profile length.
- Sections: ROW width from `RD_ROW` offsets picks the type (15/18/20 local A1–A3, 25 B1,
  30/36 C1/C2). Lanes 3.30 m, kerb 0.30 m / 150 mm upstand; local roads one-way crossfall.
- Design report LDIP-RCRC-SAP-01-AQ-DES-RPT-00001, criteria table: carriageway crossfall 2.0%,
  sidewalk 2.0% max, max grade 8/8/10%, min grade 0.5%, min VC length 24/24/12 m.

## InfraWorks test so far

`exports\Al-Qairawan-road-pilot-R.6.E.1\road_pilot.shp` (PolyLineZ, Z = PGL every 5 m, from
`pilotshp.cjs`) imported as Roads into `Al qirwan test 4 (names)`:
- The planning road kept the Z values (stands at ~693 m).
- The model terrain is flat at Z = 0, so it drew a 693 m fill wall.
- "Convert to component road" lost the profile (elevation range 0–0, grade 0%).

## Next steps

1. Terrain first: mass grading surface `Al_Qairawan_Mass Grading` (219,031 pts, 677–699 m),
   `Al-Qairawan Grading\Qairawan Rough Grading-Rev-01\REV 08-10-2026\LDIP-RCRC-LAI-LDIP-01-CIV-DWG-00002-01.dwg`
   (+ LandXML beside it). Import via Data Sources > Autodesk Civil 3D DWG, as terrain.
2. Check Parsons' road models `Vol. 04_Models\Roads\DWG\LDIP-RCRC-SAP-01-AQ-ROD-MOD-90000-00[1-3].dwg`
   (also IFC/NWC) in Civil 3D Prospector: if they hold corridors, import them directly instead
   of rebuilding roads from the drawings.
3. Otherwise retry R.6.E.1 on the real terrain and find how InfraWorks keeps the profile on a
   component road (e.g. edit the vertical profile, or import as a design road).
4. Then productise: profile reader + PolyLineZ in `packages/domain`, tests, all 250 roads.
