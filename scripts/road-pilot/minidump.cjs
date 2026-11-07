// Read the exception record and the faulting module from a Windows minidump (no debugger needed).
const fs = require("fs");
const b = fs.readFileSync(process.argv[2]);
if (b.toString("ascii", 0, 4) !== "MDMP") throw new Error("not a minidump");
const nStreams = b.readUInt32LE(8), dirRva = b.readUInt32LE(12);
const streams = [];
for (let i = 0; i < nStreams; i++) { const o = dirRva + i * 12; streams.push({ type: b.readUInt32LE(o), size: b.readUInt32LE(o + 4), rva: b.readUInt32LE(o + 8) }); }
const str = (rva) => { const n = b.readUInt32LE(rva); return b.toString("utf16le", rva + 4, rva + 4 + n); };
const mods = [];
const ml = streams.find((s) => s.type === 4);
if (ml) { const n = b.readUInt32LE(ml.rva); for (let i = 0; i < n; i++) { const o = ml.rva + 4 + i * 108; mods.push({ base: b.readBigUInt64LE(o), size: b.readUInt32LE(o + 8), name: str(b.readUInt32LE(o + 20)) }); } }
const inMod = (addr) => mods.find((m) => addr >= m.base && addr < m.base + BigInt(m.size));
const ex = streams.find((s) => s.type === 6);
if (ex) {
  const o = ex.rva; const tid = b.readUInt32LE(o); const r = o + 8;
  const code = b.readUInt32LE(r), flags = b.readUInt32LE(r + 4), addr = b.readBigUInt64LE(r + 16), nParams = b.readUInt32LE(r + 24);
  const params = []; for (let i = 0; i < Math.min(nParams, 4); i++) params.push(b.readBigUInt64LE(r + 32 + i * 8));
  const m = inMod(addr);
  console.log(`thread ${tid} exception 0x${code.toString(16)} flags ${flags} at 0x${addr.toString(16)} ${m ? `${m.name}+0x${(addr - m.base).toString(16)}` : "(no module)"}; params ${params.map((p) => "0x" + p.toString(16)).join(" ")}`);
  // stack scan of the faulting thread: find return addresses that fall inside modules
  const tl = streams.find((s) => s.type === 3);
  if (tl) { const n = b.readUInt32LE(tl.rva); for (let i = 0; i < n; i++) { const t = tl.rva + 4 + i * 48; if (b.readUInt32LE(t) !== tid) continue; const sSize = b.readUInt32LE(t + 32), sRva = b.readUInt32LE(t + 36); const seen = [];
    console.log(`faulting thread stack: ${sSize} bytes in dump at rva ${sRva}`);
    if (sRva + sSize > b.length) { console.log("stack memory not in the dump"); continue; }
    for (let k = 0; k + 8 <= sSize && seen.length < 70; k += 8) { const v = b.readBigUInt64LE(sRva + k); const mm = inMod(v); if (mm && !/ntdll|KERNEL|kernel|ucrtbase|msvcp|vcruntime|Qt5|Qt6|dbgcore|dbghelp/i.test(mm.name) && (seen.length === 0 || !seen[seen.length - 1].startsWith(mm.name.split("\\").pop() + "+0x" + (v - mm.base).toString(16)))) seen.push(`${mm.name.split("\\").pop()}+0x${(v - mm.base).toString(16)}`); }
    console.log("stack scan (module+offset, innermost first):\n  " + seen.join("\n  ")); } }
}
console.log("modules:", mods.length, "e.g.", mods.filter((m) => /AIM_|alx|Vehicle|sqlite|Savoy|VT/i.test(m.name)).map((m) => m.name.split("\\").pop()).slice(0, 30).join(", "));
