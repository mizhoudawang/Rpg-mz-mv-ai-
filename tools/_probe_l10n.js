#!/usr/bin/env node
'use strict';
/* ============================================================================
 * _probe_l10n.js —— 本地化占位符还原（v2.9.17）守门员
 * ----------------------------------------------------------------------------
 * 【为什么需要】
 * 《Knights of Messiah IF》用 ODW_MultiLanguageSystem 把**所有正文**换成了 `${code}`，
 * 真值在 <游戏根>/languages/<语言>/*.json。不还原的话：
 *   · 人名显示成 `${text.message101000}`；
 *   · 整份语料是 512 种 `${text.xxx}`，AI 拿它写世界观 = 纯编。
 * 实测那一款：世界书里 512 个占位符，**512/512 都能在语言表里找到**。
 *
 * 【这个探针盯两件事】
 *   ① 还原本身对不对（含：未知 code 不瞎猜、嵌套 code 递归、语言选择优先级）；
 *   ② **零回归红线**：没有语言表的游戏，产物必须逐字节不变 ——
 *      这条最容易在"顺手加个字段"时被破坏，所以专门有两组断言盯着。
 *
 * 用法：
 *   node _probe_l10n.js
 *   node _probe_l10n.js --tools=tools_es5_307      # 指定被测工具目录（默认 tools_es5_307）
 *   node _probe_l10n.js --keep                     # 保留临时目录，方便人工看产物
 * 退出码 = 失败数。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = __dirname;
const ARGS = process.argv.slice(2);
const argOf = (n, d) => { const a = ARGS.find(x => x.indexOf('--' + n + '=') === 0); return a ? a.slice(n.length + 3) : d; };
/* 默认工具目录：发行包里 tools/ 就是本文件所在目录；
 * 工作区里源码与 ES5 产物分家，自动挑最新的 tools_es5_*，也能用 --tools= 显式指定。 */
const TOOLS = (function () {
    const given = argOf('tools', '');
    if (given) return path.resolve(HERE, given);
    if (fs.existsSync(path.join(HERE, 'l10n.js'))) return HERE;
    const cands = [];
    try {
        fs.readdirSync(HERE).forEach(d => {
            if (/^tools_es5_\d+$/.test(d) && fs.existsSync(path.join(HERE, d, 'l10n.js'))) cands.push(d);
        });
    } catch (e) { }
    cands.sort();
    return cands.length ? path.join(HERE, cands[cands.length - 1]) : HERE;
})();
const KEEP = ARGS.indexOf('--keep') >= 0;

let pass = 0, fail = 0;
function t(name, fn) {
    try {
        const r = fn();
        if (r === false) { fail++; console.log('  ❌ ' + name); return; }
        pass++;
        console.log('  ✓ ' + name + (r === undefined || r === true ? '' : '  ← ' + String(r).slice(0, 200)));
    } catch (e) { fail++; console.log('  ❌ ' + name + '  抛异常: ' + e.message); }
}
function eq(name, got, want) {
    const g = typeof got === 'string' ? got : JSON.stringify(got);
    const w = typeof want === 'string' ? want : JSON.stringify(want);
    if (g === w) { pass++; console.log('  ✓ ' + name + '  ← ' + g.slice(0, 140)); }
    else { fail++; console.log('  ❌ ' + name + '\n      期望: ' + w.slice(0, 200) + '\n      实际: ' + g.slice(0, 200)); }
}

/* ---------------------------------------------------------------- 小工具 */
const T = path.join(os.tmpdir(), 'ainpc_l10n_probe');
function rmrf(p) { try { fs.rmSync ? fs.rmSync(p, { recursive: true, force: true }) : null; } catch (e) { } }
function W(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); }
function WJ(p, o) { W(p, JSON.stringify(o, null, 1)); }

/** 就地跑一个 tools/ 下的脚本 —— 与「游戏内一键生成」跑的是同一种方式：
 *  剥 shebang、new Function 包起来、喂假的 process/console（游戏内本来也不 spawn）。 */
function run(script, args) {
    const file = path.join(TOOLS, script);
    const dir = path.dirname(file);
    const src = fs.readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, '');
    const out = [];
    const fakeConsole = {
        log: function () { out.push(Array.prototype.join.call(arguments, ' ')); },
        error: function () { out.push(Array.prototype.join.call(arguments, ' ')); },
        warn: function () { out.push('[warn] ' + Array.prototype.join.call(arguments, ' ')); }
    };
    const fakeProcess = {
        argv: ['node', script].concat(args), env: {}, platform: process.platform,
        exit: function (c) { throw new Error('TOOL_EXIT:' + c); }
    };
    const mod = { exports: {} };
    const req = function (id) { return require(id.indexOf('.') === 0 ? path.resolve(dir, id) : id); };
    const fn = new Function('require', 'process', 'console', 'module', 'exports',
        '__dirname', '__filename', 'Buffer', 'setTimeout', 'clearTimeout', src);
    fn(req, fakeProcess, fakeConsole, mod, mod.exports, dir, file, Buffer, setTimeout, clearTimeout);
    return out.join('\n');
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; } }

