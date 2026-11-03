// Classify each Parsons road by its right-of-way width (RD_ROW) and carriageway edges (-RD_Edges),
// measured perpendicular to the centreline at several stations.
// Usage: node rowclass.cjs <layout.json (profblk output of the road layout block)> <aq_road_alignments.json> <out.json>
const fs = require("fs");
const [layoutPath, alignPath, outPath] = process.argv.slice(2);
const ents = JSON.parse(fs.readFileSync(layoutPath, "utf8"));
const segsOf = (layer) => ents.filter((e) => e.layer === layer && e.x.length > 1).flatMap((e) => e.x.slice(1).map((x, i) => [e.x[i], e.y[i], x, e.y[i + 1]]));
const ROW = segsOf("RD_ROW"), EDGE = segsOf("-RD_Edges");
// Parsons typical sections (ROD-DWG-30000-001): ROW width -> type
const TYPES = [[15, "A1"], [18, "A2"], [20, "A3"], [25, "B1"], [30, "C1"], [36, "C2"]];
const roads = JSON.parse(fs.readFileSync(alignPath, "utf8"));
// point and direction at station s on chained segments (straights + bulge arcs)
function at(segs, s) {
  for (const g of segs) {
    const c = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    let len = c, th = 0, r = 0;
    if (g.bulge) { th = 4 * Math.atan(g.bulge); r = c / (2 * Math.sin(Math.abs(th) / 2)); len = r * Math.abs(th); }
    if (s <= len + 1e-9) {
      const t = s / len;
      if (!g.bulge) return { p: [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t], u: [(g.b[0] - g.a[0]) / c, (g.b[1] - g.a[1]) / c] };
      const ux = (g.b[0] - g.a[0]) / c, uy = (g.b[1] - g.a[1]) / c, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(g.bulge);
      const cx = (g.a[0] + g.b[0]) / 2 - uy * h, cy = (g.a[1] + g.b[1]) / 2 + ux * h, a = Math.atan2(g.a[1] - cy, g.a[0] - cx) + th * t;
      const p = [cx + r * Math.cos(a), cy + r * Math.sin(a)], sg = Math.sign(th);
      return { p, u: [-Math.sin(a) * sg, Math.cos(a) * sg] };
    }
    s -= len;
  }
  return null;
}
// nearest crossing of the normal line with a segment set, on each side (within 30 m)
function cross(segs, p, u) {
  const n = [-u[1], u[0]]; let L = null, R = null;
  for (const [x1, y1, x2, y2] of segs) {
    const dx = x2 - x1, dy = y2 - y1, den = n[0] * dy - n[1] * dx; if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - p[0]) * dy - (y1 - p[1]) * dx) / den, v = ((x1 - p[0]) * n[1] - (y1 - p[1]) * n[0]) / den;
    if (v < -1e-9 || v > 1 + 1e-9 || Math.abs(t) > 30) continue;
    if (t > 0.5 && (L == null || t < L)) L = t; if (t < -0.5 && (R == null || -t < R)) R = -t;
  }
  return L != null && R != null ? { L, R, w: L + R } : null;
}
const out = {}, hist = {};
for (const r of roads) {
  const ws = [], es = [];
  // sample every 2 m away from the ends (junction mouths give stray widths), majority vote of exact type widths
  for (let s = Math.min(12, r.length / 4); s <= r.length - Math.min(12, r.length / 4); s += 2) { const q = at(r.segs, s); if (!q) continue; const a = cross(ROW, q.p, q.u); if (a) ws.push(a.w); const e = cross(EDGE, q.p, q.u); if (e) es.push(e.w); }
  const votes = {}; for (const x of ws) { const t = TYPES.find((t) => Math.abs(t[0] - x) < 0.05); if (t) votes[t[1]] = (votes[t[1]] || 0) + 1; }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const ok = ranked.length && ranked[0][1] >= 5 && (!ranked[1] || ranked[1][1] < 0.25 * ranked[0][1]);
  const ev = {}; for (const x of es) { const k = x.toFixed(1); ev[k] = (ev[k] || 0) + 1; }
  out[r.name] = { type: ok ? ranked[0][0] : null, votes, samples: ws.length, edge: Object.entries(ev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
  const k = `${ok ? ranked[0][0] : "unclassified"} (edges ${out[r.name].edge})`; hist[k] = (hist[k] || 0) + 1;
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(hist, null, 1));
for (const [n, v] of Object.entries(out).filter(([, v]) => !v.type).slice(0, 12)) console.log("  ", n, JSON.stringify(v));
