const fs=require('fs'); const t=fs.readFileSync(process.argv[2],'utf8');
const m=(re)=>[...t.matchAll(re)].map(x=>x[0].slice(0,250));
console.log(m(/<(Units|Metric|CoordinateSystem|Application|Project)[^>]*>/g).slice(0,5).join('\n'));
for(const s of t.matchAll(/<Surface [^>]*>/g)){ const i=s.index; const seg=t.slice(i, t.indexOf('</Surface>',i));
  const np=(seg.match(/<P /g)||[]).length, nf=(seg.match(/<F[ >]/g)||[]).length;
  const zs=[...seg.matchAll(/<P [^>]*>([^<]+)<\/P>/g)].slice(0,200000).map(x=>+x[1].trim().split(/\s+/)[2]);
  const bnd=seg.match(/<SourceData[\s\S]{0,200}/);
  console.log(s[0], 'points',np,'faces',nf,'z',zs.reduce((a,b)=>Math.min(a,b),1e9).toFixed(2),'..',zs.reduce((a,b)=>Math.max(a,b),-1e9).toFixed(2));
  const p=seg.match(/<P [^>]*>([^<]+)<\/P>/); console.log('  first point (N E Z):',p&&p[1]);
}
console.log('alignments', (t.match(/<Alignment /g)||[]).length, 'profiles', (t.match(/<ProfAlign /g)||[]).length);

