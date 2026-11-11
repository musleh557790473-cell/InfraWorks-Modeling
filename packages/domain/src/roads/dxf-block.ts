/**
 * Entities of one block of a DXF (Parsons binds the design into sheets as xrefs: the road layout and
 * the profiles are blocks such as "Xref Road Layout Al Qairawan"). Layers lose the xref prefix
 * (`<xref>$0$<layer>`). Coordinates are block coordinates, which for these xrefs are UTM metres.
 */
export interface DxfEnt {
  type: string;
  layer: string;
  x: number[];
  y: number[];
  /** bulge per vertex (LWPOLYLINE), 0 for straights */
  bulge: number[];
  txt: string;
  /** block name of an INSERT */
  name?: string;
  /** radius of a CIRCLE or ARC (group 40); x/y hold its centre */
  r?: number;
  /** end point of a LINE (groups 11/21); x/y hold its start */
  end?: [number, number];
}

/**
 * `block` may also name several blocks, "A|B" (Al Narjis binds the road layout and the road names as
 * two xrefs, "Xref Road Layout Al Narjis" and "Xref Dim_Names Al Narjis_1"), or be "*Model_Space": the
 * model space with every INSERT opened in place (Al Narjis' profile sheets explode each Civil 3D profile
 * view into an anonymous block *U<n> inserted at the view's position).
 */
export function readDxfBlock(text: string, block: string): DxfEnt[] {
  if (block === MODEL_SPACE) return readModelSpace(text);
  const names = block.split("|").map((s) => s.trim()).filter(Boolean);
  if (names.length > 1) return names.flatMap((n) => readOneBlock(text, n));
  return readOneBlock(text, block);
}

export const MODEL_SPACE = "*Model_Space";

/** Group codes of each entity from `from` to the next "0" code, until a code 0 with value `stop`. */
function entitiesIn(L: string[], from: number, stop: (t: string) => boolean): { t: string; at: number }[] {
  const out: { t: string; at: number }[] = [];
  for (let i = from; i + 1 < L.length; i += 2) {
    if (L[i] !== "0") continue;
    if (stop(L[i + 1]!)) break;
    out.push({ t: L[i + 1]!, at: i });
  }
  return out;
}

function readEnt(L: string[], i: number, t: string): DxfEnt & { sx: number; sy: number; rot: number } {
  const o: DxfEnt & { sx: number; sy: number; rot: number } = { type: t, layer: "", x: [], y: [], bulge: [], txt: "", sx: 1, sy: 1, rot: 0 };
  let j = i + 2;
  while (j + 1 < L.length && L[j] !== "0") {
    const c = L[j], v = L[j + 1]!;
    if (c === "8") o.layer = v.split("$0$").pop()!;
    else if (c === "10") { o.x.push(+v); o.bulge.push(0); }
    else if (c === "20") o.y.push(+v);
    else if (c === "42" && o.bulge.length) o.bulge[o.bulge.length - 1] = +v;
    else if (c === "1" || c === "3") o.txt += v;
    else if (c === "2" && t === "INSERT") o.name = v;
    else if (c === "40" && (t === "CIRCLE" || t === "ARC")) o.r = +v;
    else if (t === "LINE" && c === "11") o.end = [+v, o.end?.[1] ?? 0];
    else if (t === "LINE" && c === "21") o.end = [o.end?.[0] ?? 0, +v];
    else if (t === "INSERT" && c === "41") o.sx = +v;
    else if (t === "INSERT" && c === "42") o.sy = +v;
    else if (t === "INSERT" && c === "50") o.rot = +v;
    j += 2;
  }
  return o;
}

const plain = ({ sx: _sx, sy: _sy, rot: _rot, ...e }: DxfEnt & { sx: number; sy: number; rot: number }): DxfEnt => e;

