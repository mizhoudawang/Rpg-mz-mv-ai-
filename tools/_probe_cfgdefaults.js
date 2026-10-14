/* eslint-disable */
/**
 * v2.9.14 回归：**安装器的 config 模板必须与插件 DEFAULTS 逐项同值。**
 *
 * 为什么单独钉这一条 —— 这是本项目最容易「安静地做错事」的一处：
 *   `Ainpc.loadConfig()` 是**逐键覆盖**：
 *       Ainpc.config = DEFAULTS;  // 先铺默认
 *       Object.keys(configJson).forEach(k => Ainpc.config[k] = configJson[k]);  // 文件盖上去
 *   而 config.json 正是「一键安装.bat / install.js」按 `const tpl = {...}` 生成的那一份。
 *   ⇒ **模板里写什么，新用户就是什么。插件里把默认值改对了，只要模板没跟，一分钱都传不到玩家手上。**
 *
 * 真实事故（v2.9.14 审计发现）：
 *   · `maxTokens` 模板一直是 500，插件 v2.9.1 已提到 1600（思考型模型 / 中转站要留
 *     reasoning 额度，500 实测 content 恒为 null）→ 开箱即翻车，且**开发机上看不出来**
 *     （开发机的 config.json 是手工改过的）。
 *   · `maxTurns` 模板一直是 8，插件 v2.0 已提到 20 → 玩家刚把话头铺开就被切断。
 *   · `keepOriginalText` / `haggleBaseChance` 也各差一档。
 *   实证：Mira 的 config.json = 500/8/false/0.5（走安装器），伊莉莎 = 1600/20/true/0.45（面板手改）。
 *
 * 用法：
 *   node _probe_cfgdefaults.js [--plugin=<RM_AI_NPC.js>] [--install=<install.js>]
 *                              [--pkg=<发行包根目录，可选：顺带校验 config.template.json>]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const aArgs = process.argv.slice(2);
function argOf(n) { return (aArgs.filter(function (a) { return a.indexOf('--' + n + '=') === 0; })[0] || '').split('=').slice(1).join('='); }

/* ---------------- 定位两个源文件 ---------------- */
const CAND_PLUGIN = [
    'D:/Mira and the Mysteries of Alchemy v1.00(1)/www/js/plugins/RM_AI_NPC.js',
    path.join(__dirname, '..', '..', '2026-10-09-18-56-44', 'rm-ai-npc', 'RM_AI_NPC.js'),
    path.join(__dirname, 'RM_AI_NPC.js')
];
const CAND_INSTALL = [
    path.join(__dirname, '..', '..', '2026-10-09-18-56-44', 'rm-ai-npc', 'tools', 'install.js'),
    'D:/Mira and the Mysteries of Alchemy v1.00(1)/RM_AI_NPC-v2.9.14/tools/install.js',
    path.join(__dirname, 'tools', 'install.js')
];
function pick(explicit, cands, label) {
    if (explicit) return explicit;
    for (const c of cands) if (fs.existsSync(c)) return c;
    console.error('✘ 找不到' + label + '，请用 --' + (label === '插件' ? 'plugin' : 'install') + '= 指定');
    process.exit(2);
}
const PLUGIN = pick(argOf('plugin'), CAND_PLUGIN, '插件');
const INSTALL = pick(argOf('install'), CAND_INSTALL, 'install.js');
const PKGROOT = argOf('pkg');

let pass = 0, fail = 0;
function ok(n, extra) { pass++; console.log('  ✓ ' + n + (extra ? '  ← ' + extra : '')); }
function bad(n, extra) { fail++; console.log('  ❌ ' + n + (extra ? '  ← ' + extra : '')); }
console.log('插件    = ' + PLUGIN);
console.log('install = ' + INSTALL);

/* ---------------- 抠出两份对象 ---------------- */
function pluginDefaults(file) {
    const src = fs.readFileSync(file, 'utf8');
    const i = src.indexOf('var DEFAULTS = {');
    if (i < 0) throw new Error('插件里找不到 `var DEFAULTS = {`');
    const j = src.indexOf('\n    };', i);
    if (j < 0) throw new Error('DEFAULTS 字面量没闭合');
    const lit = src.slice(i + 'var DEFAULTS = '.length, j + 6);
    /* DEFAULTS 里只引用 P.*（插件参数），传空对象求值即可 —— 纯字面量，安全。 */
    return new Function('P', 'return ' + lit)({});
}
function installTemplate(file) {
    const src = fs.readFileSync(file, 'utf8');
    const m = /const tpl = (\{[\s\S]*?\n  \});/.exec(src);
    if (!m) throw new Error('install.js 里找不到 `const tpl = {...};`');
    return new Function('flags', 'return ' + m[1])({});
}

