/* eslint-disable */
/**
 * v2.9.12 回归：**自由对话（打字）那条路，必须走得通。**
 *
 * 背景：v2.9.12 修的是一个玩家 100% 会踩到的崩溃 ——
 *   在 Mira（Chromium 41）里，自由输入一按「保存」就抛
 *     TypeError: Cannot read property 'indexOf' of undefined   @ RM_AI_NPC.js:7275
 *   （错误栈：intentEvidence → parseIntent → DOM done() → 玩家看到一个引擎报错帧）
 *   原因：用了 `re.flags`，那是 **ES2015** 的访问器（Chrome 49+），老引擎上是 undefined。
 *
 * 为什么此前 30 个探针全绿却漏掉它：
 *   ① 自由输入这条路**一个测试都没有**（本文件补上）；
 *   ② 无头台跑在 Node 22 上，`RegExp.prototype.flags` 在那儿是存在的；
 *   ③ 甚至「把 flags 删掉再冒烟」也测不出来 —— 插件跑在 vm 里，
 *      而 **vm 中正则字面量的内建原型是 vm 自己的**，删外层的删不到它。
 *   ⇒ 这类「老引擎缺的 ES2015 访问器」只能靠 `audit_mira.js` 的静态名单拦。
 *     本文件因此**同时**做两件事：静态自证 + 行为钉死。
 *
 * 用法：node _probe_intent.js [--www=<游戏的 www 目录>]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const aArgs = process.argv.slice(2);
const wwwArg = (aArgs.filter(function (a) { return a.indexOf('--www=') === 0; })[0] || '').split('=')[1];
const plugArg = (aArgs.filter(function (a) { return a.indexOf('--plugin=') === 0; })[0] || '').split('=')[1];
process.argv = ['node', 'harness.js']
    .concat(wwwArg ? ['--www=' + wwwArg] : [])
    .concat(plugArg ? ['--plugin=' + plugArg] : []);

const H = require('./harness.js');
if (H.loadError) { console.error('插件加载失败：' + H.loadError.message); process.exit(1); }
const Ainpc = H.Ainpc;

let pass = 0, fail = 0;
function ok(n, extra) { pass++; console.log('  ✓ ' + n + (extra ? '  ← ' + extra : '')); }
function bad(n, extra) { fail++; console.log('  ❌ ' + n + (extra ? '  ← ' + extra : '')); }

/* 样本：一个真商人（有货架）与一个普通路人 —— 两条分支都要覆盖 */
const wb = JSON.parse(fs.readFileSync(path.join(H.WWW, 'ai_npc', 'worldbook.json'), 'utf8').replace(/^\uFEFF/, ''));
const all = wb.npcs || [];
const merchantNpc = all.filter(function (n) { return Ainpc.hasRealShop(n); })[0];
const plainNpc = all.filter(function (n) {
    return !Ainpc.hasRealShop(n) && String(n.aiHint || '') === 'npc';
})[0] || all.filter(function (n) { return !Ainpc.hasRealShop(n); })[0];
const CTX = {
    merchant: { key: merchantNpc ? merchantNpc.key : 'X:E1', npc: merchantNpc || { tags: [] }, goods: null },
    plain: { key: plainNpc ? plainNpc.key : 'X:E2', npc: plainNpc || { tags: [] }, goods: null }
};

/* ─────────────────────────── ① 静态自证：源码里不许再出现 re.flags 当字符串用 */
console.log('== ① 静态自证 ==');
const SRC = fs.readFileSync(H.PLUGIN, 'utf8');
const LINES = SRC.split('\n');
const BAD_FLAGS = /\.flags\s*(?:\.\s*(?:indexOf|lastIndexOf|includes|slice|split|length|match|replace|search|charAt|trim|startsWith|endsWith|substring|substr|toLowerCase|toUpperCase|concat)\b|\+)/;
const hits = [];
LINES.forEach(function (ln, i) {
    const s = ln.trim();
    if (/^(\/\/|\*|\/\*)/.test(s)) return;                 // 注释不算
    if (BAD_FLAGS.test(ln)) hits.push('L' + (i + 1) + '  ' + s.slice(0, 90));
});
if (!hits.length) ok('源码里没有把 RegExp.prototype.flags 当字符串用（ES2015 访问器）');
else { bad('源码里仍在用 re.flags（Chromium 41 上是 undefined ⇒ 必崩）'); hits.forEach(function (h) { console.log('      ' + h); }); }

const hasRegExpFlagsGuard = /rep\s*=\s*'g'/.test(SRC);
if (hasRegExpFlagsGuard) ok('用了手拼修饰符的 ES5 安全写法', "rep = 'g' (+i / +m)");
else bad('没找到 ES5 安全的手拼修饰符写法', '应为 rep = \'g\'; if (re.ignoreCase) rep += \'i\'; …');

/* ─────────────────────────── ② 等价性：手拼的修饰符 == re.flags */
console.log('\n== ② 修饰符等价性（手拼 vs 原版 re.flags）==');
function assemble(re) {                                     // 与插件里那段完全同构
    let rep = 'g';
    if (re.ignoreCase) rep += 'i';
    if (re.multiline) rep += 'm';
    return rep;
}
/* 修饰符的**顺序无语义**（'gi' 与 'ig' 完全等价），所以按字母集合比，
 * 不能按字符串比 —— 第一版就是这么误报的。 */
