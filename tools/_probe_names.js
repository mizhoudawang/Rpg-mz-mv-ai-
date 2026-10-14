/* eslint-disable */
/**
 * v2.9.13 回归：**名字不许再显示成 `mob_096`。**
 *
 * 玩家原话：「对话时我发现学生老师等人名字变成了字符数字」
 *   —— 011：実験室的 4 个校服学生，横幅上写的是 `mob_098` / `mob_100` / `mob_096` / `mob_099`。
 *   共 84 条（学生 68 / 老师 4 / 其余各种描述性称呼）。
 *
 * 修法两处：扫描器去 `scenario/<事件名>.sl` 里取游戏自己的称呼（真源），
 *   插件 `isBadNpcName` 加 `isAssetName` 兜底（老包没重扫时退到 role）。
 *
 * v2.9.14 续钉：**英文游戏别把人叫成 `Boat` / `Inn` / `Wake Up`。**
 *   玩家实测引擎 demo / 免费英文 MV：NPC 名直接显示成事件标签
 *   （`OreVein Spawner` / `TemplateMob` / `Cutscene` / `FirstEvent` / `Return` …）。
 *   修法：扫描器 + 插件各加一份 **`isLabelName`**（空格/下划线/小驼峰切词，命中系统词表即判标签）。
 *
 * 本探针钉五件事：
 *   ① **数据层**：世界书里没有任何条目的 name 是素材名；
 *   ② **插件兜底**：`isAssetName` / `isBadNpcName` 判定正确，且 `displayName`
 *      在「名字是素材名」时能退到 role，而**好名字一个都不误伤**；
 *   ③ **同口径（素材名）**：扫描器认定为素材名的，插件也必须认定（前者 ⊆ 后者）——
 *      两边是两份实现（真源 + 兜底），这条是它们的守门员。
 *   ④ **插件：事件标签名**：`isLabelName` 判据表（13 命中 / 12 不误伤 / 中日文一律放行）；
 *   ⑤ **同口径（标签名）**：把扫描器源码里的 `LABEL_WORDS` 抠出来 eval，
 *      借插件的算法跑一遍 ⇒ 扫描器认的标签名，插件也必须认。
 *
 * 用法：node _probe_names.js [--www=<游戏的 www 目录>] [--plugin=<插件路径>] [--scan=<扫描器路径>]
 *   `--scan=` 缺省读 `--www` 下已部署的 `ai_npc/tools/scan_game.js`；
 *   部署前想验新扫描器，直接指 `tools_es5_303/scan_game.js`。
 *   `--wb=<worldbook.json>` 缺省读 `--www/ai_npc/worldbook.json`；**重扫还没部署时**
 *   指到 `_tmp/ab21x_b/<游戏>/worldbook.json` 就能先验数据层（⑥ 那几节要用）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const aArgs = process.argv.slice(2);
function argOf(n) { return (aArgs.filter(function (a) { return a.indexOf('--' + n + '=') === 0; })[0] || '').split('=').slice(1).join('='); }
/* `--game=<label>`：从 `_tmp/games.json` 取真实路径 —— 绕开 Git Bash 传中文参数丢失的坑。 */
let wwwArg = argOf('www'), plugArg = argOf('plugin'), scanArg = argOf('scan');
const wbArg = argOf('wb');
const gameArg = argOf('game');
if (gameArg) {
    const gs = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp', 'games.json'), 'utf8'));
    const g = gs.filter(function (x) { return x.label === gameArg; })[0];
    if (!g) { console.error('未知游戏：' + gameArg + '（可选：' + gs.map(function (x) { return x.label; }).join(' / ') + '）'); process.exit(1); }
    const root = g.root;
    /* MV 有 `www/`，MZ 没有（根目录就是 www）。 */
    const base = fs.existsSync(path.join(root, 'www', 'js')) ? path.join(root, 'www') : root;
    wwwArg = wwwArg || base;
    plugArg = plugArg || path.join(base, 'js', 'plugins', 'RM_AI_NPC.js');
}
process.argv = ['node', 'harness.js']
    .concat(wwwArg ? ['--www=' + wwwArg] : [])
    .concat(plugArg ? ['--plugin=' + plugArg] : []);

const H = require('./harness.js');
if (H.loadError) { console.error('插件加载失败：' + H.loadError.message); process.exit(1); }
const Ainpc = H.Ainpc;

let pass = 0, fail = 0;
function ok(n, extra) { pass++; console.log('  ✓ ' + n + (extra ? '  ← ' + extra : '')); }
function bad(n, extra) { fail++; console.log('  ❌ ' + n + (extra ? '  ← ' + extra : '')); }

/* 共享样本：素材名（该拦）× 正常名（不许拦） */
const ASSET = ['mob_096', 'mob06', 'Mob_Uniform_A', '!mini_Crystal', '!$hon24', 'EV007'];
const HUMAN = ['学生', '老师', '达观的学生', '罗谢', '药水商人', '亲切的居民', 'おなほ', '米拉'];

/* ───────────────────────── ① 数据层：世界书里不该有素材名 ───────────────────────── */
console.log('== ① 数据层：世界书里没有素材名 ==');
const wb = JSON.parse(fs.readFileSync(wbArg || path.join(H.WWW, 'ai_npc', 'worldbook.json'), 'utf8').replace(/^\uFEFF/, ''));
const npcs = wb.npcs || wb.entries || [];
const dirty = npcs.filter(function (n) { return n && n.name && Ainpc.isAssetName(n.name); });
if (!dirty.length) ok('全部 ' + npcs.length + ' 条的人名都不是素材名');
else {
    bad(dirty.length + ' 条的人名还是素材名（需要重跑一次扫描）');
    dirty.slice(0, 10).forEach(function (n) { console.log('      ' + n.key + '  name=' + JSON.stringify(n.name)); });
}
const byFrom = {};
npcs.forEach(function (n) { byFrom[n.nameFrom || '(无)'] = (byFrom[n.nameFrom || '(无)'] || 0) + 1; });
console.log('    nameFrom 分布 = ' + JSON.stringify(byFrom));
if (byFrom['scenario']) ok('有 ' + byFrom['scenario'] + ' 条名字来自台词脚本（nameFrom=scenario）');
else console.log('    ℹ 本作没有 scenario 命名（若为伊莉莎属正常）');
/* 事件标签名（英文游戏专有）—— 只是体检报告：部署了旧扫描器的世界书里还会有，重扫一次即清零。 */
if (Ainpc.isLabelName) {
    const label = npcs.filter(function (n) { return n && n.name && n.name === n.eventName && Ainpc.isLabelName(n.name); });
    if (!label.length) ok('世界书里没有「事件标签当人名」的条目');
    else console.log('    ℹ ' + label.length + ' 条人名还是事件标签（跑一次重扫即退回 role）：'
        + label.slice(0, 8).map(function (n) { return n.name; }).join(' / '));
}

