/**
 * Pull the text out of a PDF (design reports, CRS sheets) without any PDF tool installed:
 *
 *   node scripts/pdf-text.cjs <file.pdf> [out.txt] [--pages 10-40]
 *
 * Reads every page's content streams (Flate), decodes strings through each font's ToUnicode map
 * (object streams included). Strings in a font without one fall back to the glyph id + 29 = ASCII
 * rule seen in Parsons' subset TrueType fonts (Namar report, Nov 2026). One output line per text
 * line, "=== page N" between pages. Good enough to find sections and values; check tables by eye.
 */
const fs = require("node:fs");
const zlib = require("node:zlib");

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const [file, outFile] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/pdf-text.cjs <file.pdf> [out.txt] [--pages 10-40]");
  process.exit(2);
}
const range = flag("--pages")?.split("-").map(Number);
const buf = fs.readFileSync(file);
const src = buf.toString("latin1");

/* ---------- objects (plain and inside object streams) */
const objs = new Map(); // num -> { dict, stream? (Buffer, raw) }
const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
let m;
while ((m = objRe.exec(src))) {
  const start = m.index + m[0].length;
  const end = src.indexOf("endobj", start);
  if (end < 0) break;
  const body = src.slice(start, end);
  const s = body.indexOf("stream");
  let dict = body;
  let stream;
  if (s >= 0 && /^\s*<</.test(body)) {
    dict = body.slice(0, s);
    let p = start + s + 6;
    if (src[p] === "\r") p++;
    if (src[p] === "\n") p++;
    const lenM = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
    let e = src.indexOf("endstream", p);
    if (lenM && !lenM[2]) e = Math.min(e, p + Number(lenM[1]));
    stream = buf.subarray(p, e);
  }
  objs.set(Number(m[1]), { dict, stream });
  objRe.lastIndex = end;
}
const decode = (o) => {
  if (!o?.stream) return null;
  if (/\/FlateDecode/.test(o.dict)) {
    try {
      return zlib.inflateSync(o.stream);
    } catch {
      try {
        return zlib.inflateSync(o.stream, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      } catch {
        return null;
      }
    }
  }
  return /\/Filter/.test(o.dict) ? null : o.stream;
};
for (const [, o] of [...objs]) {
  if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
  const data = decode(o);
  if (!data) continue;
  const n = Number(/\/N\s+(\d+)/.exec(o.dict)[1]);
  const first = Number(/\/First\s+(\d+)/.exec(o.dict)[1]);
  const t = data.toString("latin1");
  const head = t.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i < n; i++) {
    const num = head[2 * i];
    const off = first + head[2 * i + 1];
    const next = i + 1 < n ? first + head[2 * i + 3] : t.length;
    if (!objs.has(num)) objs.set(num, { dict: t.slice(off, next) });
  }
}
const ref = (s) => {
  const r = /^\s*(\d+)\s+\d+\s+R/.exec(s ?? "");
  return r ? objs.get(Number(r[1])) : undefined;
};
/** The value of /Key in a dict: a reference, a nested <<dict>>, an [array] or a token. */
const val = (dict, key) => {
  const i = dict.search(new RegExp(`/${key}(?![A-Za-z])`));
  if (i < 0) return undefined;
  let p = i + key.length + 1;
  while (/\s/.test(dict[p])) p++;
  if (dict.startsWith("<<", p)) {
    let depth = 0;
    for (let q = p; q < dict.length; q++) {
      if (dict.startsWith("<<", q)) (depth++, q++);
      else if (dict.startsWith(">>", q)) {
        depth--;
        q++;
        if (!depth) return dict.slice(p, q + 1);
      }
    }
  }
  if (dict[p] === "[") return dict.slice(p, dict.indexOf("]", p) + 1);
  const r = /^(\d+\s+\d+\s+R|\/?[^\s/<>\[\]]+)/.exec(dict.slice(p));
  return r?.[1];
};
const deref = (v) => (v && /^\d+\s+\d+\s+R$/.test(v.trim()) ? ref(v)?.dict : v);

/* ---------- fonts: ToUnicode maps */
const cmapCache = new Map();
function toUnicode(fontDict) {
  const tu = val(fontDict, "ToUnicode");
  if (!tu) return null;
  if (cmapCache.has(tu)) return cmapCache.get(tu);
  const data = decode(ref(tu));
  const map = { width: 1, chars: new Map() };
  if (data) {
    const t = data.toString("latin1");
    const cs = /<([0-9A-Fa-f]+)>\s*<[0-9A-Fa-f]+>/.exec(/begincodespacerange([\s\S]*?)endcodespacerange/.exec(t)?.[1] ?? "");
    if (cs) map.width = cs[1].length / 2;
    const u16 = new TextDecoder("utf-16be");
    const hexStr = (h) => (h.length % 4 ? String.fromCharCode(parseInt(h, 16)) : u16.decode(Buffer.from(h, "hex")));
    for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const e of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.chars.set(parseInt(e[1], 16), hexStr(e[2]));
    for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const e of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
        const a = parseInt(e[1], 16), b = parseInt(e[2], 16);
        if (e[3].startsWith("[")) {
          const list = [...e[3].matchAll(/<([0-9A-Fa-f]+)>/g)];
          list.forEach((x, k) => map.chars.set(a + k, hexStr(x[1])));
        } else {
          // Destination as UTF-16 (surrogate pairs too): the last code unit counts up.
          const base = hexStr(e[3].slice(1, -1));
          for (let c = a; c <= b && c - a < 65536; c++) map.chars.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - a));
        }
      }
  }
  cmapCache.set(tu, map);
  return map;
}

