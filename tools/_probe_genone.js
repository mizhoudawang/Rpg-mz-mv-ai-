/* 探针：Ctrl 单人生成（v2.10.1）
 * ===============================================================
 * 守的是什么：
 *   ① **静默红线** —— 三处入口在任何"落空"路径上都必须给出反馈。
 *      玩家报的「Ctrl 单独生成在呆呆里没有效果」，根因就是静默（按键与生成链路都是好的）。
 *   ② 新功能：互动中（对话时）单独生成角色设定 —— 菜单项与 Ctrl 同一条路。
 *   ③ 生成成功后必须：换掉 active.npc（这一场立刻按新卡演）+ 未启用则顺手交给 AI。
 *   ④ 单人生成线索里的人名取 displayName，不是原始素材名（呆呆 C:SF_Actor1 → 奥瑟兰）。
 *   ⑤ 本图没有可扮演角色时，配置菜单列表末尾要有说明行。
 *   ⑥ 四语言包新文案齐全。
 *
 * 用法：
 *   node _probe_genone.js --game=呆呆        # 从 _tmp/games.json 取
 *   node _probe_genone.js --www="D:/.../www" # 直接指定
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
if (!WWW) {
  console.error('需要 --game=<标签> 或 --www=<游戏的 www 目录>');
  process.exit(2);
}
/* --www / --plugin 必须在 require harness **之前**进 argv —— harness 靠它们定位。
 * ★ 插件路径要能显式指定：本探针随包发布，在包内它是 `tools/_probe_genone.js`，
 *   而 `__dirname` 指向 tools/ —— 硬编码 `__dirname/RM_AI_NPC.js` 会指向不存在的位置，
 *   harness 于是**静默退回游戏里已部署的那份插件**，包内验证就变成了假的。 */
const PLUG = arg('plugin') || path.join(__dirname, 'RM_AI_NPC.js');
process.argv.push('--www=' + WWW);
process.argv.push('--plugin=' + PLUG);

const H = require('./harness.js');
const Ainpc = H.Ainpc, S = H.sandbox;
const SRC = fs.readFileSync(H.PLUGIN, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ← ' + d : '')); } else { fail++; console.log('  ❌ ' + n + (d ? '  ← ' + d : '')); } };
console.log('插件:', H.PLUGIN);
console.log('游戏:', H.WWW, LABEL ? ('(' + LABEL + ')') : '');
if (H.loadError) { console.log('loadError:', H.loadError && H.loadError.stack || H.loadError); process.exit(1); }
/* 版本断言不许写死小版本 —— 否则每升一版都要回来改探针（v2.10.2 就踩了一次）。
 * 钉住"运行时读到的 == 文件里写的"，并要求不低于引入本功能的 2.10.1。 */
const _pv = (/Ainpc\.VERSION\s*=\s*'([^']+)'/.exec(SRC) || [])[1];
ok('版本号自洽（' + Ainpc.VERSION + '）', !!_pv && Ainpc.VERSION === _pv, Ainpc.VERSION);
ok('版本不低于引入本功能的 2.10.1', (function () {
  const p = String(Ainpc.VERSION).split('.').map(Number);
  return p[0] > 2 || (p[0] === 2 && (p[1] > 10 || (p[1] === 10 && p[2] >= 1)));
})(), Ainpc.VERSION);

const P = Ainpc.persona;
P.loaded || P.load();

/* ---------------------------------------------------------------- 打桩 */
let pressed = null;
S.Input = S.Input || {};
S.Input.isTriggered = function (name) { return pressed === name; };
S.Input.keyMapper = S.Input.keyMapper || {};
S.SoundManager = S.SoundManager || {};
S.SoundManager.playOk = function () { };
S.SoundManager.playCursor = function () { };
S.SceneManager = S.SceneManager || {};
S.SceneManager.push = function () { };

let lastChoice = null;
const rawShowChoice = Ainpc.showChoice;
Ainpc.showChoice = function (lines, choices) { lastChoice = { lines: lines, choices: choices }; };
let thinkLog = [];
const rawShowThinking = Ainpc.showThinking;
Ainpc.showThinking = function (on, label) { if (on) thinkLog.push(String(label || '')); };
const rawStall = Ainpc.stallInterpreter;
Ainpc.stallInterpreter = function () { };
Ainpc.DOM = Ainpc.DOM || {};
Ainpc.DOM.isOpen = function () { return false; };

