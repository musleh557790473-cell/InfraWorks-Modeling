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

## Session 2 (2 Nov 2026, evening): terrain, Parsons models, component roads

**Parsons road models** (`Vol. 04_Models\Roads\DWG\ROD-MOD-90000-00x.dwg`, converted with ODA):
one AECC_TIN_SURFACE each on `C-TOPO`, no corridors, alignments or profiles. IFC file names say
which: 001 = NGL, 002 = Mass Grading, 003 = **Road Surface** (finished road TIN). So roads are
rebuilt from the drawings; 003 can later check that PGL = finished road level.

**Model.** Working copy `C:\IW\Al Qairawan Test (road pilot).sqlite` (+ `.files`), on THIS
laptop only. Base: `TAWAZUN PROGRAM\Infraworks\Al Qairawan Test` (UTM84-38N, survey, DEM,
hydrology); OSM `roads` source deleted. Lessons (also in CLAUDE.md):
- InfraWorks 2026 imports Civil 3D DWG only with Civil 3D 2026 installed (this laptop has 2027):
  the surface came from the LandXML beside the DWG
  (`Qairawan Rough Grading-Rev-01\LDIP-RCRC-LAI-LDIP-01-CIV-DWG-00002-01.xml`, exported from
  REV 08-10-2026; no CRS, set UTM84-38N). Data source `Mass Grading REV 08-10-2026`, on top.
- The model's two older `Al_Qairawan_Mass Grading` surfaces (IMX, 7–8 Sep) are an earlier
  revision: 438–442k triangles, min 676.85 vs 437,340 / 677.20 in REV 08-10. Switched off.
- Under OneDrive the model broke: a LandXML resource path reached 263 chars, InfraWorks' Git in
  `.files` failed ("Filename too long") and the model would not open. Copied with robocopy to
  `C:\IW`, opened fine.

**R.6.E.1 on the real terrain** (`road_pilot.shp` re-imported):
- Planning road keeps all 29 PGL vertices (Z 692.783 → 694.207), on the terrain, no fill wall.
- PGL minus Mass Grading REV 08-10 along the road: 0.38–0.78 m, mean 0.55 m (`tinz.cjs`).
  Do not assume a pavement thickness from this; check against ROD-MOD-90000-003 instead.
- No name: `NAME = R.6.E.1` is in the DBF but not mapped, and conversion clears
  `DATA_SOURCE_ID`/`EXTERNAL_ID`, so the name must be written before / with the component road.
- "Convert to Component Road" keeps the levels (elevation range 692.783–694.207) but fits the
  profile to TWO grades with one PVI at 0+064.082 (1.027%, 1.195%). The drawing dips to 692.637
  at 0+007.9; InfraWorks gives ~692.864 there (+0.23 m). Not acceptable.

**Decision (user): approach A** — write component roads straight into a model copy (like
`model:names`), with the name and Parsons' PVIs / vertical curves, for all roads at once.

How InfraWorks stores the converted R.6.E.1 (`cdscan.cjs`; GUIDs link the rows):
- `CONSTRAINED_DEFINITIONS`: ASSET_TYPE `ROADS`, FK_DEFAULT_ASSET_GUID = ROADS.GUID,
  REFERENCE_POINT (WKB-like point, start XYZ), DESIGN_STANDARDS `AASHTO_Metric_2011`.
- `ROADS`: FK_PARENT_TABLE `CONSTRAINED_DEFINITIONS` + FK_PARENT_GUID; GEOMETRY start→end 3D;
  MANUAL_STYLE (JSON cross-section), FUNCTION `Local`, MAX_SPEED 40, GRADING_DATA blob (116 B).
- `H_CONSTRAINTS`: horizontal elements, chained by FK_PREV/NEXT; a straight is CONSTRAINT_TYPE 3
  with PASSTHROUGH_PT_1/2 = start/end XY. Arc format still unknown (need a sample).
- `V_CONSTRAINTS`: profile tangents, CONSTRAINT_TYPE 15, chained; PASSTHROUGH_PT_1/2 =
  (station, elevation); GEOMETRY the 3D segment; CURVE_TYPE/PARAM_* null so far (vertical
  curve format unknown, need a sample).
- `CONSTRAINED_DEF_GEOM_LOCATIONS`: TYPE 1/2 at station 0, TYPE 3 at the end, each pointing to
  an H constraint. `CONSTRAINED_DEF_RPSYSTEMS`: GEOMETRY, LENGTH_2D, JSON_RANGE_HASH (hashes of
  CLGeometry, GradingData, Primitives, SectionGeom...: a cache key).
- Derived: `PRIMITIVES` (5 rows), `TERRAIN_OPERATIONS` (5). `.files\exploded\<TABLE>\0` mirrors
  each table as JSON in InfraWorks' Git; it is rebuilt from the sqlite on open (that is how
  `model:names` edits survive). To verify: whether InfraWorks rebuilds PRIMITIVES /
  TERRAIN_OPERATIONS for rows we write without them.

## Session 3 (3 Nov 2026, AYNLAP1201): Parsons PVIs, V curve and H arc storage, first write

**Parsons prints the full vertical geometry** on `RD_C_PROF_LABL` (block `Xref Al Qairawan
Profiles`): `PVI <sta>`, `PVC <sta> | ELEV <z>`, `PVT <sta> | ELEV <z>`, `VC <L>, K <k>`,
`g=<grade>%`, and `STA <sta> | ELEV <z>` for a PVI without curve (sometimes split into two
MTEXTs side by side: pair by same y). A curve's PVI level = where the tangents through the
printed PVC / PVT (and neighbouring anchors) meet. `pvis.cjs`: 250 roads, 1,488 PVIs, 465 VCs;
229 roads consistent (tangents meet within 5 mm, median 0.5 mm; labels = FG line). 21 to
review: R.6.G.11 R.0.C.1 R.0.C.4 R.0.D.4 R.1.G.3 R.1.G.12 R.2.F.5 R.3.G.6 R.3.G.8 R.14.E.2
R.14.F.3 R.14.G.11 R.14.G.15 R.4.G.9 R.5.G.8 R.7.G.8 R.9.E.1 R.10.G.4 R.12.G.4 R.13.E.2 R.11.G.6.
R.6.E.1 has no VC: PVIs 0+000 692.783, 0+000.600 692.783, 0+007.900 692.637, 0+128.163 694.207.

**InfraWorks storage** (samples drawn in `C:\IW\Al Qairawan Test.sqlite`, roads 2 and 3):
- Point blobs (32 B): uint32 1, uint32 1, x, y (doubles). In V constraints x = station, y = level.
- V chain: tangent (15) PVI→PVI; between two tangents a curve row (18) with no points,
  `CURVE_TYPE` 4096 = sag / 4097 = crest, `PARAM_1` = curve length (10 m ↔ K 0.858 shown).
  Tangents may follow each other without a curve row (no VC at that PVI).
- V tangent GEOMETRY (60 B): uint32 2, 1, 2, then two XYZ points (world XY on the alignment, Z level).
- H arc: CONSTRAINT_TYPE 4, CONSTRAINT_TYPE_DEFINITION 2, PASSTHROUGH_PT_1/2/3 = start, mid, end.
- Derived per road (FK_PARENT_TABLE `ROADS`): PRIMITIVES (5), TERRAIN_OPERATIONS (5).

