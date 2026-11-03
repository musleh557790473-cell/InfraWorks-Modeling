const fs=require('fs');const ents=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const clean=t=>t.replace(/\\[A-Za-z][^;\\{}]*;/g,'').replace(/\\L/g,'').replace(/[{}"]/g,'').replace(/\\P/g,' | ').trim();
const txt=ents.filter(o=>o.txt).map(o=>({l:o.layer,t:clean(o.txt),x:o.x[0],y:o.y[0]}));
const kinds={}; for(const o of txt){ const k=o.l+' :: '+o.t.replace(/[\d.+\-]+/g,'#').slice(0,60); kinds[k]=(kinds[k]||0)+1 }
Object.entries(kinds).sort((a,b)=>b[1]-a[1]).slice(0,45).forEach(([k,n])=>console.log(n,k));
console.log('--- sample with VC/PVI/K/L:');
txt.filter(o=>/PVI|VC|K\s*=|L\s*=|HIGH|LOW|BVC|EVC|CREST|SAG/i.test(o.t)&&o.l!=='RD_C_PROF_TEXT-HG').slice(0,15).forEach(o=>console.log(o.l,'|',o.t,o.x.toFixed(1),o.y.toFixed(1)));
