const fs=require('fs');
const R=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function cmp(tag, oldP, newP){
  const A=R(oldP),B=R(newP);
  const fa=A.groups.flatMap(g=>g.members), fb=B.groups.flatMap(g=>g.members);
  console.log('════',tag,'════ 成员',fa.length,'->',fb.length);
  if(fa.length!==fb.length){console.log('  ❌ 成员数不同！');return;}
  // 逐字段
  const fd={}; let keyDiff=0;
  for(let i=0;i<fa.length;i++){
    if(fa[i].key!==fb[i].key){keyDiff++;}
    const ks=new Set([...Object.keys(fa[i]),...Object.keys(fb[i])]);
    ks.forEach(k=>{ if(JSON.stringify(fa[i][k])!==JSON.stringify(fb[i][k])) fd[k]=(fd[k]||0)+1; });
  }
  console.log('  key 顺序差异:',keyDiff);
  console.log('  成员字段差异:',JSON.stringify(fd));
  // 组结构
  const ga=A.groups.map(g=>g.groupId+'|'+g.title+'|'+g.members.length);
  const gb=B.groups.map(g=>g.groupId+'|'+g.title+'|'+g.members.length);
  console.log('  组结构:', JSON.stringify(ga)===JSON.stringify(gb)?'✓ 完全一致':'❌ 有差异');
  // stats（除 dropped 文案）
  const ka=Object.keys(A.stats),kb=Object.keys(B.stats);
  console.log('  stats 键:', kb.filter(k=>!ka.includes(k)).length===0&&ka.filter(k=>!kb.includes(k)).length===0?'✓ 一致':'❌ 变了');
  ka.forEach(k=>{ if(k!=='dropped'&&JSON.stringify(A.stats[k])!==JSON.stringify(B.stats[k])) console.log('    stats.'+k+':',JSON.stringify(A.stats[k]),'->',JSON.stringify(B.stats[k])); });
  // dropped 形态
  console.log('  dropped 条数:', (A.dropped||[]).length, '->', (B.dropped||[]).length);
  console.log('  dropped 首条:', JSON.stringify((B.dropped||[])[0]));
  console.log('  dropped 字段:', JSON.stringify(Object.keys((B.dropped||[])[0]||{})));
}
cmp('Mira','D:/Mira and the Mysteries of Alchemy v1.00(1)/www/ai_npc/persona_input.json','_nh/m.json');
console.log('');
cmp('Eliza','D:/AAAAAふたなり魔物使いエリザ 扶他那里魔驯兽师伊丽莎 [官中]/[水底3000m] ふたなり魔物使いエリザ 扶他那里魔驯兽师伊丽莎 [官中]/扶他那里魔驯兽师伊丽莎/www/ai_npc/persona_input.json','_nh/e.json');
