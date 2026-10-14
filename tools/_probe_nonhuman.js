/* 探针：非人素材判据通用化（v2.9.8）
 *   ① 判据直接从源码提取 —— 保证测的就是实际跑的那套，不复制第二份
 *   ② 通用素材名覆盖度（引擎自带 / 物件 / 特效 / 素材表）
 *   ③ 真人名绝不能误杀（尤其 Mob_Uniform —— 名字里有 Mob）
 *   ④ 两部真实游戏：Eliza 命中 3 类、Mira 零命中
 *   ⑤ 已知缺口如实列出（含中/日文物件名不覆盖，靠 --nonHuman= 兜）
 */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'orig_tools/build_persona_input.js'), 'utf8');
const rx = (name) => {
  const m = new RegExp('const ' + name + " = (/.+?/[i]?);").exec(SRC);
  if (!m) throw new Error('源码里找不到 ' + name);
  return eval(m[1]);
};
const EXACT = rx('NON_HUMAN_EXACT'), WORDS = rx('NON_HUMAN_WORDS');
console.log('判据（从源码提取）：');
console.log('  EXACT =', EXACT);
console.log('  WORDS =', WORDS);
console.log('');

let pass = 0, fail = 0;
const hit = (s) => EXACT.test(s) || WORDS.test(s);
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ← ' + d : '')); } else { fail++; console.log('  ❌ ' + n + (d ? '  ← ' + d : '')); } };

console.log('① 通用素材名 —— 应该命中');
[['Damage1', '引擎伤害数字'], ['Damage3', '引擎伤害数字'], ['Nature', '引擎自然景物'], ['Vehicle', '引擎载具'],
 ['Shadow', '影子'], ['Transparent', '透明占位'],
 ['mom_object01', '物件'], ['Scene_Object', '物件'], ['furniture_01', '家具'], ['Deco_Flower', '装饰'],
 ['Effect_Fire', '特效'], ['Particle_Smoke', '粒子'],
 ['MVenemies_02', '战斗素材表'], ['Battler_Dragon', '战斗图'], ['$FloatActor1', '漂浮物'],
 ['Marker_Goal', '标记']
].forEach(([s, why]) => ok(s + '（' + why + '）', hit(s), hit(s) ? '命中' : '漏'));

console.log('');
console.log('② 真人名 —— 绝不能误杀');
[['Actor1', '引擎主角图'], ['People4', ''], ['hero', ''], ['heroine001', ''], ['Witch_C', ''],
 ['Maid_A', ''], ['Mob_Uniform_A', '★ 名字含 Mob，必须不命中'], ['Mob_Uniform_V', '★ 同上'],
 ['Slime', 'Mira 的魔物 NPC'], ['Bats', 'Mira 的魔物 NPC'], ['Fairy1', 'Mira 的魔物 NPC'],
 ['$Holstaulosmob', '★ 含 mob，必须不命中'], ['!$field', 'Mira 的田地（带商人标记，是交互物）'],
 ['old_Actor1', ''], ['Evil', ''], ['MOM_sub_Wolf', '★ 含 MOM，必须不命中']
].forEach(([s, why]) => ok(s + (why ? '（' + why + '）' : ''), !hit(s), hit(s) ? '误杀！' : '保留'));

console.log('');
console.log('③ 已知缺口（判据不覆盖，需要 --nonHuman= 兜）');
const gaps = ['Chair01', 'Table', 'Tree1', 'Rock', 'TV', '椅子', '机'];
gaps.forEach((s) => console.log('      · ' + s + ' —— 不命中：' + (!hit(s) ? '是（用 --nonHuman= 补）' : '居然命中了')));
console.log('      ⇒ 这些漏掉的后果很轻：它们会落进 important=extra 档，');
console.log('        「生成重要角色人设」默认不写它们，所以只是多占一点索引，不会浪费额度。');

console.log('');
console.log('④ 与两部真实游戏的实际判定对照（读世界书 + 判据）');
const GAMES = [
  ['Eliza', 'D:/AAAAAふたなり魔物使いエリザ 扶他那里魔驯兽师伊丽莎 [官中]/[水底3000m] ふたなり魔物使いエリザ 扶他那里魔驯兽师伊丽莎 [官中]/扶他那里魔驯兽师伊丽莎/www/ai_npc/worldbook.json'],
  ['Mira',  'D:/Mira and the Mysteries of Alchemy v1.00(1)/www/ai_npc/worldbook.json']
];
GAMES.forEach(([tag, p]) => {
  const wb = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  const names = [...new Set((wb.npcs || []).filter((n) => n.aiHint !== 'system' && n.aiHint !== 'persona-only').map((n) => n.charName || '').filter(Boolean))];
  const got = names.filter(hit);
  console.log('   ' + tag + '：立绘 ' + names.length + ' 个 → 判为非人 ' + got.length + ' 个  ' + JSON.stringify(got.sort()));
});

console.log('');
console.log('================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
