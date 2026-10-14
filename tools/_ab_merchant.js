/* eslint-disable */
/**
 * A/B 行为对照：**同一份世界书 + 两份插件**，把「商人判定这一族」的每个函数
 * 逐个 dump 成一行，再用 diff 比。这是「伊莉莎零差异」这条不变量最硬的证据 ——
 * 数据层（worldbook.json / actors_ai.json 逐字节）只能证明「没改数据」，
 * 证明不了「改读数据的代码没改行为」。v2.9.11 收紧 `hasRealShop` 时，
 * 伊莉莎的 14 个商人（`shop={commonEvent:76}`、只有 `merchant` 标签、没有 goods/branch）
 * 正好落在「看起来像假货架」的形状上 —— 必须用行为级对照把它钉住。
 *
 * 用法：
 *   node _ab_merchant.js --www=<www> --plugin=<插件路径> --out=<落盘路径>
 * 典型：
 *   node _ab_merchant.js --www=$ELIZA/www --plugin=$MIRA/RM_AI_NPC-v2.9.10/RM_AI_NPC.js --out=old.tsv
 *   node _ab_merchant.js --www=$ELIZA/www --plugin=$MIRA/RM_AI_NPC-v2.9.11/RM_AI_NPC.js --out=new.tsv
 *   diff old.tsv new.tsv
 */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name) {
    const hit = process.argv.slice(2).filter(function (a) { return a.indexOf('--' + name + '=') === 0; })[0];
    return hit ? hit.slice(name.length + 3) : '';
}
const WWW = arg('www');
const PLUGIN = arg('plugin');
const OUT = arg('out') || 'ab_out.tsv';
const TAG = arg('tag') || path.basename(OUT);

process.argv = ['node', 'harness.js']
    .concat(WWW ? ['--www=' + WWW] : [])
    .concat(PLUGIN ? ['--plugin=' + PLUGIN] : []);

const H = require('./harness.js');
if (H.loadError) { console.error('插件加载失败：' + H.loadError.message); process.exit(1); }
const Ainpc = H.Ainpc;

const wbPath = path.join(H.WWW, 'ai_npc', 'worldbook.json');
const wb = JSON.parse(fs.readFileSync(wbPath, 'utf8').replace(/^\uFEFF/, ''));
const npcs = wb.npcs || wb.entries || [];

const COLS = ['key', 'place', 'intro', 'temper', 'pocket', 'isMerchant', 'hasRealShop', 'specials', 'menu'];
/* 表头单独一行、数据行严格按 COLS 对齐 —— 别把注释塞进第一个单元格，
 * 否则列名与数据错位一位（v2.9.11 排查时就被这个坑过一次）。 */
const lines = [
    '# plugin=' + path.basename(H.PLUGIN) + '  www=' + H.WWW + '  npcs=' + npcs.length,
    COLS.join('\t')
];

npcs.forEach(function (n) {
    const k = n.key;
    const g = function (fn, d) { try { return fn(); } catch (e) { return 'ERR:' + (e && e.message); } };
    const row = [
        k,
        g(function () { return Ainpc.placeOf(k); }, ''),
        g(function () { return Ainpc.placeIntro(k); }, ''),
        /* TEMPERS 的字段名是 `key`（不是 `id`）：写成 `.id` 会安静地拿到 undefined，
         * 整列都是空串，diff 看起来"脾气没变"，其实什么都没测到。 */
        g(function () { return Ainpc.temperOf(k).key; }, ''),
        g(function () { return Ainpc.pocketTier(k, n).id; }, ''),
        g(function () { return Ainpc.isMerchant(n) ? '1' : '0'; }, ''),
        g(function () { return Ainpc.hasRealShop(n) ? '1' : '0'; }, ''),
        g(function () { return Ainpc.specialsOf(k).map(function (d) { return d.id; }).join(','); }, ''),
        g(function () {
            return (Ainpc.buildChoices({ key: k, npc: n, goods: null }) || [])
                .map(function (c) { return c && c.key ? c.key : String(c); }).join(',');
        }, '')
    ];
    lines.push(row.join('\t'));
});

fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log('[' + TAG + '] 已写 ' + OUT + '：' + npcs.length + ' 条');
console.log('  插件 = ' + H.PLUGIN);
console.log('  版本 = ' + Ainpc.VERSION);
/* 自检：某一列整列为空 = 字段名读错了，diff 会假装"零差异" */
const emptyCol = function (idx, name) {
    const n = lines.slice(2).filter(function (l) { return l.split('\t')[idx] === ''; }).length;
    if (n) console.log('  ⚠ 列「' + name + '」有 ' + n + '/' + npcs.length + ' 行为空 —— 检查这里的字段名');
};
emptyCol(3, 'temper');
emptyCol(4, 'pocket');