let DEF, TPL;
try { DEF = pluginDefaults(PLUGIN); }
catch (e) { console.error('✘ 插件 DEFAULTS 解析失败：' + e.message); process.exit(2); }
try { TPL = installTemplate(INSTALL); }
catch (e) { console.error('✘ install.js 模板解析失败：' + e.message); process.exit(2); }

const tplKeys = Object.keys(TPL).filter(function (k) { return k.charAt(0) !== '_' && k.charAt(0) !== '/'; });
const defKeys = Object.keys(DEF);

/* ---------------- ① 模板不许出现插件不认的键 ---------------- */
console.log('\n== ① 模板里的每个键，插件都得认 ==');
const ghosts = tplKeys.filter(function (k) { return defKeys.indexOf(k) < 0; });
if (!ghosts.length) ok('模板 ' + tplKeys.length + ' 个键，插件全都认（无拼写 / 已废弃项）');
else bad('插件不认的键（写了也白写）：' + ghosts.join(' / '));

/* ---------------- ② 共有键逐项同值 ---------------- */
console.log('\n== ② 两边都有的键，值必须一样（JSON 比较，避免 [] !== [] 假阳性） ==');
const shared = tplKeys.filter(function (k) { return defKeys.indexOf(k) >= 0; });
const diff = [];
shared.forEach(function (k) {
    if (JSON.stringify(TPL[k]) !== JSON.stringify(DEF[k])) {
        diff.push({ k: k, tpl: TPL[k], def: DEF[k] });
    }
});
if (!diff.length) ok('共有的 ' + shared.length + ' 个键逐项一致');
else {
    bad(diff.length + ' 个键不一致（模板会盖掉插件默认值）：');
    diff.forEach(function (d) {
        console.log('      ! ' + d.k + ':  模板 = ' + JSON.stringify(d.tpl)
            + '   插件默认 = ' + JSON.stringify(d.def));
    });
}

/* ---------------- ③ 点名几个「必须对」的键 ---------------- */
console.log('\n== ③ 点名：改动过默认值、最容易忘记跟模板的几项 ==');
const WATCH = [
    ['maxTokens', 1600, '思考型模型 / 中转站要留 reasoning 额度（v2.9.1）'],
    ['maxTurns', 20, '一次对话允许的回合数（v2.0 从 8 提到 20）'],
    ['keepOriginalText', true, 'AI 说完是否附一行「——（原作台词）——」'],
    ['haggleBaseChance', 0.45, '讲价基础成功率（插件 DEFAULTS / doHaggle 兜底值）'],
    ['temperature', 0.85, '采样温度'],
    ['language', 'auto', '语言判定']
];
WATCH.forEach(function (w) {
    const k = w[0], want = w[1], why = w[2];
    const t = TPL[k], d = DEF[k];
    if (JSON.stringify(t) === JSON.stringify(want) && JSON.stringify(d) === JSON.stringify(want)) {
        ok(k + ' = ' + JSON.stringify(want) + '（两边都对）', why);
    } else {
        bad(k + ' 期望 ' + JSON.stringify(want)
            + '，实际 模板=' + JSON.stringify(t) + ' / 插件=' + JSON.stringify(d), why);
    }
});

/* ---------------- ④ 可选：发行包里的 config.template.json 同源 ---------------- */
if (PKGROOT) {
    console.log('\n== ④ 发行包 config.template.json 与 install.js 同源 ==');
    const f = path.join(PKGROOT, 'config.template.json');
    if (!fs.existsSync(f)) bad('发行包里没有 config.template.json');
    else {
        let j = null;
        try { j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { bad('解析失败：' + e.message); }
        if (j) {
            const d2 = [];
            shared.forEach(function (k) {
                if (k in j && JSON.stringify(j[k]) !== JSON.stringify(DEF[k])) {
                    d2.push(k + '（包=' + JSON.stringify(j[k]) + ' 插件=' + JSON.stringify(DEF[k]) + '）');
                }
            });
            if (!d2.length) ok('包里的模板与插件默认值一致');
            else bad('包里模板与插件默认值不一致：' + d2.join(' / '));
            if (typeof j.apiKey === 'string' && !j.apiKey) ok('包里模板的 apiKey 是空的（不含任何人 Key）');
            else bad('包里模板带着 apiKey！');
        }
    }
}

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