function flagSet(s) { return String(s).split('').sort().join(''); }
const CASES = [/abc/, /abc/i, /abc/m, /abc/im, /^a|b$/img, /偷|摸|顺|拿|窃/, /便宜|降价|少点/i];
let eqBad = 0;
CASES.forEach(function (re) {
    const a = assemble(re);
    const native = re.flags.indexOf('g') < 0 ? re.flags + 'g' : re.flags;   // 原来那句（只在有 flags 的机器上能跑）
    if (flagSet(a) !== flagSet(native)) { eqBad++; console.log('      ' + re.source + ' : 手拼=' + a + ' 原版=' + native); }
});
if (!eqBad) ok(CASES.length + ' 个正则：手拼修饰符与原版 re.flags 等价（字母集合一致）');
else bad('修饰符不等价 ' + eqBad + ' 处');

/* 再验一遍「匹配结果」真的相同（把 /g 加上去之后的行为） */
let matchBad = 0;
const TEXTS = ['abc ABC', 'a\nb\nc', '我想偷点东西', '便宜点行不行', 'ABC'];
CASES.forEach(function (re) {
    const g1 = new RegExp(re.source, assemble(re));
    const g2 = new RegExp(re.source, 'g' + (re.ignoreCase ? 'i' : '') + (re.multiline ? 'm' : ''));
    TEXTS.forEach(function (t) {
        const r1 = [], r2 = [];
        let m;
        while ((m = g1.exec(t))) r1.push(m.index);
        while ((m = g2.exec(t))) r2.push(m.index);
        if (r1.join(',') !== r2.join(',')) { matchBad++; console.log('      ' + re.source + ' / ' + JSON.stringify(t) + ' : ' + r1 + ' vs ' + r2); }
    });
});
if (!matchBad) ok('匹配位置逐条一致（' + CASES.length + ' 正则 × ' + TEXTS.length + ' 文本）');
else bad('匹配结果不一致 ' + matchBad + ' 处');

/* ─────────────────────────── ③ 行为：玩家真会打的话，结果得对 */
console.log('\n== ③ 自由输入解析（真玩家会打的句子）==');
/* ③④ 需要一个**真有货架**的商人当样本（「买 / 讲价」只对商人成立）。
 * 换一部没有这种商人的游戏就优雅跳过 —— 与 `_probe_interact.js` 同一惯例。 */
const HAS_SAMPLE = !!(merchantNpc && plainNpc);
if (!HAS_SAMPLE) {
    console.log('  这部游戏的世界书里没有「带真货架（goods/branch）的商人」样本 ——');
    console.log('  跳过 ③④（本探针的 ③④ 是 Mira 形状的回归；①② 与 ⑤ 已跑）。');
}
/* expect: 'menu:xxx' / 'pact:xxx' / 'plain'（null） */
const TABLE = [
    ['再见', 'menu:bye', 'menu:bye'],
    ['先走了，不打扰了', 'menu:bye', 'menu:bye'],
    ['我想偷他的钱包', 'menu:steal', 'pact:pocket'],
    ['动手抢', 'menu:rob', 'menu:rob'],
    ['老板，能不能便宜点？', 'menu:haggle', 'plain'],
    ['我想买瓶药', 'menu:buy', 'plain'],
    ['你好呀，今天天气不错', 'plain', 'plain'],
    ['喂，你在这儿做什么的', 'plain', 'plain'],
    ['你这人真讨厌', 'plain', 'plain']
];
function kindOf(r) {
    if (!r) return 'plain';
    if (r.kind === 'menu') return 'menu:' + r.id;
    if (r.kind === 'pact') return 'pact:' + r.pact.id;
    return 'other:' + r.kind;
}
if (HAS_SAMPLE) TABLE.forEach(function (row) {
    const text = row[0], wantM = row[1], wantP = row[2];
    const gm = kindOf(Ainpc.parseIntent(text, { key: CTX.merchant.key, npc: CTX.merchant.npc, goods: null }));
    const gp = kindOf(Ainpc.parseIntent(text, { key: CTX.plain.key, npc: CTX.plain.npc, goods: null }));
    if (gm === wantM && gp === wantP) ok('「' + text + '」', '商人→' + gm + ' ｜ 路人→' + gp);
    else bad('「' + text + '」', '想要 商人→' + wantM + ' 路人→' + wantP +
        '，实际 商人→' + gm + ' 路人→' + gp);
});

/* 自由输入的第二条路径：口令识别（打「买」「偷」这种） */
console.log('\n== ④ 口令识别 matchMenuWord ==');
if (HAS_SAMPLE) [['我想买点东西', 'buy'], ['便宜点', 'haggle'], ['我要偷', 'steal'], ['我要抢', 'rob'], ['再见', 'bye'], ['你好', '']]
    .forEach(function (row) {
        const got = Ainpc.matchMenuWord(row[0], { key: CTX.merchant.key, npc: CTX.merchant.npc, goods: null });
        if (got === row[1]) ok('「' + row[0] + '」→ ' + (got || '（当普通发言）'));
        else bad('「' + row[0] + '」想要 ' + (row[1] || '（空）') + '，实际 ' + (got || '（空）'));
    });

/* 夸/骂判定（自由输入里紧接着 parseIntent 调的就是它）
 * ★ 词表**从插件取**，不要硬编码 —— 配置里 insultWords/praiseWords 可能是空串
 *   （本作就是），此时走内置表；硬写「讨厌」这种不在表里的词只会误报。 */
console.log('\n== ⑤ 夸骂判定 judgeSpeech ==');
const INSULT = Ainpc.insultWords()[0] || '傻子';
const PRAISE = Ainpc.praiseWords()[0] || '谢谢';
[[INSULT, -1], [PRAISE, 1], ['今天天气不错', 0]].forEach(function (row) {
    const a = { key: CTX.plain.key, npc: CTX.plain.npc, goods: null };
    Ainpc.judgeSpeech(a, row[0]);
    const got = a.attitude || 0;
    if (got === row[1]) ok('「' + row[0] + '」→ attitude=' + got);
    else bad('「' + row[0] + '」想要 ' + row[1] + '，实际 ' + got);
});

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
