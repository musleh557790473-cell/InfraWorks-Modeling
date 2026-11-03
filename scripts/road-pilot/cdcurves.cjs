const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[2],{readOnly:true});
const hex=v=>Buffer.from(v).toString('hex');
// decode InfraWorks blob points: try doubles
const dbl=v=>{const b=Buffer.from(v);const o=[];for(let i=0;i+8<=b.length;i+=8)o.push(+b.readDoubleLE(i).toFixed(4));return o};
const show=(r)=>{const o={};for(const[k,v]of Object.entries(r)){if(v===null)continue; if(v instanceof Uint8Array){o[k]=`len${v.length} ${hex(v).slice(0,96)}`; }else o[k]=v} return o};
const order=(rows,prev,next)=>{const by=new Map(rows.map(r=>[r.GUID,r]));let cur=rows.find(r=>!r[prev]||!by.has(r[prev]));const out=[];while(cur){out.push(cur);cur=by.get(cur[next])}return out};
const G2='3eb2f70d-3d4c-4f0e-aa48-e1f81f0a42bc', G3='732f2326-2ea5-4dab-96ca-4a1fb9511c8f';
const V=order(db.prepare("select * from V_CONSTRAINTS where FK_PARENT_GUID=?").all(G2),'FK_PREV_V_CONSTRAINTS_GUID','FK_NEXT_V_CONSTRAINTS_GUID');
console.log('### road2 V chain'); for(const r of V){const o=show(r); delete o.GUID; delete o.FK_PARENT_GUID; delete o.FK_PARENT_TABLE; delete o.FK_PREV_V_CONSTRAINTS_GUID; delete o.FK_NEXT_V_CONSTRAINTS_GUID; console.log(JSON.stringify(o)); for(const k of ['PASSTHROUGH_PT_1','PASSTHROUGH_PT_2','PASSTHROUGH_PT_3']) if(r[k]) console.log('   ',k,'len',r[k].length,'hex',hex(r[k]));}
const H2=order(db.prepare("select * from H_CONSTRAINTS where FK_PARENT_GUID=?").all(G2),'FK_PREV_H_CONSTRAINTS_GUID','FK_NEXT_H_CONSTRAINTS_GUID');
console.log('### road2 H chain'); for(const r of H2){const o=show(r); console.log(r.CONSTRAINT_TYPE, o.PASSTHROUGH_PT_1, '|', o.PASSTHROUGH_PT_2, '|', o.PASSTHROUGH_PT_3||'')}
const H3=db.prepare("select * from H_CONSTRAINTS where FK_PARENT_GUID=? and CONSTRAINT_TYPE=4").all(G3);
console.log('### road3 arc sample'); for(const r of H3.slice(0,2)){const o=show(r); for(const k of ['GUID','FK_PARENT_GUID','FK_PARENT_TABLE']) delete o[k]; console.log(JSON.stringify(o)); for(const k of ['PASSTHROUGH_PT_1','PASSTHROUGH_PT_2','PASSTHROUGH_PT_3','DIRECTION_1']) if(r[k]) console.log('   ',k,'hex',hex(r[k]));}
const cd=db.prepare("select * from CONSTRAINED_DEFINITIONS where GUID=?").get(G2); console.log('### CD', JSON.stringify(show(cd)));
