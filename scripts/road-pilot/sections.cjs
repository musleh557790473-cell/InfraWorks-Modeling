// Parsons typical sections (LDIP-RCRC-SAP-01-AQ-ROD-DWG-30000-001) as InfraWorks component styles,
// plus the cross-section polygons InfraWorks caches in PRIMITIVES (computed from the component
// definitions in ProgramData\Autodesk\InfraWorks\Resources\LocalLibrary\Styles\ComponentDefinition).
// Sources: lane 3.30, kerb 0.30 (ROD-30000-001); kerb upstand 150 mm, carriageway crossfall 2.0 %,
// sidewalk 2.0 % (design report LDIP-RCRC-SAP-01-AQ-DES-RPT-00001, criteria table); design speed
// 20 km/h local, 40 km/h collector (same table).
// Not modelled yet: the raised median (drawn flat, at the profile level) and which side a local
// road's one-way crossfall falls to (taken as the right of the chainage direction, as the typical
// section is drawn).

const TYPES = {
  A1: { kind: "local", sidewalk: 3.9 }, A2: { kind: "local", sidewalk: 5.4 }, A3: { kind: "local", sidewalk: 6.4 },
  B1: { kind: "collector", median: 1.2, sidewalk: 4.6 }, C1: { kind: "collector", median: 4.0, sidewalk: 5.7 }, C2: { kind: "collector", median: 4.0, sidewalk: 8.7 },
};
const LANE = 3.3, SHY = 0.4, KERB_W = 0.3, XFALL = 0.02, SW_FALL = 0.02;
const MAT = { lane: "x7F7F7FFF", shy: "x7F7F7FFF", kerb: "xB0B0B0FF", sidewalk: "x909090FF", median: "xA0A0A0FF" };

// Component definitions (InfraWorks defaults unless overridden): local coordinates, attachment = coordinate index.
const DEF = {
  Lane: (p) => { const s = p.LeftSideFactor ?? 1, W = p.Width, Y = p.Slope * W, D = p.Depth ?? 0.2; return [[0, 0], [s * W, Y], [s * W, Y - D], [0, -D]]; },
  Sidewalk: (p) => { const s = p.LeftSideFactor ?? 1, W = p.Width, Y = p.Slope * W, D = p.Depth ?? 0.1; return [[0, 0], [s * W, Y], [s * W, Y - D], [0, -D]]; },
  Curb: (p) => { const s = p.LeftSideFactor ?? 1, W = p.Width ?? 0.225, Dp = p.Depth ?? 0.45, Db = p.DepthBelow ?? 0.3, H = Dp - Db;
    return [[0, -Db], [0, 0], [0, H], [s * W, H], [s * W, H - (p.BackHeight ?? 0)], [s * W, -Db]]; },
  "Sloped Median": (p) => { const h = p.Width / 2, G = (p.Slope ?? -0.03) * h, D = p.Depth ?? 0.2; return [[-h, 0], [0, G], [h, 0], [h, -D], [0, G - D], [-h, -D]]; },
};
const TOP = { Lane: [0, 1], Sidewalk: [0, 1], Curb: [2, 3], "Sloped Median": [0, 1, 2] }; // top surface points (for edges / transitions)

