const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[2],{readOnly:true});
const pt=v=>{const b=Buffer.from(v);return [b.readDoubleLE(8),b.readDoubleLE(16),b.length>=32?b.readDoubleLE(24):null].map(x=>x==null?x:+x.toFixed(4))};
const order=(rows,prev,next)=>{const by=new Map(rows.map(r=>[r.GUID,r]));let cur=rows.find(r=>!r[prev]||!by.has(r[prev]));const out=[];while(cur){out.push(cur);cur=by.get(cur[next])}return out};
for(const {GUID} of db.prepare("select GUID from CONSTRAINED_DEFINITIONS where ASSET_TYPE='ROADS'").all()){
 const H=order(db.prepare("select * from H_CONSTRAINTS where FK_PARENT_GUID=?").all(GUID),'FK_PREV_H_CONSTRAINTS_GUID','FK_NEXT_H_CONSTRAINTS_GUID');
 const V=order(db.prepare("select * from V_CONSTRAINTS where FK_PARENT_GUID=?").all(GUID),'FK_PREV_V_CONSTRAINTS_GUID','FK_NEXT_V_CONSTRAINTS_GUID');
 console.log('==',GUID,'H start',JSON.stringify(pt(H[0].PASSTHROUGH_PT_1)),'H count',H.length,'V:');
 for(const r of V) console.log('   ',r.CONSTRAINT_TYPE, r.PASSTHROUGH_PT_1?JSON.stringify(pt(r.PASSTHROUGH_PT_1)):'', r.PASSTHROUGH_PT_2?JSON.stringify(pt(r.PASSTHROUGH_PT_2)):'', r.CURVE_TYPE??'', r.PARAM_1??'');
}
const rd=db.prepare("select ID,NAME,FUNCTION,MAX_SPEED,FK_PARENT_GUID from ROADS").all(); console.log(JSON.stringify(rd));
console.log('PRIMITIVES',db.prepare("select count(*) n from PRIMITIVES").get().n,'TERRAIN_OPERATIONS',db.prepare("select count(*) n from TERRAIN_OPERATIONS").get().n);
console.log('planning road_pilot rows:',JSON.stringify(db.prepare("select ID,NAME,DATA_SOURCE_ID,EXTERNAL_ID from ROADS where FK_PARENT_GUID is null").all()));
