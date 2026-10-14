/* eslint-disable */
/**
 * v2.9.10 行为验证：Mira 这种「不用 Show Text 说话」的游戏，AI 到底接不接管。
 *
 * 背景（玩家报的 bug）：「虽然说有角色人设了，但开了扮演。mira 里面互动还是
 *   没有选项！！什么都没有」—— 名单里有这个人、也把「所有人都交给 AI」打开了，
 *   走上去按确定键却什么都没有。
 *
 * 真机制（Mira）：NPC 台词全交给 TS_ADVsystem 念，剧情在 scenario/*.sl 里。
 *   事件 →（CU 插件把本体换成 `117 呼叫 CE41`）→ CE41 按 `_convertID` 分派 →
 *     · 罗谢(k=3) / 埃斯梅拉达(k=4)：`356 AdvLoad mob_ros` → `$advSystem.start()`
 *     · 4 个学生（没有 `_convertID`，走 CE41 末尾的兜底分支）：
 *       `355 $advSystem.start(event().name)` → 直接读 scenario/mob_098.sl
 *   两条路殊途同归，都落在 `ADV_System.prototype.start`。
 *
 * 这个探针把新入口直接开火（真 $dataMap + 真世界书 + 真 config，
 * 其中 allNpcsTalkable=true 就是玩家现在的状态）：
 *   ✓ 罗谢 / 埃斯梅拉达 / 4 个学生：ADV 被接管，原版脚本不播
 *   ✓ 接管挂在**最里面那层**解释器上（CE41 那层），外层不被覆盖
 *   ✓ 学生的「可交易」标签不再让它们被当成商人
 *   ✓ 不该接管的照旧放行：接触触发 / 系统条目 / 不在世界书 / 真商人 / 总开关
 *
 * 用法：node _probe_interact.js [--www=<游戏的 www 目录>]
 *   不给 --www 时由 harness 自己往上找（本文件紧挨着游戏目录就能跑）。
 *   这是**Mira 的回归测试**（样本取 011：実験室）：换别的游戏、世界书里没有
 *   `M11:E19` 时，本探针会直接跳过并说明原因，不算失败。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* --www 要在 require harness 之前塞进 argv —— harness 靠它定位游戏目录 */
const ARGV = process.argv.slice(2);
const wwwArg = (ARGV.filter(function (a) { return a.indexOf('--www=') === 0; })[0] || '').split('=')[1];
process.argv = ['node', 'harness.js'].concat(wwwArg ? ['--www=' + wwwArg] : []);
const H = require('./harness.js');
const WWW = H.WWW, PLUGIN = H.PLUGIN;
const sandbox = H.sandbox, Ainpc = H.Ainpc;
if (H.loadError) { console.error('插件加载失败：', H.loadError.message); process.exit(1); }
const Game_Interpreter = sandbox.Game_Interpreter;
const Game_Event = sandbox.Game_Event;

let pass = 0, fail = 0;
function ok(n, extra) { pass++; console.log('  ✓ ' + n + (extra ? '  ← ' + extra : '')); }
function bad(n, extra) { fail++; console.log('  ❌ ' + n + (extra ? '  ← ' + extra : '')); }

function loadJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(WWW, rel), 'utf8').replace(/^\uFEFF/, ''));
}

/* 本探针的样本全部取自 Mira 的「011：実験室」；换游戏时跳过而不是报错 */
if (!Ainpc.npcByKey('M11:E19')) {
    console.log('这部游戏的世界书里没有 M11:E19（011：実験室的罗谢）。');
    console.log('本探针是 Mira 的回归测试，样本不匹配 —— 跳过全部用例。');
    process.exit(0);
}

/* ---------------------------------------------- 环境：真 $dataMap + CU 标记 */
const MAPID = 11;
const mapData = loadJson('data/Map011.json');
sandbox.$dataMap = mapData;
sandbox.$gameMap.mapId = function () { return MAPID; };
Ainpc._loadedMapId = MAPID;

const ACTORS = loadJson('data/Actors.json');
function applyCuTags(ev) {
    if (!ev || !ev.pages || !ev.pages[0]) return;
    const list = ev.pages[0].list || [];
    let i = 0;
    for (; i < list.length; i++) if (list[i].code === 108 && list[i].parameters[0] === 'ADD_OPTIONS') break;
    if (i >= list.length) return;
    ev.type = 0;
    for (i += 1; i < list.length && ev.type !== -1; i++) {
        if (list[i].code !== 408) continue;
        const p = list[i].parameters[0];
        if (p.indexOf('+type') >= 0) ev.type = parseInt(Number(p.substr(5, p.length - 1)) || 0, 10);
        else if (p.indexOf('+actor') >= 0) {
            ev.note = parseInt(Number(p.substr(6, p.length - 1)) || 0, 10);
            ev.pages[0].image.characterName = ACTORS[ev.note].characterName;
        }
    }
}
(mapData.events || []).forEach(function (ev) { if (ev) applyCuTags(ev); });

