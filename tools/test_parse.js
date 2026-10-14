/* 从插件里把 persona 的解析函数抠出来做单测（不联网、不烧额度）。
   用法: node test_parse.js <RM_AI_NPC.js 路径> */
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

const A = '        repairJsonText: function (s) {';
const B = '        /** 把一张卡写进某条 npc 条目';
const i = src.indexOf(A), j = src.indexOf(B);
if (i < 0 || j < 0) { console.error('✘ 找不到抠取区间', i, j); process.exit(1); }
const body = src.slice(i, j);
const Ainpc = {};
const obj = new Function('Ainpc', 'return { ' + body + ' };')(Ainpc);
Ainpc.persona = obj;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
    else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
const card = k => ({ key: k, name: 'N' + k, identity: 'x', appearance: 'y', personality: 'z', speech: 's', knowledge: ['a'], stance: 'b', relations: 'c', greeting: 'd', taboo: null });

console.log('── ① parseCards ──');
ok('裸数组', obj.parseCards('[{"key":"A"}]').length === 1);
ok('围栏代码块', obj.parseCards('```json\n[{"key":"A"}]\n```').length === 1);
ok('前后杂字', obj.parseCards('好的：\n[{"key":"A"}]\n以上。').length === 1);
ok('尾随逗号（清洗后）', obj.parseCards('[{"key":"A"},]').length === 1);
ok('包裹对象 {"cards":[…]}', obj.parseCards('{"cards":[{"key":"A"},{"key":"B"}]}').length === 2);
ok('包裹对象 {"personas":[…]}', obj.parseCards('{"personas":[{"key":"A"}]}').length === 1);
ok('单个对象', obj.parseCards('{"key":"A"}').length === 1);
ok('被截断的数组（抢救）', obj.parseCards('[{"key":"A"},{"key":"B"').length === 2, 'const=' + JSON.stringify(obj.parseCards('[{"key":"A"},{"key":"B"').map(c => c.key)));

console.log('\n── ② _matchCards ──');
let r = obj._matchCards(['M4:E1', 'M4:E4'], [card('M4:E1'), card('M4:E4')]);
ok('原样匹配', r.cards.length === 2 && r.filled === 0 && r.fuzzy === 0, JSON.stringify({ n: r.cards.length, f: r.filled, z: r.fuzzy }));

r = obj._matchCards(['M4:E1', 'M4:E4'], [card('M4：E1'), card(' m4:e4 ')]);
ok('全角冒号/大小写/空格 自动纠正', r.cards.length === 2 && r.fuzzy === 2 && r.filled === 0, JSON.stringify({ n: r.cards.length, f: r.filled, z: r.fuzzy }));

r = obj._matchCards(['M4:E1', 'M4:E4'], [card('X1'), card('X2')]);
ok('key 完全不同、数量相符 → 按顺序回填', r.cards.length === 2 && r.filled === 2 && r.cards[0].key === 'M4:E1' && r.cards[1].key === 'M4:E4', JSON.stringify({ f: r.filled }));

r = obj._matchCards(['M4:E1', 'M4:E4', 'M4:E7'], [card('X1'), card('X2')]);
ok('数量不符 → 不乱回填', r.cards.length === 0 && r.filled === 0, JSON.stringify({ n: r.cards.length, f: r.filled }));

r = obj._matchCards(['M4:E1', 'M4:E4'], [card('M4:E4'), card('M4:E1')]);
ok('乱序返回 → 按 keys 顺序还原', r.cards[0].key === 'M4:E1' && r.cards[1].key === 'M4:E4');

console.log('\n── ③ _envelope ──');
let e = obj._envelope(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '[]' } }], usage: { total_tokens: 5 } }));
ok('正常信封', e.payload === '[]' && e.finish === 'stop' && !e.truncated);
e = obj._envelope(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '[{"key"' } }] }));
ok('截断信封', e.truncated === true && e.finish === 'length');
e = obj._envelope(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '想了很久' } }] }));
ok('只回思考内容', e.payload === '' && e.reasoningChars === 4);
e = obj._envelope('不是 JSON 的纯文本');
ok('非 JSON 响应原样返回', e.payload === '不是 JSON 的纯文本');
e = obj._envelope(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: [{ text: 'ab' }, { text: 'cd' }] } }] }));
ok('content 是数组 → 拼起来', e.payload === 'abcd', JSON.stringify(e.payload));

console.log('\n── ④ 真实回复回放 ──');
const p = require('path');
const rawFile = p.join(__dirname, 'raw_persona.txt');
if (fs.existsSync(rawFile)) {
    const raw = fs.readFileSync(rawFile, 'utf8').replace(/^\uFEFF/, '');
    // 从 repro 的输出里读出本次 keys（repro_persona.js 会同时写 raw_persona.keys）
    const keyFile = p.join(__dirname, 'raw_persona.keys');
    const keys = fs.existsSync(keyFile)
        ? fs.readFileSync(keyFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
        : null;
    console.log('  raw_persona.txt 长度', raw.length, keys ? '| keys ' + keys.join(',') : '| (无 keys 文件，跳过匹配)');
    if (keys) {
        const parsed = obj.parseCards(raw);
        ok('parseCards 解析出全部卡片', parsed.length === keys.length, '得到 ' + parsed.length + '/' + keys.length);
        const mt = obj._matchCards(keys, parsed);
        ok('_matchCards 全部命中', mt.cards.length === keys.length, JSON.stringify({ n: mt.cards.length, 顺序回填: mt.filled, 模糊纠正: mt.fuzzy }));
        const bad = mt.cards.filter(c => !c.name || !c.identity || !c.greeting);
        ok('每张卡关键字段齐全', bad.length === 0, bad.length ? '缺字段 ' + bad.length + ' 张' : '');
    }
} else {
    console.log('  (无 raw_persona.txt，跳过)');
}

console.log('\n════ ' + pass + ' 通过 / ' + fail + ' 失败 ════');
process.exit(fail ? 1 : 0);