/* ---------- content streams */
function strBytes(tok) {
  if (tok.startsWith("<")) {
    const h = tok.slice(1, -1).replace(/\s+/g, "");
    return Buffer.from(h.length % 2 ? h + "0" : h, "hex");
  }
  const s = tok.slice(1, -1);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out.push(c.charCodeAt(0) & 255);
      continue;
    }
    const n = s[++i];
    const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n];
    if (esc !== undefined) out.push(esc);
    else if (/[0-7]/.test(n)) {
      let o = n;
      while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i];
      out.push(parseInt(o, 8) & 255);
    } else if (n === "\r" || n === "\n") {
      if (n === "\r" && s[i + 1] === "\n") i++;
    } else out.push(n.charCodeAt(0));
  }
  return Buffer.from(out);
}
function text(bytes, font) {
  const map = font?.map;
  const w = map?.width ?? (font?.twoByte ? 2 : 1);
  let s = "";
  for (let i = 0; i + w <= bytes.length; i += w) {
    const code = w === 2 ? bytes.readUInt16BE(i) : bytes[i];
    if (map?.chars.has(code)) s += map.chars.get(code);
    else if (w === 2) s += code + 29 < 127 && code + 29 >= 32 ? String.fromCharCode(code + 29) : "";
    else s += String.fromCharCode(code);
  }
  return s;
}
function tokens(t) {
  const re = /\((?:\\.|[^\\)]|\((?:\\.|[^\\)])*\))*\)|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/<>\[\]()]+|[^\s/<>\[\]()]+/gs;
  return t.match(re) ?? [];
}
function pageText(page) {
  const res = deref(val(page.dict, "Resources")) ?? "";
  const fontsDict = deref(val(res, "Font")) ?? "";
  const fonts = new Map();
  for (const f of fontsDict.matchAll(/\/([^\s/<>\[\]]+)\s+(\d+\s+\d+\s+R)/g)) {
    const fd = ref(f[2])?.dict ?? "";
    fonts.set(f[1], { map: toUnicode(fd), twoByte: /Type0/.test(fd) });
  }
  const contents = val(page.dict, "Contents") ?? "";
  const parts = contents.startsWith("[") ? [...contents.matchAll(/(\d+\s+\d+\s+R)/g)].map((x) => x[1]) : [contents];
  const data = Buffer.concat(parts.map((p) => decode(ref(p)) ?? Buffer.alloc(0))).toString("latin1");
  let font;
  let line = "";
  const lines = [];
  const stack = [];
  const flush = () => {
    if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
    line = "";
  };
  for (const tok of tokens(data)) {
    switch (tok) {
      case "Tf":
        font = fonts.get(String(stack[stack.length - 2] ?? "").slice(1));
        break;
      case "Tj":
      case "'":
      case '"': {
        const s = stack[stack.length - 1];
        if (tok !== "Tj") flush();
        if (typeof s === "string" && /^[(<]/.test(s)) line += text(strBytes(s), font);
        break;
      }
      case "TJ": {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr))
          for (const x of arr) {
            if (/^[(<]/.test(x)) line += text(strBytes(x), font);
            else if (Number(x) < -200) line += " ";
          }
        break;
      }
      case "Td":
      case "TD":
        if (Math.abs(Number(stack[stack.length - 1])) > 0.5) flush();
        else line += " ";
        break;
      case "T*":
      case "ET":
        flush();
        break;
      case "Tm":
        flush();
        break;
      default:
        if (tok === "[") {
          stack.push("[");
          continue;
        }
        if (tok === "]") {
          const i = stack.lastIndexOf("[");
          const arr = stack.splice(i).slice(1);
          stack.push(arr);
          continue;
        }
        if (/^[(<\/\-\d.]/.test(tok)) {
          stack.push(tok);
          continue;
        }
    }
    stack.length = 0;
  }
  flush();
  return lines.join("\n");
}

/* ---------- pages in order (page tree) */
const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
const pages = [];
const walk = (o, seen = new Set()) => {
  if (!o || seen.has(o)) return;
  seen.add(o);
  if (/\/Type\s*\/Page(?!s)/.test(o.dict)) return void pages.push(o);
  for (const k of (val(o.dict, "Kids") ?? "").matchAll(/(\d+\s+\d+\s+R)/g)) walk(ref(k[1]), seen);
};
walk(ref(val(catalog?.dict ?? "", "Pages")));
const out = [];
pages.forEach((p, i) => {
  const n = i + 1;
  if (range && (n < range[0] || n > (range[1] ?? range[0]))) return;
  out.push(`=== page ${n}`, pageText(p));
});
const txt = out.join("\n");
if (outFile) {
  fs.writeFileSync(outFile, txt, "utf8");
  console.log(`${pages.length} page(s); text written to ${outFile}`);
} else process.stdout.write(txt + "\n");
