/* 复现插件「角色人设」的一次真实请求 —— 严格照抄 RM_AI_NPC.js 的 buildMessages / 请求体。
   用法: node repro_persona.js --ai=<ai_npc 目录> [--group=9] [--size=8] [--dry]
*/
const fs = require('fs');
const path = require('path');
const https = require('https');

function arg(k, d) {
    const m = process.argv.find(a => a.startsWith('--' + k + '='));
    return m ? m.split('=').slice(1).join('=') : d;
}
const AI = arg('ai');
const GI = parseInt(arg('group', '9'), 10);
const SIZE = parseInt(arg('size', '8'), 10);
const DRY = process.argv.includes('--dry');

const J = f => JSON.parse(fs.readFileSync(path.join(AI, f), 'utf8').replace(/^\uFEFF/, ''));
const cfg = J('config.json');
const prompt = J('persona_prompt.json');
const sample = J('persona_sample.json');
const input = J('persona_input.json');
const bible = J('world_bible.json');

/* ---- 以下 4 个函数逐行照抄插件（只改 varname） ---- */
function g(x) { return x == null ? '' : String(x); }
function compactWorld(b) {
    if (!b) return '';
    const L = [];
    L.push('世界：' + g(b.world && b.world.summary));
    if (b.world && b.world.kingdom) L.push('王国：' + g(b.world.kingdom.name) + ' —— ' + g(b.world.kingdom.note));
    L.push('主要城镇：' + ((b.world && b.world.regions) || []).map(r => r.town + '（' + r.key + '）' + g(r.note)).join('；'));
    const pl = (b.world && b.world.places) || {};
    L.push('地点：' + Object.keys(pl).map(k => k + '＝' + pl[k]).join(' / '));
    if (b.faith) L.push('信仰：' + g(b.faith.goddess) + '。' + g(b.faith.desc) + ' 信众问候语：「' + (b.faith.greetings || []).join('」「') + '」');
    const fa = b.factions || {};
    L.push('势力：' + Object.keys(fa).map(k => k + '：' + fa[k]).join(' '));
    if (b.monsters) L.push('魔物：' + g(b.monsters.nature) + ' 已知：' + (b.monsters.known || []).join('、') + '。');
    if (b.society) L.push('社会：' + g(b.society.daily) + ' 货币为' + g(b.society.currency) + '。' + g(b.society.attitude));
    if (b.protagonist) L.push('主角：' + g(b.protagonist.name) + '，' + g(b.protagonist.desc) + ' 同伴：' + (b.protagonist.companions_actors || []).map(c => c.name).join('、') + '。');
    if (b.naming_convention) L.push('命名：' + g(b.naming_convention.rule) + g(b.naming_convention.implication));
    return L.join('\n');
}
function renderMember(m, idx) {
    const dlg = (m.dialogues && m.dialogues.length)
        ? m.dialogues.slice(0, 12).map(x => '    「' + x + '」').join('\n')
        : prompt.noDialogueNote;
    return prompt.memberTemplate
        .replace('{{INDEX}}', String(idx + 1))
        .replace('{{KEY}}', m.key)
        .replace('{{SPRITE}}', m.sprite || '（未知）')
        .replace('{{ACTOR_NAME}}', m.actorName || '（无）')
        .replace('{{DIALOGUES}}', dlg)
        .replace('{{NEIGHBORS}}', (m.neighbors || []).join('、') || '（无）');
}
function renderSample(max) {
    const cards = ((sample && sample.cards) || []).slice(0, max || 3);
    return cards.map(c => {
        const o = {};
        for (const k in c) if (Object.prototype.hasOwnProperty.call(c, k)) o[k] = c[k];
        o.key = '（占位符，不要照抄 —— 你必须用上面每一行里给出的真实 key）';
        delete o.actorId;
        return JSON.stringify(o, null, 1);
    }).join(',\n');
}
function buildMessages(group, members) {
    const world = compactWorld(bible);
    const user = prompt.userTemplate
        .replace('{{AVOID}}', '')
        .replace('{{AVOID_TAIL}}', '')
        .replace('{{WORLD_BIBLE}}', world)
        .replace(/\{\{COUNT\}\}/g, String(members.length))
        .replace('{{PLACE}}', group.title + '（' + group.place + '）')
        .replace('{{MEMBERS}}', members.map((m, i) => renderMember(m, i)).join('\n\n'))
        .replace('{{SAMPLE}}', renderSample(3));
    return { system: prompt.system, user, keys: members.map(m => m.key) };
}

const group = input.groups[GI];
const members = (group.members || []).slice(0, SIZE);
const m = buildMessages(group, members);

console.log('组:', group.title, '| 成员', members.length, '人:', m.keys.join(','));
console.log('system 长度:', m.system.length, ' user 长度:', m.user.length, '≈', Math.round(m.user.length / 1.4), 'token');
console.log('user 开头 200 字:', JSON.stringify(m.user.slice(0, 200)));
console.log('user 结尾 400 字:', JSON.stringify(m.user.slice(-400)));
if (DRY) process.exit(0);

/* 与插件同源：persona_prompt.json 的 batch.maxOutputTokens 优先，其次 cfg.personaMaxTokens */
const BATCH = prompt.batch || {};
const MAXOUT = parseInt(BATCH.maxOutputTokens, 10) || parseInt(cfg.personaMaxTokens, 10) || 16000;
const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: m.system }, { role: 'user', content: m.user }],
    temperature: cfg.temperature != null ? cfg.temperature : 1.0,
    stream: false,
    max_tokens: MAXOUT
};
console.log('max_tokens =', MAXOUT, ' (来源: persona_prompt.json batch.maxOutputTokens)');
const data = JSON.stringify(body);
const u = new URL(cfg.endpoint);
const t0 = Date.now();
const req = https.request({
    hostname: u.hostname, port: u.port || 443, path: u.pathname + (u.search || ''), method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Length': Buffer.byteLength(data)
    }
}, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
        const ms = Date.now() - t0;
        const text = Buffer.concat(chunks).toString('utf8');
        console.log('\n──────────────────────────────────────────');
        console.log('HTTP', res.statusCode, ' 用时', ms, 'ms');
        if (res.statusCode !== 200) { console.log(text.slice(0, 600)); return; }
        const j = JSON.parse(text);
        const ch = j.choices && j.choices[0];
        console.log('finish_reason =', ch && ch.finish_reason);
        console.log('usage =', JSON.stringify(j.usage));
        const msg = (ch && ch.message) || {};
        const content = msg.content;
        console.log('content 类型:', typeof content, ' 长度:', content ? content.length : 0);
        console.log('reasoning_content 长度:', msg.reasoning_content ? msg.reasoning_content.length : '(无)');
        console.log('message 键:', Object.keys(msg).join(','));
        console.log('\n----- content 开头 500 -----');
        console.log(String(content || '').slice(0, 500));
        console.log('\n----- content 结尾 500 -----');
        console.log(String(content || '').slice(-500));
        fs.writeFileSync(path.join(__dirname, 'raw_persona.txt'), String(content || ''), 'utf8');
        fs.writeFileSync(path.join(__dirname, 'raw_persona.keys'), m.keys.join('\n'), 'utf8');
        console.log('\n（原文已存 raw_persona.txt，keys 已存 raw_persona.keys）');
    });
});
req.on('error', e => console.log('ERR', e.message));
req.setTimeout(180000, () => { try { req.abort(); } catch (e) { } console.log('本机超时'); });
req.write(data);
req.end();
