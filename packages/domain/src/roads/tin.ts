/**
 * A designer's TIN surface as LandXML, when Civil 3D's own export (a dialog) cannot run headless.
 * Two sources seen on Namar (11 Nov 2026):
 * - a DXF written by EXPORTTOAUTOCAD from the surface model: the TIN comes out as 3DFACEs when the
 *   surface style shows triangles (scripts/dwg-to-dxf.cjs);
 * - Civil 3D's IFC export of the surface: a thin solid (IFCPOLYLOOP faces). Its up-facing faces are
 *   the surface; the down-facing ones are a copy 1 mm lower and the vertical ones its edge walls. Some
 *   IFCs also carry overlapping extra up faces (Namar Site Grading: 62 707 m2), so check
 *   `planOverlapM2` before trusting one.
 */
export type Tri = [[number, number, number], [number, number, number], [number, number, number]];

const num = (s: string | undefined) => Number(s);

/**
 * 3DFACEs of a DXF's ENTITIES section (a quad with a 4th corner off the 3rd gives two triangles).
 * When ENTITIES holds none, the faces of the blocks inserted there, placed by each INSERT (position,
 * scale, rotation about Z): the 60 % Namar surface models (ROD-MOD-90000-001..003, Nov 2026) come out
 * of EXPORTTOAUTOCAD with the TIN inside an "AecObjExplode_<drawing>_Vport_<n>" block.
 */
export function readDxfFaces(text: string): Tri[] {
  const L = text.split(/\r?\n/);
  const top: Tri[] = [];
  const blocks = new Map<string, { base: [number, number, number]; tris: Tri[] }>();
  const inserts: { name: string; at: [number, number, number]; scale: [number, number, number]; rot: number }[] = [];
  let sec = "";
  let block: { base: [number, number, number]; tris: Tri[] } | undefined;
  const group = (i: number) => {
    const p: Record<string, string> = {};
    for (let j = i + 2; j + 1 < L.length; j += 2) {
      const cc = L[j]!.trim();
      if (cc === "0") break;
      if (!(cc in p)) p[cc] = L[j + 1]!.trim();
    }
    return p;
  };
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = L[i]!.trim(), v = L[i + 1]!.trim();
    if (c === "2" && L[i - 1]?.trim() === "SECTION") sec = v;
    if (c !== "0" || (sec !== "ENTITIES" && sec !== "BLOCKS")) continue;
    if (sec === "BLOCKS" && v === "BLOCK") {
      const p = group(i);
      block = { base: [num(p["10"] ?? "0"), num(p["20"] ?? "0"), num(p["30"] ?? "0")], tris: [] };
      blocks.set(p["2"] ?? "", block);
      continue;
    }
    if (sec === "BLOCKS" && v === "ENDBLK") {
      block = undefined;
      continue;
    }
    if (sec === "ENTITIES" && v === "INSERT") {
      const p = group(i);
      inserts.push({
        name: p["2"] ?? "",
        at: [num(p["10"] ?? "0"), num(p["20"] ?? "0"), num(p["30"] ?? "0")],
        scale: [num(p["41"] ?? "1"), num(p["42"] ?? "1"), num(p["43"] ?? "1")],
        rot: (num(p["50"] ?? "0") * Math.PI) / 180,
      });
      continue;
    }
    if (v !== "3DFACE") continue;
    const into = sec === "ENTITIES" ? top : block?.tris;
    if (!into) continue;
    const p = group(i);
    const v4 = [0, 1, 2, 3].map((k) => [num(p[`1${k}`]), num(p[`2${k}`]), num(p[`3${k}`])] as [number, number, number]);
    into.push([v4[0]!, v4[1]!, v4[2]!]);
    if (!v4[3]!.every((x, k) => Math.abs(x - v4[2]![k]!) < 1e-9)) into.push([v4[0]!, v4[2]!, v4[3]!]);
  }
  let tris = top;
  if (!tris.length) {
    tris = [];
    for (const ins of inserts) {
      const b = blocks.get(ins.name);
      if (!b?.tris.length) continue;
      const cos = Math.cos(ins.rot), sin = Math.sin(ins.rot);
      const place = (q: [number, number, number]): [number, number, number] => {
        const x = (q[0] - b.base[0]) * ins.scale[0], y = (q[1] - b.base[1]) * ins.scale[1];
        return [ins.at[0] + x * cos - y * sin, ins.at[1] + x * sin + y * cos, ins.at[2] + (q[2] - b.base[2]) * ins.scale[2]];
      };
      for (const t of b.tris) tris.push([place(t[0]), place(t[1]), place(t[2])]);
    }
  }
  return tris.filter((t) => t.every((q) => q.every(Number.isFinite)));
}

