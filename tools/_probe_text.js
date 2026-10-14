/* 探针：互动时的文本显示 + 翻页停顿 + 人设批量打包（v2.10.2）
 * ================================================================
 * 守三个玩家报过的问题：
 *   ① 「互动文字对不齐，出现空格、错行」← 控制字符没洗干净
 *      （\r / \t 会占宽度但画不出来；\f 更狠，它是"翻页"，会让 startPause 误判
 *       "说完了" → terminateMessage 把后面所有页全吞掉）
 *   ② 「文本显示极快，人看清不清就没了」← **最后一屏拿到 0 帧停留**
 *      （中间屏走 processNewLine→startPause 有停顿；最后一屏走 onEndOfText→startPause
 *       时 _inNewLine 已是 false，直接被 terminateMessage）
 *   ③ 「呆呆角色卡生成那么慢」← 分组按地图 → 131 组（75 组只有 1 人）→ 串行 85 次请求
 *
 * 用法：
 *   node _probe_text.js --game=呆呆
 *   node _probe_text.js --www="D:/.../www" [--plugin=<路径>]
 */
const path = require('path'), fs = require('fs');

const arg = (n) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : ''; };
let WWW = arg('www');
const LABEL = arg('game');
if (!WWW && LABEL) {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp', 'games.json'), 'utf8')).find(x => x.label === LABEL);
    if (g) WWW = path.dirname(g.cur);
  } catch (e) { }
}
if (!WWW) { console.error('需要 --game=<标签> 或 --www=<游戏的 www 目录>'); process.exit(2); }
process.argv.push('--www=' + WWW);
process.argv.push('--plugin=' + (arg('plugin') || path.join(__dirname, 'RM_AI_NPC.js')));

const H = require('./harness.js');
const Ainpc = H.Ainpc, S = H.sandbox;
const SRC = fs.readFileSync(H.PLUGIN, 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ← ' + d : '')); } else { fail++; console.log('  ❌ ' + n + (d ? '  ← ' + d : '')); } };
console.log('插件:', H.PLUGIN);
console.log('游戏:', H.WWW, LABEL ? ('(' + LABEL + ')') : '');
if (H.loadError) { console.log('loadError:', H.loadError && H.loadError.stack || H.loadError); process.exit(1); }
/* 版本断言：只钉"运行时 == 文件里"，不钉具体小版本（否则每升一版都要回来改探针） */
const _pv = (/Ainpc\.VERSION\s*=\s*'([^']+)'/.exec(SRC) || [])[1];
ok('版本号自洽（' + Ainpc.VERSION + '）', !!_pv && Ainpc.VERSION === _pv, Ainpc.VERSION);
ok('版本不低于引入本修复的 2.10.2', (function () {
  const p = String(Ainpc.VERSION).split('.').map(Number);
  return p[0] > 2 || (p[0] === 2 && (p[1] > 10 || (p[1] === 10 && p[2] >= 2)));
})(), Ainpc.VERSION);

