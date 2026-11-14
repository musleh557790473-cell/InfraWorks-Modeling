import assert from "node:assert/strict";
import test from "node:test";

import { pieceLen, pointAtStation, readLandXmlRoads, ringOf } from "../src/index.js";

// Civil 3D writes points as "northing easting"; RD-01 runs east 100 m, turns left on a quarter circle
// (r 50, centre 100 E / 50 N) and north 20 m. Stations start at 1+000.
const quarter = (Math.PI * 50) / 2;
const xml = `<?xml version="1.0"?>
<LandXML><Alignments name="Roads">
 <Alignment name="RD-01" length="${(120 + quarter).toFixed(6)}" staStart="1000." desc="">
  <CoordGeom>
   <Line dir="0." length="100."><Start>0. 0.</Start><End>0. 100.</End></Line>
   <Curve rot="ccw" crvType="arc" radius="50."><Start>0. 100.</Start><Center>50. 100.</Center><End>50. 150.</End><PI>0. 150.</PI></Curve>
   <Line><Start>50. 150.</Start><End>70. 150.</End></Line>
  </CoordGeom>
  <Profile name="RD-01">
   <ProfSurf name="EG"><PntList2D>1000. 700. 1100. 701.</PntList2D></ProfSurf>
   <ProfAlign name="RD-01 FG">
    <PVI>1000. 700.</PVI>
    <ParaCurve length="40.">1080. 701.6</ParaCurve>
    <PVI>${(1120 + quarter).toFixed(6)} 700.5</PVI>
   </ProfAlign>
  </Profile>
 </Alignment>
 <Alignment name="RA-01" length="126.92" staStart="0.">
  <CoordGeom><Curve rot="cw" radius="20.2"><Start>0. 520.2</Start><Center>0. 500.</Center><End>0. 520.2</End></Curve></CoordGeom>
  <Profile name="RA-01"><ProfAlign name="FG"><PVI>0. 766.</PVI><PVI>${(2 * Math.PI * 20.2).toFixed(6)} 766.</PVI></ProfAlign></Profile>
 </Alignment>
 <Alignment name="RD-02" length="50." staStart="0.">
  <CoordGeom><Line><Start>0. 0.</Start><End>50. 0.</End></Line></CoordGeom>
 </Alignment>
 <Alignment name="RD-03" length="80." staStart="0.">
  <CoordGeom><Line><Start>0. 0.</Start><End>80. 0.</End></Line></CoordGeom>
  <Profile name="RD-03"><ProfAlign name="FG"><PVI>0. 700.</PVI><PVI>60. 701.</PVI></ProfAlign></Profile>
 </Alignment>
 <Alignment name="RD-04" length="30." staStart="0.">
  <CoordGeom><Line><Start>0. 0.</Start><End>10. 0.</End></Line><Spiral length="20." spiType="clothoid"><Start>10. 0.</Start><End>30. 1.</End></Spiral></CoordGeom>
  <Profile name="RD-04"><ProfAlign name="FG"><PVI>0. 700.</PVI><PVI>30. 701.</PVI></ProfAlign></Profile>
 </Alignment>
 <Alignment name="RD-05" length="40." staStart="0.">
  <CoordGeom><Line><Start>0. 0.</Start><End>40. 0.</End></Line></CoordGeom>
  <Profile name="RD-05"><ProfAlign name="FG"><PVI>0. 700.</PVI><PVI>40. 701.</PVI></ProfAlign><ProfAlign name="Kerb"><PVI>0. 700.</PVI><PVI>40. 701.</PVI></ProfAlign></Profile>
 </Alignment>
</Alignments></LandXML>`;

test("LandXML alignments: northing-easting points, curve turn, stations from staStart, PVIs with curve lengths", () => {
  const r = readLandXmlRoads(xml);
  const rd = r.roads.find((a) => a.name === "RD-01")!;
  assert.ok(Math.abs(rd.length - (120 + quarter)) < 1e-6);
  assert.deepEqual(rd.segs[0]!.a, [0, 0]);
  assert.deepEqual(rd.segs[0]!.b, [100, 0], "easting is x");
  assert.ok(rd.segs[1]!.bulge > 0, "ccw turns left");
  const mid = pointAtStation(rd.segs, 100 + quarter / 2)!.p;
  assert.ok(Math.abs(Math.hypot(mid[0] - 100, mid[1] - 50) - 50) < 1e-6 && mid[0] > 100 && mid[1] < 50, "arc on its circle, on the outer side");
  assert.deepEqual(r.pvis["RD-01"]!.map((p) => [p.s, p.z, p.L]), [[0, 700, 0], [80, 701.6, 40], [+(120 + quarter).toFixed(4), 700.5, 0]]);
});

test("LandXML alignments: a ring exported as one full-circle curve is split into quarter arcs", () => {
  const ra = readLandXmlRoads(xml).roads.find((a) => a.name === "RA-01")!;
  assert.equal(ra.segs.length, 4);
  assert.ok(ra.segs.every((g) => g.bulge < 0), "cw");
  assert.ok(Math.abs(pieceLen(ra.segs) - 2 * Math.PI * 20.2) < 1e-6);
  // the ring is known even when its profile cannot be read (Namar RA-01: an unsymmetrical vertical curve)
  const bad = readLandXmlRoads(xml.replace('<PVI>0. 766.</PVI>', '<PVI>0. 766.</PVI><UnsymParaCurve lengthIn="5." lengthOut="8.">7.65 766.1</UnsymParaCurve>'));
  assert.match(bad.skipped.find((s) => s.name === "RA-01")!.why, /unsymmetrical/);
  assert.deepEqual(bad.rings.map((q) => [q.name, +q.r.toFixed(3)]), [["RA-01", 20.2]]);
  const g = ringOf(ra)!;
  assert.ok(Math.abs(g.c[0] - 500) < 1e-6 && Math.abs(g.c[1]) < 1e-6 && Math.abs(g.r - 20.2) < 1e-6);
});

test("LandXML alignments: nothing invented - no profile, spiral, several profiles are left out and named; a short profile cuts the road", () => {
  const r = readLandXmlRoads(xml);
  const why = (n: string) => r.skipped.find((s) => s.name === n)?.why ?? "";
  assert.match(why("RD-02"), /no design profile/);
  assert.match(why("RD-04"), /Spiral/);
  assert.match(why("RD-05"), /2 design profiles/);
  const rd3 = r.roads.find((a) => a.name === "RD-03")!;
  assert.ok(Math.abs(rd3.length - 60) < 1e-9, "ends where the profile ends");
  assert.match(r.report.find((l) => l.startsWith("RD-03"))!, /cut to the profile end/);
  // the profile's name chooses among several; a name filter keeps only the roads
  const p = readLandXmlRoads(xml, { profile: /^FG$/, match: /^RD-0[35]$/ });
  assert.deepEqual(p.roads.map((a) => a.name), ["RD-03", "RD-05"]);
});