/* `$gameMap.event(id)` —— 真事件的 page()，供「只认玩家按键触发」那一条读。
 * 每次测试都可以临时替换（trigger 覆盖用），统一走 installMapEvent()。 */
const realMapEvent = function (id) {
    const ev = mapData.events[id];
    if (!ev) return null;
    return { _mapId: MAPID, _eventId: id, page: function () { return ev.pages[0]; } };
};
sandbox.$gameMap.event = realMapEvent;

/* ------------------------------------------------------ 桩：接管记录 */
const taken = [];
Ainpc.startConversation = function (interp, key, orig, opts) {
    taken.push({
        key: key, interp: interp, parent: interp._ainpcParent,
        own: !!interp._ainpcOwn, face: (opts && opts.face) || null
    });
};

/** 重建「117 进公共事件」的解释器链：root → … → inner（最里面那层）。
 *  `code` = 此刻正停在哪条指令上（356 AdvLoad / 355 脚本）—— 真实的 ADV 调用
 *  一定发生在某条 355/356 的执行中，插件靠这一点区分「指令流里叫的」与
 *  「场景自己放的演出」（后者的 _eventId 只是残留值）。 */
function makeChain(mapId, eventId, depth, code) {
    code = code || 356;
    const cur = [
        { code: code, indent: 0, parameters: [code === 356 ? 'AdvLoad x' : '$advSystem.start("x")'] },
        { code: 0, indent: 0, parameters: [] }
    ];
    const root = new Game_Interpreter(0);
    root.setup(cur, eventId);
    root._mapId = mapId;
    let it = root;
    for (let i = 0; i < depth; i++) {
        it.setupChild(cur, eventId);
        it = it._childInterpreter;
        it._mapId = mapId;
    }
    sandbox.$gameMap._interpreter = root;
    return { root: root, inner: it };
}

/** 临时改点东西跑一段，跑完无论成败都还原（不用 setTimeout —— 那是异步的坑）。 */
function withTemp(patches, fn) {
    const saved = [];
    patches.forEach(function (p) { saved.push({ t: p[0], k: p[1], v: p[0][p[1]] }); p[0][p[1]] = p[2]; });
    try { return fn(); } finally {
        saved.forEach(function (s) { s.t[s.k] = s.v; });
    }
}

/* ============================================================ 1. 门闸 */
console.log('== ① 门闸（世界书 / 开关 / 可接管）==');
[[19, 'ロシェ'], [7, 'エスメラルダ'], [6, '学生 mob_098'], [11, '系统点(mobBranch)'], [2, '图块事件']]
    .forEach(function (t) {
        const id = t[0], key = 'M' + MAPID + ':E' + id;
        console.log('  · E' + id + ' ' + t[1] + ' | 世界书=' + !!Ainpc.npcByKey(key) +
            ' 启用=' + Ainpc.isEnabled(key) + ' 可接管=' + Ainpc.eventIsTalkable(MAPID, id) + '  ' + key);
    });