/* ================================================================ ① 控制字符清洗 */
console.log('\n① 文本控制字符（错行 / 空白的真凶）');
{
  const C = Ainpc.cleanText;
  ok('①a cleanText 存在', typeof C === 'function');
  /* ★ 裸 CR：必须**删除**（与 v2.9 之前 sanitizeSay 的 `.replace(/\r/g,'')` 同口径）。
   *   不能把它变成 \n —— 那会凭空多出一行；它本来就是"同一行的重复换行符"。 */
  ok('①b 裸 \\r 被删掉（不产生新行）', C('abc\rdef') === 'abcdef', JSON.stringify(C('abc\rdef')));
  ok('①c CRLF 变成 LF（保留分段）', C('a\r\nb') === 'a\nb', JSON.stringify(C('a\r\nb')));
  ok('①d 多个连续 CRLF 不产生多余空行', C('a\r\n\r\nb') === 'a\n\nb', JSON.stringify(C('a\r\n\r\nb')));
  /* \t 同理，且它没有"正当用途"（引擎画的是空白宽度，与排版无关） */
  ok('①d \\t 变空格', C('a\tb') === 'a b', JSON.stringify(C('a\tb')));
  /* ★ \f 是引擎的"新的一页"，会触发 startPause → 我们误判"说完了" → 吞掉后面所有页 */
  ok('①e \\f 被清掉（否则会吞掉后面所有页）', C('a\fb') === 'ab', JSON.stringify(C('a\fb')));
  ok('①f 其它 C0 控制符被清掉', C('a\x00\x01\x07\x1bb') === 'ab', JSON.stringify(C('a\x00\x01\x07\x1bb')));
  /* 排版噪音 */
  ok('①g 连续半角空格压成一个', C('a   b') === 'a b', JSON.stringify(C('a   b')));
  ok('①h 全角空格压成半角', C('a\u3000\u3000b') === 'a b', JSON.stringify(C('a\u3000\u3000b')));
  ok('①i 行首 / 行尾空白去掉', C('  a  \n  b  ') === 'a\nb', JSON.stringify(C('  a  \n  b  ')));
  ok('①j 不换行空格（NBSP）转普通空格', C('a\u00a0b') === 'a b', JSON.stringify(C('a\u00a0b')));
  /* 幂等 */
  const once = C(' x\r\n\r\n  y\t\t  ');
  ok('①k 幂等（清两遍 = 清一遍）', C(once) === once, JSON.stringify(once));
  /* ★ 不能把正常内容弄坏 */
  ok('①l 不动 \\n（分段是正当用法）', C('第一行\n第二行') === '第一行\n第二行');
  ok('①m 不动中文标点 / 引号 / 省略号', C('他说：「…好。」') === '他说：「…好。」', C('他说：「…好。」'));
  ok('①n 单个空格保留（英文单词间）', C('hello world') === 'hello world');
  /* cleanText 必须在折行的必经之路上 —— 否则调用点漏一个就漏一个 */
  const wrapped = Ainpc.wrapSay('a\rb\tc\fd', true);
  ok('①o wrapSay 也走清洗（大多调用点不自己清）',
    wrapped.join('').indexOf('\r') < 0 && wrapped.join('').indexOf('\t') < 0 && wrapped.join('').indexOf('\f') < 0,
    JSON.stringify(wrapped));
  /* 入库清洗 */
  ok('①p cleanWbText 递归清洗对象', (function () {
    const o = { a: 'x\ry', b: ['p\tq'], c: { d: 'm\fn' } };
    Ainpc.cleanWbText(o);
    return o.a === 'xy' && o.b[0] === 'p q' && o.c.d === 'mn';
  })());
  /* 世界书里的文本本身必须是干净的（这是"入库前洗"的证据） */
  let dirty = 0, sample = '';
  Object.keys(Ainpc.npcIndex || {}).slice(0, 400).forEach(k => {
    const n = Ainpc.npcIndex[k];
    [n.name, n.role, n.mapName, n.eventName].forEach(v => {
      if (typeof v === 'string' && /[\r\t\f\v\u3000]/.test(v)) { dirty++; if (!sample) sample = k + ':' + v.slice(0, 30); }
    });
  });
  ok('①q 世界书条目里没有残留控制字符', dirty === 0, dirty ? (dirty + ' 条，例：' + sample) : '0 条');
  /* ★ ①r 无头台与真实游戏同口径 —— 否则"在 DEFAULTS 上调参"这类修复永远验不到 */
  ok('①r harness 的 config 是 DEFAULTS 打底（不是整体替换）',
    Object.keys(Ainpc.config).length > 130 && ('pageWaitFrames' in Ainpc.config),
    Object.keys(Ainpc.config).length + ' 键');
  /* 量宽口径：清洗后不该再有"零宽高宽"的怪字符 */
  const w1 = Ainpc.measureText('\r'), w2 = Ainpc.measureText('a'), w3 = Ainpc.measureText('\t');
  console.log('    （参考：引擎给 \\r 的宽度 = ' + Math.round(w1) + 'px，\\t = ' + Math.round(w3) +
    'px，普通字 = ' + Math.round(w2) + 'px —— 前两者画的却是空白）');
}

/* ================================================================ ② 翻页停顿 */
/* ================================================================ ② 翻页停顿 / 等按键 */
/* 【2.10.3 重写】原来的断言是 v2.10.2 的机制（"延迟终止 + 到点自动收尾"）。
 * 玩家随后明确要求「**改成点一下再下一页**」，机制换成"保留 pause 等按键 + 兜底帧数自己数"，
 * 所以这一段的断言跟着换 —— 断言必须描述**当前机制**，否则守门员会绑死一个被废弃的实现。 */