Ainpc.config = Ainpc.config || {};
const oldKey = Ainpc.config.apiKey, oldModel = Ainpc.config.model;
Ainpc.config.apiKey = 'TEST-KEY';
Ainpc.config.model = 'test-model';

/* 假 LLM：genOne 走的是 P.genOne → Ainpc.postJson */
const rawPost = Ainpc.postJson;
Ainpc.postJson = function (url, hdr, body, cb) {
  const payload = JSON.stringify([{ key: (window.__k || 'k'), name: '测试名', identity: '测试身份' }]);
  cb(null, 200, JSON.stringify({ choices: [{ message: { content: payload } }] }));
};

/* 假对话现场 */
function fakeActive(key) {
  return { interp: { setWaitMode() { }, _ainpcRelease: false }, key: key, npc: Ainpc.npcByKey(key) || {}, turns: 0, face: { name: '', index: 0 }, originalText: [], token: 0 };
}

/* 找一个真角色 key（优先 displayName ≠ 原始素材名的那种，用来验人名） */
const keys = Object.keys(Ainpc.npcIndex || {});
const realKeys = keys.filter(k => (Ainpc.npcIndex[k].aiHint || '') !== 'system');
const names = realKeys.map(k => ({ k: k, dn: Ainpc.displayName(k) }));
const cKey = (names.find(x => x.dn && x.dn !== '居民' && x.dn !== x.k) || names[0] || {}).k;

/* ================================================================ ① 三处入口不许静默 */
console.log('\n① 入口落空必须出声（静默红线）');

