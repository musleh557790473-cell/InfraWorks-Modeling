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