/** IFCPOLYLOOP faces of an IFC (STEP) file, fanned into triangles. */
export function readIfcFaces(text: string): Tri[] {
  const pts = new Map<string, [number, number, number]>(), loops: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    let m = line.match(/^#(\d+)\s*=\s*IFCCARTESIANPOINT\(\(([^)]*)\)\)/);
    if (m) {
      const c = m[2]!.split(",").map(Number);
      pts.set(m[1]!, [c[0]!, c[1]!, c[2] ?? 0]);
      continue;
    }
    m = line.match(/^#\d+\s*=\s*IFCPOLYLOOP\(\(([^)]*)\)\)/);
    if (m) loops.push(m[1]!.split(",").map((s) => s.trim().replace(/^#/, "")));
  }
  const tris: Tri[] = [];
  for (const l of loops)
    for (let k = 1; k + 1 < l.length; k++) {
      const a = pts.get(l[0]!), b = pts.get(l[k]!), c = pts.get(l[k + 1]!);
      if (a && b && c) tris.push([a, b, c]);
    }
  return tris;
}

const key = (p: readonly number[]) => p.map((x) => x.toFixed(3)).join(",");

/** Unique triangles (to 1 mm) split by facing: up (normal z > 0.05), down, vertical. */
export function splitByFacing(tris: Tri[]): { up: Tri[]; down: Tri[]; vertical: Tri[] } {
  const seen = new Set<string>(), g = { up: [] as Tri[], down: [] as Tri[], vertical: [] as Tri[] };
  for (const t of tris) {
    const k = t.map(key).sort().join(";");
    if (seen.has(k)) continue;
    seen.add(k);
    const [a, b, c] = t;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nz = ux * vy - uy * vx, len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz) || 1;
    (nz / len > 0.05 ? g.up : nz / len < -0.05 ? g.down : g.vertical).push(t);
  }
  return g;
}

/** Plan area covered by two or more faces, sampled on a grid (0.5 m by default). */
export function planOverlapM2(tris: Tri[], cell = 0.5): number {
  const cover = new Map<number, number>();
  for (const [a, b, c] of tris) {
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) continue;
    const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / cell), x1 = Math.ceil(Math.max(a[0], b[0], c[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1], c[1]) / cell), y1 = Math.ceil(Math.max(a[1], b[1], c[1]) / cell);
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const px = (i + 0.5) * cell, py = (j + 0.5) * cell;
        const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
        const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
        // half-open test, so a cell centre on a shared edge counts once
        if (l1 > 0 && l2 > 0 && l1 + l2 < 1) cover.set(i * 1e7 + j, (cover.get(i * 1e7 + j) ?? 0) + 1);
      }
  }
  let many = 0;
  for (const n of cover.values()) if (n > 1) many++;
  return many * cell * cell;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * A LandXML 1.2 TIN (points "northing easting elevation", faces by point id), as Civil 3D writes it
 * and loadLandXmlSurface reads it. Points shared to 1 mm; faces that collapse below that are dropped.
 */
export function toLandXml(tris: Tri[], o: { surface: string; source: string; epsg?: number; csName?: string; date?: Date }): { xml: string; points: number; faces: number } {
  const ids = new Map<string, number>(), P: number[][] = [];
  const F = tris
    .map((t) => t.map((p) => {
      const k = key(p);
      if (!ids.has(k)) { ids.set(k, ids.size + 1); P.push(p); }
      return ids.get(k)!;
    }))
    .filter(([i, j, k]) => i !== j && j !== k && i !== k);
  const d = (o.date ?? new Date()).toISOString();
  const cs = o.csName ?? "UTM84-38N";
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${d.slice(0, 10)}" time="${d.slice(11, 19)}">`,
    '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>',
    `<CoordinateSystem desc="${esc(cs)}" epsgCode="${o.epsg ?? 32638}" horizontalCoordinateSystemName="${esc(cs)}"/>`,
    `<Application name="InfraWorks-Modeling surface-to-landxml" desc="${esc(o.source)}"/>`,
    `<Surfaces><Surface name="${esc(o.surface)}"><Definition surfType="TIN">`,
    "<Pnts>",
    ...P.map((p, i) => `<P id="${i + 1}">${p[1]!.toFixed(4)} ${p[0]!.toFixed(4)} ${p[2]!.toFixed(4)}</P>`),
    "</Pnts><Faces>",
    ...F.map((f) => `<F>${f.join(" ")}</F>`),
    "</Faces></Definition></Surface></Surfaces></LandXML>",
    "",
  ].join("\n");
  return { xml, points: P.length, faces: F.length };
}
