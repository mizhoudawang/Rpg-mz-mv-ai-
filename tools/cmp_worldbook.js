#!/usr/bin/env node
'use strict';
/* 两份 worldbook.json 的**逐条字段级**比对。
 * 用法: node cmp_worldbook.js <旧.json> <新.json> [--allow=role,tags,shop_menu]
 *
 * 输出：
 *   · 条目数、增/删的 key
 *   · 每条差异按「key → 字段 → 旧值/新值」列出（默认全字段）
 *   · --allow 列出的字段差异不计入失败（用来实现「只允许 role/tags 变化」这种断言）
 */
const fs = require('fs');
const A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const B = JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
const ALLOW = (process.argv.find(a => a.startsWith('--allow=')) || '').split('=')[1];
const allow = ALLOW ? ALLOW.split(',') : [];

const IGNORE_FIELDS = ['generatedAt'];   // 时间戳天然不同

const an = A.npcs || [], bn = B.npcs || [];
const am = {}, bm = {};
an.forEach(n => { if (n && n.key) am[n.key] = n; });
bn.forEach(n => { if (n && n.key) bm[n.key] = n; });

const onlyA = Object.keys(am).filter(k => !(k in bm));
const onlyB = Object.keys(bm).filter(k => !(k in am));
console.log('旧条目 ' + an.length + ' ／ 新条目 ' + bn.length);
console.log('只在旧书: ' + (onlyA.length ? onlyA.join(',') : '（无）'));
console.log('只在新书: ' + (onlyB.length ? onlyB.join(',') : '（无）'));

let diffCount = 0, relaxed = 0;
const fieldsTouched = {};
const samples = [];

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

Object.keys(am).forEach(k => {
    const o = am[k], n = bm[k];
    if (!n) return;
    const keys = {};
    Object.keys(o).forEach(x => keys[x] = 1);
    Object.keys(n).forEach(x => keys[x] = 1);
    Object.keys(keys).forEach(f => {
        if (IGNORE_FIELDS.indexOf(f) >= 0) return;
        if (eq(o[f], n[f])) return;
        fieldsTouched[f] = (fieldsTouched[f] || 0) + 1;
        if (allow.indexOf(f) >= 0) { relaxed++; return; }
        diffCount++;
        if (samples.length < 12) samples.push('  ' + k + '  [' + f + ']\n      旧: ' + JSON.stringify(o[f]) + '\n      新: ' + JSON.stringify(n[f]));
    });
});

console.log('差异字段分布: ' + (Object.keys(fieldsTouched).length ? JSON.stringify(fieldsTouched) : '（无）'));
if (relaxed) console.log('其中被 --allow 放行: ' + relaxed + ' 处  (' + allow.join(',') + ')');
if (diffCount) {
    console.log('\n未放行差异 ' + diffCount + ' 处，样例：');
    samples.forEach(s => console.log(s));
}
console.log('\n════ ' + (diffCount === 0 ? '一致 ✓' : '有差异 ✘ ' + diffCount + ' 处') + ' ════');
process.exit(diffCount === 0 && !onlyA.length && !onlyB.length ? 0 : 1);