rmrf(T);
console.log('被测工具：' + TOOLS + '\n临时目录：' + T + '\n');

const L10N = require(path.join(TOOLS, 'l10n.js'));

/* ==========================================================================
 * 一、API：语言表发现与选择
 * ======================================================================== */
console.log('== ① API：语言表发现与选择 ==');
const g1 = path.join(T, 'classic', 'www');          // 经典布局 <root>/www
WJ(path.join(g1, 'data', 'System.json'), { gameTitle: '测试', locale: 'ja_JP' });
WJ(path.join(g1, 'languages', 'jpn', 'main.json'), { 'text.a': 'アリシア', 'text.b': '${text.a}乙', 'text.c': 'セリス' });
WJ(path.join(g1, 'languages', 'chn', 'main.json'), { 'text.a': '艾莉西亞', 'text.b': '${text.a}乙', 'text.c': '賽利斯' });

const A = L10N.load({ root: path.join(T, 'classic'), www: g1 });
eq('① locale=ja_JP → 选 jpn', A.lang, 'jpn');
eq('① 语言清单', A.languages, ['chn', 'jpn'].sort());
eq('① 键数', A.keys, 3);

const A2 = L10N.load({ root: path.join(T, 'classic'), www: g1, lang: 'chn' });
eq('① 显式 --lang=chn 覆盖 locale', A2.lang, 'chn');
eq('① chn 的值', A2.resolve('${text.a}'), '艾莉西亞');

console.log('\n== ② 还原规则（与 ODW 逐字同口径）==');
eq('② 单层还原', A.resolve('你好 ${text.a}'), '你好 アリシア');
eq('② 嵌套 code 递归展开', A.resolve('${text.b}'), 'アリシア乙');
eq('② 未知 code **原样保留**（不学 ODW 退化成裸 code）', A.resolve('${text.zzz}'), '${text.zzz}');
eq('② resolveText 抹掉没还原的残余', A.resolveText('前${text.zzz}后'), '前后');
eq('② hasPlaceholder', A.hasPlaceholder('a${text.a}') + '/' + A.hasPlaceholder('普通文本'), 'true/false');
eq('② 没有占位符的串原样返回', A.resolve('普通的字'), '普通的字');
eq('② deepResolve 只动含 ${ 的串',
    JSON.stringify(A.deepResolve({ a: '${text.a}', b: ['${text.c}'], c: 3, d: '普通', e: { f: '${text.a}' } })),
    JSON.stringify({ a: 'アリシア', b: ['セリス'], c: 3, d: '普通', e: { f: 'アリシア' } }));

console.log('\n== ③ 找不到表时的零回归（红线）==');
/* NW.js 每个游戏根目录都自带 locales/（放 en-US.pak），它**不是**语言表 */
const g3 = path.join(T, 'nwjs', 'www');
WJ(path.join(g3, 'data', 'System.json'), { gameTitle: '普通MV', locale: 'zh_CN' });
W(path.join(g3, 'locales', 'en-US.pak'), 'not json');
const C = L10N.load({ root: path.join(T, 'nwjs'), www: g3 });
eq('③ locales/（.pak）不被当成语言表', C.available, false);
eq('③ 不可用时 resolve 原样返回', C.resolve('${text.a} 和 ${x}'), '${text.a} 和 ${x}');
eq('③ 不可用时 resolveText 也不动', C.resolveText('a${text.a}b'), 'a${text.a}b');
eq('③ 不可用时 deepResolve 是空转', JSON.stringify(C.deepResolve({ a: '${text.a}' })), JSON.stringify({ a: '${text.a}' }));

console.log('\n== ④ 扁平布局的「邻居串味」护栏 ==');
/* 扁平布局：<parent>/<game>/data 与 index.html 平铺，root 会被算成 <parent>。
 * 而 <parent> 可能是 Steam 的 common/ —— 里面躺着**别的游戏**的 languages/。 */
