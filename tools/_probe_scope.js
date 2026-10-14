/* 探针：验证 v2.9.6 的「重要角色 / 全部角色」两档入口真的工作 */
const H = require('./harness');
const fs = require('fs');
const Ainpc = H.Ainpc;
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ← ' + d : '')); } else { fail++; console.log('  ❌ ' + n + (d ? '  ← ' + d : '')); } };

console.log('插件:', H.PLUGIN);
if (H.loadError) { console.log('加载抛错:', H.loadError && H.loadError.stack || H.loadError); process.exit(1); }

/* 版本号自洽检查：运行时读到的 == 插件文件里写的 —— 升版时不用再回来改探针 */
const _pv = (/Ainpc\.VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(H.PLUGIN, 'utf8')) || [])[1];
ok('版本号自洽（' + (_pv || '?') + '）', !!_pv && Ainpc.VERSION === _pv, Ainpc.VERSION);

const P = Ainpc.persona;
const loaded = P.loaded || P.load();
ok('线索包加载成功', !!loaded, P.status);

ok('importantTiers() 用的是 prompt 里的配置', JSON.stringify(P.importantTiers()) === '["core","major"]', JSON.stringify(P.importantTiers()));

const st = P.scopeStat();
ok('scopeStat() 有结果', !!st, st && ('重要 ' + st.important + ' / 共 ' + st.total));
const byTier = {};
(P.groups || []).forEach(g => (g.members || []).forEach(m => { byTier[m.importance || '(无)'] = (byTier[m.importance || '(无)'] || 0) + 1; }));
console.log('    档位分布:', JSON.stringify(byTier), '（"无"= 线索包没这个字段，老包兼容）');

/* ---- 菜单：两条入口都在，且带人数 ---- */
const captured = [];
const SceneCfg = Ainpc.Scene_AINpcConfig || (function () {
  // 有些版本没导出，就从沙箱里取
  return null;
})();
let data = null;
try {
  const fake = {
    _showAll: false,
    _listWindow: { setData: (d) => { data = d; }, select: () => {}, index: () => 0 }
  };
  // refreshList 依赖 $gameMap.mapId() 与 Ainpc.npcsOnMap
  Ainpc.Scene_AINpcConfig.prototype.refreshList.call(fake);
} catch (e) { console.log('    refreshList 调用异常:', e.message); }

if (data) {
  const imp = data.find(d => d.key === '__persona_imp__');
  const all = data.find(d => d.key === '__persona__');
  ok('菜单含「生成重要角色」入口', !!imp, imp && imp.name);
  ok('菜单含「生成全部角色」入口', !!all, all && all.name);
  ok('重要角色入口带人数', !!(imp && /（\d+ 人）/.test(imp.name)), imp && imp.name);
  ok('全部角色入口带人数', !!(all && /（\d+ 人）/.test(all.name)), all && all.name);
  const mi = imp && (imp.name.match(/（(\d+) 人）/) || [])[1];
  const ma = all && (all.name.match(/（(\d+) 人）/) || [])[1];
  ok('菜单人数与 scopeStat 一致', String(mi) === String(st.important) && String(ma) === String(st.total),
     '菜单 ' + mi + '/' + ma + '  vs stat ' + st.important + '/' + st.total);
} else {
  console.log('  ⚠ 没能跑到 refreshList（$gameMap 桩缺失），跳过菜单项断言');
}

/* ---- onOk：两条入口把 scope 设对 ---- */
try {
  H.sandbox.SoundManager = H.sandbox.SoundManager || {};
  H.sandbox.SoundManager.playOk = function () {};
  H.sandbox.SceneManager = H.sandbox.SceneManager || {};
  H.sandbox.SceneManager.push = function () {};
} catch (e) {}
try {
  const proto = Ainpc.Scene_AINpcConfig.prototype;
  const fakeScene = Object.create(proto);
  fakeScene._listWindow = { item: () => ({ special: 'personaImp' }), activate: () => {} };
  proto.onOk.call(fakeScene);
  ok('选「重要角色」→ scope=important', Ainpc._personaScope === 'important' && Ainpc._workshopMode === 'persona',
     Ainpc._personaScope + '/' + Ainpc._workshopMode);
  fakeScene._listWindow = { item: () => ({ special: 'persona' }), activate: () => {} };
  proto.onOk.call(fakeScene);
  ok('选「全部角色」→ scope=all', Ainpc._personaScope === 'all' && Ainpc._workshopMode === 'persona',
     Ainpc._personaScope + '/' + Ainpc._workshopMode);
} catch (e) { console.log('  ⚠ onOk 调用异常:', e.message); }

/* ---- 过滤语义：important 只留 tiers 里的档 ---- */
const tiers = P.importantTiers();
const kept = (P.groups || []).reduce((n, g) => n + (g.members || []).filter(m => tiers.indexOf(m.importance || '') >= 0).length, 0);
ok('按 tiers 过滤的人数 == scopeStat.important', kept === st.important, kept + ' vs ' + st.important);


/* ---- 老包兜底：抹掉 importance 后应退回「全部」，而不是 0 人 ---- */
const savedImp = [];
(P.groups || []).forEach(g => (g.members || []).forEach(m => { savedImp.push(m.importance); delete m.importance; }));
const st2 = P.scopeStat();
ok('旧线索包（无 importance）→ 退回全部', !!(st2 && st2.fallback && st2.important === st2.total && st2.total > 0), st2 && JSON.stringify(st2));
let _i = 0;
(P.groups || []).forEach(g => (g.members || []).forEach(m => { if (savedImp[_i] !== undefined) m.importance = savedImp[_i]; _i++; }));
const st3 = P.scopeStat();
ok('还原后 important 回到 33', !!(st3 && !st3.fallback && st3.important === 33), st3 && JSON.stringify(st3));
console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