/* ───────────────────────── ② 插件兜底 ───────────────────────── */
console.log('\n== ② 插件兜底：isAssetName / isBadNpcName / displayName ==');
let aBad = [];
ASSET.forEach(function (s) { if (!Ainpc.isAssetName(s)) aBad.push(s); });
if (!aBad.length) ok('素材名全部被认出', ASSET.join(' / '));
else bad('这些素材名没被认出：' + aBad.join(' / '));

let hBad = [];
HUMAN.forEach(function (s) { if (Ainpc.isAssetName(s)) hBad.push(s); });
if (!hBad.length) ok('正常名字一个都没误伤', HUMAN.join(' / '));
else bad('这些正常名字被误判成素材名：' + hBad.join(' / '));

let nBad = [];
ASSET.forEach(function (s) { if (!Ainpc.isBadNpcName(s)) nBad.push(s); });
if (!nBad.length) ok('isBadNpcName 认素材名（displayName 会跳过它们）');
else bad('isBadNpcName 漏了：' + nBad.join(' / '));

/* displayName 的降级：注入一个「名字=素材名、role=学生」的假条目 */
const K1 = '__probe_asset__:E1', K2 = '__probe_good__:E1';
const bakIdx = Ainpc.npcIndex[K1], bakIdx2 = Ainpc.npcIndex[K2];
Ainpc.npcIndex[K1] = { key: K1, name: 'mob_999', role: '学生', eventName: 'mob_999', tags: [] };
Ainpc.npcIndex[K2] = { key: K2, name: '罗谢', role: '居民', eventName: 'EV019', tags: [] };
try {
    const got = Ainpc.displayName(K1);
    if (got === '学生') ok('displayName 遇到素材名会退到 role', 'mob_999 → 「学生」');
    else bad('displayName 没退到 role', '实际 = ' + JSON.stringify(got));
    const got2 = Ainpc.displayName(K2);
    if (got2 === '罗谢') ok('displayName 不误伤正常名字', '→ 「罗谢」');
    else bad('正常名字被改掉了', '实际 = ' + JSON.stringify(got2));
} finally {
    if (bakIdx === undefined) delete Ainpc.npcIndex[K1]; else Ainpc.npcIndex[K1] = bakIdx;
    if (bakIdx2 === undefined) delete Ainpc.npcIndex[K2]; else Ainpc.npcIndex[K2] = bakIdx2;
}

/* ───────────────────────── ③ 同口径：扫描器的判据 ⊆ 插件的判据 ───────────────────────── */
console.log('\n== ③ 同口径：扫描器认定的素材名，插件也必须认定 ==');
/* 两份实现（扫描器是真源、插件是兜底）。这里把扫描器源码里 `isAssetName` 的
 * **正则字面量抠出来再 eval** —— 测的就是实际会跑的那一份，不是另抄一份。 */
const scanFile = scanArg || path.join(H.WWW, 'ai_npc', 'tools', 'scan_game.js');
const scanFn = (function () {
    if (!fs.existsSync(scanFile)) return null;
    const src = fs.readFileSync(scanFile, 'utf8');
    const body = /function isAssetName\([\s\S]*?\n\s*\}/.exec(src);
    if (!body) return null;
    const lits = body[0].match(/\/(?:[^\/\\\n\[]|\\.|\[[^\]]*\])+\/[a-z]*/g) || [];
    const res = [];
    lits.forEach(function (l) { try { res.push(eval(l)); } catch (e) { } });
    if (!res.length) return null;
    return function (v) {
        const t = String(v == null ? '' : v).trim();
        if (!t) return false;
        for (let i = 0; i < res.length; i++) if (res[i].test(t)) return true;
        return /^[!$]/.test(t);
    };
})();
if (!scanFn) console.log('  ℹ 抠不到扫描器的判据（' + scanFile + '）—— 跳过同口径检查');
else {
    const CROSS = ASSET.concat(['mob076', 'Mob_Uniform_G', 'mob_123']);
    const miss = CROSS.filter(function (s) { return scanFn(s) && !Ainpc.isAssetName(s); });
    const extra = CROSS.filter(function (s) { return Ainpc.isAssetName(s) && !scanFn(s); });
    if (!miss.length) ok('扫描器认的素材名，插件也全部认（前者 ⊆ 后者）',
        extra.length ? '（插件多认 ' + extra.length + ' 种：' + extra.join('/') + '，属兜底更宽，符合设计）' : '');
    else bad('插件漏了扫描器会拦的形态：' + miss.join(' / '));
    const hw = HUMAN.filter(function (s) { return scanFn(s); });
    if (!hw.length) ok('两边都不误伤正常名字');
    else bad('扫描器误判正常名字：' + hw.join(' / '));
}

/* ───────────────────────── ④ 插件：isLabelName 认事件标签 ───────────────────────── */
console.log('\n== ④ 插件：isLabelName 认事件标签名（英文游戏的「Boat / Inn / Wake Up」） ==');
/* 来源：`D:/测试插件区` 实测的英文 MV —— 事件标签本来是该事件的用途说明，不是人名。 */
const LABEL = ['TemplateMob', 'OreVein Spawner', 'Blacksmithing Crystal', 'Intro Script',
    'Second Troll Battle', 'Main Event', 'Cutscene', 'Boat', 'Inn', 'Return', 'Wake Up',
    'RandomPositionTest', 'FirstEvent',
    /* 【v2.9.18】带尾部编号的英文标签 —— 曾经因为"切词时把空格吃掉"漏掉（`sign2` ≠ `sign`）。 */
    'Stay Out Sign 2', 'Stay Out Sign 3'];
/* 真名一个都不许动（含驼峰 / 空格 / 全大写形态）。
 * 后 7 个是「本身就是常见人名的歧义词」—— 单独出现时必须放行（见 LABEL_WEAK）。 */
const NOT_LABEL = ['Reed', 'Jim', 'Doc', 'Frank', 'Evan', 'Bob', 'Sky', 'John', 'Troll',
    'Smith', 'Old Smith', 'MacDonald', 'Crystal', 'Rose', 'Star', 'Sun', 'River', 'Stone'];
/* 歧义词 + 另一个词 = 事件标签（这些必须照抓）。 */
const LABEL_MULTI = ['Blacksmithing Crystal', 'Crystal Blade', 'Ore Vein Crystal',
    'Star Fragment', 'River Gate', 'Stone Door'];