const par = path.join(T, 'common');
const g4 = path.join(par, 'MyGame');
WJ(path.join(g4, 'data', 'System.json'), { gameTitle: '扁平MV', locale: 'ja_JP' });
W(path.join(g4, 'index.html'), '<html></html>');
WJ(path.join(par, 'languages', 'jpn', 'main.json'), { 'text.a': '邻居游戏的值' });   // ← 别人的
const D = L10N.load({ root: par, www: g4 });
eq('④ 父目录不是游戏根 → 不去父目录找（不串味）', D.available, false);
/* 自己在 www 下有一份 → 只认自己的 */
WJ(path.join(g4, 'languages', 'jpn', 'main.json'), { 'text.a': '自己的值' });
const D2 = L10N.load({ root: par, www: g4, lang: 'jpn' });
eq('④ 只认游戏自己的语言表', D2.resolve('${text.a}'), '自己的值');

/* ==========================================================================
 * 二、端到端：就地跑扫描器 / 抽取器，断言磁盘产物
 * ======================================================================== */
console.log('\n== ⑤ 端到端：带语言表的假游戏 ==');

/** 搭一个**带占位符**的经典布局假游戏 */
function mkGame(dir, withLang) {
    const www = path.join(dir, 'www');
    WJ(path.join(www, 'data', 'System.json'), { gameTitle: '虚构多语言测试', currencyUnit: 'G', hasEncryptedImages: false, locale: 'ja_JP' });
    WJ(path.join(www, 'data', 'Actors.json'), [null, { id: 1, name: '${text.hero}' }, { id: 2, name: '${text.sub}' }]);
    WJ(path.join(www, 'data', 'MapInfos.json'), { 1: { id: 1, name: '${text.map1}', parentId: 0 } });
    WJ(path.join(www, 'data', 'CommonEvents.json'), [null, { id: 1, name: 'ce', trigger: 0, list: [{ code: 401, parameters: ['${text.line1}'] }] }]);
    WJ(path.join(www, 'data', 'Map001.json'), {
        width: 17, height: 13, note: '', events: [
            {
                id: 1, name: '${text.evname1}', x: 3, y: 3, pages: [{
                    image: { characterName: 'Actor1', characterIndex: 0 },
                    list: [{ code: 101, parameters: ['', 0, 0, 2] }, { code: 401, parameters: ['${text.line1}'] },
                        { code: 401, parameters: ['你${text.hero}啊'] }]
                }]
            },
            {
                id: 2, name: '${text.missing}', x: 5, y: 3, pages: [{
                    image: { characterName: 'Actor1', characterIndex: 1 },
                    list: [{ code: 401, parameters: ['${text.line2}'] }]
                }]
            }
        ]
    });
    if (withLang) {
        WJ(path.join(www, 'languages', 'jpn', 'main.json'), {
            'text.hero': 'アリシア', 'text.sub': 'セリス', 'text.map1': '王城',
            'text.evname1': '衛兵', 'text.line1': 'ここは王城だ。', 'text.line2': 'よく来たな。'
            /* 故意不给 text.missing —— 考验「缺键」这条路径 */
        });
    }
    return www;
}

const G5 = path.join(T, 'g5'); mkGame(G5, true);
const out5 = path.join(T, 'out5');
const log5 = run('scan_game.js', [G5, '--out', out5]);
const w5 = readJson(path.join(out5, 'worldbook.json'));
const j5 = JSON.stringify(w5);
t('⑤ 扫描跑通（无异常）', () => !!w5);
t('⑤ 世界书里**一个 ${ 都不剩**', () => !/\$\{/.test(j5), j5.match(/\$\{[^}]*\}/g) || '');
t('⑤ game.title 仍是原样（标题里没占位符）', () => w5.game.title === '虚构多语言测试', w5.game.title);
eq('⑤ 记账字段：已还原', w5.game.localization && w5.game.localization.resolved, true);
eq('⑤ 记账字段：语言', w5.game.localization && w5.game.localization.lang, 'jpn');
t('⑤ 事件名还原（M1:E1 = 衛兵）', () => {
    const n = (w5.npcs || []).find(x => x.key === 'M1:E1');
    return n && n.name === '衛兵' ? n.name : (n && n.name);
});
t('⑤ 台词还原（含句中插值）', () => {
    const n = (w5.npcs || []).find(x => x.key === 'M1:E1');
    const txt = (n && n.dialogues || []).map(d => d.text).join(' | ');
    return txt.indexOf('ここは王城だ。') >= 0 && txt.indexOf('アリシア') >= 0 ? txt : txt;
});
t('⑤ 缺键的 code 不当名字（M1:E2 退到 role，不是 ${text.missing}）', () => {
    const n = (w5.npcs || []).find(x => x.key === 'M1:E2');
    return n && String(n.name).indexOf('${') < 0 && n.name !== 'text.missing' ? n.name : (n && n.name);
});
t('⑤ 扫描日志里点名了还原成功', () => log5.indexOf('本地化占位符全部还原成功') >= 0, '');

