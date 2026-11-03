const fs=require('fs');const ents=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const clean=t=>t.replace(/\\[A-Za-z][^;\\{}]*;/g,'').replace(/\\L/g,'').replace(/[{}"]/g,'').replace(/\\P/g,' ').trim();
const by={}; ents.forEach(o=>(by[o.layer]=by[o.layer]||[]).push(o));
for(const ly of ['0-Alignment Name','RD_C_CHAIN_TEXT','RD_C_CHAIN_MARK','RD_PR_CNRL']){ const a=by[ly]||[]; const tc={}; a.forEach(o=>tc[o.t]=(tc[o.t]||0)+1); console.log('##',ly,JSON.stringify(tc));
 a.slice(0,5).forEach(o=>console.log('   ',o.t,o.name||'',o.txt?JSON.stringify(clean(o.txt)):'', 'pts',o.x.length,o.x[0]?.toFixed(1),o.y[0]?.toFixed(1)))}
const lens=(by['RD_PR_CNRL']||[]).filter(o=>o.t==='LWPOLYLINE').map(o=>{let l=0;for(let i=1;i<o.x.length;i++)l+=Math.hypot(o.x[i]-o.x[i-1],o.y[i]-o.y[i-1]);return l});
console.log('centreline count',lens.length,'total km',(lens.reduce((a,b)=>a+b,0)/1000).toFixed(2));