/** Model space, each INSERT replaced by its block's entities placed by the insert (to 6 levels). */
function readModelSpace(text: string): DxfEnt[] {
  const L = text.split(/\r?\n/).map((x) => x.trim());
  const sec = (name: string) => { for (let i = 0; i + 3 < L.length; i += 2) if (L[i] === "0" && L[i + 1] === "SECTION" && L[i + 3] === name) return i + 4; return -1; };
  const b0 = sec("BLOCKS"), e0 = sec("ENTITIES");
  if (e0 < 0) throw new Error("not a DXF with an ENTITIES section");
  const blocks = new Map<string, { base: [number, number]; ents: { t: string; at: number }[] }>();
  if (b0 >= 0) {
    for (let i = b0; i + 1 < L.length; i += 2) {
      if (L[i] !== "0") continue;
      if (L[i + 1] === "ENDSEC") break;
      if (L[i + 1] !== "BLOCK") continue;
      let name = "", bx = 0, by = 0, j = i + 2;
      while (j + 1 < L.length && L[j] !== "0") { if (L[j] === "2") name = L[j + 1]!; else if (L[j] === "10") bx = +L[j + 1]!; else if (L[j] === "20") by = +L[j + 1]!; j += 2; }
      const ents = entitiesIn(L, j, (t) => t === "ENDBLK");
      blocks.set(name, { base: [bx, by], ents });
    }
  }
  const out: DxfEnt[] = [];
  type Xf = (x: number, y: number) => [number, number];
  const walk = (ents: { t: string; at: number }[], xf: Xf, mirror: boolean, scale: number, depth: number) => {
    for (const { t, at } of ents) {
      if (t === "ATTRIB" || t === "SEQEND" || t === "ATTDEF") continue;
      const e = readEnt(L, at, t);
      if (t === "INSERT") {
        const b = e.name ? blocks.get(e.name) : undefined;
        if (b && depth < 6) {
          const [ix, iy] = [e.x[0] ?? 0, e.y[0] ?? 0], a = (e.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
          const inner: Xf = (x, y) => { const u = (x - b.base[0]) * e.sx, v = (y - b.base[1]) * e.sy; return xf(ix + u * c - v * s, iy + u * s + v * c); };
          walk(b.ents, inner, mirror !== (e.sx * e.sy < 0), scale * Math.abs(e.sx), depth + 1);
          continue;
        }
      }
      for (let k = 0; k < e.x.length; k++) { const [x, y] = xf(e.x[k]!, e.y[k] ?? 0); e.x[k] = x; e.y[k] = y; }
      if (e.end) e.end = xf(e.end[0], e.end[1]);
      if (mirror) e.bulge = e.bulge.map((g) => -g);
      if (e.r !== undefined) e.r *= scale;
      out.push(plain(e));
    }
  };
  walk(entitiesIn(L, e0, (t) => t === "ENDSEC"), (x, y) => [x, y], false, 1, 0);
  return out;
}

function readOneBlock(text: string, block: string): DxfEnt[] {
  const L = text.split(/\r?\n/).map((x) => x.trim());
  const s0 = L.indexOf("BLOCKS"), e0 = L.indexOf("ENTITIES");
  if (s0 < 0 || e0 < 0) throw new Error("not a DXF with BLOCKS and ENTITIES sections");
  const out: DxfEnt[] = [];
  let blk: string | null = null;
  for (let i = s0 + 1; i < e0; i += 2) {
    if (L[i] !== "0") continue;
    const t = L[i + 1]!;
    if (t === "BLOCK") {
      let j = i + 2;
      while (j < e0 && L[j] !== "0") { if (L[j] === "2") { blk = L[j + 1]!; break; } j += 2; }
      continue;
    }
    if (t === "ENDBLK") { blk = null; continue; }
    if (blk !== block) continue;
    const o: DxfEnt = { type: t, layer: "", x: [], y: [], bulge: [], txt: "" };
    let j = i + 2;
    while (j < e0 && L[j] !== "0") {
      const c = L[j], v = L[j + 1]!;
      if (c === "8") o.layer = v.split("$0$").pop()!;
      else if (c === "10") { o.x.push(+v); o.bulge.push(0); }
      else if (c === "20") o.y.push(+v);
      else if (c === "42" && o.bulge.length) o.bulge[o.bulge.length - 1] = +v;
      else if (c === "1" || c === "3") o.txt += v;
      else if (c === "2" && t === "INSERT") o.name = v;
      else if (c === "40" && (t === "CIRCLE" || t === "ARC")) o.r = +v;
      else if (t === "LINE" && c === "11") o.end = [+v, o.end?.[1] ?? 0];
      else if (t === "LINE" && c === "21") o.end = [o.end?.[0] ?? 0, +v];
      j += 2;
    }
    out.push(o);
  }
  return out;
}

/** MTEXT without formatting codes ("\\P" paragraph breaks become `para`). */
export const cleanText = (t: string, para = " "): string =>
  t.replace(/\\[A-Za-z][^;\\{}]*;/g, "").replace(/\\L/g, "").replace(/[{}"]/g, "").replace(/\\P/g, para).trim();
