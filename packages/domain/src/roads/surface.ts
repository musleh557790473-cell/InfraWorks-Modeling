/**
 * A LandXML TIN surface (Civil 3D export: <P id>northing easting z</P>, <F>a b c</F>) as a level
 * lookup on a 20 m grid. Parsons' "Al_Qairawan_Mass Grading" carries the road crossfall (2 %) and
 * sits ~0.5-0.8 m under the finished road levels.
 */
export type SurfaceZ = (x: number, y: number) => number | null;

export function loadLandXmlSurface(xml: string, surfaceName: string): SurfaceZ {
  const start = xml.indexOf(`<Surface name="${surfaceName}"`);
  if (start < 0) throw new Error(`surface "${surfaceName}" not in the LandXML`);
  const end = xml.indexOf("</Surface>", start);
  const b = xml.slice(start, end < 0 ? undefined : end);
  const P = new Map<string, [number, number, number]>();
  for (const m of b.matchAll(/<P id="(\d+)">([^<]+)<\/P>/g)) {
    const [n, e, z] = m[2]!.trim().split(/\s+/).map(Number);
    P.set(m[1]!, [e!, n!, z!]);
  }
  const CELL = 20, grid = new Map<string, [number, number, number][][]>(), key = (i: number, j: number) => `${i},${j}`;
  for (const m of b.matchAll(/<F(?: [^>]*)?>([^<]+)<\/F>/g)) {
    const t = m[1]!.trim().split(/\s+/).map((i) => P.get(i));
    if (t.some((v) => !v)) continue;
    const tri = t as [number, number, number][];
    const xs = tri.map((v) => v[0]), ys = tri.map((v) => v[1]);
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
      for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(tri);
      }
  }
  return (x, y) => {
    for (const [a, b2, c] of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const d = (b2![1] - c![1]) * (a![0] - c![0]) + (c![0] - b2![0]) * (a![1] - c![1]);
      const l1 = ((b2![1] - c![1]) * (x - c![0]) + (c![0] - b2![0]) * (y - c![1])) / d;
      const l2 = ((c![1] - a![1]) * (x - c![0]) + (a![0] - c![0]) * (y - c![1])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a![2] + l2 * b2![2] + l3 * c![2];
    }
    return null;
  };
}
