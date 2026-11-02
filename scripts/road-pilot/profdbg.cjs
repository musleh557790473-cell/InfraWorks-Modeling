const fs=require('fs');
const ents=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const clean=t=>t.replace(/\\[A-Za-z][^;\\{}]*;/g,'').replace(/\\L/g,'').replace(/[{}"]/g,'').replace(/\\P/g,' ').trim();
for(const nm of process.argv.slice(3)){
 const n=ents.find(o=>o.layer==='RD_C_PROF_TITL'&&clean(o.txt)===nm); const nx=n.x[0],ny=n.y[0]; const rowY=ny-16;
 console.log('==',nm,'title',nx.toFixed(1),ny.toFixed(1));
 const near=(o)=>o.x.some(x=>x>nx-20&&x<nx+900)&&o.y.some(y=>y>rowY-80&&y<rowY+300);
 ents.filter(o=>(o.layer==='RD_C_PROF_FG'||o.layer==='RD_C_PROF_TITL')&&near(o)).forEach(o=>console.log('  ',o.layer,o.t,o.txt?clean(o.txt):'', o.x.length? `x ${Math.min(...o.x).toFixed(1)}..${Math.max(...o.x).toFixed(1)} y ${Math.min(...o.y).toFixed(1)}..${Math.max(...o.y).toFixed(1)} n=${o.x.length}`:''));
 const st=ents.filter(o=>o.layer==='RD_C_PROF_STN-MAJR'&&Math.abs(o.y[0]-rowY)<1&&o.x[0]>nx&&o.x[0]<nx+900).map(o=>clean(o.txt)+'@'+o.x[0].toFixed(1)); console.log('   stations',st.join(' '));
}
