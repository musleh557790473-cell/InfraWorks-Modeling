# InfraWorks 2026 crashes when a cross of two through roads is converted to a roundabout

Report to Autodesk (draft, AICC, 7 Nov 2026). Model: `Al Qairawan Roads (Parsons 6 junctions)`
(UTM84-38N, component roads written from the designer's drawings), InfraWorks 2026.0.2.119,
Windows 11 Enterprise 10.0.26200, NVIDIA RTX PRO 4000 Blackwell Laptop GPU.

## What happens

Junction 309 is the automatic intersection of two component roads that both run through it
(R.0.D.12, 1155.7 m, and R.0.D.4, 1436.1 m; both B1 divided roads, 2 + 2 lanes, crossing at right
angles). Selecting it and clicking the Roundabout thumbnail under Junction Type in the Stack closes
InfraWorks at once, every time: four crashes on 7 Nov 2026, with the same exception each time.

| # | Time | Model | Neighbouring junctions | Dump |
|---|---|---|---|---|
| 1 | 15:46 | working copy | 142 at 70 m, 137 and 299 at 80 m | `InfraWorks_error.dmp` |
| 2 | 19:30 | working copy, junction recreated | same | `InfraWorks_error_2.dmp` |
| 3 | 21:44 | trial copy, junctions 142 / 137 / 299 deleted (InfraWorks recreated them on the road rebuild) | same | `InfraWorks_error_3.dmp` |
| 4 | 21:53 | trial copy, the four local roads removed: no junction nearer than 125 m | none | `InfraWorks_error_4.dmp` |

Dump (`%LOCALAPPDATA%\Temp\InfraWorks_error.dmp`, read with `minidump.cjs`): exception 0xC0000005,
read of address 0x0, on the UI thread, at `AIM_RoadsApp.dll+0xf8be5` in all four dumps; frames
AIM_UIPlatform > AIM_Platform > AIM_RoadsApp > AIM_ModelRoad / AIM_ModelCore > FdoWrap / AIM_CoreAPI.
The log's last line before each crash is
`VehicleTrackingRoundaboutStandard.cpp(144): Junction Standard loaded from .../Standards/Roads/Roundabouts/US_1400.atj`.
After the crash the model holds a ROUNDABOUTS row and four INTERSECTION_ARMS rows with an empty
FK_PARENT_GUID and the arms' blend point offsets already computed (65.6 / 73.5 / 65.6 / 55.6 m in
crashes 1-3, i.e. the conversion got as far as clamping the arms before the next junctions).

An earlier attempt on the same junction (14:54, before the first crash) did not crash but logged
`database table is locked` twelve times (FDO wrap, `UPDATE "ROUNDABOUTS"`, `UPDATE "INTERSECTION_ARMS"`,
`UPDATE "INTERSECTIONS" ... WHERE "ID"=308`) and left the same half-written rows.

## What does not crash

- Junction 308, 600 m away on the same road R.0.D.12, with three roads (R.0.D.12 through, R.6.F.1 and
  R.0.D.15 ending there): converts in the Stack, first with the warning "Invalid roundabout geometry -
  insufficient space for arm lengths, or arm radii" on FHWA 2010 Rural Double Lane, then builds when
  the Standard is switched to FHWA 2000 Urban Compact.
- The same cross (309) with the roundabout row written into the SQLite file (ROUNDABOUTS, arm
  indices, blend points on the roads) and the road edited: no crash, but "Invalid roundabout geometry
  - intersections overlap" with no body, whatever the arm lengths (76.9 default, 65.6 / 55.6, 60 / 50).
- The same cross with one of the roads split at the centre into two roads (R.0.D.3 + R.0.D.4 ending
  there): "Intersection not supported" (log: `IntersectionCommonInfo.cpp(1596): failed to get road
  parameters` x 4), so the roundabout cannot be tried.

## To reproduce

1. Open the model (copy supplied: `Al Qairawan Roads (Parsons 7 RA5 trial)` has the four local roads
   near the junction removed; the crash is the same with them).
2. Select road R.0.D.4 (Select By Filter `NAME = 'R.0.D.4'`), set Grading Limit 5.0 -> 5.1 -> 5.0 so
   the centre junction (R.0.D.12 x R.0.D.4) is created.
3. Select that junction; Stack > Junction Type > Roundabout.

Files for Autodesk: the four dumps and the day's logs in
`InfraWorks-Modeling-Data\reports\infraworks-roundabout-crash-2026-11-07`; the trial copy on request.

## What we ask

Whether a cross of two through component roads can be converted to a roundabout in 2026.0.2, and
whether a fix or workaround exists (the file route is rejected as "intersections overlap" even with
the arms 6.7 m clear of the neighbouring junctions' extents).