let nextId = 300000000 + Math.floor(Math.random() * 100000000);
function build(type) {
  const T = TYPES[type]; if (!T) throw new Error(`unknown section ${type}`);
  const comps = []; // {def, params, attach: {point, ex_comp, ex_point} | null, role}
  const add = (def, params, attach, role) => { comps.push({ def, params: { ...params, COMPONENT_ID: nextId++ }, attach, role }); return comps.length - 1; };
  const ORIGIN = 4294967295;
  for (const side of [-1, 1]) {
    const L = side < 0 ? { LeftSideFactor: -1 } : {};
    let last;
    if (T.kind === "local") {
      // one-way crossfall: rises to the left, falls to the right of the chainage direction
      last = add("Lane", { ...L, Width: LANE, Slope: side < 0 ? XFALL : -XFALL, Depth: 0.2 }, { point: 0, ex_comp: ORIGIN, ex_point: ORIGIN }, "lane");
    } else {
      if (side < 0) add("Sloped Median", { Width: T.median, Slope: 0, Depth: 0.2 }, null, "median");
      last = add("Lane", { ...L, Width: SHY, Slope: -XFALL, Depth: 0.2 }, { point: 0, ex_comp: 0, ex_point: side < 0 ? 0 : 2 }, "shy");
      last = add("Lane", { ...L, Width: LANE, Slope: -XFALL, Depth: 0.2 }, { point: 0, ex_comp: last, ex_point: 1 }, "lane");
      last = add("Lane", { ...L, Width: LANE, Slope: -XFALL, Depth: 0.2 }, { point: 0, ex_comp: last, ex_point: 1 }, "lane");
    }
    const kerb = add("Curb", { ...L, Width: KERB_W }, { point: 1, ex_comp: last, ex_point: 1 }, "kerb");
    add("Sidewalk", { ...L, Width: T.sidewalk, Slope: SW_FALL, Depth: 0.1 }, { point: 0, ex_comp: kerb, ex_point: 4 }, "sidewalk");
  }
  // place every component (attachments always point to earlier components)
  const placed = [];
  comps.forEach((c, i) => {
    const local = DEF[c.def](c.params);
    let dx = 0, dy = 0;
    if (c.attach && c.attach.ex_comp !== ORIGIN) { const host = placed[c.attach.ex_comp].pts[c.attach.ex_point], me = local[c.attach.point]; dx = host[0] - me[0]; dy = host[1] - me[1]; }
    placed[i] = { ...c, pts: local.map(([x, y]) => [x + dx, y + dy]) };
  });
  // InfraWorks' cached cross-section rings: ascending x, codes 202 (first), 2 ... 3 (top), 201, closing point
  const ring = (pts) => {
    pts = pts.filter((p, k) => pts.findIndex((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) === k);
    const xs = pts.map((p) => p[0]), lo = Math.min(...xs), hi = Math.max(...xs);
    const upper = pts.filter((p) => p[1] >= Math.min(...pts.filter((q) => Math.abs(q[0] - p[0]) < 1e-9).map((q) => q[1])) && pts.filter((q) => Math.abs(q[0] - p[0]) < 1e-9).length === 1 || p[1] === Math.max(...pts.filter((q) => Math.abs(q[0] - p[0]) < 1e-9).map((q) => q[1])));
    const ups = upper.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const bl = [lo, Math.min(...pts.filter((p) => Math.abs(p[0] - lo) < 1e-9).map((p) => p[1]))];
    const br = [hi, Math.min(...pts.filter((p) => Math.abs(p[0] - hi) < 1e-9).map((p) => p[1]))];
    return [[...bl, 202], ...ups.map((p, k) => [...p, k === ups.length - 1 ? 3 : 2]), [...br, 201], bl];
  };
  const parts = placed.map((c) => ({ role: c.role, id: c.params.COMPONENT_ID, material: MAT[c.role], crossSection: ring(c.pts) }));
  // top boundary points across the section, for the edges and the end transitions
  const tops = []; placed.forEach((c) => TOP[c.def].forEach((k) => tops.push(c.pts[k])));
  const bound = [...new Map(tops.sort((a, b) => a[0] - b[0]).map((p) => [p[0].toFixed(4), p])).values()];
  // component style JSON, as InfraWorks writes it
  const references = placed.map((c) => ({
    def: `ComponentDefinition/${c.def}`, material: MAT[c.role], description: c.role, classification: c.role === "sidewalk" ? "Sidewalk" : c.role === "kerb" ? "Curb" : c.role === "median" ? "Greenspace" : "Roadway",
    ...(c.attach ? { attachment: c.attach } : {}),
    paramOverrides: Object.entries(c.params).map(([name, value]) => ({ name, value })),
  }));
  const lanes = T.kind === "local" ? 1 : 2;
  const componentStyle = { styleType: "Component", showMarking: true, revision: 1, references, migrationInfo: { MANUAL_STYLE: "", LANES_FORWARD: lanes, LANES_BACKWARD: lanes } };
  const marking = T.kind === "local" ? [0] : []; // centre line on two-lane local roads
  return { type, kind: T.kind, speed: T.kind === "local" ? 20 : 40, lanes, parts, bound, componentStyle, marking, width: bound.at(-1)[0] - bound[0][0] };
}
module.exports = { build, TYPES };

if (require.main === module) {
  for (const t of Object.keys(TYPES)) { const b = build(t); console.log(t, "width", b.width.toFixed(2), "parts", b.parts.length, "edges", b.bound[0].map((v) => v.toFixed(3)).join(","), b.bound.at(-1).map((v) => v.toFixed(3)).join(",")); }
  const a = build("A1"); console.log(JSON.stringify(a.parts.map((p) => [p.role, p.crossSection.map((q) => q.map((v) => +(+v).toFixed(3)))])));
}
