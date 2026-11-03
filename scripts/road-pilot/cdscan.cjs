// Dump every row of one InfraWorks component road (constrained definition) and list tables that reference it.
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[2],{readOnly:true});
const show=(v)=>v instanceof Uint8Array?('hex:'+Buffer.from(v).toString('hex')):v;
const dump=(t,w,args=[])=>{let rows;try{rows=db.prepare(`select * from "${t}" where ${w}`).all(...args)}catch(e){console.log('ERR',t,e.message);return[]}console.log(`## ${t} (${rows.length})`);for(const r of rows){const o={};for(const[k,v]of Object.entries(r))if(v!==null)o[k]=show(v);console.log(JSON.stringify(o))}return rows};
db.prepare("select 1").get();
// Usage: node cdscan.cjs <model.sqlite> [constrained-definition GUID]; default: the first ROADS definition.
const G=process.argv[3]||db.prepare("select GUID from CONSTRAINED_DEFINITIONS where ASSET_TYPE='ROADS'").get().GUID;
dump('CONSTRAINED_DEFINITIONS','GUID=?',[G]);
dump('ROADS','1=1');
dump('CONSTRAINED_DEF_RPSYSTEMS','1=1');
dump('V_CONSTRAINTS','1=1');
dump('H_CONSTRAINTS','FK_PARENT_GUID=?',[G]);
dump('CONSTRAINED_DEF_GEOM_LOCATIONS','FK_PARENT_GUID=?',[G]);
// tables referencing G or road guid
const road=db.prepare("select GUID from ROADS").get().GUID;console.log('road guid',road);
for(const {name} of db.prepare("select name from sqlite_master where type='table' and name not like '__journal%'").all()){
 const cols=db.prepare(`pragma table_info("${name}")`).all().filter(c=>/TEXT/i.test(c.type)).map(c=>c.name);
 for(const c of cols){try{const n=db.prepare(`select count(*) n from "${name}" where "${c}" in (?,?)`).get(G,road).n;if(n)console.log('ref',name,c,n)}catch(e){}}}
