/* 探针：地点解析（v2.9.8）
 *   ① 插件手抄本 Ainpc.parsePlaceName  vs  真源 tools/place_names.js —— 两部游戏逐张地图必须一致
 *   ② 编号派/路径派/通用派/降级 的手工用例
 *   ③ 产物侧：旧内联版的两处老 bug 确认已修
 */
const fs = require('fs');
const H = require('./harness');
const Ainpc = H.Ainpc;
const PN = require('./orig_tools/place_names.js');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ← ' + d : '')); } else { fail++; console.log('  ❌ ' + n + (d ? '  ← ' + d : '')); } };

console.log('插件:', H.PLUGIN);
if (H.loadError) { console.log('加载抛错:', H.loadError && H.loadError.stack || H.loadError); process.exit(1); }
/* 版本号自洽检查：运行时读到的 == 插件文件里写的 —— 升版时不用再回来改探针 */
const _pv = (/Ainpc\.VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(H.PLUGIN, 'utf8')) || [])[1];
ok('版本号自洽（' + (_pv || '?') + '）', !!_pv && Ainpc.VERSION === _pv, Ainpc.VERSION);

/* ---------- ① 逐张地图：插件 vs 真源 ---------- */
const GAMES = [
  ['Eliza', 'D:/AAAAAふたなり魔物使いエリザ 扶他那里魔驯兽师伊丽莎 [官中]/[水底3000m] ふたなり魔物使いエリザ 扶他那里魔驯兽师伊丽莎 [官中]/扶他那里魔驯兽师伊丽莎/www/ai_npc/worldbook.json'],
  ['Mira',  'D:/Mira and the Mysteries of Alchemy v1.00(1)/www/ai_npc/worldbook.json']
];
GAMES.forEach(([tag, p]) => {
  const wb = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  const paths = wb.mapPaths || {};
  const ids = Object.keys(paths);
  const bad = [];
  ids.forEach(id => {
    const raw = paths[id];
    const a = Ainpc.parsePlaceName(raw);
    const b = PN.parsePlace(raw);
    if (a !== b) bad.push({ id, raw, plugin: a, src: b });
  });
  ok(tag + ' 插件手抄本 == 真源（' + ids.length + ' 张）', bad.length === 0,
     bad.length ? JSON.stringify(bad.slice(0, 3)) : '逐张一致');
});

/* ---------- ② 手工用例 ---------- */
const CASES = [
  /* 路径派（伊莉莎）—— 必须与旧版一致 */
  ['MAP010/area01_hel_town_in_church_1F_01', '赫尔镇 · 教堂'],
  ['MAP015/area01_hel_town_in_INN_1F_01', '赫尔镇 · 旅店'],
  ['MAP009/area01_hel_town_out_map01', '赫尔镇 · 街道'],
  ['MAP003/area00_wolrd', '世界地图'],
  ['MAP001/Game', '主线剧情演出场景'],
  /* 编号派（Mira）—— 新增能力 */
  ['004：校門', '校门'],
  ['001：アウイル / 002：学校 / 004：校門', 'アウイル › 学校 › 校门'],
  ['001：アウイル / 002：学校 / 011-1：教室1', 'アウイル › 学校 › 教室1'],
  ['001：アウイル / 001：街 / 007：南区 / 008：ミラ自宅 / 009：一階：玄関', 'アウイル › 街道 › 南区 › ミラ自宅 › 一层 › 玄关'],
  ['124:テンプレートマップ', '模板地图'],
  /* 降级：parsePlaceName 的契约就是「认不出返回空串」，由调用方兜底成原文 */
  ['', ''],
  ['某部没见过的图', ''],
  ['   ', '']
];
CASES.forEach(([raw, want]) => {
  const got = Ainpc.parsePlaceName(raw);
  ok('parsePlaceName(' + JSON.stringify(raw) + ')', got === want, JSON.stringify(got) + (got === want ? '' : '  ≠ ' + JSON.stringify(want)));
});

/* ---------- ③ 旧内联版两处老 bug 确认已修 ---------- */
/* bug1: `_in` 子串命中 `_in_church`，给教堂加「室内」 */
ok('不再给教堂加「室内」', Ainpc.parsePlaceName('MAP010/area01_hel_town_in_church_1F_01') === '赫尔镇 · 教堂',
   Ainpc.parsePlaceName('MAP010/area01_hel_town_in_church_1F_01'));
/* bug2: indexOf 切片吃掉首段前导下划线，dungeon_map01 认不出「地牢」 */
ok('地下城地图认得出「地牢」', /地牢/.test(Ainpc.parsePlaceName('MAP061/area02_alt_dungeon_map01')),
   Ainpc.parsePlaceName('MAP061/area02_alt_dungeon_map01'));

/* ---------- ④ parsePlaceInfo 结构化（真源）---------- */
const info = PN.parsePlaceInfo('001：アウイル / 002：学校 / 004：校門');
ok('parsePlaceInfo.area = 链首地名', info.area === 'アウイル', info.area);
ok('parsePlaceInfo.style = label', info.style === 'label', info.style);
ok('parsePlaceInfo.chain 保留原始链', Array.isArray(info.chain) && info.chain.length === 3, JSON.stringify(info.chain));
const pinfo = PN.parsePlaceInfo('MAP006/area09_gasB_dungeon_res_map01');
ok('路径派 area 仍是 areaNN', pinfo.area === 'area09', pinfo.area);
ok('路径派 style = path', pinfo.style === 'path', pinfo.style);

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
