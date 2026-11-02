// Usage: node roadgeom.cjs <model.sqlite> <out.json>: XYZ vertices of the first ROADS geometry.
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[2],{readOnly:true});
const g=Buffer.from(db.prepare("select r.GEOMETRY g from ROADS r").get().g);
console.log('len',g.length,'head',g.subarray(0,24).toString('hex'));
// find first double near 659155
let off=-1;for(let i=0;i<g.length-8;i++){const v=g.readDoubleLE(i);if(v>659000&&v<659300){off=i;break}}
console.log('first X at',off);
const pts=[];for(let i=off;i+24<=g.length;i+=24){const x=g.readDoubleLE(i),y=g.readDoubleLE(i+8),z=g.readDoubleLE(i+16);if(!(x>659000&&x<659300))break;pts.push([x,y,z])}
console.log('n',pts.length);console.log(pts.slice(0,3),pts.slice(-2));
require('fs').writeFileSync(process.argv[3],JSON.stringify(pts));
