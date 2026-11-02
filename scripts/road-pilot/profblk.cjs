const fs=require('fs');
const L=fs.readFileSync(process.argv[2],'latin1').split(/\r?\n/).map(x=>x.trim());
const want=process.argv[3];
const s=L.indexOf('BLOCKS'); const e=L.indexOf('ENTITIES');
let blk=null; const ents=[];
for(let i=s+1;i<e;i+=2){ if(L[i]!=='0')continue; const t=L[i+1];
  if(t==='BLOCK'){ let j=i+2; while(L[j]!=='0'){ if(L[j]==='2'){blk=L[j+1];break} j+=2;} continue}
  if(t==='ENDBLK'){blk=null;continue}
  if(blk!==want) continue;
  const o={t,x:[],y:[],txt:''}; let j=i+2;
  while(j<e&&L[j]!=='0'){ const c=L[j],v=L[j+1]; if(c==='8')o.layer=v.split('$0$').pop(); else if(c==='10')o.x.push(+v); else if(c==='20')o.y.push(+v); else if(c==='1'||c==='3')o.txt+=v; else if(c==='2'&&t==='INSERT')o.name=v; else if(c==='40'&&!o.h)o.h=+v; j+=2;}
  ents.push(o);
}
fs.writeFileSync(process.argv[4], JSON.stringify(ents));
const by={}; for(const o of ents){ (by[o.layer]=by[o.layer]||[]).push(o)}
for(const ly of ['RD_C_PROF_TITL','RD_C_PROF_TEXT-FG','RD_C_PROF_TEXT-GRID','RD_C_PROF_STN-MAJR','RD_C_PROF_LABL','C-ROAD-PROF','RD_C_PROF_FG','RD_C_PROF_TEXT-HG','G-SHTNO','MATCH LINE']){
  const a=by[ly]||[]; const tc={}; a.forEach(o=>tc[o.t]=(tc[o.t]||0)+1);
  console.log('##',ly,JSON.stringify(tc));
  a.filter(o=>o.txt).slice(0,6).forEach(o=>console.log('   ',o.t,o.x[0]?.toFixed(1),o.y[0]?.toFixed(1),JSON.stringify(o.txt.slice(0,120))));
  a.filter(o=>!o.txt).slice(0,2).forEach(o=>console.log('   ',o.t,o.name||'','pts',o.x.length,o.x.slice(0,3).map(v=>v.toFixed(1)).join(','),'|',o.y.slice(0,3).map(v=>v.toFixed(1)).join(',')));
}
