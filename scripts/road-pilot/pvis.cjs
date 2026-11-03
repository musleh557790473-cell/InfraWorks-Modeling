const fs=require('fs');const ents=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const prof=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const clean=t=>t.replace(/\\[A-Za-z][^;\\{}]*;/g,'').replace(/\\L/g,'').replace(/[{}"]/g,'').replace(/\\P/g,' | ').trim();
const sta=t=>{const m=t.match(/(\d+)\+(\d+(?:\.\d+)?)/);return m?+m[1]*1000+ +m[2]:NaN};
const lab=ents.filter(o=>o.layer==='RD_C_PROF_LABL'&&o.txt).map(o=>({t:clean(o.txt),x:o.x[0],y:o.y[0]}));
const names=ents.filter(o=>o.layer==='RD_C_PROF_TITL'&&o.txt).map(o=>({t:clean(o.txt),x:o.x[0],y:o.y[0]})).filter(o=>!/^Datum/.test(o.t));
const out={};
for(const n of names){
  const next=names.filter(o=>Math.abs(o.y-n.y)<1&&o.x>n.x+1).sort((a,b)=>a.x-b.x)[0]; const xmax=next?next.x:n.x+3000;
  const rowY=n.y-16; const above=names.filter(o=>o.x<xmax-20&&o.x>n.x-200&&o.y>n.y+1).sort((a,b)=>a.y-b.y)[0]; const top=above?above.y-20:rowY+500;
  const L=lab.filter(o=>o.x>n.x&&o.x<xmax&&o.y>rowY&&o.y<top);
  const fixed=L.filter(o=>/^STA .*\| ELEV/.test(o.t)).map(o=>({s:sta(o.t),z:+o.t.split('ELEV')[1]}));
  const lone=L.filter(o=>/^STA [\d+.]+$/.test(o.t)), elev=L.filter(o=>/^ELEV [\d.]+$/.test(o.t));
  for(const s of lone){ const e=elev.filter(o=>Math.abs(o.y-s.y)<0.6&&Math.abs(o.x-s.x)<30).sort((a,b)=>Math.abs(a.x-s.x)-Math.abs(b.x-s.x))[0]; if(e) fixed.push({s:sta(s.t),z:+e.t.slice(5),split:true}); }
  const pvc=L.filter(o=>/^PVC/.test(o.t)).map(o=>({s:sta(o.t),z:+o.t.split('ELEV')[1],x:o.x,y:o.y}));
  const pvt=L.filter(o=>/^PVT/.test(o.t)).map(o=>({s:sta(o.t),z:+o.t.split('ELEV')[1],x:o.x,y:o.y}));
  const pvi=L.filter(o=>/^PVI/.test(o.t)).map(o=>({s:sta(o.t),x:o.x,y:o.y}));
  const vc=L.filter(o=>/^VC/.test(o.t)).map(o=>({L:+o.t.match(/VC\s*([\d.]+)/)[1],K:+o.t.match(/K\s*([\d.]+)/)[1],x:o.x,y:o.y}));
  const curves=pvi.map(p=>{ const v=vc.sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x))[0]; const c=pvc.find(q=>Math.abs(q.s-(p.s-v.L/2))<0.01), t=pvt.find(q=>Math.abs(q.s-(p.s+v.L/2))<0.01); return {s:p.s,L:v&&v.L,K:v&&v.K,pvc:c,pvt:t}});
  const key=n.t; (out[key]=out[key]||[]).push({fixed,curves});
}
// assemble PVI list per road: points (s,z) + curve lengths; PVI elevation from PVC/PVT tangents
const roads={};
for(const [name,views] of Object.entries(out)){
  const pts=[];
  for(const v of views){ v.fixed.forEach(f=>pts.push({s:f.s,z:f.z,L:0}));
    v.curves.forEach(c=>{ if(!c.pvc||!c.pvt){pts.push({s:c.s,z:null,L:c.L,err:'no PVC/PVT'});return}
      // tangents meet at PVI: need grades; use neighbouring points later; store PVC/PVT
      pts.push({s:c.s,L:c.L,K:c.K,pvc:[c.pvc.s,c.pvc.z],pvt:[c.pvt.s,c.pvt.z]}); }); }
  pts.sort((a,b)=>a.s-b.s);
  // dedupe same station
  const u=[]; for(const p of pts){ const q=u.find(o=>Math.abs(o.s-p.s)<0.001); if(!q)u.push(p); else if(p.L&&!q.L)Object.assign(q,p)}
  // anchors: fixed points, PVC, PVT (printed levels); a curve's PVI lies where the tangents through them meet
  const fg=prof.filter(p=>p.name===name).flatMap(v=>v.pts).sort((a,b)=>a[0]-b[0]);
  if(fg.length&&!u.some(p=>Math.abs(p.s-fg[0][0])<0.01&&p.z!=null)) u.unshift({s:+fg[0][0].toFixed(3),z:+fg[0][1].toFixed(3),L:0,fromFG:true});
  if(fg.length&&!u.some(p=>Math.abs(p.s-fg.at(-1)[0])<0.01&&p.z!=null)) u.push({s:+fg.at(-1)[0].toFixed(3),z:+fg.at(-1)[1].toFixed(3),L:0,fromFG:true});
  u.sort((a,b)=>a.s-b.s);
  const anchorsBefore=(i)=>{for(let k=i-1;k>=0;k--){const q=u[k]; if(q.pvt)return [q.pvt[0],q.pvt[1]]; if(q.z!=null&&!q.L)return [q.s,q.z]} return null};
  const anchorsAfter=(i)=>{for(let k=i+1;k<u.length;k++){const q=u[k]; if(q.pvc)return [q.pvc[0],q.pvc[1]]; if(q.z!=null&&!q.L)return [q.s,q.z]} return null};
  for(let i=0;i<u.length;i++){ const p=u[i]; if(!p.pvc)continue; const a=anchorsBefore(i), b=anchorsAfter(i); if(!a||!b){p.err='no anchor';continue}
    const gin=(p.pvc[1]-a[1])/(p.pvc[0]-a[0]), gout=(b[1]-p.pvt[1])/(b[0]-p.pvt[0]);
    const z1=p.pvc[1]+gin*(p.s-p.pvc[0]), z2=p.pvt[1]+gout*(p.s-p.pvt[0]); p.z=+((z1+z2)/2).toFixed(4); p.mis=Math.abs(z1-z2); p.gin=gin; p.gout=gout; }
  roads[name]=u;
}fs.writeFileSync(process.argv[4],JSON.stringify(roads));
// verify against FG polyline: z at each PVT computed from PVI->next tangent vs printed PVT, and fixed points vs FG
const fgz=(name,s)=>{ for(const v of prof.filter(p=>p.name===name)){ const p=v.pts; for(let i=1;i<p.length;i++) if(p[i-1][0]<=s+1e-6&&p[i][0]>=s-1e-6) return p[i-1][1]+(p[i][1]-p[i-1][1])*(s-p[i-1][0])/((p[i][0]-p[i-1][0])||1)} return null};
let n=0,bad=[],nc=0,mis=[];
for(const [name,u] of Object.entries(roads)){ for(const p of u){ if(p.z==null){bad.push(name+' '+p.s+' '+(p.err||'no level'));continue}
  if(p.L){nc++; mis.push(p.mis); if(p.mis>0.005)bad.push(`${name} PVI ${p.s}: tangents disagree by ${p.mis.toFixed(3)}`)}
  else if(!p.fromFG){ const f=fgz(name,p.s); if(f!=null){n++; if(Math.abs(f-p.z)>0.005)bad.push(`${name} ${p.s}: label ${p.z} vs FG ${f.toFixed(3)}`)}} }}
mis.sort((a,b)=>a-b); const maxd=mis.at(-1)||0;
console.log('curve PVI tangent mismatch: median',(mis[mis.length>>1]||0).toFixed(4),'p95',(mis[Math.floor(mis.length*0.95)]||0).toFixed(4));console.log('roads',Object.keys(roads).length,'PVIs',Object.values(roads).reduce((a,u)=>a+u.length,0),'with VC',Object.values(roads).reduce((a,u)=>a+u.filter(p=>p.L).length,0));
console.log('fixed points checked vs FG',n,'curves',nc,'max tangent mismatch',maxd.toFixed(4));
console.log('issues',bad.length); bad.slice(0,15).forEach(b=>console.log('  ',b)); const bn=[...new Set(bad.map(b=>b.split(' ')[0]))]; console.log('roads with issues',bn.length,bn.join(' '));
for(const r of ['R.6.E.1','R.6.F.1']) console.log(r, JSON.stringify(roads[r]));


