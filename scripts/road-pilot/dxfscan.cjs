// Usage: node dxfscan.cjs <file.dxf>: header units/extents, entity, layer and AECC class counts.
const fs=require('fs');
const f=process.argv[2];
const L=fs.readFileSync(f,'latin1').split(/\r?\n/);
let sec='',cls={},ents={},layers={},objs={},zs=[],inEnt=false,curType='',classNames=[];
for(let i=0;i+1<L.length;i+=2){const c=L[i].trim(),v=L[i+1].trim();
 if(c==='0'&&v==='SECTION'){sec=L[i+3].trim();continue}
 if(c==='0'){curType=v;
  if(sec==='ENTITIES')ents[v]=(ents[v]||0)+1;
  if(sec==='OBJECTS')objs[v]=(objs[v]||0)+1;}
 if(sec==='CLASSES'&&c==='1')classNames.push(v);
 if(sec==='ENTITIES'&&c==='8'){const k=curType+' @ '+v;layers[k]=(layers[k]||0)+1}
 if(sec==='ENTITIES'&&c==='30'&&zs.length<200000){const z=+v;if(z)zs.push(z)}
 if(sec==='HEADER'&&c==='9'&&/INSUNITS|EXTMIN|EXTMAX/.test(v))console.log(v,L[i+3].trim(),L[i+5]?.trim());
}
const top=(o,n)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n);
console.log('ENTITIES',top(ents,30));
console.log('AECC classes',classNames.filter(x=>/AECC/i.test(x)));
console.log('OBJECTS',top(objs,30).filter(([k])=>/AECC|PROXY/i.test(k)||true).slice(0,20));
console.log('LAYERS',top(layers,40));
if(zs.length){zs.sort((a,b)=>a-b);console.log('Z nonzero n',zs.length,'min',zs[0],'max',zs[zs.length-1])}