console.log('\n== ⑥ 端到端：**不带**语言表的同款假游戏（红线）==');
const G6 = path.join(T, 'g6'); mkGame(G6, false);
const out6 = path.join(T, 'out6');
const log6 = run('scan_game.js', [G6, '--out', out6]);
const w6 = readJson(path.join(out6, 'worldbook.json'));
t('⑥ 扫描跑通', () => !!w6);
eq('⑥ 记账字段：未还原 + 点名了占位符', w6.game.localization && w6.game.localization.resolved, false);
t('⑥ 记账字段：placeholdersSeen > 0', () => w6.game.localization.placeholdersSeen > 0, String(w6.game.localization.placeholdersSeen));
t('⑥ **没有去掉**占位符原文（原文是玩家数据，不许改）', () => /\$\{/.test(JSON.stringify(w6)), '');
t('⑥ 日志里**大声警告**（失败必须让玩家看得见）', () => log6.indexOf('没找到语言表') >= 0, '');

console.log('\n== ⑦ 端到端：语料抽取器 ==');
const out7 = path.join(T, 'out7');
run('extract_lore.js', ['--www=' + path.join(G5, 'www'), '--out=' + path.join(out7, 'lore_raw.json')]);
const l7 = readJson(path.join(out7, 'lore_raw.json'));
t('⑦ 语料跑通', () => !!l7);
t('⑦ 语料里没有 ${ 占位符', () => l7 && !/\$\{/.test(JSON.stringify(l7)), '');
t('⑦ 语料的 localization 记账', () => l7 && l7.game.localization && l7.game.localization.resolved === true, '');

/* 语料：不带表时不应该多出 localization 字段（逐字节零回归） */
const G8 = path.join(T, 'g8');
WJ(path.join(G8, 'www', 'data', 'System.json'), { gameTitle: '无占位符的普通游戏', currencyUnit: 'G', locale: 'zh_CN' });
WJ(path.join(G8, 'www', 'data', 'Actors.json'), [null]);
WJ(path.join(G8, 'www', 'data', 'MapInfos.json'), { 1: { id: 1, name: '城', parentId: 0 } });
WJ(path.join(G8, 'www', 'data', 'Map001.json'), {
    width: 17, height: 13, events: [{ id: 1, name: '旅店老板', x: 3, y: 3, pages: [{ image: { characterName: 'Actor1', characterIndex: 0 }, list: [{ code: 401, parameters: ['欢迎。'] }] }] }]
});
const out8 = path.join(T, 'out8');
run('scan_game.js', [G8, '--out', out8]);
const w8 = readJson(path.join(out8, 'worldbook.json'));
t('⑧ 普通游戏：不写 localization 字段（产物逐字节不膨胀）',
    () => w8 && w8.game.localization === undefined, JSON.stringify(w8 && w8.game));
t('⑧ 普通游戏：game 只有 title/currency 两个键',
    () => w8 && Object.keys(w8.game).join(',') === 'title,currency', Object.keys(w8.game).join(','));

/* ==========================================================================
 * 三、插件侧同口径（Ainpc.l10n 与 tools/l10n.js 规则必须一致）
 * ======================================================================== */
console.log('\n== ⑨ 插件侧 Ainpc.l10n 与工具同口径 ==');
const PLUGIN = argOf('plugin', '') || '';
const pluginPath = [PLUGIN, path.join(HERE, 'RM_AI_NPC.js'), path.join(HERE, '..', 'RM_AI_NPC.js')]
    .filter(Boolean).find(p => fs.existsSync(p)) || '';
t('⑨ 插件文件找得到', () => fs.existsSync(pluginPath), pluginPath);
if (fs.existsSync(pluginPath)) {
    const src = fs.readFileSync(pluginPath, 'utf8');
    t('⑨ 插件里有 Ainpc.l10n', () => src.indexOf('Ainpc.l10n = (function') >= 0, '');
    t('⑨ 插件占位符正则与工具一致 /\$\{([\w|.]+)\}/', () => src.indexOf('/\\$\\{([\\w|.]+)\\}/g') >= 0, '');
    t('⑨ 插件语言目录优先级与工具一致', () => src.indexOf("['languages', 'language', 'lang', 'i18n', 'translations', 'locale', 'locales']") >= 0, '');
    t('⑨ ITEM_NAME 走还原（货架上的道具名不能是占位符）', () => /var ITEM_NAME = function[\s\S]{0,400}?Ainpc\.l10n\.resolve/.test(src), '');
    t('⑨ 插件里有「父目录必须是游戏根」护栏（防邻居串味）', () => src.indexOf('parentIsGame') >= 0, '');
}

/* ---------------------------------------------------------------- 收尾 */
if (!KEEP) rmrf(T);
console.log('\n' + '='.repeat(62));
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail);