/* ================================================ 2. ADV 入口（核心） */
console.log('\n== ② ADV 入口（ADV_System.prototype.start）==');
[
    { id: 19, who: 'ロシェ', file: 'mob_ros', depth: 1, code: 356 },
    { id: 7, who: 'エスメラルダ', file: 'mob_esm', depth: 1, code: 356 },
    { id: 6, who: '学生 mob_098', file: 'mob_098', depth: 1, code: 355 },
    { id: 9, who: '学生 mob_100', file: 'mob_100', depth: 1, code: 355 },
    { id: 15, who: '学生 mob_096', file: 'mob_096', depth: 1, code: 355 },
    { id: 16, who: '学生 mob_099', file: 'mob_099', depth: 1, code: 355 }
].forEach(function (t) {
    const chain = makeChain(MAPID, t.id, t.depth, t.code);
    taken.length = 0;
    const rv = sandbox.$advSystem.start(t.file);
    const key = 'M' + MAPID + ':E' + t.id;
    if (taken.length === 1 && taken[0].key === key && taken[0].parent === chain.inner && rv === undefined) {
        ok('E' + t.id + ' ' + t.who + ' 「' + t.file + '.sl」被接管',
            '第 ' + t.code + ' 号指令（' + (t.code === 356 ? '356 AdvLoad' : '355 $advSystem.start') + '）| ' +
            '原版未播 | 对话挂在最里层(CE41)下 | 外层未被覆盖=' + (chain.root._childInterpreter === chain.inner) +
            ' | 已标 _ainpcOwn=' + taken[0].own);
    } else {
        bad('E' + t.id + ' ' + t.who + ' 没被接管',
            'taken=' + JSON.stringify(taken.map(function (x) { return x.key + '@' + (x.parent === chain.inner ? 'inner' : 'other'); })) + ' rv=' + rv);
    }
});
/* 深度 0：台词直接写在自己那一页的事件（本作的 Map018:E14 就是这种） */
(function () {
    const chain = makeChain(MAPID, 19, 0);
    taken.length = 0;
    const rv = sandbox.$advSystem.start('mob_ros');
    if (taken.length === 1 && taken[0].parent === chain.root && rv === undefined) {
        ok('深度 0 的事件（台词就写在自己那页）也能接管', '对话挂在根解释器下');
    } else bad('深度 0 没接管', 'taken=' + taken.length + ' rv=' + rv);
})();
/* startAutMessage 是同一个入口的第二个名字 */
(function () {
    makeChain(MAPID, 19, 1);
    taken.length = 0;
    const rv = sandbox.$advSystem.startAutMessage('mob_ros');
    if (taken.length === 1 && rv === undefined) ok('startAutMessage（另一个 ADV 入口）同样被接管');
    else bad('startAutMessage 没被接管', 'taken=' + taken.length + ' rv=' + rv);
})();

/* ------------------------------------------------------- 否定用例 */
console.log('\n== ③ 不该接管的照旧放行 ==');
function released(name, id, file, prepare) {
    try {
        const chain = makeChain(MAPID, id, 1);
        if (prepare) prepare(chain);
        taken.length = 0;
        const rv = sandbox.$advSystem.start(file);
        if (!taken.length && rv === 'VANILLA') ok(name);
        else bad(name, 'taken=' + JSON.stringify(taken.map(function (x) { return x.key; })) + ' rv=' + rv);
    } finally {
        sandbox.$gameMap.event = realMapEvent;
        Ainpc.active = null;
        Ainpc.config.advIntercept = true;
    }
}
/* 接触触发（trigger=1）—— Mira 208 处 AdvLoad 里 123 处是这种演出脚本 */
released('接触触发的事件（trigger=1）不接管', 6, 'mob_098', function () {
    sandbox.$gameMap.event = function (id) {
        const ev = mapData.events[id];
        if (!ev) return null;
        const pg = ev.pages[0];
        return {
            _mapId: MAPID, _eventId: id,
            page: function () { return { list: pg.list, trigger: id === 6 ? 1 : pg.trigger }; }
        };
    };
});
/* 不在世界书里 */
released('不在世界书里的事件不接管（E2 图块）', 2, 'mob_098');
/* aiHint=system（交互点 / 传送点） */
released('系统条目（aiHint=system）不接管', 11, 'mob_098');
/* 真商人（M37:E31 敵7，shop.branch=7 有真货架）→ 留给 302 */
released('真商人（带 branch 货架）不接管，留给商店指令', 31, 'item_shop', function (chain) {
    chain.root._mapId = 37;
    if (chain.inner) chain.inner._mapId = 37;
    sandbox.$gameMap.event = function () { return null; };
});
/* 已经有一场对话了 */
released('已有一场对话进行中 → 不接管（不套娃）', 19, 'mob_ros', function () {
    Ainpc.active = { key: 'M11:E19' };
});
/* 总开关 */
released('advIntercept=false 时退回旧行为', 19, 'mob_ros', function () {
    Ainpc.config.advIntercept = false;
});
/* 场景 / 菜单自己放的演出：解释器没停在 355/356 上，_eventId 只是残留值 */
released('场景自放的演出（解释器没停在 355/356 上）不接管', 19, 'mob_ros', function (chain) {
    chain.inner._list = [{ code: 0, indent: 0, parameters: [] }];
    chain.inner._index = 0;
});
/* ADV 脚本内部又调一次：解释器正被 ADV 挂着等（updateWait() 为真） */
released('ADV 脚本内部再调一次（解释器正被挂着等）不接管', 19, 'mob_ros', function (chain) {
    chain.inner._waitMode = 'ainpc';
});

