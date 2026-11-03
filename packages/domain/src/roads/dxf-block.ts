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
}

export function readDxfBlock(text: string, block: string): DxfEnt[] {
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
      j += 2;
    }
    out.push(o);
  }
  return out;
}

/** MTEXT without formatting codes ("\\P" paragraph breaks become `para`). */
export const cleanText = (t: string, para = " "): string =>
  t.replace(/\\[A-Za-z][^;\\{}]*;/g, "").replace(/\\L/g, "").replace(/[{}"]/g, "").replace(/\\P/g, para).trim();