/* 中日文名天然不含这些英文词 —— 中文/日文游戏必须逐字节零差异。 */
const CJK = ['学生', '达观的学生', '罗谢', '药水商人', 'おなほ', '旅店老板', 'ロシェ', '米拉'];
if (!Ainpc.isLabelName) bad('插件没有 isLabelName（v2.9.14 的新判据没进插件）');
else {
    const hit = LABEL.filter(function (s) { return Ainpc.isLabelName(s); });
    if (hit.length === LABEL.length) ok('实测的 ' + LABEL.length + ' 处事件标签全部命中', LABEL.join(' / '));
    else bad('漏认 ' + (LABEL.length - hit.length) + ' 处：' + LABEL.filter(function (s) { return !Ainpc.isLabelName(s); }).join(' / '));

    const hurt = NOT_LABEL.filter(function (s) { return Ainpc.isLabelName(s); });
    if (!hurt.length) ok(NOT_LABEL.length + ' 个真名一个都没误伤（含 Crystal/Rose 这类歧义词）', NOT_LABEL.join(' / '));
    else bad('这些真名被当成标签了：' + hurt.join(' / '));

    /* 歧义词只有「单飞」才放行 —— 旁边还有别的词就还是标签。 */
    const multiMiss = LABEL_MULTI.filter(function (s) { return !Ainpc.isLabelName(s); });
    if (!multiMiss.length) ok(LABEL_MULTI.length + ' 个「歧义词 + 别的词」照抓', LABEL_MULTI.join(' / '));
    else bad('这些该抓的漏了：' + multiMiss.join(' / '));

    const cjkHurt = CJK.filter(function (s) { return Ainpc.isLabelName(s); });
    if (!cjkHurt.length) ok('中日文名一律放行（纯 ASCII 闸门生效）');
    else bad('中日文名被误判：' + cjkHurt.join(' / '));

    /* 空串 / null / 纯符号 / 事件编号（EV007 由另一条规则管，不是标签）。
     * 【v2.9.18】`EV_007` 移出去了 —— 它含下划线+数字，属于「素材名形状」，现在判标签是对的。 */
    const edgeBad = [];
    [[null, 'null'], [undefined, 'undefined'], ['', '空串'], ['   ', '全空格'],
     ['!!!', '纯符号'], ['EV007', 'EV 编号']].forEach(function (p) {
        if (Ainpc.isLabelName(p[0])) edgeBad.push(p[1]);
    });
    if (!edgeBad.length) ok('边界值（null/空/符号/EV 编号）一个都没被当成标签');
    else bad('边界值被误判：' + edgeBad.join(' / '));

    /* isBadNpcName 必须把标签名一并收编（displayName 靠它跳过）。 */
    const nbad = LABEL.filter(function (s) { return !Ainpc.isBadNpcName(s); });
    if (!nbad.length) ok('isBadNpcName 认标签名（displayName 会跳过它们）');
    else bad('isBadNpcName 漏了标签名：' + nbad.join(' / '));

    /* displayName 的降级：名字=标签、role=居民 → 应显示 role。 */
    const K3 = '__probe_label__:E1', K4 = '__probe_labelgood__:E1';
    const b3 = Ainpc.npcIndex[K3], b4 = Ainpc.npcIndex[K4];
    Ainpc.npcIndex[K3] = { key: K3, name: 'Stay Out Sign', role: '居民', eventName: 'Stay Out Sign', tags: [] };
    Ainpc.npcIndex[K4] = { key: K4, name: 'MacDonald', role: '村民', eventName: 'EV042', tags: [] };
    try {
        const g3 = Ainpc.displayName(K3);
        if (g3 === '居民') ok('displayName 遇到标签名会退到 role', 'Stay Out Sign → 「居民」');
        else bad('displayName 没退到 role', '实际 = ' + JSON.stringify(g3));
        const g4 = Ainpc.displayName(K4);
        if (g4 === 'MacDonald') ok('displayName 不误伤真名（MacDonald）');
        else bad('真名被改掉了', '实际 = ' + JSON.stringify(g4));
    } finally {
        if (b3 === undefined) delete Ainpc.npcIndex[K3]; else Ainpc.npcIndex[K3] = b3;
        if (b4 === undefined) delete Ainpc.npcIndex[K4]; else Ainpc.npcIndex[K4] = b4;
    }
}

/* ───────────────── ④b 插件：isLabelName 认【中日文】事件标签（v2.9.15） ───────────────── */
console.log('\n== ④b 插件：isLabelName 认中日文事件标签（「分支 宝箱 / 调查书架 / 主线 斯卡雷特」）==');
/* 来源：Steam 三款中文游戏实测（《偕老同穴》《呆呆大冒险》《Routine Soul》）——
 * 这些事件名原先会原样摆进 AI 扮演菜单。 */
const CJK_LABEL = ['分支 宝箱', '调查书架', '调查任意', '解锁书架 梦', '必经提示', '猛犸传送门',
    '圣堂水晶', '事件箱', '公告牌', '主线 床', '开场', '调查花', '调查物资', '密室之门', '路口指示牌'];
/* 同一个游戏里的真名 —— 一个都不许动。 */
const CJK_KEEP = ['斯卡雷特', '路明泽', '铁砧公主', '梅琳达', '旅店老板', '守门人', '读书人',
    '小智', '泉哥', '抓蓝', '抓黄', '粉', '猫', '心宝', '精灵女王', '学生', '药水商人', 'ロシェ', '米拉'];
if (typeof Ainpc.isLabelName !== 'function') bad('没有 isLabelName');
else {
    const miss = CJK_LABEL.filter(function (s) { return !Ainpc.isLabelName(s); });
    if (!miss.length) ok('中日文标签 ' + CJK_LABEL.length + '/' + CJK_LABEL.length + ' 全部命中');
    else bad('漏认 ' + miss.length + ' 处：' + miss.join(' / '));
    const hurt = CJK_KEEP.filter(function (s) { return Ainpc.isLabelName(s); });
    if (!hurt.length) ok('中日文真名 ' + CJK_KEEP.length + ' 个零误伤', CJK_KEEP.join(' / '));
    else bad('中日文真名被误判：' + hurt.join(' / '));

    if (typeof Ainpc.cleanEventName !== 'function') bad('插件没有 cleanEventName（前缀剥离没进插件）');
    else {
        const pairs = [['主线 斯卡雷特', '斯卡雷特'], ['主线 抓蓝', '抓蓝'],
            /* 【v2.9.18】剥完只剩一个字 → 弃用（实测《偕老同穴》把"粉"摆进了菜单）。 */
            ['主线 粉', ''],
            ['主线 出门', ''], ['主线 床', ''], ['分支 宝箱', ''], ['调查书架', ''],
            ['斯卡雷特', '斯卡雷特'], ['路明泽', '路明泽']];
        const badc = pairs.filter(function (p) { return Ainpc.cleanEventName(p[0]) !== p[1]; });
        if (!badc.length) ok('cleanEventName 前缀剥离 ' + pairs.length + '/' + pairs.length + ' 正确');
        else bad('cleanEventName 不符：' + badc.map(function (p) {
            return p[0] + '→' + JSON.stringify(Ainpc.cleanEventName(p[0])) + '(期望 ' + JSON.stringify(p[1]) + ')';
        }).join(' / '));
    }
}