/* ================================== 4. Game_Event.start（本来就什么都不做） */
console.log('\n== ④ 空事件入口（Game_Event.start）==');
function makeEvent(id, trigger, list) {
    const ev = new Game_Event();
    ev._mapId = MAPID; ev._eventId = id;
    ev.page = function () { return { list: list, trigger: trigger }; };
    ev.list = function () { return list; };
    ev.isTriggerIn = function () { return true; };
    return ev;
}
function freshRoot(eventId) {
    const it = new Game_Interpreter(0);
    it.setup([{ code: 0, indent: 0, parameters: [] }], eventId);
    it._mapId = MAPID;
    sandbox.$gameMap._interpreter = it;
    return it;
}
(function () {
    const inertList = [
        { code: 108, indent: 0, parameters: ['ADD_OPTIONS'] },
        { code: 408, indent: 0, parameters: ['+type1'] },
        { code: 0, indent: 0, parameters: [] }
    ];
    const ev = makeEvent(19, 0, inertList);
    freshRoot(19);
    taken.length = 0;
    ev.start();
    if (taken.length === 1 && taken[0].key === 'M11:E19') {
        ok('「按下去本来就什么都不做」的事件被接管', '原版 start 未执行=' + !ev._started);
    } else bad('空事件没被接管', 'taken=' + taken.length);
})();
(function () {
    /* 学生的真实形态：page 里有 117 → 放行，让 CE41 去说话（走 ② 那条路） */
    const ev = makeEvent(6, 0, mapData.events[6].pages[0].list);
    freshRoot(6);
    taken.length = 0;
    ev.start();
    if (!taken.length && ev._started) ok('学生那种「117 去 CE41」的事件 → 放行（对话在 CE 里，走 ADV 入口）');
    else bad('带 117 的事件被空事件钩子抢了', 'taken=' + taken.length);
})();
(function () {
    const list = [{ code: 101, indent: 0, parameters: [] }, { code: 401, indent: 0, parameters: ['x'] }, { code: 0, indent: 0, parameters: [] }];
    const ev = makeEvent(19, 0, list);
    freshRoot(19);
    taken.length = 0;
    ev.start();
    if (!taken.length && ev._started) ok('页里有 101 的事件 → 放行给 command101 老路');
    else bad('有 101 的事件被空事件钩子抢了', 'taken=' + taken.length);
})();
(function () {
    const list = [{ code: 108, indent: 0, parameters: ['x'] }, { code: 0, indent: 0, parameters: [] }];
    const ev = makeEvent(19, 1, list);
    freshRoot(19);
    taken.length = 0;
    ev.start();
    if (!taken.length && ev._started) ok('非按键触发（trigger=1）→ 不接管');
    else bad('接触触发的事件被空事件钩子接管了', 'taken=' + taken.length);
})();

/* ================================= 5. 商人判定（121 个路人不再被误判） */
console.log('\n== ⑤ 「可交易」标签 ≠ 商人 ==');
[
    { key: 'M11:E6', who: '学生 mob_098（共用 CE41，shop 里没有 branch）', real: false, mer: false },
    { key: 'M11:E15', who: '学生 mob_096（同上）', real: false, mer: false },
    { key: 'M37:E31', who: '敵7 素材摊（shop.branch=7，真货架）', real: true, mer: true },
    { key: 'M37:E33', who: '敵8 素材摊（shop.branch=8）', real: true, mer: true },
    { key: 'M11:E19', who: 'ロシェ（没有 shop 字段）', real: false, mer: false }
].forEach(function (t) {
    const npc = Ainpc.npcByKey(t.key);
    if (!npc) { bad(t.key + ' 不在世界书里（数据变了？）'); return; }
    const real = Ainpc.hasRealShop(npc), mer = Ainpc.isMerchant(npc);
    if (real === t.real && mer === t.mer) ok(t.who + ' → hasRealShop=' + real + ' isMerchant=' + mer);
    else bad(t.who, '期望 hasRealShop=' + t.real + ' isMerchant=' + t.mer + '，实际 ' + real + '/' + mer);
});

/* ============================================ 6. 关掉总开关（端到端） */
console.log('\n== ⑥ 总开关 advIntercept=false 时两个入口都不接管 ==');
(function () {
    const rv = withTemp([[Ainpc.config, 'advIntercept', false]], function () {
        makeChain(MAPID, 19, 1);
        taken.length = 0;
        const r = sandbox.$advSystem.start('mob_ros');
        const list = [{ code: 108, indent: 0, parameters: ['x'] }, { code: 0, indent: 0, parameters: [] }];
        const ev = makeEvent(19, 0, list);
        ev.start();
        return { r: r, started: ev._started, n: taken.length, keys: taken.map(function (x) { return x.key; }) };
    });
    if (rv.n === 0 && rv.r === 'VANILLA' && rv.started) ok('关掉总开关后两个入口都不接管（原版照跑）');
    else bad('关掉总开关后仍在接管', 'taken=' + JSON.stringify(rv.keys));
})();

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
