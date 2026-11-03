const fs=require('fs');
const ents=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const clean=t=>t.replace(/\\[A-Za-z][^;\\{}]*;/g,'').replace(/\\L/g,'').replace(/[{}"]/g,'').replace(/\\P/g,' ').trim();
const L=n=>ents.filter(o=>o.layer===n);
const titles=L('RD_C_PROF_TITL').map(o=>({x:o.x[0],y:o.y[0],t:clean(o.txt)}));
const names=titles.filter(o=>!/^Datum/.test(o.t));
const datums=titles.filter(o=>/^Datum/.test(o.t));
const stn=L('RD_C_PROF_STN-MAJR').map(o=>({x:o.x[0],y:o.y[0],t:clean(o.txt)})).filter(o=>/^\d+\+\d+(\.\d+)?$/.test(o.t)).map(o=>({...o,s:(([a,b])=>+a*1000+ +b)(o.t.split('+'))}));
const grid=L('RD_C_PROF_TEXT-GRID').map(o=>({x:o.x[0],y:o.y[0],v:+clean(o.txt)})).filter(o=>isFinite(o.v)&&o.v>500);
const fgt=L('RD_C_PROF_TEXT-FG').map(o=>({x:o.x[0],y:o.y[0],t:clean(o.txt)}));
const fg=L('RD_C_PROF_FG').filter(o=>o.t==='LWPOLYLINE');
const views=[]; let errs=[];
for(const n of names){
  const d=datums.find(o=>Math.abs(o.y-(n.y-6))<1&&Math.abs(o.x-(n.x+14))<2);
  const datum=d?+d.t.replace(/[^\d.]/g,''):NaN;
  const next=names.filter(o=>Math.abs(o.y-n.y)<1&&o.x>n.x+1).sort((a,b)=>a.x-b.x)[0];
  const rowY=n.y-16;
  let above=names.filter(o=>o.x<(next?next.x:n.x+2000)-20&&o.x>n.x-200&&o.y>n.y+1).sort((a,b)=>a.y-b.y)[0];
  // the last view of a row searched 2 km sideways and could take a title of the next zone column as
  // its top, leaving a window too short for the level grid (R.3.G.4, R.10.G.1): then look straight up
  if(above&&above.y-20<rowY+50) above=names.filter(o=>Math.abs(o.x-n.x)<100&&o.y>n.y+1).sort((a,b)=>a.y-b.y)[0];
  const top=above?above.y-20:rowY+500;
  const xmax=next?next.x:Infinity;
  const st=stn.filter(o=>Math.abs(o.y-rowY)<1&&o.x>n.x&&o.x<xmax).sort((a,b)=>a.x-b.x);
  const reg=st.filter(o=>Math.abs(o.s/25-Math.round(o.s/25))<1e-6);
  // horizontal: label x = tick x (labels centred); scale from regular labels
  const k=reg.length>=2?(reg.at(-1).s-reg[0].s)/(reg.at(-1).x-reg[0].x):1;
  const x0=reg[0].x, s0=reg[0].s;
  // vertical: left-axis grid labels in one column just left of the first station
  const cols={}; for(const o of grid){ if(o.y<=rowY||o.y>top)continue; if(o.x>x0+1||o.x<x0-40)continue; const kx=Math.round(o.x); (cols[kx]=cols[kx]||[]).push(o)}
  const col=Object.entries(cols).sort((a,b)=>(+b[0])-(+a[0]))[0];
  if(!col||col[1].length<2){errs.push(n.t+' no grid');continue}
  const gg=col[1].sort((a,b)=>a.y-b.y);
  const ve=(gg.at(-1).y-gg[0].y)/(gg.at(-1).v-gg[0].v);
  const xEnd=st.at(-1).x;
  // the FG line only has to stay left of the next view's title (its own line starts ~54 m right of
  // that title); a 20 m margin cut off lines ending close to it (R.14.G.9, R.8.G.4)
  const f=fg.filter(o=>o.x.every(x=>x>=x0-s0/k-0.5&&x<=xEnd+25&&x<xmax)&&o.y.every(y=>y>rowY&&y<top)&&o.x[0]<xmax);
  const viaGrid=Math.abs(ve-10)<0.01; const zf=y=>viaGrid?gg[0].v+(y-gg[0].y)/ve:datum+(y-(rowY+5))/10;
  const pts=f.flatMap(o=>o.x.map((x,i)=>[s0+(x-x0)*k, zf(o.y[i])])).sort((a,b)=>a[0]-b[0]);
  // PGL row check
  const pglHdr=fgt.find(o=>o.t==='PGL ELEVATION'&&Math.abs(o.x-(n.x-0.3))<2&&o.y<rowY&&o.y>rowY-60);
  let maxd=null, nchk=0;
  if(pglHdr&&pts.length){ const row=fgt.filter(o=>Math.abs(o.y-pglHdr.y)<0.5&&o.x>n.x+5&&o.x<xmax&&/^\d+\.\d+$/.test(o.t));
    for(const r of row){ const s=s0+(r.x-0.6-x0)*k; let z=null; for(let i=1;i<pts.length;i++){ if(pts[i-1][0]<=s+1e-6&&pts[i][0]>=s-1e-6){ const a=pts[i-1],b=pts[i]; z=b[0]===a[0]?a[1]:a[1]+(b[1]-a[1])*(s-a[0])/(b[0]-a[0]); break}} if(z!==null){nchk++; const dd=Math.abs(z-+r.t); if(maxd===null||dd>maxd)maxd=dd}}}
  views.push({name:n.t,tx:+n.x.toFixed(1),ty:+n.y.toFixed(1),datum,k:+k.toFixed(4),ve:+ve.toFixed(3),s0:pts[0]?.[0],send:pts.at(-1)?.[0],smaxLabel:st.at(-1).s,nfg:f.length,nchk,maxd,pts});
}
fs.writeFileSync(process.argv[3],JSON.stringify(views));
console.log('views',views.length,'errors',errs.length,errs.slice(0,5));
const hist=(f)=>JSON.stringify(views.reduce((m,v)=>{const k=f(v);m[k]=(m[k]||0)+1;return m},{}));
console.log('hscale',hist(v=>v.k),'\nvscale',hist(v=>v.ve));
console.log('check: views checked',views.filter(v=>v.nchk).length,'labels',views.reduce((a,v)=>a+v.nchk,0));
console.log('max diff hist (m)',hist(v=>v.maxd===null?'none':v.maxd<0.002?'<2mm':v.maxd<0.01?'<1cm':v.maxd<0.05?'<5cm':'>=5cm'));
console.log('bad:',views.filter(v=>v.maxd>=0.05||v.maxd===null).slice(0,12).map(v=>`${v.name}@${v.tx},${v.ty} k=${v.k} ve=${v.ve} nfg=${v.nfg} nchk=${v.nchk} maxd=${v.maxd&&v.maxd.toFixed(3)} s=${v.s0?.toFixed(1)}-${v.send?.toFixed(1)}/${v.smaxLabel}`).join('\n'));