**First write** (`cdwrite.cjs`): road 1 (= R.6.E.1 converted, two-grade fit) given Parsons' PVIs
and `NAME = R.6.E.1`, in two copies: `C:\IW\Al Qairawan Test (R.6.E.1 A)` (V chain + name) and
`(R.6.E.1 B)` (also deletes that road's PRIMITIVES / TERRAIN_OPERATIONS).
- **A works**: profile as Parsons (elevation range 692.637–694.207, PVIs 0+000.600, 0+007.900,
  grades 0–2.00%), graded to the terrain. InfraWorks rebuilt the shape in memory from the V chain;
  the stored PRIMITIVES / TERRAIN_OPERATIONS rows stayed as they were (a cache).
- **B fails**: the road is gone. InfraWorks does not recreate deleted derived rows, so keep them.
- The name did not show with `ROADS.NAME` only ("Enter a name"): copy `(R.6.E.1 C)` also sets
  `CONSTRAINED_DEFINITIONS.NAME` (to test).

**New roads written from scratch work** (`cdnew.cjs`, template = R.6.E.1 in copy C):
- "Convert to Component Road" has no multi-select; the Traffic Study Area bulk conversion needs a
  Java runtime (not installed), so the tool writes the roads itself.
- D (template rows + template JSON_RANGE_HASH): rows reach InfraWorks' mirror, road not drawn.
- F (no derived rows): nothing shown, empty profile. Derived rows must exist.
- E (derived rows copied, hash zeroed): R.6.F.1 read correctly (BC/EC, PVIs, K 18.7/50.0/17.6/17.5)
  but its body stayed the template's cached one at R.6.E.1. **Changing a property (Speed 40→41)
  rebuilt it**: 321.208 m, EC/BC 0+057.189 (= Parsons L=57.189 R=400), EC 0+179.996, elevation
  693.908–697.239, grades 0.50–2.21%. So InfraWorks rebuilds a road's body only on an edit.
- Batch: `Al Qairawan Roads (Parsons)` = copy C + 161 roads (162 with R.6.E.1); 21 PVI-review roads
  and 8 whose PVIs do not reach the alignment end (R.2.G.6 R.2.G.22 R.3.D.1 R.5.G.5 R.5.G.11
  R.7.G.2 R.9.G.2 R.13.G.15) left out. The user then selects all roads and edits Speed once.

- Bulk edit failed: Model Explorer "Select All" selects all 162 roads, but editing Speed on the
  multi-selection did not rebuild them (only single-road edits do).
- **Root fix**: `cdnew.cjs` now computes each road's body from its own geometry (PRIMITIVES:
  template cross-sections on the road's 3D path with mirrored ghost ends, vertexIndices [0, n-1];
  TERRAIN_OPERATIONS: start / end transitions through every strip boundary, right edge, left edge
  reversed, ring keys = corners, CutOut polygon; GEOMETRY = bbox polygon blob 3,0,1,5).
  R.6.E.1 recomputed with `--regen` matches InfraWorks' own body within 4 mm.
  `Al Qairawan Roads (Parsons 2)`: 162 roads, each with its own 5 + 5 body rows. To test.

**Earlier plan for all roads** (from A/B, superseded): the user imports the centrelines as planning roads and runs
"Convert to Component Road" on all of them at once (InfraWorks creates every table, including the
derived rows); then a tool, like `model:names`, matches each component road to its Parsons road by
geometry and writes the name and Parsons' PVIs / VCs into a copy. Check per road that the
converted horizontal length equals Parsons' alignment length (stations depend on it).

User guide `Documents\04 Development\Infraworks\Roads IN infraworks.docx` (LinkedIn Learning
transcript): useful for cross-sections, "Road assembly > Add to library" saves a custom
assembly; build A1–A3, B1, C1, C2 once and copy the resulting MANUAL_STYLE to roads.

## Session 3b (3 Nov 2026): typical sections, raised median, crossfall side

- `sections.cjs` builds A1–C2 from ROD-DWG-30000-001 (lanes 3.30, kerb 0.30, upstand 150 mm,
  crossfall 2 %, sidewalk 2 % to the road); `rowclass.cjs` picks the type from the ROW width.
  `Parsons 3 sections` was checked in InfraWorks (B1, C2, A1 roads).
- Median (B1/C1/C2): AICC confirmed from the C1 detail that P.G.L. is the asphalt edge at the
  median kerb. Lanes start at the profile level; the median is a flat base plus, on each edge, an
  upstand kerb facing the lanes (width 0.30, as the road kerb) and a fill 150 mm above the lanes.
- Crossfall side of local roads (one-way, "LOW POINT" at one kerb): the typical section does not
  say which side. The STO plan has no inlets (note 3: contractor verifies the low point). Parsons'
  grading surface `Al_Qairawan_Mass Grading` (LandXML) carries the crossfall at exactly 2 %:
  `xfall.cjs` samples it 3 m each side every 5 m -> `C:\IW\data\alignments\aq_road_xfall.json`.
  Local roads: 146 fall right of the chainage, 7 left (R.6.F.3 R.1.F.2 R.4.G.6 R.5.G.1 R.13.G.1
  R.13.G.15 R.13.G.5), 4 unclear, kept right (R.6.G.22 R.3.G.2 R.4.G.13 R.11.G.4).
  Collectors show a crown (fall outward), as modelled. Some local roads change side along
  their length ("mixed"): one side per road is taken (the median sample).
- `cdnew.cjs --xfall <aq_road_xfall.json>`; `Al Qairawan Roads (Parsons 4 median xfall)`: built
  from Parsons 2 with `--regen --sections --xfall` on all 162 roads. Seen in InfraWorks: median
  raised with kerbs; but walls hanging below the terrain and bodies far from it.