/* ───────────────── ④c 插件：日文事件标签（v2.9.16，《水族馆不会跳舞》实测） ───────────────── */
console.log('\n== ④c 插件：认日文事件标签（「回想 / ドア / 優雅に泳いでいる / EV020:トト」）==');
/* 来源：Steam 新下载的 MZ 游戏《水族馆不会跳舞(簡)》（中文发行，但事件名是日文）——
 * 62 条 npc 条目的名字就是事件标签，全都会原样摆进 AI 扮演菜单。 */
const JA_LABEL_CASES = ['回想', '診察室', 'カフェ', '水族館6　巨大水槽', '2号車', '地下', '包帯１',
    'ドア', '自動ドア', 'チケット', 'エレベーター1', 'レトロ階段', 'デメキン板',
    '優雅に泳いでいる', 'クラゲが優雅に', '声が聞こえる', '怪しい雰囲気の', '背筋が冷たく',
    '从上面的某种东西让人恶寒啊...', 'ヤドカリ下', '先生に話しかけられている',
    'イベント', '移動制限', '解説キイロハギ'];
/* 同一款游戏里的真名 + 常见日本姓 —— 一个都不许动。 */
const JA_KEEP_CASES = ['トト', '露露', '蕾忒罗', '克莉丝', 'レトロ', 'キティ', 'ダンボ',
    'カワウソ', 'シャチ', 'フグナース', '田中', '山下', '川上'];
if (typeof Ainpc.isLabelName !== 'function') bad('没有 isLabelName');
else {
    const missJa = JA_LABEL_CASES.filter(function (s) { return !Ainpc.isLabelName(s); });
    if (!missJa.length) ok('日文标签 ' + JA_LABEL_CASES.length + '/' + JA_LABEL_CASES.length + ' 全部命中');
    else bad('漏认 ' + missJa.length + ' 处：' + missJa.join(' / '));
    const hurtJa = JA_KEEP_CASES.filter(function (s) { return Ainpc.isLabelName(s); });
    if (!hurtJa.length) ok('日文真名 ' + JA_KEEP_CASES.length + ' 个零误伤', JA_KEEP_CASES.join(' / '));
    else bad('日文真名被误判：' + hurtJa.join(' / '));

    if (typeof Ainpc.cleanEventName === 'function') {
        const pairsJa = [['EV020:トト', 'トト'], ['21:クラゲ調査', 'クラゲ'], ['レトロに会う', 'レトロ'],
            ['キティ話す', 'キティ'], ['レトロ気絶', 'レトロ'], ['ピラニア3', 'ピラニア'],
            ['レトロ２', 'レトロ'], ['回想', ''], ['ドア', ''], ['水族館6　巨大水槽', ''],
            ['優雅に泳いでいる', ''], ['ヤドカリ下', ''], ['トト', 'トト'], ['レトロ', 'レトロ']];
        const badJa = pairsJa.filter(function (p) { return Ainpc.cleanEventName(p[0]) !== p[1]; });
        if (!badJa.length) ok('cleanEventName 日文剥离 ' + pairsJa.length + '/' + pairsJa.length + ' 正确');
        else bad('cleanEventName 日文不符：' + badJa.map(function (p) {
            return p[0] + '→' + JSON.stringify(Ainpc.cleanEventName(p[0])) + '(期望 ' + JSON.stringify(p[1]) + ')';
        }).join(' / '));
    }
}

/* ───────────────── ④d 插件：「形状闸门」（v2.9.18，从 13 台真实游戏挖出来的） ───────────────── */
console.log('\n== ④d 插件：通用形状闸门（机器路径 / 注解包裹 / 中英混排 + 素材名形状）==');
/* 每一条都有**真实出处**（跑 13 台机器的世界书 dump 出来的，不是编的）：
 *   机器路径   `EV027/door_01B` `EV083/Dash01`        ← 《伊丽莎》
 *   注解包裹   `（上层）`（作者把"楼层"写进 Actor 表当说话人横幅） ← 《伊丽莎》M158:E1
 *   中英混排   `大保BOSS` ← 《Routine Soul》M42:E25；`随机BOSS战斗` ← 《呆呆大冒险》
 * 判据要求**语言无关**：不靠任何语言词表（只有第 ③ 条带一个极窄的拉丁系统词表，
 * 且**只作用于含 CJK 的串** —— 纯英文走的是 isLabelName 的英文词表，两条路不混）。
 * ★ 曾经还有第 ④ 条「CJK + 尾随拉丁字母」（`居民N` / `武术家E`），**实测后删掉了**：
 *   这些名字来自说话人表，拒掉之后名字会退到 `area01_NPC00B` 这种原始素材名 —— 更差。 */
const SHAPE_LABEL = ['EV027/door_01B', 'EV083/Dash01', 'EV029/door_key05',
    '（上层）', '[食堂]', '【主线】', '(upper floor)',
    '大保BOSS', '最终BOSS战斗', '随机BOSS战斗', '小王NPC', '杂鱼Enemy'];
/* 「素材名形状」是**另一条**判据（`isAssetShape`，含下划线 + 含数字），
 * 且必须在**剥掉机器前缀之后**才判 —— 见 ④d 后面单独那段。 */
const ASSET_SHAPE = ['area05_NPC13', 'area01_NPC00B', 'EV_007', 'mob_096'];
/* 不许误伤 —— 全部来自真实世界书里的**真名**或**够用的名字**。 */
const SHAPE_KEEP = ['セリス', 'アリシア', 'リッツ', 'ロシェ', 'リニ', '居民', '商人', '卫兵', '赌徒',
    '斯卡雷特', '路明泽', '铁砧公主', '旅店老板', '龙', '猫', '吴', '袁', '心宝',
    '田中', '山下', 'Reed', 'Jim', 'Doc', 'MacDonald', 'Old Smith',
    '居民A', '居民N', '警卫A', '武术家E',   // ← 曾想拦它们；A/B 证明拦了会更差 → 必须保留
    '12_海月水母', '12_フナ', '25_クラゲ', '31_ウミウシ',  // ← 《水族馆不会跳舞》的角色**就是**水母/鱼
    '海月水母', 'クラゲ', 'ベタ',           //   事件名是「编号_名字」，剥掉编号后是真名
    '王子coser',            // ← 真实条目：`coser` 不在系统词表里，必须放行
    '大力神老A',            // ← 真实条目（《呆呆大冒险》M84:E2）：地图「大力神居」，横幅就是它
    'EV020:トト',           // ← 真实条目：冒号前缀后面是**真名**，剥前缀即可
    'EV023/旅人ノア'];      // ← 构造的对照组：斜杠后面是 CJK 真名 → 不能误杀
