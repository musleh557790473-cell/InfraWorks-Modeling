const fs=require('fs');
const L=fs.readFileSync(process.argv[2],'latin1').split(/\r?\n/);
const s=L.indexOf('ENTITIES'); let e=s; while(e<L.length && !(L[e].trim()==='ENDSEC' && L[e-1].trim()==='0')) e++;
console.log('ENTITIES lines',s,'to',e);
const cnt={}; const lay={};
for(let i=s+1;i<e;i+=2){ if(L[i].trim()==='0'){ const t=L[i+1].trim(); let j=i+2, layer='', name=''; while(j<e && L[j].trim()!=='0'){ if(L[j].trim()==='8')layer=L[j+1].trim(); if(L[j].trim()==='2'&&!name)name=L[j+1].trim(); j+=2;} const k=t+' | '+layer+(t==='INSERT'?' | '+name:''); cnt[k]=(cnt[k]||0)+1; i=j-2; } }
Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,50).forEach(([k,n])=>console.log(n,k));