- Fixes (`Al Qairawan Roads (Parsons 5 direction)`, from Parsons 2, to test):
  - R.1.G.8: a 5 m tick 1 mm from an element end gave a zero-length segment, NaN edge points and
    walls down to nowhere. cdnew now drops stations closer than 1 mm. `zscan.cjs` checks a model
    for NaN / out-of-range levels in roads, PRIMITIVES and TERRAIN_OPERATIONS.
  - Four roads were chained from the wrong end (road rising 6 m where the surface falls 6 m):
    R.0.D.15 R.1.F.2 R.5.G.1 R.13.G.5. `orient.cjs` compares the profile with the grading surface
    both ways and reverses the alignment when the other end fits (2-7 cm instead of 1.7-3.4 m).
    Run `orient.cjs ... --write` after `alignments.cjs`, then `xfall.cjs`.
    (`aq_road_alignments.as-chained.json` keeps the file before the reversal.)
  - `cdnew.cjs --rewrite` deletes a road (definition, constraints, body) and writes it again,
    needed when the plan changes; `--regen` changes only the body.
  - After the reversal, local roads falling left: R.6.F.3 R.4.G.6 R.13.G.1 R.13.G.15.
  - Correction: R.13.G.5 (128 m) was reversed on the surface fit alone, but its end met R.13.G.6
    at exactly the same level (686.002) and the reversal broke that junction (1.00 m step).
    `orient.cjs` now also compares junction levels (a road end on another centreline) and
    reverses only when the junctions agree: R.0.D.15 (11.87 -> 0.00 m), R.1.F.2 (5.70 -> 0),
    R.5.G.1 (5.88 -> 0). `junctions.cjs <model>` lists level steps at junctions in a model.
  - `Al Qairawan Roads (Parsons 6 junctions)` (from Parsons 2; those three with `--rewrite`):
    zscan clean; one junction step >= 0.3 m (R.4.G.6 end on R.4.G.4, 0.38 m). To test.
  - 3 Nov 2026: trial copies deleted at the user's request. C:\IW keeps `Al Qairawan Test`
    (base with samples), `Al Qairawan Roads (Parsons 2)` (rebuild base) and the one working copy
    `Al Qairawan Roads (Parsons 6 junctions)`, updated in place from now on.
  - More roads (3 Nov 2026, working copy updated in place, now 200 roads):
    - alignments.cjs: 61 of 332 centreline pieces had no name in the roads package (names come
      from it by start vertex) and some carried a neighbour's name. Each road is chained from its
      0+000 end through its own and unnamed pieces; a chain is kept only if its length equals the
      profile length (1 cm). 219 alignments (was 188; the 188 unchanged; no piece used twice).
      Loop roads (no free end) are opened at a vertex.
    - orient.cjs: loops re-started at the vertex whose profile follows the surface (R.1.G.23,
      R.2.G.5, R.2.G.24), ties broken by junction levels; a reversal is also taken when junction
      levels alone are clear (R.4.G.6, R.13.G.1: both then fall right like the other local roads).
      Reversed: R.6.G.14 R.0.D.15 R.1.F.2 R.4.G.6 R.5.G.1 R.9.G.5 R.13.G.1.
    - cdnew.cjs: PVIs past the road end (next profile on the sheet) dropped when a PVI sits at the
      end; a first PVI up to 0.30 m after 0 has its tangent extended to 0 at its own grade.
    - rowclass.cjs: when only one ROW line is drawn, that side doubled (flagged `oneSided`):
      17 more roads typed. Still untyped: R.9.G.6, R.9.G.7 (kerb-to-kerb 6.7 / 9.8 m).
    - `addnew.cjs` writes the roads missing from a model. Checks: zscan clean; one junction step
      >= 0.3 m: R.1.G.24 start on loop R.1.G.23 (0.53 m), to look at.
    - Still out: 19 PVI-review roads; 10 with no profile in ROD-40000 (R.3.G.4 R.14.G.9 R.14.G.13
      R.14.G.14 R.8.G.4 R.10.G.1 R.10.G.5 R.10.G.6 R.13.G.7, +1); 9 whose chains do not match the
      profile (RA-3 RA-6 R.0.D.13 R.0.D.5 R.1.E.1 R.12.E.1, and R.3.G.11 R.14.F.3 R.14.G.7
      R.10.G.4 R.13.G.3 a few dm to 2 m off).
  - PVI review roads (3 Nov 2026, now 219 roads): the label window of a profile also caught the
    neighbouring profile's labels (R.3.G.6 carried R.2.F.5's PVIs at 294/349/353 m). pvis.cjs now
    checks labels against the road's own FG line: outside its station range, or a printed level
    off it by > 5 cm, the label is dropped. Missing PVC/PVT labels: levels read on the FG line;
    neighbouring anchors that are not the tangent points: grades of the FG line 2 m outside the
    curve. All 250 roads consistent (max tangent mismatch 3.7 mm); 25 roads changed, 225
    identical. Old file kept as `aq-road-pvis.before-fg-filter.json`. R.0.C.4 then reversed
    (junction steps 10.05 -> 0.02 m). 19 roads written; R.2.G.6 R.2.G.22 R.5.G.5 R.7.G.2 rewritten.
    Left out now: 10 with no profile in ROD-40000, 9 whose chains do not match the profile, and
    still untyped R.9.G.6, R.9.G.7.
  - Length mismatches (3 Nov 2026, now 228 roads): alignments.cjs pass 2 chains roads still left
    over all pieces no accepted road uses, starting on a piece that carries the road's name label
    ("0-Alignment Name"; the package had named R.0.D.13's 354.020 m piece RA-6): RA-3 RA-6
    R.0.D.13 R.1.E.1. Pass 3: a single piece longer than the profile by <= 2.5 m is cut at the
    profile end (R.3.G.11 2.000, R.14.G.7 1.560, R.13.G.3 0.600, R.14.F.3 0.328, R.10.G.4 0.058 m).
    R.0.D.13 reversed. rowclass: a local road whose sidewalk changes along it takes the majority
    type, flagged `mixed` (R.1.E.1: A3). Untyped, template width: RA-3 RA-6 R.9.G.6 R.9.G.7.
    Checks now include RA roads (`NAME like 'R%'`). Left out: R.0.D.5 (375 m), R.12.E.1 (401 m),
    and 10 roads with no profile in ROD-40000.
  - "No profile" roads (3 Nov 2026, now 237 roads): ROD-40000 holds 266 profile views for 250
    roads (as many as the layout's name labels), 85 sheet numbers; the export dropped nothing.
    profread.cjs had (a) dropped FG lines ending within 20 m of the next view's title (R.14.G.9,
    R.8.G.4 + 5 more) and (b) taken a title of the next zone column as the top of the last view in
    a row, leaving a 6 m window with no grid (R.3.G.4, R.10.G.1); pvis.cjs had the same window bug.
    Fixed in both: 266 views, 257 byte-identical, new ones match the PGL row labels within ~1 mm
    (R.14.G.14 and R.3.G.8 have one label 0.55 m off the line). Plan lengths of all 9 equal their
    profile lengths. R.8.G.4 reversed (junctions 4.60 -> 0). Files kept:
    `aq-road-profiles.before-window-fix.json`. Left out: R.0.D.5 (375 m), R.12.E.1 (401 m).
  - All 250 roads (3 Nov 2026): 11 roads had a profile but no piece named in the roads package
    and were never tried (R.6.G.8 R.0.D.1 R.0.D.8 R.0.D.11 RA-1 RA-2 RA-4 RA-5 RA-7 R.10.G.2
    R.11.G.1); every profile name is now tried, pass 2 starts them on their name-labelled pieces.
    RA-1..RA-7 are roundabout circles (one closed piece, ~126.9 m, each label ~4 m from its own
    circle), left untyped (template width; circulatory width not in the drawings read so far).
    Pass 3b: walk the free pieces from the labelled start while the way on is unique; if the
    plan's end-station label equals the walk's length, or the walk is <= 2.5 m longer, cut at the
    profile end: R.0.D.5 (plan 0+416.889, profile 375.000), R.12.E.1 (401.308 -> 401.213).
    orient.cjs repeats until no road flips (R.10.G.2 only clear once R.0.D.1 was reversed); 13
    reversed in all. Checks: zscan clean; one junction step >= 0.3 m (R.1.G.24 on R.1.G.23).
  - Roundabouts: each RA is one arc going almost all the way round (start and end ~1 cm apart).
    InfraWorks defines an H arc by start / mid / end, so it was nearly undefined; RA-2 came out
    with length 0.0 m and a line hanging down. cdnew splits arcs over 90 degrees into equal arcs
    of at most 90 (RA: 4 quarter circles, R 20.2 m). 19 roads rewritten (7 RA, loops, arcs just
    over 90 degrees). Approach roads still run through the roundabout centre, as Parsons draws
    the centrelines: part of the junction work.
  - Productised (3 Nov 2026): `pnpm model:roads` (packages/model-gate/src/roads-cli.ts) runs the
    whole chain from the three drawings; logic in packages/domain/src/roads/ and
    packages/model-gate/src/roads/, tests in both packages' test/roads.test.ts. Checked against the
    pilot on the real inputs: profile views, PVIs, alignments and crossfall identical for all 250
    roads, sections identical but one sample count (R.10.G.2); written into a copy of Parsons 2,
    H and V constraints identical to the working copy for all 250 roads. Differences: untyped
    roads (RA) now take the template's original style (the pilot cloned them after refreshing the
    template with A3); R.12.G.3's centreline was rebuilt by InfraWorks after an edit. The scripts in
    this folder stay as the record of how each rule was found.
  - Finding a road in InfraWorks: Model Explorer > Roads > Select By Filter, `NAME = 'R.5.G.1'`, F.
- `roadtin.cjs`: road centreline against the grading surface. Most roads sit 0.5-0.8 m above it
  (pavement). Larger only at junction mouths (R.3.G.3, R.0.D.16, R.3.E.1, R.3.F.1) and on R.3.G.1,
  whose first 100 m stand 5 m above the surface (surface dips to 683.6, Parsons' profile labels stay
  at 689): Parsons' data, to raise with them.
