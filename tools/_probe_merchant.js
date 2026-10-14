/* eslint-disable */
/**
 * v2.9.11 回归：**假货架不许冒充真柜台**。
 *
 * 背景：本作（Mira）**所有** `shop` 都来自同一个 CE41 派发器 ——
 *   128 个条目里只有 7 个带 `branch`（真柜台），其余 121 个是共用派发器的
 *   学生 / 魔物 / 普通居民，扫描器把 CE41 里的 302 记在了它们头上。
 *   v2.9.10 只把 `isMerchant()` 改成看 `hasRealShop()`；
 *   可 `shop` 字段与 `shop_menu` 标签还被另外几处**直接读**：
 *     placeOf / temperOf / ROLE_SPECIALS / buildChoices / menuMerchant / pocketTier / 条目详情。
 *   最刺眼的后果：提示词对一个校服学生写「你在这里开店卖东西，客人上门就是买卖」，
 *   模型于是演店主（实测台词：「我这摊子上的东西可不便宜」），
 *   菜单里还长出「买东西 / 讲讲价 / 偷东西 / 动手抢」。
 *
 * 这个探针钉住**两个方向**：
 *   ① 121 个假货架：一律不许再被当成商人（场合、脾气、菜单、口令、摸口袋、详情）；
 *   ② 7 个真货架：判定一个字都不许变（真商人不能被误伤）。
 * 另外证明**世界书数据一个字没动** —— 改的只是读它的代码。
 *
 * 用法：node _probe_merchant.js [--www=<游戏的 www 目录>]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const wwwArgIn = (process.argv.slice(2).filter(function (a) { return a.indexOf('--www=') === 0; })[0] || '').split('=')[1];
/* 不给 --www 时默认找 Mira（样本全取自它的世界书）。 */
let wwwArg = wwwArgIn;
if (!wwwArg) {
    ['D:/Mira and the Mysteries of Alchemy v1.00(1)/www', path.join(__dirname, 'www')].some(function (p) {
        if (fs.existsSync(path.join(p, 'js/plugins/RM_AI_NPC.js'))) { wwwArg = p; return true; }
        return false;
    });
}
process.argv = ['node', 'harness.js'].concat(wwwArg ? ['--www=' + wwwArg] : []);
const H = require('./harness.js');
const WWW = H.WWW;
const sandbox = H.sandbox, Ainpc = H.Ainpc;
if (H.loadError) { console.error('插件加载失败：', H.loadError.message); process.exit(1); }

let pass = 0, fail = 0;
function ok(n, extra) { pass++; console.log('  ✓ ' + n + (extra ? '  ← ' + extra : '')); }
function bad(n, extra) { fail++; console.log('  ❌ ' + n + (extra ? '  ← ' + extra : '')); }

const wb = JSON.parse(fs.readFileSync(path.join(WWW, 'ai_npc/worldbook.json'), 'utf8').replace(/^\uFEFF/, ''));
const npcs = wb.npcs || wb.entries || [];
const shopNpcs = npcs.filter(function (n) { return n.shop; });
const real = shopNpcs.filter(function (n) {
    const s = n.shop;
    return (s.goods && s.goods.length) || (s.branch !== undefined && s.branch !== null);
});
const fake = shopNpcs.filter(function (n) {
    const s = n.shop;
    return !((s.goods && s.goods.length) || (s.branch !== undefined && s.branch !== null));
});

console.log('样本：带 shop 的条目 ' + shopNpcs.length + ' 条 ｜ 真货架（goods/branch） ' + real.length +
    ' ｜ 假货架（共用派发器） ' + fake.length);
if (!fake.length) {
    console.log('这部游戏没有「共用派发器假货架」这种东西（世界书里没有这种条目）——跳过全部用例。');
    process.exit(0);
}

/** 这个人现在给不给得出买卖那套（照着插件自己的口径算，不另立标准） */
function menuHasTrade(key) {
    const npc = Ainpc.npcByKey(key);
    const a = { key: key, npc: npc, goods: null, discount: 1, face: null, profile: Ainpc.profileOf(key) || {} };
    let ch = [];
    try { ch = Ainpc.buildChoices(a) || []; } catch (e) { return { err: e.message, keys: [] }; }
    return { keys: ch.map(function (c) { return c && c.key; }) };
}
const TRADE_KEYS = ['buy', 'haggle', 'steal', 'rob'];

