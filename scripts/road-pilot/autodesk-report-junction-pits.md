# InfraWorks 2026: some component-road intersections are built with a surface dropping to elevation 0

Prepared by AICC JV (LDIP / Al Qairawan road model), 5 Nov 2026, for Autodesk support.

## Summary

In a local InfraWorks 2026 model with about 240 component roads and 290 intersections, three
4-arm intersections on divided roads are built with their intersection slabs and cut-out dropping
from the road level (about 689 m) down to elevation 0. In the viewer this shows as a deep pit with
vertical walls in the middle of the intersection. Eighteen other intersections with the same make-up
in the same model are built correctly.

## Affected intersections (UTM84-38N)

| Intersection | Location (E, N) | Roads | Reference elevation |
|---|---|---|---|
| 106 | 658444.3, 2748423.0 | four divided roads ending at one point | 687.93 |
| 135 (re-created as 298) | 658847.9, 2748152.8 | divided road through, two two-lane roads ending on it from opposite sides | 689.75 |
| 161 | 658280.1, 2748757.0 | divided road through, two two-lane roads ending on it from opposite sides | 688.72 |

A correct intersection with the same make-up as 135: 139 at 658848.4, 2747962.8 (divided road R.0.D.13 through,
R.9.G.6 and R.10.G.1 ending on it). A correct one with the same make-up as 106: 136 (four divided roads
ending at one point).

## What the model data shows

- `PRIMITIVES` of the intersection: the `targetingSlab` strips have base paths falling from about
  689 m to 0.0 inside the intersection (e.g. 650.15, 649.74, 649.33 ... to 0.0); the intersection's
  `CutOut` terrain operation goes down to about 637 m. On correct intersections all values stay within
  a few centimetres of the road level.
- `INTERSECTIONS.REFERENCE_POINTS` elevation is correct (687-690 m) on all three.
- The roads' own 3D centrelines and profiles are correct at the intersection: level spread between the
  roads 0.04-0.14 m (a correct intersection, 103, has 0.05 m); grades near the intersection 0.3-1.8 %.
- The grading surface (LandXML, visible terrain) exists and is continuous under all three.
- No other feature's cut-out covers the area.
- Corner (turning zone) rows look the same as on correct intersections (radius 9-11 m, type 2).

## What was tried, and the result

1. Rebuilding each road of the intersection (changing its Grading Limit 5.0 -> 5.1 -> 5.0): roads rebuilt,
   intersection unchanged.
2. Changing the intersection's Design Vehicle P -> SU-9 -> P: intersection rebuilt (its shape changed),
   the pit came back.
3. Deleting the intersection and letting InfraWorks create it again by editing one of its roads: a new
   intersection (ID 298) was created at the same place, with the same pit.
4. Turning "Extend into Intersection" and "Yield Line" off: no change.

## Questions

- What makes the intersection slabs target elevation 0 at these intersections?
- Is there a setting or a road-assembly condition that avoids it?

The model (or the affected area) can be provided on request.