if (typeof Ainpc.isPlaceholderShape !== 'function') bad('插件没有 isPlaceholderShape（v2.9.18 的新判据没进插件）');
else {
    const missS = SHAPE_LABEL.filter(function (s) { return !Ainpc.isPlaceholderShape(s); });
    if (!missS.length) ok('四种形态 ' + SHAPE_LABEL.length + '/' + SHAPE_LABEL.length + ' 全部认出');
    else bad('漏认 ' + missS.length + ' 处：' + missS.join(' / '));
    const hurtS = SHAPE_KEEP.filter(function (s) { return Ainpc.isPlaceholderShape(s); });
    if (!hurtS.length) ok('真名 ' + SHAPE_KEEP.length + ' 个零误伤', '（含 coser / EV023:旅人ノア 两个对照组）');
    else bad('真名被误判成占位：' + hurtS.join(' / '));

    /* 另一条判据：**素材名形状**（含下划线 + 含数字）。它与上面那条**独立**，而且必须
     * 在**剥掉机器前缀之后**才判 —— 这是 A/B 第三次对拍才暴露的坑：
     * 《水族馆不会跳舞》的角色**就叫** `海月水母` / `クラゲ`，事件名是 `12_海月水母`；
     * 拿**原始串**判素材名形状会把整馆水母变成「居民」。 */
    if (typeof Ainpc.isAssetShape !== 'function') bad('插件没有 isAssetShape（v2.9.18 的新判据没进插件）');
    else {
        const missA = ASSET_SHAPE.filter(function (s) { return !Ainpc.isAssetShape(s); });
        if (!missA.length) ok('素材名形状 ' + ASSET_SHAPE.length + '/' + ASSET_SHAPE.length + ' 全部认出',
            '（`area05_NPC13` 是「（上层）」被拒后退化到的那一层）');
        else bad('漏认 ' + missA.length + ' 处：' + missA.join(' / '));
        /* 真名里带「编号_」前缀的那几个，**原始串**确实长得像素材名 —— 这正是要求"剥前缀后再判"的原因，
         * 所以先按前缀剔掉，再要求剩下的一律不许被当成素材名。 */
        const PREFIXED_KEEP = ['12_海月水母', '12_フナ', '25_クラゲ', '31_ウミウシ'];
        const hurtA = SHAPE_KEEP.filter(function (s) {
            return PREFIXED_KEEP.indexOf(s) < 0 && Ainpc.isAssetShape(s);
        });
        if (!hurtA.length) ok('素材名形状对真名零误伤', '（带「编号_」前缀的真名剥前缀后放行）');
        else bad('真名被误判成素材名：' + hurtA.join(' / '));
    }

    /* 闸门要能**穿透**到 isLabelName / isBadNpcName（displayName 靠它们跳过）。两条判据都要穿透。 */
    const ALL_SHAPE = SHAPE_LABEL.concat(ASSET_SHAPE);
    const notThrough = ALL_SHAPE.filter(function (s) { return !Ainpc.isLabelName(s) || !Ainpc.isBadNpcName(s); });
    if (!notThrough.length) ok('闸门已穿透 isLabelName / isBadNpcName（' + ALL_SHAPE.length + ' 条，displayName 会跳过它们）');
    else bad('有形态没穿透到 isLabelName：' + notThrough.join(' / '));

    /* 真实条目 `（上层）` 的完整降级链：name=注解、role=居民 → 必须显示「居民」。 */
    const K5 = '__probe_shape__:E1';
    const b5 = Ainpc.npcIndex[K5];
    Ainpc.npcIndex[K5] = { key: K5, name: '（上层）', role: '居民', eventName: 'area05_NPC13', tags: [] };
    try {
        const g5 = Ainpc.displayName(K5);
        if (g5 === '居民') ok('displayName 遇到「（上层）」会退到 role（实测修复项）', '（上层）→「居民」');
        else bad('displayName 没退到 role', '实际 = ' + JSON.stringify(g5));
    } finally {
        if (b5 === undefined) delete Ainpc.npcIndex[K5]; else Ainpc.npcIndex[K5] = b5;
    }

    if (typeof Ainpc.cleanEventName === 'function') {
        const pairsS = [['EV027/door_01B', ''], ['EV083/Dash01', ''], ['（上层）', ''],
            ['大保BOSS', ''], ['随机BOSS战斗', ''],
            ['area05_NPC13', ''], ['EV_007', ''],       // ← 素材名形状：退到 role，别当名字
            ['12_海月水母', '海月水母'], ['25_クラゲ', 'クラゲ'],   // ← 编号前缀要剥掉、名字要留住
            ['Stay Out Sign 2', ''],                    // ← 尾部编号的英文标签
            ['居民N', '居民N'], ['武术家E', '武术家E'],
            ['EV020:トト', 'トト'], ['EV023/旅人ノア', '旅人ノア']];
        const badS = pairsS.filter(function (p) { return Ainpc.cleanEventName(p[0]) !== p[1]; });
        if (!badS.length) ok('cleanEventName 形状闸门 ' + pairsS.length + '/' + pairsS.length + ' 正确');
        else bad('cleanEventName 不符：' + badS.map(function (p) {
            return p[0] + '→' + JSON.stringify(Ainpc.cleanEventName(p[0])) + '(期望 ' + JSON.stringify(p[1]) + ')';
        }).join(' / '));
    }
}

/* ───────────────────────── ⑤ 同口径：扫描器的词表 ⊆ 插件的 ───────────────────────── */
console.log('\n== ⑤ 同口径：扫描器的 LABEL_WORDS / LABEL_WEAK，插件必须都认 ==');
/* 把扫描器源码里的两档词表字面量抠出来 eval（测的是实际会跑的那一份），
 * 再**借插件的算法**跑一遍 —— 词表换成扫描器的，`isLabelName` 就等价于扫描器的判据。 */