/* ═════════════════ ① 假货架：一律不许再当商人 ═════════════════ */
console.log('\n== ① 121 个假货架不再被当成商人 ==');
const shopIntro = Ainpc.t('place.intro.shop');
/* 拿一个真商人当对照：它就是「贪婪」那一档，假货架必须与它不同。 */
const GREEDY = real.length ? Ainpc.temperOf(real[0].key) : null;
let badPlace = [], badTemper = [], badMenu = [], badIntro = [], badPocket = [], badReal = 0;
fake.forEach(function (n) {
    const key = n.key;
    if (Ainpc.hasRealShop(n)) badReal++;
    if (Ainpc.isMerchant(n)) badReal++;
    if (Ainpc.placeOf(key) === 'shop') badPlace.push(key);
    if (GREEDY && Ainpc.temperOf(key) === GREEDY) badTemper.push(key);
    if (menuHasTrade(key).keys.some(function (k) { return TRADE_KEYS.indexOf(k) >= 0; })) badMenu.push(key);
    if (Ainpc.placeIntro(key) === shopIntro) badIntro.push(key);
    if (Ainpc.pocketTier(key, n).id === 'merchant') badPocket.push(key);
});
function gate(name, list, sampleOf) {
    if (!list.length) ok(name, '全部 ' + fake.length + ' 条通过');
    else bad(name, list.length + ' 条没通过：' + list.slice(0, sampleOf || 5).join(', ') +
        (list.length > (sampleOf || 5) ? ' …' : ''));
}
gate('场合不再判成「商店」', badPlace);
gate('脾气不再是「贪婪」', badTemper);
gate('菜单里不再有 买卖/讲价/偷/抢', badMenu);
gate('提示词不再写「你在这里开店卖东西」', badIntro);
gate('摸口袋不再按商人上限算', badPocket);
if (!badReal) ok('hasRealShop / isMerchant 对假货架一律 false');
else bad('有假货架仍被判成商人', badReal + ' 条');

/* 抽样把最刺眼的几个点名报出来，方便肉眼复核 */
console.log('\n  抽样（学生 / 魔物各取一个）：');
fake.filter(function (n) { return /学生|魔物/.test(String(n.role)); }).slice(0, 3).forEach(function (n) {
    console.log('    ' + n.key + ' ' + n.name + '（' + n.role + '）→ 场合=' + Ainpc.placeOf(n.key) +
        ' 脾气与真商人相同=' + (Ainpc.temperOf(n.key) === GREEDY) +
        ' 菜单=[' + menuHasTrade(n.key).keys.join(',') + ']');
});

/* ═════════════════ ② 真货架：一个字都不许变 ═════════════════ */
console.log('\n== ② 7 个真货架（梦境素材摊）判定不变 ==');
console.log('  名单：' + real.map(function (n) { return n.key + '(branch=' + n.shop.branch + ')'; }).join('  '));
real.forEach(function (n) {
    const key = n.key;
    const problems = [];
    if (!Ainpc.hasRealShop(n)) problems.push('hasRealShop=false');
    if (!Ainpc.isMerchant(n)) problems.push('isMerchant=false');
    if (Ainpc.placeOf(key) !== 'shop') problems.push('场合=' + Ainpc.placeOf(key));
    if (Ainpc.pocketTier(key, n).id !== 'merchant') problems.push('摸口袋=' + Ainpc.pocketTier(key, n).id);
    const ks = menuHasTrade(key).keys;
    if (!ks.some(function (k) { return TRADE_KEYS.indexOf(k) >= 0; })) problems.push('菜单没有买卖项：[' + ks.join(',') + ']');
    if (problems.length) bad(key + ' ' + n.name + ' 判定被改坏了', problems.join(' / '));
    else ok(key + ' ' + n.name + ' 仍是商人（场合=商店、菜单有买卖、摸口袋=商人）');
});

/* ═════════════════ ③ 世界书数据一个字没动 ═════════════════ */
console.log('\n== ③ 数据没被改（改的是读它的人）==');
fake.slice(0, 5).forEach(function (n) {
    const stillHasShop = !!n.shop && n.shop.commonEvent === 41;
    const stillHasTag = (n.tags || []).indexOf('shop_menu') >= 0;
    if (stillHasShop && stillHasTag) ok(n.key + ' 世界书里仍有 shop=CE41 与 shop_menu 标签（原样保留）');
    else bad(n.key + ' 世界书被改动了', 'shop=' + JSON.stringify(n.shop) + ' tags=' + JSON.stringify(n.tags));
});
/* 反过来：真货架的 merchant 标签不该被 merchantTags 摘掉 */
real.forEach(function (n) {
    const after = Ainpc.merchantTags(n);
    const same = after.length === (n.tags || []).length;
    if (same) ok(n.key + ' 真货架的标签照旧（merchantTags 不碰真货架）');
    else bad(n.key + ' 真货架的标签被摘了', JSON.stringify(n.tags) + ' → ' + JSON.stringify(after));
});

/* ═════════════════ ④ 自由输入的口令 ═════════════════ */
console.log('\n== ④ 自由发言里打「买」「偷」不再被当口令接走 ==');
(fake.slice(0, 3).concat(real.slice(0, 1))).forEach(function (n) {
    const npc = Ainpc.npcByKey(n.key);
    const isReal = real.indexOf(n) >= 0;
    const a = { key: n.key, npc: npc, goods: null, discount: 1, profile: Ainpc.profileOf(n.key) || {} };
    let word = '';
    try { word = Ainpc.matchMenuWord('我要买东西', a) || ''; } catch (e) { }
    if (isReal) {
        if (word === 'buy') ok(n.key + '（真商人）「我要买东西」仍被认成买卖口令');
        else bad(n.key + '（真商人）口令丢了', 'word=' + JSON.stringify(word));
    } else {
        if (!word) ok(n.key + '（假货架）「我要买东西」不再被认成口令');
        else bad(n.key + '（假货架）仍被认成口令', 'word=' + word);
    }
});

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
