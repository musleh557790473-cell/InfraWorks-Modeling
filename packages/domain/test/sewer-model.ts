import { DatabaseSync } from "node:sqlite";

/** A tiny SewerGEMS model database, as OpenFlows writes it: feet, WKB XY geometry, IsDeleted flags. */
export function makeSewerModel(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    create table HMIModelingElement (ElementID integer primary key, DomainDataSetID int, IsDeleted int, ElementType int, Label text);
    create table Conduit (DomainElementID integer);
    create table Manhole (DomainElementID integer);
    create table Outfall (DomainElementID integer);
    create table BaseNode_HmiDataSetGeometry_Data (DomainElementID integer, AlternativeID int, HMIGeometry blob, HMIRealGeometry blob);
    create table BaseLink_HmiDataSetGeometry_Data (DomainElementID integer, AlternativeID int, HMIGeometry blob, HMIRealGeometry blob, HMIGeometryScaledLength real);
    create table BaseLink_HMIDataSetTopology_Data (DomainElementID integer, AlternativeID int, HMITopologyStartNodeID int, HMITopologyStopNodeID int);
    create table GravityNode_Physical_Data (DomainElementID integer, AlternativeID int, Physical_InvertElevation real);
    create table GravitySurfaceStructure_Physical_Data (DomainElementID integer, AlternativeID int, Physical_RimElevation real, CircularStructureType_Diameter real, GravityStructureType int);
    create table Outfall_Physical_Data (DomainElementID integer, AlternativeID int, Physical_RimElevation real);
    create table Conduit_Physical_Data (DomainElementID integer, AlternativeID int, ConduitDiameter real, ConduitShape int, Physical_ConduitShapeLabel text, ConduitSpan real, ConduitRise real);
    create table GravityLinkBase_Physical_Data (DomainElementID integer, AlternativeID int, Physical_Material text);
    create table PhysicalLink_Physical_Data (DomainElementID integer, AlternativeID int, Physical_SetInvertToUpstream int, Physical_UpstreamInvert real, Physical_SetInvertToDownstream int, Physical_DownstreamInvert real);
  `);
  const ft = (m: number) => m / 0.3048;
  const point = (x: number, y: number) => {
    const b = Buffer.alloc(21);
    b[0] = 1;
    b.writeUInt32LE(1, 1);
    b.writeDoubleLE(ft(x), 5);
    b.writeDoubleLE(ft(y), 13);
    return b;
  };
  const line = (pts: [number, number][]) => {
    const b = Buffer.alloc(9 + pts.length * 16);
    b[0] = 1;
    b.writeUInt32LE(2, 1);
    b.writeUInt32LE(pts.length, 5);
    pts.forEach(([x, y], i) => {
      b.writeDoubleLE(ft(x), 9 + i * 16);
      b.writeDoubleLE(ft(y), 17 + i * 16);
    });
    return b;
  };
  const el = db.prepare("insert into HMIModelingElement values (?, 1, ?, 0, ?)");
  // Manholes 1-3 and outfall 4 along an east-west line in UTM 38N; a deleted pipe 13.
  const nodes: [number, string, number, number, number, number][] = [
    [1, "MH-1", 657000, 2748000, 685.0, 683.0],
    [2, "MH-2", 657100, 2748000, 684.5, 682.5],
    [3, "MH-3", 657200, 2748000, 684.0, 682.0],
  ];
  for (const [id, label, x, y, rim, inv] of nodes) {
    el.run(id, 0, label);
    db.prepare("insert into Manhole values (?)").run(id);
    db.prepare("insert into BaseNode_HmiDataSetGeometry_Data values (?, 2, ?, null)").run(id, point(x, y));
    db.prepare("insert into GravityNode_Physical_Data values (?, 6, ?)").run(id, ft(inv));
    db.prepare("insert into GravitySurfaceStructure_Physical_Data values (?, 6, ?, ?, 0)").run(id, ft(rim), ft(1.2));
  }
  el.run(4, 0, "OUT-1");
  db.prepare("insert into Outfall values (4)").run();
  db.prepare("insert into BaseNode_HmiDataSetGeometry_Data values (4, 2, ?, null)").run(point(657300, 2748000));
  db.prepare("insert into GravityNode_Physical_Data values (4, 6, ?)").run(ft(681.5));
  db.prepare("insert into Outfall_Physical_Data values (4, 6, 0)").run(); // rim left at 0
  const pipes: [number, string, number, number, number, string, number, number, number][] = [
    // id, label, from, to, diameter m, material, inv start, inv end, deleted
    [11, "CO-1", 1, 2, 0.2, "HDPE CORRUGATED", 683.0, 682.5, 0],
    [12, "CO-2", 3, 2, 0.3, "Ductile Iron", 682.0, 682.5, 0], // drawn against the flow
    [13, "CO-OLD", 3, 4, 0.2, "HDPE CORRUGATED", 682.0, 681.5, 1],
  ];
  const xy = new Map(nodes.map(([id, , x, y]) => [id, [x, y] as [number, number]]));
  xy.set(4, [657300, 2748000]);
  for (const [id, label, a, b, d, mat, i1, i2, del] of pipes) {
    el.run(id, del, label);
    db.prepare("insert into Conduit values (?)").run(id);
    db.prepare("insert into BaseLink_HmiDataSetGeometry_Data values (?, 2, ?, null, 0)").run(id, line([xy.get(a)!, xy.get(b)!]));
    db.prepare("insert into BaseLink_HMIDataSetTopology_Data values (?, 3, ?, ?)").run(id, a, b);
    db.prepare("insert into Conduit_Physical_Data values (?, 6, ?, 2, ?, 0, 0)").run(id, ft(d), `Circle - ${d * 1000}.0 mm`);
    db.prepare("insert into GravityLinkBase_Physical_Data values (?, 6, ?)").run(id, mat);
    db.prepare("insert into PhysicalLink_Physical_Data values (?, 6, 0, ?, 0, ?)").run(id, ft(i1), ft(i2));
  }
  db.close();
}