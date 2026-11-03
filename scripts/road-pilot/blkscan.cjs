const fs=require('fs');
const L=fs.readFileSync(process.argv[2],'latin1').split(/\r?\n/).map(x=>x.trim());
const s=L.indexOf('BLOCKS'); const e=L.indexOf('ENTITIES');
let blk=null, inHdr=false; const b={};
for(let i=s+1;i<e;i+=2){ if(L[i]!=='0')continue; const t=L[i+1];
  if(t==='BLOCK'){ let j=i+2; let n=''; while(L[j]!=='0'){ if(L[j]==='2'){n=L[j+1];break} j+=2;} blk=n; b[blk]={n:0,types:{},layers:{}}; continue}
  if(t==='ENDBLK'){blk=null;continue}
  if(blk){ const o=b[blk]; o.n++; o.types[t]=(o.types[t]||0)+1; let j=i+2; while(j<e&&L[j]!=='0'){ if(L[j]==='8'){o.layers[L[j+1]]=(o.layers[L[j+1]]||0)+1;break} j+=2;} }
}
const arr=Object.entries(b).sort((x,y)=>y[1].n-x[1].n).slice(0,8);
for(const [n,o] of arr){ console.log(o.n, n, JSON.stringify(o.types).slice(0,200)); console.log('   layers:', Object.entries(o.layers).sort((x,y)=>y[1]-x[1]).slice(0,25).map(([k,v])=>k+':'+v).join(', ')); }
