/* _probe_actor.js —— v2.9.9「+actorN 指名角色」收录与性质判定的探针
 *
 * 做法与 v2.9.8 的 _probe_nonhuman.js 一致：判据常量与函数**从
 * orig_tools/scan_game.js 的源码文本里提取后 eval** —— 测的就是实际跑的那份，
 * 不是抄一遍（抄一遍就会出现"探针全绿、跑起来全错"）。
 *
 * 用法: node _probe_actor.js [游戏目录]
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 开发目录里读 ES6 主源；随包分发后目录里只有 ES5 产物，就退回同目录的 scan_game.js */
const SRC_PATH = fs.existsSync(path.join(__dirname, 'orig_tools', 'scan_game.js'))
  ? path.join(__dirname, 'orig_tools', 'scan_game.js')
  : path.join(__dirname, 'scan_game.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/* ── 从源码里抠出判据 ─────────────────────────────────────────── */
function grabConst(name) {
  const m = new RegExp('^const ' + name + '\\s*=\\s*(.+?);\\s*$', 'm').exec(SRC);
  if (!m) throw new Error('源码里找不到常量 ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
}
function sliceFn(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('源码里找不到函数 ' + name);
  let depth = 0, k = SRC.indexOf('{', i);
  const start = i;
  for (; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
  }
  return SRC.slice(start, k + 1);
}
const CONSTS = ['NONHUMAN_SPRITE_GENERIC', 'NONHUMAN_SPRITE_WORDS', 'NONHUMAN_SPRITE_MOB',
  'NONHUMAN_SPRITE_TITLE', 'NONHUMAN_ACTOR_NAME'];

/** 用给定的逃生舱参数，把源码里的判据装载出来 */
function loadJudge(keepActor, dropActor) {
  const code = [
    ...CONSTS.map(grabConst),
    'const ARGS = ' + JSON.stringify({ keepActor: keepActor || [], dropActor: dropActor || [] }) + ';',
    sliceFn('actorDisplayName'),
    sliceFn('spriteIsNonHuman'),
    'return { spriteIsNonHuman: spriteIsNonHuman, actorDisplayName: actorDisplayName };'
  ].join('\n');
  return new Function(code)();
}
const J = loadJudge([], []);

/* ── 用例（先钉死几个必须成立的断言）────────────────────────── */
let pass = 0, fail = [];
function eq(label, got, want) {
  if (got === want) { pass++; return; }
  fail.push(label + '  期望=' + JSON.stringify(want) + '  实际=' + JSON.stringify(got));
}
const isHuman = (id, cn, an) => J.spriteIsNonHuman(id, cn, an) === '';

/* 用户报的那张图：两位真角色必须判为「人」 */
eq('map011 E19 罗谢（heroine002 / actor3）是人', isHuman(3, 'heroine002', 'ロシェ'), true);
eq('map011 E7  埃斯梅拉达（heroine003 / actor4）是人', isHuman(4, 'heroine003', 'エスメラルダ'), true);
/* 4 个校服学生：不带 +actorN，但立绘名绝不能命中判据（否则 v2.9.8 的收尾会误杀） */
eq('Mob_Uniform_A（学生）不是素材', J.spriteIsNonHuman(null, 'Mob_Uniform_A', ''), '');
/* 怪物必须被判为素材 */
eq('Bats（蝙蝠）是素材', J.spriteIsNonHuman(11, 'Bats', 'コウモリ') !== '', true);
eq('Slime（史莱姆）是素材', J.spriteIsNonHuman(12, 'Slime', 'スライム') !== '', true);
eq('mob06（敌6）是素材', J.spriteIsNonHuman(16, 'mob06', '敵6') !== '', true);
eq('Werewolf 是素材', J.spriteIsNonHuman(24, 'Werewolf', 'ワーウルフ') !== '', true);
/* 人形角色（同族）不能被误杀 */
eq('heroine006（グラナ）是人', isHuman(6, 'heroine006', 'グラナ'), true);
eq('Maid_A（女仆）是人', isHuman(9, 'Maid_A', 'メイドＡ'), true);
eq('Witch_G（魔女）是人', isHuman(30, 'Witch_G', 'まちはずれ2：魔女1'), true);
eq('Pharmacy（药剂店）是人', isHuman(33, 'Pharmacy', 'ポーション屋'), true);
eq('Fairy1（妖精）是人', isHuman(7, 'Fairy1', '妖精'), true);
eq('Fox（狐娘）是人', isHuman(8, 'Fox', '狐娘'), true);
eq('!$hon24（おなほ）是人', isHuman(32, '!$hon24', 'まちはずれ2：おなほ'), true);
/* `!$` 大图里的摆件：名字含 plant → 素材 */
eq('!$ThePlantofMagic（魔精植物）是素材', J.spriteIsNonHuman(34, '!$ThePlantofMagic', '道具屋奥地：魔精植物') !== '', true);
/* 无立绘 → 不判素材（交给 hasSprite 去判 system） */
eq('无立绘不判素材', J.spriteIsNonHuman(34, '', '道具屋奥地：魔精植物'), '');

/* ── 逃生舱 ─────────────────────────────────────────────────── */
const JK = loadJudge(['11'], []);
eq('--keepActor=11 放行蝙蝠', JK.spriteIsNonHuman(11, 'Bats', 'コウモリ'), '');
const JK2 = loadJudge(['Bats'], []);
eq('--keepActor=Bats（按素材名）放行', JK2.spriteIsNonHuman(11, 'Bats', 'コウモリ'), '');
const JD = loadJudge([], ['4']);
eq('--dropActor=4 剔除埃斯梅拉达', JD.spriteIsNonHuman(4, 'heroine003', 'エスメラルダ') !== '', true);

/* ── actorDisplayName（地图限定前缀剥离）────────────────────── */
eq('剥离地图前缀「まちはずれ2：魔女1」', J.actorDisplayName('まちはずれ2：魔女1'), '魔女1');
eq('剥离全角冒号「道具屋奥地：魔精植物」', J.actorDisplayName('道具屋奥地：魔精植物'), '魔精植物');
eq('普通名字原样', J.actorDisplayName('ロシェ'), 'ロシェ');

/* ── 全盘实跑：对正文 46 个 +actorN 事件逐条判定 ────────────── */
const gameArg = process.argv[2] || 'D:/Mira and the Mysteries of Alchemy v1.00(1)';
const DATA = path.join(gameArg, 'www', 'data');
let stats = { total: 0, human: 0, nonhuman: 0, noSprite: 0 };
let detail = [];
if (fs.existsSync(DATA)) {
  const A = JSON.parse(fs.readFileSync(path.join(DATA, 'Actors.json'), 'utf8').replace(/^\uFEFF/, ''));
  const files = fs.readdirSync(DATA).filter(f => /^Map\d+\.json$/.test(f));
  for (const f of files) {
    let m; try { m = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { continue; }
    for (const ev of (m.events || [])) {
      if (!ev) continue;
      let actor = null;
      (ev.pages || []).forEach(pg => (pg.list || []).forEach(c => {
        if (c.code !== 108 && c.code !== 408) return;
        const s = String((c.parameters || [])[0] == null ? '' : (c.parameters || [])[0]).trim();
        const mm = s.match(/^\+actor[\s_]*([0-9]+)/i);
        if (mm) actor = +mm[1];
      }));
      if (actor == null) continue;
      stats.total++;
      const a = A[actor] || {};
      /* 与扫描器同一口径：**Actors 表优先**（这就是 +actorN 补正），未命中才退回事件页原立绘。
       * 反过来写会漏掉「事件本来就带立绘、Actors 表反而空」的情况（如魔精植物）。 */
      const pageCn = ((((ev.pages || [])[0] || {}).image || {}).characterName) || '';
      const cn = a.characterName || pageCn;
      const an = J.actorDisplayName(a.name || '');
      const why = J.spriteIsNonHuman(actor, cn, an);
      if (!cn) stats.noSprite++; else if (why) stats.nonhuman++; else stats.human++;
      detail.push({ f, id: ev.id, actor, cn, an, why });
    }
  }
}

/* 断言：那两个必须收成"人"的，在全盘明细里确实是人 */
const m11 = detail.filter(d => d.f === 'Map011.json');
eq('Map011 全盘：E19 判为人', (m11.find(d => d.id === 19) || {}).why, '');
eq('Map011 全盘：E7  判为人', (m11.find(d => d.id === 7) || {}).why, '');

/* ── 输出 ───────────────────────────────────────────────────── */
console.log('\n用例: ' + pass + ' 通过 / ' + fail.length + ' 失败');
if (fail.length) fail.forEach(x => console.log('  ✗ ' + x));
console.log('\n全盘 +actorN 事件: ' + stats.total
  + '  → 人形角色 ' + stats.human
  + ' / 判为素材 ' + stats.nonhuman
  + ' / 无立绘 ' + stats.noSprite);
if (detail.length) {
  console.log('\n判为素材的（应全是怪物 / 摆件）:');
  detail.filter(d => d.why).forEach(d => console.log('   ' + d.f.padEnd(16) + 'E' + String(d.id).padEnd(4)
    + ('#' + d.actor).padEnd(6) + (d.cn || '(空)').padEnd(22) + d.an.padEnd(14) + '—— ' + d.why));
  const noSprite = detail.filter(d => !d.cn);
  if (noSprite.length) {
    console.log('\n无立绘（交给 hasSprite 判 system，不参与素材判定）:');
    noSprite.forEach(d => console.log('   ' + d.f.padEnd(16) + 'E' + String(d.id).padEnd(4)
      + ('#' + d.actor).padEnd(6) + d.an + '   （Actors 表里该编号无立绘）'));
  }
}
process.exit(fail.length ? 1 : 0);