- `tin.cjs`: shared surface lookup and station helpers (orient.cjs; xfall.cjs and roadtin.cjs
  still carry their own copy).

## Next steps

1. Inputs: `DATA_DIR\inputs\road-pilot` is online-only in OneDrive and would not download on
   this laptop. On the other laptop make it local first; read the profile DXF for PVI and
   vertical-curve labels (if Parsons prints them), otherwise derive PVIs from the FG polyline.
2. Samples from InfraWorks (any model on a short path such as `C:\IW`): (a) a component road
   whose profile has a vertical curve and 3+ PVIs; (b) a component road with a horizontal arc.
   Read them with `cdscan.cjs` to learn V curve and H arc storage.
3. Write R.6.E.1 as a component road into a fresh copy (name, Parsons PVIs), user tests.
4. Productise in `packages/domain` with tests (profile reader with the PGL-label check,
   PolyLineZ writer, section type from ROW width, component-road writer); then all 250 roads.

## Session 4 (3 Nov 2026, evening): roundabout width, RA-1 band, Scripting Console

- Roundabout width from the edges in 10200 (AICC decision): RA-1..RA-7 island CIRCLE r 12.0 and
  outer edge arcs r 20.2 on `-RD_Edges`, width 8.2 m; the RA alignment is the OUTER edge.
  `measureRoundabouts()` + `buildRoundaboutSection()` (8.2 m on the island side, 0 % crossfall
  pending Parsons, kerbs 0.30 both edges), branch `feat/roundabout-sections`. Not yet written to
  the working model. The grading surface has no fixed crossfall across the rings (tilted plane).
- RA-1 band: our stored rows all lie within 31 m of its centre; after a Grading Limit edit
  InfraWorks rebuilt RA-1 as 4 pieces between its arms and created 9 intersections (3 -> 12,
  arms 9 -> 41, regions 6 -> 34). The band comes from the one-piece closed ring we write.
- Scripting Console = Ctrl+2 (InfraWorks 2026). API: RoadModel (regenModel, saveUpdates,
  invalidateModel, readRoadModel, getRoadID...), Intersections.updateIntersections, app.Regenerate.
  Next (user to approve): try a script rebuild on RA-2, then the closed roads, then all roads
  and updateIntersections, instead of writing junction rows ourselves.

## Session 5 (4 Nov 2026, AYNLAP1201): checks that need no model

- R.1.G.24 start on loop R.1.G.23, 0.535 m step: Parsons' data. Both profile views match their
  printed PGL rows (within 1 mm); R.1.G.24's other end meets R.1.F.1 at 1.7 cm, so its direction and
  profile are right. R.1.G.24 starts at 679.807 where R.1.G.23's profile gives 680.342 (the loop
  stands a steady 0.73 m over the grading surface, R.1.G.24 only 0.02-0.36 m). No start of the loop
  removes the step and still fits the surface (best fit 0.03 m leaves 0.53-0.61 m; the starts that
  remove it fit at 0.33-0.37 m). To raise with Parsons, with R.3.G.1.
- R.9.G.6 (107.5 m) and R.9.G.7 (136.4 m), still on the template section: both are one arc
  (bulge -0.07) between E 658718-658848, N 2747930-2748029, ending on the road at E 658848.4.
  R.9.G.6: ROW ~15 m, carriageway ~7 m (A1), but the drawn centreline is off the middle by up to
  ~1.8 m (edges at -5.28 / +1.56 m at mid-length). R.9.G.7: A1 at both ends (ROW 15.1, carriageway
  7.25 m), widening on one side to ~9.8 m (ROW 17.4 m) over its middle, a lay-by or parking bay.
  rowclass finds no exact type width over enough samples. AICC decision (4 Nov 2026): A1, given
  with `model:roads --section R.9.G.6=A1,R.9.G.7=A1` (`applySectionDecisions`: only untyped roads,
  flagged `decided`). Crossfall from the surface: both fall right at 2 %. The A1 section stays
  centred on the drawn centreline: up to ~1.8 m off the drawn edges on R.9.G.6, no widening on
  R.9.G.7. Written to the working model with `--only R.9.G.6,R.9.G.7`: A1, 20 km/h.
- Working model on AYNLAP1201 since 4 Nov 2026: the one from road-model-2026-11-03b.zip
  (12 intersections, 41 arms, 34 regions, 109 links), moved to C:\IW under the usual name. The
  previous local copy (49 intersections, edited in InfraWorks on the morning of 4 Nov) is kept as
  `C:\IW\Al Qairawan Roads (Parsons 6 junctions) old-2026-11-04` until the new one is checked.
- Scripting Console rebuild (`iw-road-probe.js`, `iw-road-rebuild.js`): `readRoadModel()` takes the
  CONSTRAINED_DEFINITIONS.ID (RA-2: 299; ROADS.ID 280 returns false). RA-2 rebuilt with
  readRoadModel, regenModel, saveUpdates, updateIntersections(extents, [], [299], [], true): the
  last returned [] but the model went from 12 to 20 intersections (arms 41 -> 68, regions 34 -> 57);
  RA-2 got InfraWorks' own body (21 strips, 11 grading rows, real range hash) and 6 arms, still one
  row; 182 links, all resolve. The console ran the script twice (output printed twice).
- Roundabouts the InfraWorks way (AICC, 4 Nov 2026): InfraWorks creates an intersection wherever
  component roads cross; a roundabout is such an intersection converted to the roundabout type
  (Autodesk help "To convert an intersection to a roundabout"; Inscribed Circle Diameter, apron
  width, central circle diameter). The JS API has no call to change an intersection's type (the
  Intersection object: setCurbReturnRadius, setDesignVehicle, widenings; Roundabout: deleteMe only).
  model:roads no longer writes RA rings (`roadsToWrite`, `--roundabouts-as-roads` to force).
- `iw-roundabouts.js` (delete RA-1, RA-3..RA-7, rebuild the 19 roads through their centres) called
  updateIntersections(..., invalidate = true) per road: InfraWorks sat in "Regenerating full model /
  Batch generating tiles" at 84 % for many minutes and the user cancelled. State after it (model
  closed, 14:30): 244 roads (rings deleted; RA-2 kept: its 3 roads stop 3 m short of the centre),
  20 intersections, 68 arms, 57 regions, 182 links of which 24 point at the deleted rings; the 19
  through roads were NOT rebuilt (our bodies, no arms). Rule since then: time any script on one item
  first and never be slower than by hand (`iw-rebuild-one.js`, invalidate = false, not run).
  Decision: write intersections and roundabouts straight into the model file instead (new session).
  Roads through each centre (CONSTRAINED_DEFINITIONS.ID): RA-1 R.0.D.2=46 R.1.F.2=185 R.2.F.3=73
  R.0.D.1=274; RA-3 R.0.D.9=48 R.0.D.14=51 R.0.D.15=184 R.0.D.11=276; RA-4 R.6.F.1=23 R.0.D.10=49
  R.0.D.12=50 R.0.D.15; RA-5 R.0.D.3=193 R.0.D.4=231 R.0.D.10 R.0.D.13=258; RA-6 R.0.C.3=192
  R.0.C.4=230 R.12.E.1=272 R.0.D.13; RA-7 R.0.B.1=45 R.0.C.4 R.0.D.5=271. Roundabout size from the
  drawn edges: outer r 20.2 (ICD 40.4 m), island r 12.0 (central circle 24.0 m), apron not given.