function grabWords(src) {
    const out = { words: null, weak: null };
    const m1 = /(?:const|var)\s+LABEL_WORDS\s*=\s*\(([\s\S]*?)\)\s*\.split\(' '\)\s*;/.exec(src);
    if (m1) {
        try { out.words = String(eval(m1[1])).split(' ').filter(Boolean); } catch (e) { }
    }
    const m2 = /(?:const|var)\s+LABEL_WEAK\s*=\s*(\[[^\]]*\])\s*;/.exec(src);
    if (m2) {
        try { out.weak = eval(m2[1]).filter(Boolean); } catch (e) { }
    }
    return out;
}
const scanSets = (function () {
    if (!fs.existsSync(scanFile)) return null;
    const g = grabWords(fs.readFileSync(scanFile, 'utf8'));
    return (g.words && g.words.length) ? g : null;
})();
if (!scanSets) console.log('  ℹ 抠不到扫描器的 LABEL_WORDS（' + scanFile + '）—— 跳过同口径检查');
else if (!Ainpc.isLabelName) console.log('  ℹ 插件没有 isLabelName —— 跳过同口径检查');
else {
    const mine = Ainpc.LABEL_WORDS || [], mineWeak = Ainpc.LABEL_WEAK || [];
    const missWord = scanSets.words.filter(function (w) { return mine.indexOf(w) < 0; });
    if (!missWord.length) ok('扫描器的 LABEL_WORDS（' + scanSets.words.length + ' 词）插件全都有（插件 ' + mine.length + ' 词）');
    else bad('插件词表缺了扫描器会拦的词：' + missWord.join(' / '));
    if (scanSets.weak) {
        const missWeak = scanSets.weak.filter(function (w) { return mineWeak.indexOf(w) < 0; });
        if (!missWeak.length) ok('扫描器的 LABEL_WEAK（' + scanSets.weak.length + ' 词）插件全都有（插件 ' + mineWeak.length + ' 词）');
        else bad('插件弱词表缺了：' + missWeak.join(' / '));
    } else console.log('  ℹ 扫描器里没有 LABEL_WEAK（旧版）—— 跳过弱词表比对');

    /* 借插件的算法跑扫描器词表 —— 扫描器判 1 的，插件必须也判 1。 */
    const savedW = Ainpc.LABEL_WORDS, savedK = Ainpc.LABEL_WEAK;
    try {
        Ainpc.LABEL_WORDS = scanSets.words;
        Ainpc.LABEL_WEAK = scanSets.weak || [];
        const verdict = function (s) { return Ainpc.isLabelName(s); };
        const CROSS = LABEL.concat(LABEL_MULTI).concat(['Get Medicine', 'Treasure Chest',
            'Stay Out Sign', 'Chest', 'Door', 'Gate', 'Sign', 'Trigger', 'Spawner',
            'Potion', 'Gold', 'Save', 'Load', 'Menu', 'Credits', 'Title', 'Ending']);
        const leak = CROSS.filter(function (s) { return verdict(s) && !Ainpc.isLabelName(s); });
        const crossHurt = NOT_LABEL.concat(CJK).filter(function (s) { return verdict(s); });
        if (!leak.length) ok('扫描器会拦的，插件也全部拦（前者 ⊆ 后者）',
            CROSS.filter(verdict).length + ' 例交叉样本');
        else bad('插件漏了扫描器会拦的形态：' + leak.join(' / '));
        if (!crossHurt.length) ok('扫描器侧也不误伤真名 / 中日文名');
        else bad('扫描器侧误判：' + crossHurt.join(' / '));
    } finally {
        Ainpc.LABEL_WORDS = savedW;
        Ainpc.LABEL_WEAK = savedK;
    }
}

console.log('\n== ⑤b 同口径：扫描器的 SYS_LATIN_IN_CJK，插件必须逐词一致 ==');
(function () {
    if (!fs.existsSync(scanFile)) { console.log('  ℹ 没有扫描器源码 —— 跳过'); return; }
    const src = fs.readFileSync(scanFile, 'utf8');
    const m = /SYS_LATIN_IN_CJK\s*=\s*\(([\s\S]*?)\)\s*\.split\(' '\)\s*;/.exec(src);
    if (!m) { bad('扫描器里抠不到 SYS_LATIN_IN_CJK（v2.9.18 的判据没进扫描器）'); return; }
    let words = [];
    try { words = String(eval(m[1])).split(' ').filter(Boolean); } catch (e) { }
    const mine = Ainpc.SYS_LATIN_IN_CJK || [];
    const miss = words.filter(function (w) { return mine.indexOf(w) < 0; });
    if (!miss.length) ok('扫描器的 SYS_LATIN_IN_CJK（' + words.length + ' 词）插件全都有（插件 ' + mine.length + ' 词）');
    else bad('插件缺了：' + miss.join(' / '));
    /* 反向：插件多的词说明两边不同步。 */
    const extra = mine.filter(function (w) { return words.indexOf(w) < 0; });
    if (!extra.length) ok('插件没有多余词（两边逐词一致）');
    else bad('插件多了扫描器没有的词（两边不同步）：' + extra.join(' / '));
})();

