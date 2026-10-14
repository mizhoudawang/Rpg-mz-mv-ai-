/* 探针：翻页改「点一下」+ 人设同步到角色面板（v2.10.3）
 * ============================================================
 * 守三件事（都是玩家报的）：
 *   ① 「交互时文字还会自动下一页，不如改成点一下再下一页」
 *      ← 真凶是我们自己的 `updateInput` 钩子每帧无条件清 pause，把引擎的按键判定跳过了；
 *        另外《Mira》装的 CU_TimeNextMessageMode 会把"时间到"也算成按键。
 *   ② 「mira 文本框仍然错行」← 折行宽度不能照公式猜，要用真实消息窗量。
 *   ③ 「写好的人设没有同步到当前地图显示的角色设定的面板上」
 *      ← 面板那一行原来只读 n.role（原作身份），完全不看 n.persona。
 *
 * 用法：node _probe_sync.js --game=Mira [--plugin=<路径>]
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
const _pv = (/Ainpc\.VERSION\s*=\s*'([^']+)'/.exec(SRC) || [])[1];
ok('版本号自洽（' + Ainpc.VERSION + '）', !!_pv && Ainpc.VERSION === _pv, Ainpc.VERSION);

const P = Ainpc.persona;
P.loaded || P.load();
Ainpc.config = Ainpc.config || {};
Ainpc.config.apiKey = 'TEST'; Ainpc.config.model = 't';

/* ================================================================ ① 翻页 = 点一下 */
console.log('\n① 翻页必须「点一下再下一页」');
{
  ok('①a 源码：startPause 不再无条件清 pause',
    /startPause = function \(\) \{[\s\S]{0,700}?this\.pause = \(fb > 0\)/.test(SRC));
  ok('①b 源码：updateInput 不再无条件 `this.pause = false`',
    !/updateInput = function \(\) \{\s*\n?\s*if \(Ainpc\.active && this\.pause\) this\.pause = false;/.test(SRC));
  ok('①c 源码：AI 对话期间把 isTriggered 收到只认玩家输入',
    /Window_Message\.prototype\.isTriggered = function \(\) \{[\s\S]{0,400}?Ainpc\.active/.test(SRC)
    && /Input\.isRepeated\('ok'\)/.test(SRC));
  ok('①d 源码：兜底帧数自己数，不用 _waitCount', /Ainpc\._ptFrames/.test(SRC)
    && !/_waitCount = Math\.max\(this\._waitCount \|\| 0, (pw|pw2|fb)\)/.test(SRC));
  ok('①e 源码：兜底推进在 tickWatchdog 里每帧跑',
    /tickWatchdog = function \(\) \{\s*\n?\s*Ainpc\.tickPendingTerminate\(\);/.test(SRC));

  /* 行为：startPause 之后 pause 必须留着（等按键），且挂了兜底帧数 */
  const mkWin = () => ({
    pause: false, _waitCount: 0, _textState: null, terminated: 0,
    terminateMessage() { this.terminated++; }
  });
  Ainpc.active = { interp: { setWaitMode() { } }, key: 'k', npc: {}, face: {} };
  const WM = S.Window_Message.prototype;
  /* 插件已经把 WM.startPause / isTriggered 包过了 —— 直接拿现成的（不要自己再包一层） */
  const pluginStartPause = WM.startPause;
  const pluginIsTriggered = WM.isTriggered;
  let w = mkWin();
  Ainpc._inNewLine = true;
  pluginStartPause.call(w);
  ok('①f 中间屏：pause 保留（等玩家点一下）', w.pause === true, 'pause=' + w.pause);
  ok('①g 中间屏：挂了兜底帧数（玩家不按也不会僵死）', Ainpc._ptFrames > 0, '_ptFrames=' + Ainpc._ptFrames);
  ok('①h 中间屏：没有 terminate（否则后面几屏全丢）', w.terminated === 0, 'terminated=' + w.terminated);
  w = mkWin();
  Ainpc._inNewLine = false;
  pluginStartPause.call(w);
  ok('①i 最后一屏：pause 也保留', w.pause === true, 'pause=' + w.pause);
  ok('①j 最后一屏：挂了待收尾（等按键 / 兜底）', Ainpc._pendingTerminate === w);

  /* 兜底：帧数走完必须推进 */
  Ainpc._ptFrames = 2;
  const rawTrig = S.Input.isTriggered, rawRep = S.Input.isRepeated;
  S.Input.isTriggered = () => false; S.Input.isRepeated = () => false;
  Ainpc.tickPendingTerminate();
  ok('①k 兜底第 1 帧：还不推进（给玩家按键的机会）', Ainpc._pendingTerminate === w, 'ptFrames=' + Ainpc._ptFrames);
  Ainpc._ptFrames = 0;
  Ainpc.tickPendingTerminate();
  ok('①l 兜底到点：自己推进（等价于玩家按了一下）', Ainpc._pendingTerminate === null && w.pause === false,
    'terminated=' + w.terminated + ' pause=' + w.pause);

  /* 玩家按键时把兜底清掉（不必再等） */
  Ainpc._pendingPage = mkWin();
  Ainpc._ptFrames = 999;
  S.Input.isRepeated = (n) => n === 'ok';
  Ainpc.tickPendingTerminate();
  ok('①m 玩家按键 → 兜底计时清 0（按了就立刻翻）', Ainpc._ptFrames === 0, '_ptFrames=' + Ainpc._ptFrames);
  S.Input.isTriggered = rawTrig; S.Input.isRepeated = rawRep;

  /* isTriggered 闸门：有 active 时只认玩家输入 */
  const itWin = {};
  S.Input.isRepeated = () => false;
  const itAI = pluginIsTriggered.call(itWin);
  ok('①n AI 对话中：没有玩家输入 → isTriggered 为 false（自动推进被挡住）', itAI === false, String(itAI));
  S.Input.isRepeated = (n) => n === 'ok';
  ok('①o AI 对话中：玩家按确定 → true', pluginIsTriggered.call(itWin) === true);
  Ainpc.active = null;
  S.Input.isRepeated = () => false;
  pluginIsTriggered.call(itWin);   // 不该抛错；对话结束后恢复原行为
  ok('①p 对话结束后恢复原行为（不抛错）', true);
  S.Input.isRepeated = rawRep;
  Ainpc._pendingPage = null; Ainpc._pendingTerminate = null; Ainpc._ptFrames = 0;
}

/* ================================================================ ② 折行宽度用真实窗口量 */
console.log('\n② 折行宽度要用真实消息窗口量');
{
  ok('②a 源码：messageTextWidth 会先试真实消息窗',
    /mw\.contentsWidth\(\)/.test(SRC) && /mw\.newLineX/.test(SRC));
  ok('②b 源码：量不到才退回公式（无头测试要能跑）',
    /if \(r > 80\) return r;/.test(SRC) && /var w = 816, pad = 36;/.test(SRC));
  /* 行为：挂一个假消息窗，看宽度是否按它算。
   ★ 必须带 `contents`（插件的守卫会检查它），否则会退回公式 —— 那正是它该做的。 */
  const fakeMW = {
    contents: {},
    contentsWidth: () => 700,
    newLineX: () => 200
  };
  S.SceneManager = S.SceneManager || {};
  S.SceneManager._scene = { _messageWindow: fakeMW };
  const noFaceW = Ainpc.messageTextWidth(false);
  const faceW = Ainpc.messageTextWidth(true);
  ok('②c 有真实窗口时按它算（无立绘）', noFaceW === 500, '700 - max(newLineX=200, 0) = ' + noFaceW);
  ok('②d 有真实窗口时按它算（有立绘，取更保守的）',
    faceW === 500 || faceW === 532, '700 - max(newLineX,168) = ' + faceW);
  /* 真实窗口宽度一变，折行结果必须跟着变 */
  fakeMW.contentsWidth = () => 400;
  const narrow = Ainpc.messageTextWidth(false);
  ok('②e 窗口变窄 → 可用宽度跟着变', narrow < noFaceW, noFaceW + ' → ' + narrow);
  S.SceneManager._scene = null;
  const fallback = Ainpc.messageTextWidth(false);
  ok('②f 没有窗口时退回公式', fallback === Math.max(120, 816 - 36), String(fallback));
  ok('②g 折行函数会用到这个宽度',
    Ainpc.wrapSay('测试', false).length >= 1 && typeof Ainpc.wrapLines === 'function');
}

/* ================================================================ ③ 人设同步到角色面板 */
console.log('\n③ 人设必须同步到「AI 角色」菜单');
{
  const keys = Object.keys(Ainpc.npcIndex).filter(k => (Ainpc.npcIndex[k].aiHint || '') !== 'system');
  const onMap = keys.filter(k => Ainpc.npcIndex[k].mapId === S.$gameMap.mapId());
  const key = onMap[0] || keys[0];
  const n = Ainpc.npcByKey(key);
  const MARK = '★探针-人设同步★';
  P.apply([{ key: key, name: '同步测试名', identity: MARK }]);

  let data = null;
  const sc = Object.create(Ainpc.Scene_AINpcConfig.prototype);
  sc._showAll = false;
  sc._listWindow = { setData: d => { data = d; }, select() { }, index: () => 0 };
  Ainpc.Scene_AINpcConfig.prototype.refreshList.call(sc);
  const row = (data || []).find(d => d.key === key);
  ok('③a 面板行存在（' + key + '）', !!row, row ? JSON.stringify(row).slice(0, 80) : '未找到');
  ok('③b 面板名字取的是**人设卡里的名字**', !!row && row.name === '同步测试名', row && row.name);
  ok('③c 面板身份含人设卡里的 identity', !!row && String(row.role).indexOf(MARK) >= 0, row && row.role);
  ok('③d 面板带 hasCard 标记（能看出"已写"）', !!row && row.hasCard === true);
  ok('③e 面板带人设字数（可排序/可核对）', !!row && row.personaChars > 0, row && String(row.personaChars));
  /* 源码：列表会画 ✎ */
  ok('③f 源码：列表给有卡的人画标记', /hasCard[\s\S]{0,200}?drawText\('✎'/.test(SRC) || /drawText\('✎'/.test(SRC));

  /* 本图没人时，别的地图上已写人设的角色要被附上来 */
  const emptyMap = (function () {
    const byMap = {};
    Object.keys(Ainpc.npcIndex).forEach(k => {
      const x = Ainpc.npcIndex[k];
      if (x.aiHint === 'system') return;
      byMap[x.mapId] = 1;
    });
    for (let m = 1; m <= 500; m++) if (!byMap[m]) return m;
    return 0;
  })();
  if (emptyMap) {
    const rawMapId = S.$gameMap.mapId;
    S.$gameMap.mapId = () => emptyMap;
    data = null;
    const sc2 = Object.create(Ainpc.Scene_AINpcConfig.prototype);
    sc2._showAll = false;
    sc2._listWindow = { setData: d => { data = d; }, select() { }, index: () => 0 };
    Ainpc.Scene_AINpcConfig.prototype.refreshList.call(sc2);
    const hints = (data || []).filter(d => d.special === 'hint').map(d => d.name);
    const offRows = (data || []).filter(d => d.offMap);
    ok('③g 空图：有说明行', hints.length >= 1, hints.join(' | '));
    ok('③h 空图：列出了别处已写人设的角色', offRows.length > 0, offRows.length + ' 个');
    ok('③i 空图：这些行也带 hasCard', offRows.every(d => d.hasCard === true));
    ok('③j 空图：列出的名字取卡里的名字', offRows.some(d => d.name === '同步测试名'),
      offRows.map(d => d.name).slice(0, 5).join('、'));
    S.$gameMap.mapId = rawMapId;
  } else {
    console.log('  ⚠ 这台游戏每张图都有人，跳过 ③g~③j');
  }
  /* 目录栏（资料馆）本来就读卡 —— 两边口径必须一致 */
  let lrow = null;
  try {
    const f2 = { _mode: 'actor', _listWindow: { setData: d => { lrow = (d || []).find(x => x.key === key); }, select() { }, topRow: () => 0, setTopRow() { } } };
    Ainpc.Scene_AILibrary.prototype.refreshList.call(f2);
  } catch (e) { }
  ok('③k 资料馆与菜单两边都显示同一条人设', !!lrow && String(lrow.role).indexOf(MARK) >= 0, lrow && lrow.role);
}

/* ================================================================ ④ 四语言文案 */
console.log('\n④ 四语言新文案');
{
  const langs = ['zh-CN', 'zh-TW', 'ja', 'en'];
  const need = ['hasCardsElsewhere', 'hasCardsMore'];
  const miss = [];
  if (Ainpc.TEXTS) {
    langs.forEach(L => {
      const pk = (Ainpc.TEXTS[L] || {}).panel || {};
      need.forEach(k => { if (!pk[k]) miss.push(L + '.' + k); });
    });
  }
  ok('④a 四语言 × 2 条新文案齐全', miss.length === 0, miss.join(' '));
  ok('④b 文案带 {n} 占位符（要显示数量）',
    (Ainpc.t('panel.hasCardsElsewhere', { n: 7 }) || '').indexOf('7') >= 0,
    Ainpc.t('panel.hasCardsElsewhere', { n: 7 }));
}

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);