- Intersections link to roads by the road's CONSTRAINED_DEFINITIONS GUID (all 385 links of the 49
  intersections, 44 roads). The writer used to give a replaced road new GUIDs, which would have
  left those links pointing at nothing (it never happened: the model with intersections came from
  InfraWorks after the last full write). RoadWriter.write now keeps the road's and its definition's
  GUIDs, and refuses a road InfraWorks split into pieces when a later piece carries intersections
  (test: test/roads-write.test.ts, an in-memory model). After writing R.9.G.6/R.9.G.7: 385 links
  resolve, 0 dangling; 250 roads, one row each.
- Junction inventory from Parsons' layout (`junction-inventory.cjs <10200.dxf> <dry-run dir> <out>`,
  for step c, before comparing with InfraWorks' INTERSECTIONS): 361 junctions, 310 T, 20 three-way,
  5 four-way, 26 roundabout arm groups; 322 meet at 85-90 degrees, 20 under 45. Kerb return arcs on
  -RD_Edges within 25 m: 10.0 m most (461), then 12.0 (165), 20.0 (76, roundabout entries), 0.5
  (106, chamfers). Local T junctions mostly 10 m (12 m too); roundabout entries 20 m and 15 m.
  Arcs are not yet assigned to single corners (a nearby bend or the next corner can be counted).
- `parsons-questions.md`: the open questions for Parsons (levels, sections, crossfall sides,
  utilities, Al Narjis), each with what AICC modelled meanwhile.

## Session 6 (4 Nov 2026, AYNLAP1201): intersections in the model file

- The working model holds 40 intersections, 128 arms, 98 regions (not 20/68/57): InfraWorks itself
  added 20 (IDs 21-40, around R.10/R.14/R.0.D.5 and RA-7) at 15:33 ("Merged undo stack" in `.files`),
  finishing the cancelled regeneration. 244 roads, 252 definitions (8 without a road, IDs 1, 11-15,
  18, 19, NAME null).
- `.files` history is readable: each InfraWorks commit stores tables as text rows under
  `exploded/<TABLE>/<n>` (`git log`, `git show <c> -- exploded/INTERSECTION_ARMS`), so every edit
  InfraWorks made can be diffed without opening the model. Only 5 commits touched intersections;
  none removed an arm.