console.log('\n== ⑤c 同口径：扫描器的 isAssetShape（含下划线 + 含数字）插件必须一致 ==');
(function () {
    /* 这条判据两边都是「两个正则的合取」，没有词表可抠，所以用**行为对拍**：
     * 拿一组样本喂插件，再拿同一组喂"从扫描器源码里抠出来的那两个正则"。 */
    if (!fs.existsSync(scanFile)) { console.log('  ℹ 没有扫描器源码 —— 跳过'); return; }
    const src = fs.readFileSync(scanFile, 'utf8');
    const body = /function isAssetShape\([\s\S]*?\n\}/.exec(src);
    if (!body) { bad('扫描器里抠不到 isAssetShape（v2.9.18 的判据没进扫描器）'); return; }
    const lits = body[0].match(/\/[^\/\n]+\//g) || [];
    if (lits.length < 2) { bad('isAssetShape 里抠不到两个正则（实现变了？）'); return; }
    const rs = lits.map(function (l) { try { return eval(l); } catch (e) { return null; } }).filter(Boolean);
    const scanAssetShape = function (s) {
        const t = String(s == null ? '' : s);
        for (let i = 0; i < rs.length; i++) if (!rs[i].test(t)) return false;
        return true;
    };
    const SAMP = ['area05_NPC13', 'area01_NPC00B', 'EV_007', 'mob_096', '12_海月水母',
        '25_クラゲ', 'Stay Out Sign 2', '居民A', 'Old Smith', 'MacDonald', '海月水母', '（上层）'];
    const diff = SAMP.filter(function (s) {
        return (!!(Ainpc.isAssetShape && Ainpc.isAssetShape(s))) !== scanAssetShape(s);
    });
    if (!diff.length) ok('两边对 ' + SAMP.length + ' 个样本判断一致', '（含 `12_海月水母` 与 `area05_NPC13` 两个方向）');
    else bad('两边判断不一致：' + diff.join(' / '));
})();

/* ───────────── ⑥ v2.10.0：汉化版游戏的「日文地名 / 日文人名 / 说话人横幅」 ─────────────
 *
 * 玩家原话：「mira里面有些角色名变成日文了，默认全部人名和地址显示中文吧。」
 *
 * 三条互不相关的根因，都是「汉化包只翻了该翻的一半」：
 *   ① 地名 —— `MapInfos.json` 是**编辑器地图树**的名字（汉化组没动），
 *      `MapXXX.json` 的 `displayName` 才是**游戏内窗口显示的那个**（汉化组翻了）。
 *   ② 人名 —— `Actors.json` 里演员名还是原文（`リア`），中文名只在剧本里
 *      （`[莉娅]「…」` + 立绘 `@f=Ria` 共现）。
 *   ③ 说话人横幅 —— 见下面 ⑥c/⑥d。
 */
console.log('\n== ⑥ v2.10.0：日文地名 / 日文人名 / 说话人横幅 ==');

/* ⑥a 地名：displayName（游戏内真名）优先于 MapInfos.name（编辑器名） */
(function () {
    let MI = null, ids = [], fileOf = {};
    try {
        MI = JSON.parse(fs.readFileSync(path.join(H.WWW, 'data', 'MapInfos.json'), 'utf8').replace(/^\uFEFF/, ''));
        /* 文件名**不能自己拼** —— 本作是 `Map001.json`（三位补零）、别的工程是 `Map1.json`，
         * 拼错了会全部 ENOENT 而被 try 吞掉，于是误判成"这个游戏没有 displayName"。 */
        fs.readdirSync(path.join(H.WWW, 'data')).forEach(function (f) {
            const m = /^Map(\d+)\.json$/.exec(f);
            if (!m) return;
            ids.push(Number(m[1]));
            fileOf[Number(m[1])] = f;
        });
    } catch (e) { console.log('  ℹ 读不到 data/MapInfos.json —— 跳过'); return; }
    if (!ids.length) { console.log('  ℹ 没有 MapXXX.json —— 跳过'); return; }
    const disp = {};
    let readErr = 0, firstErr = '';
    ids.forEach(function (id) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(H.WWW, 'data', fileOf[id]), 'utf8').replace(/^\uFEFF/, ''));
            const dn = (j && typeof j.displayName === 'string') ? j.displayName.trim() : '';
            if (dn) disp[id] = dn;
        } catch (e) { readErr++; if (!firstErr) firstErr = e.message; }
    });
    if (readErr) console.log('    ℹ ' + readErr + ' 张地图读失败（' + firstErr + '）');
    if (!Object.keys(disp).length) {
        console.log('  ℹ 本作没有一张地图有 displayName（MV < 1.5 的老工程）—— 老游戏逐字节零回归，跳过');
        return;
    }
    /* 只挑「两者真的不一致」的图 —— 一致的那些本来就分不出来，不算证据。 */
    const mismatch = ids.filter(function (id) {
        const mn = (MI[id] || {}).name || '';
        return disp[id] && mn && mn !== disp[id];
    });
    /* 期望值是**判据算出来的**，不是"永远取 displayName"：
     *   两者互为前缀（同一个地方、一个更具体）→ 取更全的那个；
     *   否则 → displayName（汉化组翻过的那份）。见扫描器 mapDisplay 的注释。 */
    const expect = function (id) {
        const mn = String((MI[id] || {}).name || '').trim(), dn = disp[id];
        if (mn && mn !== dn && (mn.indexOf(dn) === 0 || dn.indexOf(mn) === 0)) {
            return mn.length > dn.length ? mn : dn;
        }
        return dn;
    };
    const wbMaps = wb.maps || {};
    const wrong = mismatch.filter(function (id) { return wbMaps[id] !== expect(id); });
    const prefixKind = mismatch.filter(function (id) {
        const mn = String((MI[id] || {}).name || '').trim(), dn = disp[id];
        return mn && mn !== dn && (mn.indexOf(dn) === 0 || dn.indexOf(mn) === 0);
    });
    if (!mismatch.length) console.log('  ℹ 没有「MapInfos 名 ≠ displayName」的图 —— 无从验证，跳过');
    else if (!wrong.length) {
        ok('全 ' + mismatch.length + ' 张「编辑器名 ≠ 游戏内名」的图，世界书里取的都对'
            + (prefixKind.length ? '（其中 ' + prefixKind.length + ' 张是"互为前缀"，按信息更全的那个取）' : ''),
            '例：' + mismatch.slice(0, 3).map(function (id) { return (MI[id] || {}).name + ' → ' + wbMaps[id]; }).join('；'));
    } else {
        bad(wrong.length + ' 张图的地址取错了：'
            + wrong.slice(0, 6).map(function (id) { return 'M' + id + '=' + wbMaps[id] + '（应为 ' + expect(id) + '）'; }).join(' / '));
    }
    /* 红线：**不许为了好看去改文本**，游戏自己的写法（`阿维尔・中央区域` 用全角中点）
     * 必须原样带出来 —— 我们只是"取对字段 / 取对那一个"，不是"改写名字"。 */
    const tweaked = mismatch.filter(function (id) {
        const v = wbMaps[id] || '';
        return v && v !== expect(id) && v.replace(/[·・]/g, '·') === expect(id).replace(/[·・]/g, '·');
    });
    if (!tweaked.length) ok('只换字段 / 不改字面（中点写法原样保留）');
    else bad('世界书改写了原文的字面：' + tweaked.map(function (id) { return wbMaps[id] + ' ≠ ' + expect(id); }).join(' / '));
})();

