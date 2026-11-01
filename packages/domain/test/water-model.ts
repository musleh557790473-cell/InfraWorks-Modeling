import { DatabaseSync } from "node:sqlite";

/**
 * A tiny WaterGEMS model database, as OpenFlows writes it: feet, WKB XY geometry, IsDeleted and
 * ElementType flags (9 = a prototype), scenario alternatives with a child active topology that
 * switches a pipe off, inside diameters, junctions that are only network points.
 */
export function makeWaterModel(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    create table HMIModelingElement (ElementID integer primary key, DomainDataSetID int, IsDeleted int, ElementType int, Label text);
    create table HMIDomainDataSet (DomainDataSetID integer, ActiveScenarioID int);
    create table HMIAlternative (AlternativeID integer, ParentID int, AlternativeTypeID int, IsDeleted int);
    create table HMIScenarioAlternative (ScenarioID int, AlternativeTypeID int, AlternativeID int, IsLocal int);
    create table IdahoPipe (DomainElementID integer);
    create table IdahoJunction (DomainElementID integer);
    create table IdahoReservoir (DomainElementID integer);
    create table AirValve (DomainElementID integer);
    create table PressureIsolationValve (DomainElementID integer);
    create table BaseIdahoNode_HmiDataSetGeometry_Data (DomainElementID integer, AlternativeID int, HMIGeometry blob);
    create table PressureIsolationValve_HmiDataSetGeometry_Data (DomainElementID integer, AlternativeID int, HMIGeometry blob);
    create table BaseIdahoNode_Physical_Data (DomainElementID integer, AlternativeID int, Physical_NodeElevation real);
    create table BaseLink_HmiDataSetGeometry_Data (DomainElementID integer, AlternativeID int, HMIGeometry blob);
    create table BaseLink_HMIDataSetTopology_Data (DomainElementID integer, AlternativeID int, HMITopologyStartNodeID int, HMITopologyStopNodeID int);
    create table BaseLink_HMIActiveTopology_Data (DomainElementID integer, AlternativeID int, HMIActiveTopologyIsActive int);
    create table IdahoPipe_Physical_Data (DomainElementID integer, AlternativeID int, Physical_PipeMaterial text, Physical_PipeDiameter real);
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
  // Scenario 7500 uses active topology 7496, a child of 4 that switches pipe 23 off.
  db.exec(`
    insert into HMIDomainDataSet values (1, 7500);
    insert into HMIAlternative values (4, null, 3, 0), (7496, 4, 3, 0), (6, null, 4, 0);
    insert into HMIScenarioAlternative values (7500, 3, 7496, 0), (7500, 4, 6, 0);
  `);
  const el = db.prepare("insert into HMIModelingElement values (?, 1, ?, ?, ?)");
  const nodes: [number, string, string, number, number, number][] = [
    [1, "R-1", "IdahoReservoir", 657000, 2748000, 700],
    [2, "J-1", "IdahoJunction", 657100, 2748000, 699],
    [3, "J-2", "IdahoJunction", 657200, 2748000, 698],
    [4, "AV-1", "AirValve", 657300, 2748000, 697],
  ];
  for (const [id, label, table, x, y, z] of nodes) {
    el.run(id, 0, 3, label);
    db.prepare(`insert into ${table} values (?)`).run(id);
    db.prepare("insert into BaseIdahoNode_HmiDataSetGeometry_Data values (?, 2, ?)").run(id, point(x, y));
    db.prepare("insert into BaseIdahoNode_Physical_Data values (?, 6, ?)").run(id, ft(z));
  }
  // An isolation valve keeps its position in its own geometry table.
  el.run(5, 0, 3, "ISO-1");
  db.prepare("insert into PressureIsolationValve values (5)").run();
  db.prepare("insert into PressureIsolationValve_HmiDataSetGeometry_Data values (5, 2, ?)").run(point(657150, 2748000));
  const xy = new Map(nodes.map(([id, , , x, y]) => [id, [x, y] as [number, number]]));
  const pipes: [number, string, number, number, number, string, number, number][] = [
    // id, label, from, to, inside diameter mm, material, deleted, element type
    [21, "P-1", 1, 2, 130.8, "HDPE", 0, 3], // Ø160 SDR11
    [22, "P-2", 2, 3, 515.6, "HDPE", 0, 3], // Ø630 SDR11
    [23, "P-3", 3, 4, 130.8, "HDPE", 0, 3], // switched off in the active scenario
    [24, "P-OLD", 1, 3, 130.8, "HDPE", 1, 3], // deleted
    [25, "Pipe Prototype - 1", 1, 2, 130.8, "HDPE", 0, 9], // a template, not a pipe
    [26, "P-DI", 3, 4, 700, "Ductile Iron", 0, 3],
  ];
  for (const [id, label, a, b, d, mat, del, type] of pipes) {
    el.run(id, del, type, label);
    db.prepare("insert into IdahoPipe values (?)").run(id);
    db.prepare("insert into BaseLink_HmiDataSetGeometry_Data values (?, 2, ?)").run(id, line([xy.get(a)!, xy.get(b)!]));
    db.prepare("insert into BaseLink_HMIDataSetTopology_Data values (?, 3, ?, ?)").run(id, a, b);
    db.prepare("insert into BaseLink_HMIActiveTopology_Data values (?, 4, 1)").run(id);
    db.prepare("insert into IdahoPipe_Physical_Data values (?, 6, ?, ?)").run(id, mat, ft(d / 1000));
  }
  db.prepare("insert into BaseLink_HMIActiveTopology_Data values (23, 7496, 0)").run();
  db.close();
}