/* ①a 配置菜单：special 行的 Ctrl */
{
  const proto = Ainpc.Scene_AINpcConfig.prototype;
  const sc = Object.create(proto);
  sc._genBusy = false; sc._lastHelp = null;
  sc._helpWindow = { setText: function (t) { sc._lastHelp = t; } };
  sc._listWindow = { item: () => ({ special: 'persona', name: '✦ 生成全部角色人设' }) };
  sc.refreshList = function () { };
  let called = false;
  const rawGen = P.genOne; P.genOne = function () { called = true; };
  proto.onGenOne.call(sc);
  P.genOne = rawGen;
  ok('①a 配置菜单：光标在功能项上按 Ctrl 有反馈', !!sc._lastHelp && !called, String(sc._lastHelp || '').slice(0, 40));
}
/* ①b 配置菜单：真人行仍然能生成 */
{
  const proto = Ainpc.Scene_AINpcConfig.prototype;
  const sc = Object.create(proto);
  sc._genBusy = false; sc._lastHelp = null;
  sc._helpWindow = { setText: function (t) { sc._lastHelp = t; } };
  sc._listWindow = { item: () => ({ key: cKey, name: Ainpc.displayName(cKey) }) };
  sc.refreshList = function () { };
  let gotKey = null;
  P.genOne = function (k, cb) { gotKey = k; cb(true, '已写好'); };
  proto.onGenOne.call(sc);
  ok('①b 配置菜单：真人行按 Ctrl 正常生成', gotKey === cKey, gotKey);
}
/* ①c 资料馆：总览行 */
{
  const proto = Ainpc.Scene_AILibrary.prototype;
  const sc = Object.create(proto);
  sc._mode = 'actor'; sc._genBusy = false; sc._lastHelp = null;
  sc._helpWindow = { setText: function (t) { sc._lastHelp = t; } };
  sc.refreshList = function () { };
  sc._listWindow = { item: () => ({ key: '__ov__', head: true, name: '🎭 角色　总览' }), _data: [] };
  let called = false;
  P.genOne = function () { called = true; };
  proto.onGenActorPersona.call(sc);
  ok('①c 资料馆：光标在总览行按 Ctrl 有反馈', !!sc._lastHelp && !called, String(sc._lastHelp || '').slice(0, 40));
}
/* ①d 资料馆：真人行 */
{
  const proto = Ainpc.Scene_AILibrary.prototype;
  const sc = Object.create(proto);
  sc._mode = 'actor'; sc._genBusy = false; sc._lastHelp = null;
  sc._helpWindow = { setText: function (t) { sc._lastHelp = t; } };
  sc.refreshList = function () { };
  sc._listWindow = { item: () => ({ key: cKey, name: Ainpc.displayName(cKey) }), _data: [] };
  let gotKey = null;
  P.genOne = function (k, cb) { gotKey = k; cb(true, 'ok'); };
  proto.onGenActorPersona.call(sc);
  ok('①d 资料馆：真人行按 Ctrl 正常生成', gotKey === cKey, gotKey);
}
/* ①e 源码：资料馆 update 里 Ctrl 不再被 mode 直接吃掉 */
ok('①e 源码：资料馆 Ctrl 在非角色栏也会给提示',
  /if \(Input\.isTriggered\('control'\)\) \{\s*\n\s*if \(this\._mode === 'actor'\) this\.onGenActorPersona\(\);/.test(SRC));
/* ①f 源码：配置菜单 Ctrl 不再裸 return */
ok('①f 源码：配置菜单 onGenOne 的落空分支有 setText',
  /onGenOne = function \(\)[\s\S]{0,600}?genOneNoTargetMsg\(\)/.test(SRC));

/* ================================================================ ② 互动中单人生成 */
console.log('\n② 互动中（对话时）的单人生成');
ok('②a 「互动…」子菜单含「单独生成角色设定」',
  Ainpc.pactChoices(cKey).some(c => c.key === 'sub:genpersona'),
  Ainpc.pactChoices(cKey).map(c => c.key).join(','));
ok('②b 该项排在「…算了」之前（不会被当成取消项）', (function () {
  const ch = Ainpc.pactChoices(cKey);
  return ch[ch.length - 1].key === 'sub:back' && ch[ch.length - 2].key === 'sub:genpersona';
})(), Ainpc.pactChoices(cKey).slice(-2).map(c => c.key).join(','));
ok('②c PACT 动作表没被污染（不能把生成塞进动作表）',
  Ainpc.pactChoices(cKey).filter(c => c.key.indexOf('pact:') === 0).length === Ainpc.pactList(cKey).length);

/* ②d 菜单项走通：genPersonaInTalk 成功路径 */
{
  const a = fakeActive(cKey);
  Ainpc.active = a;                       // 真实场景里 active 就是当前对话，探针必须还原这一层
  S.window = S.window || {};
  lastChoice = null;
  P.genOne = function (k, cb) { cb(true, '已写好'); };
  const r = Ainpc.genPersonaInTalk(a);
  ok('②d genPersonaInTalk 返回 true 并给出结果', r === true && !!lastChoice
    && /✔/.test(String(lastChoice.lines[0])), String(lastChoice && lastChoice.lines[0]).slice(0, 50));
  ok('②e 结果里带上了人名（不是 key）',
    !!lastChoice && String(lastChoice.lines[0]).indexOf(Ainpc.displayName(cKey)) >= 0,
    Ainpc.displayName(cKey));
  Ainpc.active = null;
}
/* ②f 换卡：active.npc 必须被换成新的那一份 */
{
  const a = fakeActive(cKey);
  a.npc = { stale: true };                // 假装手里拿的是旧副本
  Ainpc.active = a;
  P.genOne = function (k, cb) { cb(true, 'ok'); };
  Ainpc.genPersonaInTalk(a);
  ok('②f 生成后 active.npc 指向世界书里最新的那份', a.npc === Ainpc.npcByKey(cKey),
    a.npc === Ainpc.npcByKey(cKey) ? '已换成最新' : '还是旧副本');
  Ainpc.active = null;
}
/* ②g 未启用则顺手交给 AI */
{
  const a = fakeActive(cKey);
  Ainpc.active = a;
  Ainpc.setEnabled(cKey, false);
  P.genOne = function (k, cb) { cb(true, 'ok'); };
  lastChoice = null;
  Ainpc.genPersonaInTalk(a);
  ok('②g 他还没被交给 AI 时，顺手交出去', Ainpc.isEnabled(cKey) === true, '生成前 isEnabled=false');
  ok('②h 提示里说明了"已让他由 AI 扮演"',
    !!lastChoice && /AI/.test(String(lastChoice.lines[0])), String(lastChoice && lastChoice.lines[0]).slice(0, 60));
  Ainpc.active = null;
}
/* ②g2 已经开着的人不许被覆盖（本周目玩家的选择优先） */
{
  const a = fakeActive(cKey);
  Ainpc.active = a;
  Ainpc.setEnabled(cKey, true);
  Ainpc.npcState(cKey).onSet = false;     // 清掉"玩家亲手设过"的标记，模拟"批量全开"的情形
  P.genOne = function (k, cb) { cb(true, 'ok'); };
  lastChoice = null;
  Ainpc.genPersonaInTalk(a);
  ok('②g2 已在 AI 扮演的人不会被重复提示"已交给 AI"',
    !!lastChoice && !/已让他由 AI 扮演/.test(String(lastChoice.lines[0])),
    String(lastChoice && lastChoice.lines[0]).slice(0, 60));
  Ainpc.active = null;
}
/* ②i 四道闸都要出声 */
{
  const cases = [];
  const a = fakeActive(cKey);
  /* 无 Key */
  const k0 = Ainpc.config.apiKey; Ainpc.config.apiKey = '';
  lastChoice = null; Ainpc.genPersonaInTalk(a);
  cases.push(['无 API Key', !!lastChoice]);
  Ainpc.config.apiKey = k0;
  /* 忙 */
  Ainpc.generatingOne = true; lastChoice = null;
  Ainpc.genPersonaInTalk(a);
  cases.push(['已在生成中', !!lastChoice]);
  Ainpc.generatingOne = false;
  cases.forEach(c => ok('②i ' + c[0] + ' → 有提示', c[1]));
}
/* ②j Ctrl 热键 */
{
  const a = fakeActive(cKey);
  Ainpc.active = a;
  let called = 0;
  const rawFn = Ainpc.genPersonaInTalk;
  Ainpc.genPersonaInTalk = function () { called++; return true; };
  pressed = null; Ainpc.tickTalkHotkey();
  ok('②j 没按 Ctrl 时不动作', called === 0);
  pressed = 'control'; Ainpc.tickTalkHotkey();
  ok('②k 按 Ctrl 时触发单人生成', called === 1, 'called=' + called);
  /* 等 LLM 回复期间不许插队 */
  Ainpc.waitingForLlm = true; called = 0; pressed = 'control';
  Ainpc.tickTalkHotkey();
  ok('②l 正在等 AI 回复时不插队', called === 0);
  Ainpc.waitingForLlm = false;
  /* 自由发言输入框开着时不许抢 Ctrl */
  Ainpc.DOM.isOpen = function () { return true; };
  called = 0; pressed = 'control';
  Ainpc.tickTalkHotkey();
  ok('②m 玩家正在输入框里打字时不抢 Ctrl', called === 0);
  Ainpc.DOM.isOpen = function () { return false; };
  Ainpc.genPersonaInTalk = rawFn;
  Ainpc.active = null;
  called = 0; pressed = 'control';
  Ainpc.tickTalkHotkey();
  ok('②n 没有对话时不动作（也不报错）', called === 0);
  pressed = null;
}
/* ②o 源码：Ctrl 钩子必须挂在 active 早退之前 */
ok('②o 源码：tickTalkHotkey 在 `if (Ainpc.active) return;` 之前',
  (function () {
    const i = SRC.indexOf('Ainpc.tickTalkHotkey();');
    const j = SRC.indexOf('if (Ainpc.active) return;                                        // AI 对话进行中，不打断');
    return i > 0 && j > 0 && i < j;
  })());
ok('②p 源码：handleChoice 认 sub:genpersona',
  /c\.key === 'sub:genpersona'[\s\S]{0,120}?genPersonaInTalk/.test(SRC));

/* ================================================================ ③ 单人线索里的人名 */
console.log('\n③ 单人生成线索里的人名');
{
  /* ★ 要真正验证"素材名 → 显示名"，就得找一个**两者不同**的样本。
   *   剧情驱动型作品里这类最多：呆呆的 `C:SF_Actor1`（演员表原始名）→ 显示名「奥瑟兰」。
   *   先在全世界书里搜一遍，找不到再退回普通样本（并如实说明验证强度不足）。 */
  let sample = null, fallback = null;
  Object.keys(Ainpc.npcIndex || {}).forEach(k => {
    const n = Ainpc.npcIndex[k];
    if (n.aiHint === 'system') return;
    const dn = Ainpc.displayName(k) || '';
    const raw = n.name || n.role || '';
    if (!fallback) fallback = { k: k, dn: dn, raw: raw };
    /* 显示名是有意义的 CJK 名，而原始值是 ASCII 素材名 —— 正是要修的那一类 */
    if (!sample && dn && /[\u4e00-\u9fa5]/.test(dn) && /^[A-Za-z0-9_:.\-]+$/.test(raw) && raw !== dn) {
      sample = { k: k, dn: dn, raw: raw };
    }
  });
  const use = sample || fallback || { k: cKey };
  const clue = P.clueOf(use.k);
  ok('③a clueOf 有结果（' + use.k + '）', !!clue, use.k);
  ok('③b actorName 取显示名', !!clue && clue.actorName === Ainpc.displayName(use.k),
    (clue && clue.actorName) + ' vs ' + Ainpc.displayName(use.k));
  ok('③c 原始素材名另存在 rawActorName（备查）', !!(clue && ('rawActorName' in clue)));
  if (sample) {
    ok('③d 素材名样本：actorName 不是原始素材名',
      clue.actorName !== clue.rawActorName && /[\u4e00-\u9fa5]/.test(clue.actorName),
      use.k + '：原始=' + clue.rawActorName + ' → actorName=' + clue.actorName);
  } else {
    console.log('  ⚠ 这台机器上没有"显示名 ≠ 原始素材名"的样本，③d 用合成样本代替');
  }
  /* ★ ③d′ 合成样本：**精确验证取值优先级**，不依赖这台机器"有没有生成过人设"。
   *   为什么必须合成：已经跑过批量生成的机器上，`n.name` 早被 AI 写回成中文名了，
   *   素材名只活在 persona_input 的 member.actorName 里 —— 照机器现状取样，
   *   这个 bug 会"看起来不存在"。构造一个 name 为空的条目才能还原真实现场。 */
  {
    const TK = '__probe:genone__';
    Ainpc.npcIndex[TK] = {
      key: TK, mapId: 999999, eventId: 1, eventName: 'SF_ActorX', mapName: '探针图',
      role: '居民', name: '', aiHint: 'npc', charName: 'Nature', charIndex: 0,
      dialogues: [{ text: '探针台词一' }, { text: '探针台词二' }]
    };
    const savedGroups = P.groups;
    P.groups = [{ groupId: 'probe', title: '探针图', place: '探针图', members: [
      { key: TK, eventName: 'SF_ActorX', actorName: 'SF_ActorX', mapName: '探针图',
        place: '探针图', sprite: '（探针）', dialogues: ['探针台词一', '探针台词二'], importance: 'core' }
    ] }];
    const t = P.clueOf(TK);
    ok('③d′ 素材名不会被当成要发给模型的人名',
      !!t && t.actorName !== 'SF_ActorX' && t.actorName === (Ainpc.displayName(TK) || t.actorName),
      t ? ('member.actorName=SF_ActorX → 实际发出=' + t.actorName) : 'clueOf 为空');
    ok('③d″ 原始值仍可查（rawActorName）', !!t && t.rawActorName === 'SF_ActorX',
      t && t.rawActorName);
    P.groups = savedGroups;
    delete Ainpc.npcIndex[TK];
  }
  /* ③e 名字必须真进提示词 —— renderMember 的 {{ACTOR_NAME}} 用的就是 actorName */
  if (clue) {
    const rendered = P.renderMember(clue, 0);
    ok('③e 渲染进提示词的成员卡用的是显示名',
      rendered.indexOf(String(clue.actorName)) >= 0 && !!clue.actorName,
      String(clue.actorName));
  } else { ok('③e 渲染进提示词的成员卡用的是显示名', false, 'clueOf 为空'); }
}

/* ================================================================ ④ 空列表提示行 */
console.log('\n④ 本图没有可扮演角色时的列表');
{
  const real = S.$gameMap.mapId();
  /* 挪到一张确定没有非 system 条目的地图上（从 1 开始找） */
  const byMap = {};
  Object.keys(Ainpc.npcIndex).forEach(k => {
    const n = Ainpc.npcIndex[k];
    if (n.aiHint === 'system') return;
    byMap[n.mapId] = (byMap[n.mapId] || 0) + 1;
  });
  let emptyMap = 0;
  for (let m = 1; m <= 400; m++) { if (!byMap[m]) { emptyMap = m; break; } }
  if (!emptyMap) {
    console.log('  ⚠ 这台游戏的每一张地图都有可扮演角色，跳过 ④');
  } else {
    const rawMapId = S.$gameMap.mapId;
    S.$gameMap.mapId = function () { return emptyMap; };
    let data = null;
    const sc = Object.create(Ainpc.Scene_AINpcConfig.prototype);
    sc._showAll = false;
    sc._listWindow = { setData: d => { data = d; }, select() { }, index: () => 0 };
    Ainpc.Scene_AINpcConfig.prototype.refreshList.call(sc);
    ok('④a 空图名单里有说明行', !!data && data.some(d => d.special === 'hint'),
      data ? data.filter(d => d.special === 'hint').map(d => d.name).join(',') : '');
    /* 说明行不能被 Enter 当成功能项 */
    const sc2 = Object.create(Ainpc.Scene_AINpcConfig.prototype);
    sc2._helpWindow = { setText() { } };
    let panelOpened = false;
    const rawOpen = Ainpc.openConfigPanel;
    Ainpc.openConfigPanel = function () { panelOpened = true; return true; };
    sc2._listWindow = { item: () => ({ key: '__nochar__', special: 'hint' }), activate() { }, refresh() { } };
    Ainpc.Scene_AINpcConfig.prototype.onOk.call(sc2);
    Ainpc.openConfigPanel = rawOpen;
    ok('④b 说明行按 Enter 不会误开配置面板', !panelOpened, 'panelOpened=' + panelOpened);
    S.$gameMap.mapId = rawMapId;
  }
}

/* ================================================================ ⑤ 四语言文案 */
console.log('\n⑤ 四语言包新文案齐全');
{
  const need = ['pactGenPersona', 'pactGenPersonaAsk', 'pactGenPersonaOk', 'pactGenPersonaFail',
    'pactGenPersonaNoKey', 'pactGenPersonaNoTpl', 'pactGenPersonaBusy'];
  const needPanel = ['genOneEmptyMap', 'genOneSpecial', 'noCharHere', 'noCharHereHint', 'libGenPick', 'libGenOnlyActor'];
  const langs = ['zh-CN', 'zh-TW', 'ja', 'en'];
  const packs = Ainpc.TEXTS || (function () { try { return eval('(' + /TEXTS = (\{[\s\S]*?\});\s*\n/.exec(SRC)[1] + ')'); } catch (e) { return null; } })();
  const miss = [];
  if (Ainpc.TEXTS) {
    langs.forEach(L => {
      const pk = Ainpc.TEXTS[L] || {};
      need.forEach(k => { if (!(pk.ui && pk.ui[k])) miss.push(L + '.ui.' + k); });
      needPanel.forEach(k => { if (!(pk.panel && pk.panel[k])) miss.push(L + '.panel.' + k); });
    });
    ok('⑤a 四语言 × 13 条新文案齐全', miss.length === 0, miss.slice(0, 6).join(' '));
  } else {
    /* 语言包没导出就退回文本断言 */
    langs.forEach(() => { });
    const cn = (k) => new RegExp(k + ":").test(SRC);
    ok('⑤a（文本断言）新文案在源码里', need.concat(needPanel).every(cn));
  }
  /* helpActor 提到 Ctrl */
  const ha = SRC.match(/helpActor: '([^']*)'/g) || [];
  ok('⑤b 四份 helpActor 都写了 Ctrl', ha.length === 4 && ha.every(s => /Ctrl/.test(s)), ha.length + ' 份');
}

/* ---------------------------------------------------------------- 还原 */
Ainpc.showChoice = rawShowChoice;
Ainpc.showThinking = rawShowThinking;
Ainpc.stallInterpreter = rawStall;
Ainpc.postJson = rawPost;
Ainpc.config.apiKey = oldKey;
Ainpc.config.model = oldModel;

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