/* ⑥b 人名：Actors.json 里纯假名的**真人角色**名，不许再出现在世界书的人名里 */
(function () {
    let actors = null;
    try { actors = JSON.parse(fs.readFileSync(path.join(H.WWW, 'data', 'Actors.json'), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { console.log('  ℹ 读不到 data/Actors.json —— 跳过'); return; }
    /* 纯假名（片假名/平假名，**排除中点与长音符**：`阿维尔・中央区域` 不是"日文名"）。 */
    const KANA_NAME = /^[\u3041-\u3096\u30a1-\u30fa]+$/;
    const kata = (actors || []).filter(function (a) { return a && KANA_NAME.test(String(a.name || '').trim()); });
    if (!kata.length) { console.log('  ℹ 演员表里没有纯假名（本作本来就是中文名）—— 跳过'); return; }
    /* 演员表里混着"把怪物做成演员行"的（Mira：コウモリ / スライム / キノコ / アルラウネ
     * 全是 classId=1 的杂兵）。它们**本来就没有官方中文名**，本地化器按设计也不该动
     * （首字母对不上就放弃）。拿什么分开？用**称号字段**：真人角色有「天才魔術師 /
     * 学校教師 / 魔女」这种称号，充数的怪物行一律为空。这是本探针的判据，不是产品逻辑。 */
    const isStory = function (a) { return String(a.nickname || '').trim().length > 0; };
    const story = kata.filter(isStory).map(function (a) { return String(a.name).trim(); });
    const mobKata = kata.filter(function (a) { return !isStory(a); }).map(function (a) { return String(a.name).trim(); });
    if (!story.length) console.log('  ℹ 纯假名演员里没有"带称号的真人角色" —— 无从验证正面方向，跳过');
    else {
        const hit = npcs.filter(function (n) { return n && n.name && story.indexOf(String(n.name).trim()) >= 0; });
        if (!hit.length) ok('演员表里 ' + story.length + ' 个纯假名真人角色（' + story.join('/') + '）一个都没漏进人名');
        else {
            bad(hit.length + ' 条人名还是演员表的原文（剧本里能对出中文名）：'
                + hit.slice(0, 8).map(function (n) { return n.key + '=' + n.name; }).join(' / '));
        }
    }
    /* 红线：**宁可漏判不可误杀** —— 怪物 / 素材行的原文名必须原样保留。
     * 这条防的是"为了好看硬套一个中文名上去"（那会让 コウモリ 变成某个角色的名字）。 */
    const wbNames = {};
    npcs.forEach(function (n) { if (n && n.name) wbNames[String(n.name).trim()] = 1; });
    const survivors = mobKata.filter(function (x) { return wbNames[x]; });
    if (!mobKata.length) console.log('    ℹ 没有"非真人角色的纯假名演员行"可比对');
    else if (survivors.length) ok('非真人角色的原文名原样保留（' + survivors.length + '/' + mobKata.length + '）：' + survivors.join('/'));
    else console.log('    ℹ ' + mobKata.length + ' 个怪物演员名都没出现在世界书人名里（本作地图上没摆它们，不算异常）');
})();

/* ⑥c 说话人横幅：`101 ["Monster",…]` 后的 `401 ["白骨："]` 不是台词 —— 行为对拍 */
(function () {
    if (!Ainpc.speakerNameLine || !Ainpc.readTextBlockOf) {
        bad('插件缺 speakerNameLine / readTextBlockOf（v2.10.0 的判据没进插件）');
        return;
    }
    /* 该认的（冒号后只有空白） */
    const YES = ['白骨：', '坤坤：', '镇长:', '路明泽：'];
    /* 红线：这些**不是**名字行（冒号后面还有正文）—— 误吃一口就把 NPC 的台词吞了 */
    const NO = ['奖励：全体法攻+5。', '提示：按确定键继续', '米拉：（叹气）我回来了',
        '（没时间闲逛了，快带她回镇上疗伤）', '你可以在商人处购买恢复药水、草药和复活道具，也可以'];
    const miss = YES.filter(function (s) { return !Ainpc.speakerNameLine(s); });
    const hurt = NO.filter(function (s) { return Ainpc.speakerNameLine(s); });
    if (!miss.length) ok('名字行识别 ' + YES.length + ' 例全中', YES.join(' / '));
    else bad('漏认名字行：' + miss.join(' / '));
    if (!hurt.length) ok('冒号后带正文的一律不算名字行（' + NO.length + ' 例红线）');
    else bad('这些正文被当成名字行了：' + hurt.join(' / '));

    /* 真实指令序列：`101 ["Monster",5,0,2]` → `401 ["白骨："]` → `401 ["是你…"]`
     * 期望：横幅被跳过，**只剩正文**，且两个 401 都被消费掉（endIndex=2）。 */
    const L1 = [{ code: 101, parameters: ['Monster', 5, 0, 2] },
        { code: 401, parameters: ['白骨：'] }, { code: 401, parameters: ['是你把我唤醒的吗？'] }];
    const b1 = Ainpc.readTextBlockOf(L1, 0);
    if (b1.lines.length === 1 && b1.lines[0] === '是你把我唤醒的吗？' && b1.endIndex === 2)
        ok('运行时跳过横幅：只把正文喂给模型', JSON.stringify(b1.lines));
    else bad('运行时没跳过横幅', 'lines=' + JSON.stringify(b1.lines) + ' endIndex=' + b1.endIndex);

    /* 红线：**旁白** 101 是 `["",0,0,2]`（faceName 空）—— 它的「打印出来了：」是正文，不许吃 */
    const L2 = [{ code: 101, parameters: ['', 0, 0, 2] }, { code: 401, parameters: ['打印出来了：'] }];
    const b2 = Ainpc.readTextBlockOf(L2, 0);
    if (b2.lines.length === 1 && b2.lines[0] === '打印出来了：')
        ok('旁白不被误吃（Level C-1366 实测过的坑）', JSON.stringify(b2.lines));
    else bad('旁白被当成名字行吃掉了', 'lines=' + JSON.stringify(b2.lines));

    /* 只有一条横幅的 101（横幅后没有正文）—— 不许把 401 留在后面让解释器显示出来 */
    const L3 = [{ code: 101, parameters: ['Monster', 5, 0, 2] }, { code: 401, parameters: ['白骨：'] },
        { code: 0, parameters: [] }];
    const b3 = Ainpc.readTextBlockOf(L3, 0);
    if (b3.lines.length === 0 && b3.endIndex === 1)
        ok('整块只有横幅时也消费干净（endIndex=1，不会残留成一句原文台词）');
    else bad('只有横幅的块没消费干净', 'lines=' + JSON.stringify(b3.lines) + ' endIndex=' + b3.endIndex);
})();

/* ⑥d 说话人横幅的数据层：nameFrom=nameline 的条目，**自己的**那句「名字：」不许留在台词里 */
(function () {
    const nl = npcs.filter(function (n) { return n && n.nameFrom === 'nameline'; });
    if (nl.length) ok('有 ' + nl.length + ' 条名字是从「101 后的名字行」认回来的（nameFrom=nameline）');
    else console.log('  ℹ 本作没有这种写法（伊莉莎/Mira 无）—— 若为呆呆属异常');
    /* 口径要窄：只查**与他自己的名字一字不差**的那行。
     *   · 同一事件里别人说话的名字行（多角色同场）本来就该留；
     *   · 不挂立绘的 101（旁白/纸条）里的「潦草的笔记：」按红线也必须留
     *     —— 那是 Level C-1366 那条硬约束的代价，不是泄漏。 */
    const leak = nl.filter(function (n) {
        const nm = String(n.name || '').trim();
        if (!nm) return false;
        return (n.dialogues || []).some(function (d) {
            const t = String((d && d.text) || '').trim();
            return t === nm + '：' || t === nm + ':';
        });
    });
    if (!leak.length) ok('这些条目里没有「自己的名字行」残留在台词里（0 条）');
    else {
        bad(leak.length + ' 条把自己的名字行当台词喂给了模型：'
            + leak.slice(0, 6).map(function (n) { return n.key + '「' + n.name + '」'; }).join(' / '));
    }
})();

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