- The 24 dangling links all point at ONE definition, RA-1's (`ce9d4a19-...`, ID 298 in the backup),
  in intersections 7, 8, 10, 11 (each: a through road's 2 arms + RA-1's 2 arms, 4 regions). The
  other rings had no intersections. Rule (Autodesk tutorial "Roads Tutorial 3 Exercise 1: Creating
  Intersections": deleting a road, "the lower intersection disappears and the upper ... reverts to
  ... a simple T-junction"): an intersection left with fewer than two roads goes with its arms and
  regions; one still joining two roads is not guessed (listed for a rebuild). Code:
  `packages/model-gate/src/roads/intersections.ts` (`pruneDanglingIntersections`), CLI
  `pnpm model:intersections <model> [--dry]`, test `test/intersections.test.ts`. Dry run on the
  working model: removes 7, 8, 10, 11 (left: R.1.F.2, R.0.D.2, R.0.D.1, R.2.F.3), keeps none.
  Written to the closed working model (4 Nov, after 16:16): 36 intersections, 112 arms, 82 regions,
  276 links, 0 dangling; InfraWorks' journal tables got the 4 / 16 / 16 deleted rows; integrity ok.
  Not yet opened in InfraWorks after the write.
- How InfraWorks stores an intersection (the 40 it built): INTERSECTIONS row with GEOMETRY = the
  bounding box polygon, REFERENCE_POINTS = a 32-byte point blob, INTERSECTION_TYPE 0, DESIGN_VEHICLE
  "P", MANUAL_CHANGES 0, style/model columns null. One arm per road direction leaving the junction
  (a through road gives 2, APPROACH_DIRECTION_MATCHES_ASSET 0 and 1), LANES JSON per lane,
  CENTER_TURN_LANES_COUNT -1. One region per kerb return between neighbouring arms of different roads
  (T: 2, cross: 4, three roads: 3), CURB_RETURN_TYPE 2 (radius; 4 seen too), INPUT_CURB_RETURN_TYPE -1,
  lane width 3.3, transitions 30 m / taper 6 / radii 10, 7.5, 20. CURB_RETURN_RADIUS is InfraWorks'
  own (9.0 mostly, also 5-18, -1, 0.96), not Parsons' 10 / 12 / 20 m. ROUNDABOUTS exists, empty
  (INSCRIBED_CIRCLE_DIAMETER, ISLAND_DIAMETER, APRON_WIDTH, LANES, STANDARD_NAME ...).
- Already built at the centres: 9 at RA-1 (R.0.D.2, R.2.F.3, R.1.F.2, R.0.D.1), 19 at RA-2
  (R.0.C.2, R.0.C.1, R.0.D.1), 23 at RA-7 (R.0.B.1, R.0.C.4, R.0.D.5).
- Roundabout by hand (Autodesk "To convert an intersection to a roundabout": select it, Stack >
  Junction Type thumbnail > Roundabout; "To modify roundabout geometry": select the roundel, drag the
  grips or edit in the Stack). Next: the user converts intersection 9 (RA-1 centre) with ICD 40.4 m,
  central circle 24.0 m, then the before/after diff from `.files`.
- Restored (4 Nov, ~17:15, user's decision): the working model went through the cancelled script,
  and InfraWorks logged "Model Repair: Git repo is in undo branch" at 15:33; every later open sat
  10+ minutes regenerating (the document itself opened in under a minute: "is opened" in
  `%APPDATA%\Autodesk\Autodesk InfraWorks\logs`). `C:\IW\Al Qairawan Roads (Parsons 6 junctions)`
  is again road-model-2026-11-03b.zip: 250 roads (RA-1..RA-7 one row each), 12 intersections,
  41 arms, 34 regions, 109 links, 0 dangling, integrity ok. The Session 6 cleanup above was on the
  replaced file. Not in 03b: the 4 Nov write of R.9.G.6 / R.9.G.7 as A1 (redo with
  `model:roads ... --section R.9.G.6=A1,R.9.G.7=A1 --only R.9.G.6,R.9.G.7`). Next: delete the rings in
  the file (no script) with their intersections, test, then the roundabout by hand.
- Rings deleted in the file (4 Nov, AICC: all 7): `pnpm model:intersections <model> --delete-roads
  RA-1,RA-2,RA-3,RA-4,RA-5,RA-6,RA-7`: 223 rows, intersections 7, 8, 10, 11 removed. Working model now:
  243 roads, 8 intersections, 25 arms, 18 regions, 61 links, 0 dangling, integrity ok. Intersection 9
  (RA-1 centre: R.0.D.2, R.2.F.3, R.1.F.2, R.0.D.1) is kept for the roundabout trial. The other RA
  centres have no intersection yet (their through roads were never rebuilt by InfraWorks).
- InfraWorks rebuilds a road we wrote the first time it handles it (our range hash is zeroed): at
  21:19 R.2.G.11 (grading FixedWidth -> FixedSlope, profile end moved < 1 mm) and 10 new T junctions;
  21:22 R.0.D.1 after the user set its grading: its junctions incl. 41 at the RA-2 centre (R.0.C.2,
  R.0.C.1, R.0.D.1). Junction 9 (RA-1 centre) was not rebuilt. Arms of the divided R.0.D roads carry
  LANES `{"version": 1}` (no lanes) even on junctions InfraWorks just built: normal, not stale.
- Roundabout conversion: junction 9 (4 arms, R.0.D.2 / R.0.D.1 divided) does not convert (the
  Roundabout thumbnail does nothing; cause not known: space, per Roads Tutorial 3 Ex 3, or the
  divided arms). Junction 4 (T, R.1.F.2 / R.1.F.1) converts. Diff (`.files` 6d846cb, revert 7282287):
  INTERSECTIONS.INTERSECTION_TYPE 0 -> 1 and GEOMETRY grows to the roundabout's box; one ROUNDABOUTS
  row (FK_PARENT_TABLE INTERSECTIONS, FK_PARENT_GUID the intersection, EXTERNAL_STANDARD_GUID,
  STANDARD_NAME "FHWA 2010: Rural Double Lane Roundabout", STANDARD_SOURCE "Pool", LOCATION_OFFSET,
  LANES 1, LANE_DETAILS width 7.225, ISLAND_DIAMETER 27, APRON_WIDTH 2, INSCRIBED_CIRCLE_DIAMETER 45.45,
  TILTED_PLANE_* 0, STATUS 0); each arm gets ARM_INDEX 1..n, BLEND_POINT_ENTRY (+offset 73.5 m),
  widths 3.3, ENTRY/EXIT_LANES_AT_YIELD 1, STATUS 0; regions unchanged. The body is InfraWorks':
  PRIMITIVES / TERRAIN_OPERATIONS with FK_PARENT_TABLE INTERSECTIONS (37 strips, 4 grading rows),
  and the two roads' bodies regenerated. Revert: type 0, ROUNDABOUTS row deleted, arm fields stay.
  Rule in code: `readJunctions()` (test in `test/intersections.test.ts`).
- Roundabout centres are made of road ends only (RA-1: R.0.D.2, R.2.F.3 start, R.1.F.2, R.0.D.1 end at
  one point, z 683.390; RA-2: R.0.C.2, R.0.D.1 start, R.0.C.1 ends, z 681.825); no road passes through.
  InfraWorks: junction 41 (RA-2) "Intersection not supported", junction 9 (RA-1) will not convert; the
  converted junction 4 has a through road. Straight pairs: RA-1 R.0.D.2/R.0.D.1 and R.2.F.3/R.1.F.2,
  RA-2 R.0.C.1/R.0.C.2 (R.0.D.1 the T). No Autodesk help topic for the warning or for joining roads.
  Trial (AICC, 4 Nov): `model:roads ... --merge R.0.C.2=R.0.C.1+R.0.C.2` joins the pair as drawn
  (`mergeRoads`: refuses a gap, reversed part, level step or curve at the joint), writes it under
  R.0.C.2 (GUIDs kept), moves R.0.C.1's intersection links (`repointLinks`) and deletes R.0.C.1.
  Dry run: 1231.277 m, 15 PVIs, C1. Naming to settle if it works (two Parsons names, one road).
  Written (4 Nov ~21:52, model closed): R.0.C.2 = R.0.C.1 + R.0.C.2 (1231.277 m), 7 links moved,
  R.0.C.1 deleted (70 rows): 242 roads, 37 intersections, 0 dangling, integrity ok; junction 41 now
  R.0.C.2 < > and R.0.D.1 <, junction 39 R.0.D.16 on R.0.C.2. RoadWriter now uses savepoints so the
  merge runs in one transaction. Next: the user converts 41 (ICD 40.4, island 24.0) in InfraWorks.
- After the merge InfraWorks rebuilt junction 41 as a proper T (R.0.C.2 through, R.0.D.1 ending), but
  the Roundabout thumbnail still does nothing. Likely space (not proven): InfraWorks' default
  roundabout (FHWA 2010 Rural Double Lane, ICD 45.45) put junction 4's blend points 73.5 m out; the
  nearest other junction is 99 m from 4, but 65.8 / 70.3 m from 9 (RA-1) and 76.6 m from 41 (RA-2).
- Roundabout written into the file (AICC: apron 2.0 m, InfraWorks' default, not in Parsons'
  drawings): `pnpm model:intersections <model> --roundabout 41 --icd 40.4 --island 24.0 --apron 2.0
  --lanes 1 --lane-width 8.2` (`writeRoundabout`): INTERSECTION_TYPE 1, ROUNDABOUTS row (box = the
  circle's square around REFERENCE_POINTS, InfraWorks' standard GUID from junction 4, LOCATION_OFFSET
  0), arms numbered anticlockwise (checked: same numbers InfraWorks gave junction 4), one lane each
  way at the yield line; blend points and body left to InfraWorks. Written 4 Nov ~22:15; model then
  72 intersections, integrity ok. Not yet opened in InfraWorks.
- Opened in InfraWorks (22:16): the Stack shows Roundabout 41 (Junction Type Roundabout, FHWA 2010
  standard, island 24.0, apron 2.0, 3 arms) but Inscribed Circle Diameter 42.45 although 40.4 is
  stored: InfraWorks shows island + 2 x apron + 2 x 7.225 (the standard's lane; junction 4: 27 + 4 +
  14.45 = 45.45). Rule in code: `roundaboutDiameter`; writeRoundabout refuses sizes that do not add
  up. The body was not rebuilt (the old T's 52 strips and 4 grading rows stay; blend offsets null).
  Open: where the 2.0 m apron goes inside Parsons' 8.2 m ring (island 20.0 + apron to r 12, lane 8.2;
  or island 24.0, lane 6.2), and the hand step that makes InfraWorks build the body.
- AICC decision (4 Nov): the 2.0 m apron sits inside Parsons' island circle (r 12.0): InfraWorks island
  20.0, apron 2.0, one lane 8.2 m (Parsons' ring width), ICD 40.4. Written to junction 41 (~22:40,
  `--roundabout 41 --icd 40.4 --island 20.0 --apron 2.0 --lanes 1 --lane-width 8.2`), integrity ok.
  Next: the user types 40.4 in the Stack's Inscribed Circle Diameter (Autodesk "To modify roundabout
  geometry") to see whether InfraWorks builds the body and which lane width it keeps.
- Roundabout 41 built (22:34-22:36): the user selected the roundel (Autodesk "To modify roundabout
  geometry") and edited apron / island in its Stack (Inscribed Circle Diameter, Apron Width, Center
  Island Diameter, Center Point Elevation 681.83 editable; Total Width of Lanes 7.225 read-only).
  Only then did InfraWorks build the body (31 strips, 4 grading rows) and blend points (76.9 m).
  Saved: ICD 40.45, island 22, apron 2, LANE_DETAILS rewritten to 7.225 (our 8.2 replaced). Rules in
  code: the lane is the standard's 7.225 m (`IW_ROUNDABOUT_STANDARD.laneWidth`, other widths refused);
  ICD = island + 2 x apron + 2 x 7.225. The body sits on a tall wall at the grading edge (yellow line),
  the known site-edge terrain issue, not the roundabout.
  Open: Parsons' ring is 8.2 m (r 12.0 to r 20.2) but the lane is 7.225, so apron = 0.975 if both
  drawn edges are kept (island 24.0, ICD 40.4); apron 2.0 moves the island edge to r 10.975.
- AICC decision (4 Nov, ~22:50): keep both of Parsons' drawn edges: island 24.0 (r 12.0), ICD 40.4
  (r 20.2), lane 7.225 (the standard's), so apron = 8.2 - 7.225 = 0.975 m. Written to junction 41
  (`--roundabout 41 --icd 40.4 --island 24.0 --apron 0.975 --lanes 1 --lane-width 7.225`); its body
  is rebuilt by one roundel edit in the Stack. RA-1 merges dry run: R.0.D.2 = R.0.D.1 + R.0.D.2
  (1085.545 m, B1), R.2.F.3 = R.1.F.2 + R.2.F.3 (807.596 m, A2); not written.
- RA-1 written (4 Nov ~23:00, model closed): R.0.D.2 = R.0.D.1 + R.0.D.2 (22 links moved, R.0.D.1
  deleted), R.2.F.3 = R.1.F.2 + R.2.F.3 (7 links moved, R.1.F.2 deleted); junction 9 is now two
  through roads crossing, then `--roundabout 9 --icd 40.4 --island 24.0 --apron 0.975 --lanes 1
  --lane-width 7.225` (4 arms). Model: 240 roads, 72 intersections, 514 links, 0 dangling, integrity
  ok; roundabouts 9 and 41 both 40.4 / 24.0 / 0.975. Bodies need one roundel edit each in InfraWorks.
  Merged names so far: R.0.C.2 (+R.0.C.1), R.0.D.2 (+R.0.D.1), R.2.F.3 (+R.1.F.2).
- Deep wall under roundabouts 9 and 41 (4 Nov, ~23:10): their grading reached z 7-8 m. Causes:
  (1) InfraWorks placed each arm's blend point on its road but at height 0.00 (9: 80.8 m out, 41:
  76.9 m), so every arm graded down from ~683 to 0; junction 4, converted in the Stack, had real
  heights (683.x). Fix: `fixBlendLevels` sets the road's 3D centreline level at that point (Parsons'
  profile), position kept; run by every model:intersections. (2) my prune removed junctions 7, 8, 10,
  11 but left their bodies (166 PRIMITIVES, 15 TERRAIN_OPERATIONS with cut-outs around the RA-1
  centre); prune now removes intersection bodies too. Dry run on the model: 181 body rows, 7 blend
  heights 680.4-683.7, each 0.000 m from its road. The Stack field keeps 2 decimals: apron 0.975
  typed was saved as 0.97 (ICD 40.39).
- Written (5 Nov ~14:45, model closed; copy before in the session scratchpad): 181 orphan body rows
  removed, blend heights 9: 683.62 / 683.33 / 682.73 / 683.65, 41: 681.08 / 680.41 / 682.97, both
  roundabouts 40.4 / 24.0 / 0.975 / 7.225 exactly; 0 orphans, 0 dangling, integrity ok. The bodies
  rebuild after one roundel edit each (island 24.1 then 24.0: exact at 2 decimals).
- Checked (5 Nov 14:47, after the user toggled each island 24.1 -> 24.0): the wall is gone. Grading
  9: 683.0-683.9, 41: 680.7-683.2; no point below 600 (before 1428 / 1028); apron stays 0.975 (the
  island toggle does not round it); 0 orphan bodies, 0 dangling. Remaining: a seam where a roundabout
  arm meets a merged road InfraWorks has not rebuilt yet (R.0.D.2, R.2.F.3 still carry our body;
  R.0.C.2 rebuilt, no seam). Next: one road edit each (Grading Limit 5.0 -> 5.1 -> 5.0, Autodesk
  "To set the roadside grading method") so InfraWorks rebuilds them.
- 5 Nov 15:00: Grading Limit 5.0 -> 5.1 -> 5.0 on R.0.D.2 and R.2.F.3 made InfraWorks rebuild both
  (95 / 56 strips, real range hash). Roundabout 9 arm 4 blend point moved to 55.6 m and InfraWorks gave
  it a real height (683.23) itself: blend heights come out as 0 only on roads still carrying our body.
  Order for the next roundabouts: merge, let InfraWorks rebuild the roads (one road edit each), then
  write the roundabout and toggle its island. Grading 9: 683.0-683.9, 41: 680.7-683.2; 0 dangling.
- The "seam" at RA-1's north arm (R.0.D.2): no level step. At the blend point the road and the
  roundabout arm centrelines are both 683.624; the face is the cut end of the B1 section (median,
  kerbs, depth: 683.18-683.77) where InfraWorks switches from Parsons' 2+2 divided section to the
  roundabout standard's one-lane arm without a taper. Open: how many entry lanes and what taper
  Parsons draws at the RA entries (to check on 10200 with the kerb radii, step c).
- Split test (5 Nov ~15:20, AICC: keep Parsons' roads if InfraWorks allows): `model:roads ... --split
  R.0.C.2=R.0.C.1+R.0.C.2` writes the parts again as drawn and moves each junction link to the part it
  lies on (`splitLinks`; at the joint, an arm approaching along the road goes to the part ending there).
  Model: R.0.C.1 (39, 70 and 41's approaching arm) and R.0.C.2 (75, 76 and 41's leaving arm), 0
  dangling, integrity ok; roundabout 41 row kept. Next: the user opens it, checks 41, then makes
  InfraWorks rebuild R.0.C.1 (Grading Limit 5.0 -> 5.1 -> 5.0) and sees whether 41 stays a roundabout.
- Split test result (5 Nov 16:06): after the user made InfraWorks rebuild R.0.C.1 (Grading Limit
  toggle), roundabout 41 lost its body (1 strip, no grading; row and links kept): with R.0.C.1 and
  R.0.C.2 only ending at the centre the junction is road ends only, which InfraWorks does not support.
  Rule: every roundabout centre needs a road passing through it, so the approach roads stay merged.
  Next (to agree): merge R.0.C.1 + R.0.C.2 again, rebuild, toggle the island; record Parsons' part
  names and stations in each merged road's DESCRIPTION, and gate that every Parsons name is either a
  road or a recorded part.
- Re-merged (5 Nov ~16:20): R.0.C.2 = R.0.C.1 + R.0.C.2 again (11 links back); parts recorded in
  ROADS.DESCRIPTION (`partsDescription`, `--record-merges` for merges written earlier): R.0.C.2,
  R.0.D.2 (R.0.D.1 0+000-0+756.589, R.0.D.2 to 1+085.545), R.2.F.3 (R.1.F.2 0+000-0+440.093, R.2.F.3
  to 0+807.596). `missingDrawnRoads`: every drawn road is in the model as a road or a recorded part.
  0 dangling, integrity ok. Next: rebuild R.0.C.2 (Grading Limit toggle), then island toggle on 41.
- RA-2 restored (5 Nov 16:17): R.0.C.2 rebuilt by InfraWorks (114 strips), island toggled; roundabout
  41 40.4 / 24.0 / 0.975, grading 680.7-683.2; RA-1 683.0-683.9; all blend heights real; 0 orphans,
  0 dangling. The DESCRIPTION records survive InfraWorks' rebuilds. RA-1 and RA-2 done.
  Recipe for RA-3..RA-7 (each): merge the straight pairs through the centre (`--merge`, parts
  recorded), one road edit per merged road so InfraWorks rebuilds it and creates the centre junction,
  `model:intersections --roundabout <id> --icd 40.4 --island 24.0 --apron 0.975 --lanes 1
  --lane-width 7.225`, then the island toggle (24.1 -> 24.0) in the roundel Stack.
- Roundabout arms vs Parsons' roads (5 Nov): on the divided roads (B1 / C1: R.0.D.2, R.0.C.2) InfraWorks
  reads 0 lanes, 0 median, 0 lane width at every arm (also on R.0.D.1's T junctions earlier), so it
  builds a generic arm (no median, the standard's footpath); on A2 (R.2.F.3) it reads 1 + 1 lanes of
  3.3. Our B1/C1/C2 section writes a 0.4 m shy strip as a Lane beside the median (3 "lanes" a side
  while the road says 2) and the raised median fill as Sidewalk pieces on the median; InfraWorks' own
  "Four Lane Divided with Sloped Asphalt Median & Curb & Gutter" has only real lanes on the median's
  curb. Hypothesis to test on one road: write the shy strip as a Shoulder component.
- Test (5 Nov ~16:45): the 0.4 m shy strip of B1/C1/C2 is now a Shoulder component (same shape as a
  Lane; `sections.ts`, test "a divided road has exactly its lanes as Lane components"). Only R.0.C.2
  rewritten (re-run of its merge: GUIDs, links, Parsons record kept). Next: InfraWorks rebuilds
  R.0.C.2 (Grading Limit toggle) and roundabout 41 (island toggle); then read the arms' LANES /
  BLEND_POINT_MEDIAN_WIDTH in the file.
- Shoulder test result (5 Nov ~17:00): R.0.C.2 rebuilt by InfraWorks (102 strips) with the shy strip as
  a Shoulder; roundabout 41's arms still read LANES 0, median 0, widths 0. Not the cause; the change is
  kept (the strip is not a traffic lane). The road's Stack "Description" stayed empty with only
  ROADS.DESCRIPTION set: `setDescription` now also writes CONSTRAINED_DEFINITIONS.DESCRIPTION (to check).
  Open: why InfraWorks reads no lanes on our divided sections (B1/C1/C2). Next idea: a controlled test
  with InfraWorks' own "Four Lane Divided with Sloped Asphalt Median & Curb & Gutter" layout.
- Arms from roads written (5 Nov ~17:20, AICC: the arm meets the road as drawn until Parsons gives the
  entries): R.0.D.2 rewritten with the Shoulder section (merge re-run; GUIDs, links kept); Parsons
  records now also on CONSTRAINED_DEFINITIONS.DESCRIPTION for the 3 merged roads; `--arms-from-roads`:
  9 arms 1, 3 and 41 arm 1 (R.0.D.2, B1) 2 + 2 x 3.3, median 1.2; 41 arms 2, 3 (R.0.C.2, C1) 2 + 2 x
  3.3, median 4.0; yield 1 lane. 0 dangling, integrity ok. Next: rebuild R.0.D.2, toggle islands 9
  and 41, then check whether InfraWorks keeps or recomputes the arm values.
- After the rebuild (5 Nov ~20:05): the road Stack shows the Parsons record (CONSTRAINED_DEFINITIONS
  .DESCRIPTION is the field it shows). Arms: InfraWorks KEPT BLEND_POINT_MEDIAN_WIDTH (1.2 / 4.0) and
  ENTRY/EXIT_WIDTH 3.3 (the arms now show a median and a nose at the road) but RESET LANES and
  ENTRY/EXIT_LANES to 0: it takes the lane count from the road, and still reads 0 lanes on our
  divided sections (also with the Shoulder). Grading 680.7-683.9, 0 dangling. Remaining fix: make
  B1/C1/C2 lanes readable to InfraWorks (controlled test with its own divided assembly on a copy).
- Lane-reading test on a temporary copy C:\IW\lanetest (5 Nov ~20:20; delete after the test):
  V1 R.0.C.2 = our C1 without the kerbs and fill on the median (lanes off the median edge, as
  InfraWorks' "Four Lane Divided ..." hangs them off its median curbs); V2 R.0.D.2 = our B1 without the
  `classification` tags (InfraWorks' assemblies have none). Written to ROADS.MANUAL_STYLE only; the user
  rebuilds each (Grading Limit toggle), then the junction arms' LANES are read.
- Test round 1 (lanetest, 5 Nov ~20:40): V1 (R.0.C.2 without median kerbs and fill) -> every junction
  arm reads 4 lanes (2 each way); roundabout median 4.8 (4.0 + 2 x 0.4 shoulder). V2 (no
  classification) -> still 0. Cause: the kerbs / fill on the median with the lanes hung off the median.
  Round 2 written: V3 R.0.D.2 = full B1 (kerbs + raised fill) but the shoulder hangs off the median
  kerb (point 1 = the median edge at road level), as InfraWorks chains median -> curb -> lanes; V4
  R.0.C.2 = kerbs, no fill, shoulder off the kerb. Same geometry; only the attachment parent changes.
- Round 2 (lanetest, 5 Nov ~20:50): V4 R.0.C.2 (median kerbs, no fill, shoulder off the kerb) reads 2 + 2
  lanes at every arm, body rebuilt (90 strips), the arm continues the road's lanes into the roundabout.
  V3 R.0.D.2 (kerbs + raised fill as a Sidewalk on the median) still 0 lanes. Cause: a Sidewalk piece on
  the median (InfraWorks seems to take a sidewalk as the carriageway edge). Plan: the raised median is
  drawn by the kerbs themselves (each kerb half the median wide, 150 mm upstand, flat top); test V5 on
  R.0.D.2 in the copy, then change `buildSection`.
- Round 3 (lanetest): V5 R.0.D.2 = raised median drawn by the kerbs (each half the median wide, 150 mm
  upstand), nothing else on the median, shoulder off the kerb face -> every arm reads 2 + 2 lanes
  (9, 12, 21, 22, 40, 41, 90; roundabout median 2.0). `buildSection` B1/C1/C2 changed to this layout
  (tests: median top 150 mm, only the two kerbs on the median, shoulder on the kerb face).
  `model:roads ... --restyle divided` (`restyleRoad`: only the section in MANUAL_STYLE) applied to the
  19 divided roads of the working model (5 Nov ~21:15); 0 dangling, integrity ok. Test copy deleted.
  Next: InfraWorks rebuilds each of the 19 (one road edit each), then roundabout island toggles;
  check junction arms read lanes. armsFromRoads should no longer be needed.
- After the 19 road edits (5 Nov ~21:40): every divided road reads 4 lanes at its junctions (also
  roundabouts 9 and 41). 3 pits = junctions 106 (RA-3 centre), 135 (R.0.D.13 south of RA-5), 161:
  their surface strips go to z 0. Each joins a road InfraWorks has not rebuilt (still our body, zero
  range hash): 106 R.0.D.14; 135 R.9.G.5, R.10.G.2; 161 R.4.G.2, R.5.G.1. Rule: InfraWorks builds a
  junction at height 0 on a road that still carries our body (same as the blend points). Every road
  InfraWorks rebuilds can make new junctions with neighbours not yet rebuilt; until every road has been
  rebuilt once, such pits can appear. Fix now: one edit on those 5 roads. Open: a way to have all ~200
  remaining roads rebuilt once without 200 hand edits.
- Pits 106, 135, 161 (5 Nov ~22:50): rebuilding their 5 roads, then a Design Vehicle change on 135
  (P -> SU-9 -> P, Autodesk "About Intersections"), rebuilt the junction but its surface and cut-out
  still drop to ~0 / 637 m. Not the road levels (spread <= 0.14 m, like good 103), not the grading
  surface (present, 686.9-689.1), not other cut-outs, not the layout (139 = same make-up as 135, ok;
  136 = same as 106, ok). Remaining difference: they were first created while a road had our body.
  Test: `model:intersections --delete-junctions 135` then one edit on R.9.G.5 so InfraWorks creates the
  junction afresh (`deleteIntersection`, test).
- Fresh-build test (5 Nov ~23:10): junction 135 deleted in the file (82 rows; area flat and clean in
  InfraWorks), then an edit on R.9.G.5: InfraWorks created it again (now ID 298) with the same pit. So
  it is how InfraWorks builds this junction, not its history. Also ruled out: grades near the junction
  (pit 135: 1.74 / 0.95 %, good ones down to 0.008 %). Open: 3 of 21 crossings on divided roads
  (106, 161, 298) build with surfaces dropping to 0; next cheap test: "Extend into Intersection" off in
  the junction's Stack; else raise with Autodesk with the evidence.
- "Extend into Intersection" off (and Yield Line off) on junction 298: same pit. Search stopped: an
  InfraWorks build problem at 3 of 21 divided-road crossings (106, 161, 298), not explained by the
  data. Proposed: delete 298 and 161 as a cosmetic workaround (they come back on a road edit), report
  to Autodesk with the evidence, continue with RA-3..RA-7 (106 is replaced by RA-3's roundabout).
