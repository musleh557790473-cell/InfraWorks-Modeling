const fs=require('fs');const base=process.argv[2];
const shp=fs.readFileSync(base+'.shp'), dbf=fs.readFileSync(base+'.dbf');
const n=dbf.readUInt32LE(4), hl=dbf.readUInt16LE(8), rl=dbf.readUInt16LE(10);
const fields=[]; for(let o=32;dbf[o]!==0x0d;o+=32){fields.push({name:dbf.toString('latin1',o,o+11).replace(/\0.*/,''),len:dbf[o+16]})}
const recs=[]; for(let i=0;i<n;i++){let o=hl+i*rl+1; const r={}; for(const f of fields){r[f.name]=dbf.toString('utf8',o,o+f.len).trim(); o+=f.len} recs.push(r)}
const geoms=[]; let o=100; while(o<shp.length){const len=shp.readInt32BE(o+4)*2; const c=o+8; const t=shp.readInt32LE(c); if(t===3){const np=shp.readInt32LE(c+36+4); const nparts=shp.readInt32LE(c+36); const p0=c+44+4*nparts; const pts=[]; for(let k=0;k<np;k++)pts.push([shp.readDoubleLE(p0+16*k),shp.readDoubleLE(p0+16*k+8)]); geoms.push(pts)} else geoms.push(null); o=c+len}
console.log('fields',fields.map(f=>f.name).join(','),'records',n);
const want=process.argv.slice(3);
recs.forEach((r,i)=>{ const nm=Object.values(r).join('|'); if(want.some(w=>nm.includes(w))){const p=geoms[i]; let l=0; for(let k=1;k<p.length;k++)l+=Math.hypot(p[k][0]-p[k-1][0],p[k][1]-p[k-1][1]); console.log(i,JSON.stringify(r),'pts',p.length,'len',l.toFixed(3),'start',p[0].map(v=>v.toFixed(2)).join(','),'end',p.at(-1).map(v=>v.toFixed(2)).join(','))}});
