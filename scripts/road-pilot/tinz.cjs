// Usage: node tinz.cjs <surface.xml> <points.json [[x,y,z],...]>: terrain Z under each point and PGL minus terrain.
const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const b=s.slice(s.indexOf('<Surface name="Al_Qairawan_Mass Grading"'));
const P=new Map();for(const m of b.matchAll(/<P id="(\d+)">([^<]+)<\/P>/g)){const [n,e,z]=m[2].trim().split(/\s+/).map(Number);P.set(m[1],[e,n,z])} // LandXML: northing easting z
const pts=JSON.parse(fs.readFileSync(process.argv[3]));const minx=Math.min(...pts.map(p=>p[0]))-20,maxx=Math.max(...pts.map(p=>p[0]))+20,miny=Math.min(...pts.map(p=>p[1]))-20,maxy=Math.max(...pts.map(p=>p[1]))+20;
const F=[];for(const m of b.matchAll(/<F(?: [^>]*)?>([^<]+)<\/F>/g)){const t=m[1].trim().split(/\s+/).map(i=>P.get(i));if(t.some(v=>!v))continue;if(t.every(v=>v[0]<minx||v[0]>maxx||v[1]<miny||v[1]>maxy))continue;F.push(t)}
function zAt(x,y){for(const [a,b2,c] of F){const d=(b2[1]-c[1])*(a[0]-c[0])+(c[0]-b2[0])*(a[1]-c[1]);const l1=((b2[1]-c[1])*(x-c[0])+(c[0]-b2[0])*(y-c[1]))/d,l2=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,l3=1-l1-l2;if(l1>=-1e-9&&l2>=-1e-9&&l3>=-1e-9)return l1*a[2]+l2*b2[2]+l3*c[2]}return null}
let st=0,prev=null,diffs=[];console.log('station  PGL      terrain  PGL-terrain');
for(const p of pts){if(prev)st+=Math.hypot(p[0]-prev[0],p[1]-prev[1]);prev=p;const z=zAt(p[0],p[1]);const d=z==null?null:p[2]-z;if(d!=null)diffs.push(d);console.log(st.toFixed(1).padStart(7),p[2].toFixed(3),z==null?'  n/a  ':z.toFixed(3),d==null?'':d.toFixed(3))}
console.log('faces near road',F.length,'diff min',Math.min(...diffs).toFixed(3),'max',Math.max(...diffs).toFixed(3),'mean',(diffs.reduce((a,b)=>a+b,0)/diffs.length).toFixed(3));