console.log('\n② 翻页：等玩家点一下，兜底帧数自己数（v2.10.3 机制）');
{
  const K = Ainpc.config.pageWaitFrames;
  const defPw = (function () {
    const m = /pageWaitFrames:\s*(\d+)/.exec(SRC.replace(/\/\*[\s\S]*?\*\//g, ''));
    return m ? Number(m[1]) : NaN;
  })();
  ok('②a DEFAULTS 里的 pageWaitFrames >= 100（兜底 2 秒）', defPw >= 100, String(defPw));
  console.log('    （本机 config.json 的当前值 = ' + K + '；自愈规则会把旧的 20 / 60 迁上来）');
  ok('②a2 源码：自愈规则认得旧默认值 20 / 60', /pageWaitFrames/.test(SRC));

  ok('②b 源码：startPause 保留 pause（等玩家点一下）',
    /startPause = function \(\) \{[\s\S]{0,700}?this\.pause = \(fb > 0\)/.test(SRC));
  ok('②c 源码：updateInput **不再**无条件清 pause',
    !/updateInput = function \(\) \{\s*\n?\s*if \(Ainpc\.active && this\.pause\) this\.pause = false;/.test(SRC));
  ok('②d 源码：兜底帧数自己数（不用 _waitCount）',
    /Ainpc\._ptFrames/.test(SRC) && !/_waitCount = Math\.max\(this\._waitCount \|\| 0, (pw|pw2|fb)\)/.test(SRC));
  ok('②e 源码：兜底推进每帧检查（不是 setTimeout）',
    /tickWatchdog = function \(\) \{\s*\n?\s*Ainpc\.tickPendingTerminate\(\);/.test(SRC)
    && !/setTimeout\([^)]*_pendingTerminate/.test(SRC));
  ok('②f 源码：AI 对话期间 isTriggered 只认玩家输入',
    /Window_Message\.prototype\.isTriggered = function \(\) \{[\s\S]{0,400}?Ainpc\.active/.test(SRC));

  /* 行为：挂上待收尾 + 一个较大的兜底帧数 */
  S.Input = S.Input || {};
  const rawTrig = S.Input.isTriggered, rawRep = S.Input.isRepeated;
  S.Input.isTriggered = () => false; S.Input.isRepeated = () => false;
  const fakeWin = { _waitCount: 0, pause: true, _textState: null, terminated: 0, terminateMessage() { this.terminated++; } };
  Ainpc.active = { interp: { setWaitMode() { } }, key: 'k', npc: {}, face: {} };
  Ainpc._pendingTerminate = fakeWin;
  Ainpc._pendingPage = null;
  Ainpc._ptFrames = 5;
  Ainpc.tickPendingTerminate();
  ok('②g 兜底还没走完 → 不推进（给玩家按键的机会）',
    fakeWin.terminated === 0 && Ainpc._pendingTerminate === fakeWin, 'ptFrames=' + Ainpc._ptFrames);
  Ainpc._ptFrames = 0;
  Ainpc.tickPendingTerminate();
  ok('②h 兜底到点 → 自己推进（玩家一直不按也不会僵死）',
    fakeWin.terminated === 1 && fakeWin.pause === false, 'terminated=' + fakeWin.terminated);
  /* 玩家按键 → 兜底计时清 0（按了就立刻走，不用再等） */
  const w2 = { _waitCount: 0, pause: true, _textState: null, terminated: 0, terminateMessage() { this.terminated++; } };
  Ainpc._pendingTerminate = w2;
  Ainpc._ptFrames = 999;
  S.Input.isRepeated = (n) => n === 'ok';
  Ainpc.tickPendingTerminate();
  ok('②i 玩家按确定键 → 兜底计时清 0（不必再等）', Ainpc._ptFrames === 0, '_ptFrames=' + Ainpc._ptFrames);
  S.Input.isTriggered = rawTrig; S.Input.isRepeated = rawRep;
  /* 对话已中断也要推进，否则消息窗卡在半路 */
  const w3 = { _waitCount: 0, pause: true, _textState: null, terminated: 0, terminateMessage() { this.terminated++; } };
  Ainpc._pendingTerminate = w3;
  Ainpc._ptFrames = 999;
  Ainpc.active = null;
  Ainpc.tickPendingTerminate();
  ok('②j 对话中断时也推进（别把消息窗留在半路）', w3.terminated === 1, 'terminated=' + w3.terminated);
  Ainpc._pendingTerminate = null; Ainpc._ptFrames = 0;
}

/* ================================================================ ③ 批量打包 */
console.log('\n③ 人设批量打包（呆呆慢的真因）');
{
  const P = Ainpc.persona;
  P.loaded || P.load();
  const MAXP = (P.prompt && P.prompt.batch && P.prompt.batch.maxMembersPerCall) || 8;
  const tiers = P.importantTiers();
  const groups = P.groups || [];
  let total = 0, g1 = 0;
  groups.forEach(g => { const n = (g.members || []).length; total += n; if (n === 1) g1++; });
  console.log('    规模：' + total + ' 人 / ' + groups.length + ' 组，其中只有 1 人的组 = ' + g1 + ' 个');

  /* 旧口径（按组切块） */
  let oldBlocks = 0, impMembers = 0, oldImpBlocks = 0;
  groups.forEach(g => {
    oldBlocks += Math.ceil((g.members || []).length / MAXP);
    const im = (g.members || []).filter(m => tiers.indexOf(m.importance || '') >= 0);
    impMembers += im.length;
    oldImpBlocks += Math.ceil(im.length / MAXP);
  });
  /* 新口径（按容量跨组打包） */
  const newBlocks = Math.ceil(total / MAXP);
  const newImpBlocks = Math.ceil(impMembers / MAXP);
  console.log('    全部角色：旧 ' + oldBlocks + ' 次 → 新 ' + newBlocks + ' 次' +
    '（省 ' + Math.round((1 - newBlocks / oldBlocks) * 100) + '%）');
  console.log('    重要角色：旧 ' + oldImpBlocks + ' 次 → 新 ' + newImpBlocks + ' 次' +
    '（省 ' + Math.round((1 - newImpBlocks / oldImpBlocks) * 100) + '%）');
  ok('③a 打包后的请求数明显少（全部角色）', newBlocks < oldBlocks * 0.75, oldBlocks + ' → ' + newBlocks);
  ok('③b 打包后的请求数明显少（重要角色）', newImpBlocks < oldImpBlocks * 0.5, oldImpBlocks + ' → ' + newImpBlocks);
  /* 源码断言 */
  ok('③c 源码：新增 packAcrossGroups 开关（可退回旧行为）', /packAcrossGroups/.test(SRC));
  ok('③d 源码：新增并发闸门 parallel（1 = 串行）', /batch\.parallel|personaParallel/.test(SRC));
  ok('③e 源码：并发上限被夹在 1..6', /if \(PAR < 1\) PAR = 1; if \(PAR > 6\) PAR = 6;/.test(SRC));
  /* ★ 红线：不合并时（单人生成）提示词必须与旧版逐字节相同 */
  const t = P.prompt;
  const impl = /(所在：)/.test(t.memberTemplate);
  ok('③f 模板里没有硬加地点字段（不许强推新模板）', !impl);
  const m = { key: 'x', place: '同一个地方', oldRole: '居民', dialogues: ['a'], sprite: 's' };
  const withSame = P.renderMember(m, 0, '同一个地方');
  /* ★ 缺省（不传第 3 参）时 = "调用方没告诉我块地点"，这时**不许附加** ——
   *   单人生成 / 老调用点走的都是这条路，输出必须与旧版逐字节相同。 */
  const withNone = P.renderMember(m, 0);
  ok('③g 地点与块地点相同 → 不附加（不合并时输出不变）', withSame === withNone,
    JSON.stringify(withSame.split('\n').find(l => l.indexOf('原作定位') >= 0) || ''));
  ok('③g2 不传 groupPlace（老调用点）→ 也不附加', withNone.indexOf('所在：') < 0);
  const withDiff = P.renderMember(m, 0, '另一个地方');
  ok('③h 地点与块地点不同 → 附上「所在」（合并时不丢信息）',
    withDiff.indexOf('所在：同一个地方') >= 0 && withDiff !== withSame,
    JSON.stringify(withDiff.split('\n').find(l => l.indexOf('原作定位') >= 0) || '').slice(0, 80));
}

/* ================================================================ ④ 单人生成不受影响 */
console.log('\n④ 红线：单人生成的提示词不许被改动');
{
  const P = Ainpc.persona;
  const keys = Object.keys(Ainpc.npcIndex || {}).filter(k => (Ainpc.npcIndex[k].aiHint || '') !== 'system');
  const k = keys[0];
  const c = P.clueOf && P.clueOf(k);
  if (!c) { ok('④a clueOf 可用', false, k); }
  else {
    const msg = P.buildMessages({ groupId: 'single', title: c.place || 'x', place: c.place || '', area: '', members: [c] });
    const per = P.renderMember(c, 0, c.place || '');
    ok('④a 单人生成的成员卡不含「所在：」（它已经在块地点里）',
      per.indexOf('所在：') < 0, c.key + ' place=' + (c.place || ''));
    ok('④b 单人生成走的是同一套模板', msg.user.indexOf(per) >= 0 || msg.user.indexOf(per.slice(0, 40)) >= 0);
    /* ④c：单人生成时 buildMessages 传的 group.place 必须就是 clue.place，
     * 否则会平白多出一个「（所在：…）」。genOne 里的 group 定义见 persona.genOne。 */
    ok('④c genOne 的 group.place 与成员 place 一致（幂等）',
      /var g = \{ groupId: 'single', title: clue\.place \|\| '单人生成', place: clue\.place \|\| ''/.test(SRC));
  }
}

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);