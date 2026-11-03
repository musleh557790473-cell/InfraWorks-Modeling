const fs=require('fs');const ents=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const prof=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const A=[659155.50,2748176.91],B=[659203.64,2748295.69]; const L=Math.hypot(B[0]-A[0],B[1]-A[1]); const u=[(B[0]-A[0])/L,(B[1]-A[1])/L], nrm=[-u[1],u[0]];
// signed offsets of ROW / edge polylines crossing the normal at mid-chainage
for(const ly of ['RD_ROW','-RD_Edges']){ const offs=[];
 for(const o of ents.filter(e=>e.layer===ly&&e.x.length>1)){ for(let i=1;i<o.x.length;i++){ const P=[o.x[i-1],o.y[i-1]],Q=[o.x[i],o.y[i]];
   const s1=(P[0]-A[0])*u[0]+(P[1]-A[1])*u[1], s2=(Q[0]-A[0])*u[0]+(Q[1]-A[1])*u[1]; const m=64;
   if((s1-m)*(s2-m)>0||s1===s2)continue; const t=(m-s1)/(s2-s1); const X=[P[0]+t*(Q[0]-P[0]),P[1]+t*(Q[1]-P[1])]; const off=(X[0]-A[0])*nrm[0]+(X[1]-A[1])*nrm[1]; if(Math.abs(off)<30)offs.push(+off.toFixed(3)); }}
 console.log(ly,offs.sort((a,b)=>a-b).join(' '));}
const v=prof.find(p=>p.name==='R.6.E.1'); console.log('profile pts',v.pts.length, v.pts.map(p=>p[0].toFixed(2)+':'+p[1].toFixed(3)).join('  '));
