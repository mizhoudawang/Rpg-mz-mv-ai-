/* 探针：别把所有人都当陌生人（v2.10.4）
 * ============================================================
 * 玩家报的原话：「角色扮演时，所有角色都是陌生人……Mira 里实验室的老师本来对主角很温柔，
 * 态度偏差太大」。
 *
 * 排查下来是**四层**叠加，每一层单独都还合理，叠起来就成了"全员陌生人"：
 *
 *   ① 默认关系文案整套是商店口气。
 *      `aff.tone` / `aff.act` 的五个档位写的是「普通的买卖关系」「价钱按本价」——
 *      可 95% 的 NPC 不做买卖。给他们也套这句，就是一副店家待客的客气疏远。
 *      修法：同档位再写一份 `toneNs` / `actNs`（「不是来做买卖的」版本），
 *      `relationBrief()` 按 `hasRealShop()` 分流。
 *
 *   ② 提示词里从来没有"跟你说话的人是谁"。
 *      world_bible.json 里其实写着（Mira：米拉·艾亚丽兹，就读于阿维尔的学校），
 *      可那份文件只喂给「人设工坊」，**对话提示词一次都没读过**。
 *      修法：`Ainpc.protagonist()` 懒加载主角档案 → buildMessages 拼 `prompt.worldYou` 段。
 *
 *   ③ 人设卡里根本没地方写"他和主角什么关系"。
 *      铁律 8 要求 relations 只能写本组名单里的人，主角不在名单里 → 永远写不出来；
 *      再叠上"初次见面 = 彼此不认识"，老师对学生也被演成生人。
 *      修法：新增卡片字段 `towardPlayer`（铁律 8 的唯一例外），并把它写进
 *      对话提示词；初次见面另给一句"交情归零，身份照旧"。
 *
 *   ④ 「你们今天才第一次打交道」这句字面没错，模型却极易读成"不认识"。
 *      修法：`prompt.strangerKnown` 变体，有人设卡写了关系时才用。
 *
 * 用法：node _probe_relation.js --game=Mira [--plugin=<路径>]
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

/* TEXTS 在闭包里、Ainpc 上没挂出来；而四个语言段也不适合按 "语言名:" 切
 *（ja / en 用的是裸键名）。所以改用两种更笨但可靠的办法：
 *   ·「有几种语言写了这条」→ 数 `^\s*key\s*:` 的定义条数，应当正好 4。
 *   ·「某一组的字段齐不齐」→ 把所有 toneNs / actNs 块逐个挖出来，逐块查五档位。 */
const LANGS = ['zh-CN', 'zh-TW', 'ja', 'en'];
function defs(key) { return (SRC.match(new RegExp('^\\s*' + key + '\\s*:', 'gm')) || []).length; }
function blocks(name) {
  const out = []; const re = new RegExp(name + '\\s*:\\s*\\{', 'g'); let m;
  while ((m = re.exec(SRC))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < SRC.length && depth > 0) {
      const c = SRC[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    out.push(SRC.slice(m.index, i));
  }
  return out;
}
const ok4 = (key) => defs(key) === 4;
/* 当前语言下的取词（T()） */
const T = (k) => Ainpc.t(k);

/* ================================================================ ① 非商人文案 */
console.log('\n① 默认关系文案不能是商店口气（非商人走 toneNs / actNs）');
{
  const TIERS = ['hated', 'cold', 'plain', 'warm', 'close'];
  const toneB = blocks('toneNs'), actB = blocks('actNs');
  ok('①a 四语言都有 toneNs / actNs 两组',
    toneB.length === 4 && actB.length === 4, toneB.length + ' 组 toneNs / ' + actB.length + ' 组 actNs');
  const fieldMiss = [];
  toneB.forEach(function (b, i) {
    TIERS.forEach(t => { if (!new RegExp('\\b' + t + '\\s*:').test(b)) fieldMiss.push('toneNs#' + i + '.' + t); });
  });
  actB.forEach(function (b, i) {
    TIERS.forEach(t => { if (!new RegExp('\\b' + t + '\\s*:').test(b)) fieldMiss.push('actNs#' + i + '.' + t); });
  });
  ok('①a2 四语言 × 五档位字段全齐', fieldMiss.length === 0,
    fieldMiss.join(', ') || (toneB.length + '×' + TIERS.length + '×2 段'));

  /* 注意 npcByKey 读的是 Ainpc.npcIndex，不是 worldbook.npcs ——
   假 NPC 必须同时写进索引，否则 relationBrief / buildMessages 拿到的全是 null。 */
function putNpcs(list) {
  Ainpc.worldbook = Ainpc.worldbook || { npcs: [], game: {} };
  Ainpc.worldbook.npcs = list;
  Ainpc.npcIndex = Ainpc.npcIndex || {};
  list.forEach(function (n) { Ainpc.npcIndex[n.key] = n; });
  return list;
}

/* 非商人的五档位里，不能把"买卖关系"当成本人的关系陈述。
   ★ 只查陈述句，不查所有买卖词 —— 上面那句「别拿店家对客人的口气对待他」
     本身就含"店家/客人"，那正是要的效果（明令模型别那么演）。 */
const SHOP_CLAIM = ['买卖关系', '价钱按本价', '不打折也不刁难', '固定的买卖', 'sale relationship',
  'price at face value', 'no discounts'];
  const bad = [];
  toneB.concat(actB).forEach(function (b, i) {
    SHOP_CLAIM.forEach(w => { if (b.indexOf(w) >= 0) bad.push('#' + i + ' 仍把买卖当关系「' + w + '」'); });
  });
  ok('①b 非商人文案不把买卖当本人关系', bad.length === 0, bad.join('; ') || '已清');
  ok('①b2 非商人的 plain 档明令"别拿店家口气"',
    toneB.filter(b => /plain\s*:/.test(b))
      .every(b => /不是來買東西|不是来买东西| Protocols?|buy/i.test(b) || /把关|距離/.test(b)));

  /* 行为：拿一个"明确不是商人"的 NPC 走 relationBrief，看有没有落回商店腔 */
  putNpcs([{
    key: '_probe_teacher', name: '实验室的老师', role: '教师',
    // 明确不带 goods / branch / merchant 标签
    lines: []
  }]);
  const brief = Ainpc.relationBrief('_probe_teacher');
  ok('①c 老师（非商人）的语气段不含买卖腔',
    brief.indexOf('买卖关系') < 0 && brief.indexOf('价钱按本价') < 0,
    JSON.stringify(brief.split('\n').slice(2) || []).slice(0, 80));
  ok('①d 老师用的是非商人口气（明说"他不是来买东西的"）',
    brief.indexOf('不是来买东西的') >= 0 || brief.indexOf('不热络也不冷淡') >= 0);

  /* 商人仍走原版 —— 别把这条改坏了 */
  putNpcs([{
    key: '_probe_teacher', name: '实验室的老师', role: '教师', lines: []
  }, {
    key: '_probe_shop', name: '杂货店老板', role: '商人',
    // ★ hasRealShop 读的是 npc.shop.goods / npc.shop.branch —— 不是 npc.goods
    shop: { goods: [{ name: '苹果', price: 10 }] }
  }]);
  const sb = Ainpc.relationBrief('_probe_shop');
  ok('①e 商人仍走原版买卖口气',
    sb.indexOf('买卖关系') >= 0 || sb.indexOf('价钱按本价') >= 0,
    JSON.stringify(sb.split('\n').slice(2) || []).slice(0, 80));
}

/* ================================================================ ② 提示词里有主角 */
console.log('\n② 对话提示词必须说明"跟你说话的人是谁"');
{
  ok('②a 四语言都有 prompt.worldYou', ok4('worldYou'), defs('worldYou') + '/4');
  ok('②b 四语言都有 prompt.personaToward', ok4('personaToward'), defs('personaToward') + '/4');
  ok('②c 四语言都有 prompt.firstMeetKnown', ok4('firstMeetKnown'), defs('firstMeetKnown') + '/4');
  ok('②d 四语言都有 prompt.strangerKnown', ok4('strangerKnown'), defs('strangerKnown') + '/4');
  ok('②e 源码：Ainpc.protagonist() 存在且懒加载',
    /Ainpc\.protagonist = function \(\)/.test(SRC) && /Ainpc\._protagonist !== undefined/.test(SRC));

  /* 行为：真的从 world_bible.json 里读出来 */
  const P = Ainpc.persona; P.loaded || P.load();
  Ainpc._protagonist = undefined;
  const pg = Ainpc.protagonist();
  if (pg) {
    ok('②f 本机 world_bible.json 里有 protagonist，读出来了',
      !!(pg.name || pg.desc), (pg.name || '') + '｜' + String(pg.desc || '').slice(0, 40));
  } else {
    console.log('  · 本机没有 protagonist 字段（世界书是旧版）—— 主角档案这一段会缺，'
      + '其余检查照样成立');
    ok('②f 取不到时不抛异常（返回 null，老机器照常跑）', pg === null || pg === undefined, String(pg));
  }
  ok('②g reloadProtagonist 能清缓存',
    typeof Ainpc.reloadProtagonist === 'function' && Ainpc.reloadProtagonist() !== undefined);
  ok('②h 生成圣经后立刻重读主角缓存',
    /reloadProtagonist/.test(SRC.slice(SRC.indexOf("key: 'bible'") - 400, SRC.indexOf("key: 'bible'") + 900)));
}

/* ================================================================ ③ 人设卡的 towardPlayer */
console.log('\n③ 人设卡要能写"他和主角什么关系"');
{
  ok('③a 玩家模板里追加了 towardPlayer 要求（铁律 8 的唯一例外）',
    /playerTieRule/.test(SRC) && /唯一例外/.test(SRC));
  ok('③b 玩家模板自己提过 towardPlayer 时不重复追加',
    /indexOf\('towardPlayer'\) >= 0/.test(SRC));

  /* 行为：playerTieRule 的实际产出 */
  const rule = Ainpc.persona.playerTieRule();
  ok('③c playerTieRule() 产出的要求非空', !!rule && rule.indexOf('towardPlayer') >= 0,
    (rule || '').split('\n')[0]);
  ok('③d playerTieRule() 明说这是铁律 8 的例外', (rule || '').indexOf('例外') >= 0);

  /* 行为：模板已含该字段时不追加（别覆盖玩家自己写的） */
  const savePrompt = Ainpc.persona.prompt;
  Ainpc.persona.prompt = { userTemplate: '请输出 towardPlayer 字段', system: '' };
  ok('③e 模板已含 towardPlayer 时 playerTieRule() 返回空串',
    Ainpc.persona.playerTieRule() === '');
  Ainpc.persona.prompt = savePrompt;

  /* 写入 / 读取 / 编辑三处白名单都得认这个字段 */
  ok('③f 写卡时 towardPlayer 进对象', /towardPlayer: c\.towardPlayer \|\| ''/.test(SRC));
  ok('③g 保存白名单含 towardPlayer（手工编辑不会被吞）',
    /'relations', 'towardPlayer', 'greeting', 'taboo'/.test(SRC));
  ok('③h 编辑器认「与主角的关系」这一行',
    /与主角的关系/.test(SRC) && /对主角的态度/.test(SRC) && /对玩家的态度/.test(SRC));
  ok('③i 字数统计含 towardPlayer（不会因此排到列表末尾）',
    /'relations',\s*\n\s*'towardPlayer', 'greeting', 'taboo'/.test(SRC));
  ok('ⓘ 资料馆卡片展示 towardPlayer', /card\.towardPlayer\).*libT\('cardToward'/.test(SRC));
  ok('③j 四语言都有 cardToward 标签', ok4('cardToward'), defs('cardToward') + '/4');
}

/* ================================================================ ④ 提示词真的用上了 */
console.log('\n④ 对话提示词实际把关系用进去');
{
  putNpcs([
    { key: '_probe_plain', name: '路人甲', role: '居民', lines: [] },
    { key: '_probe_close', name: '实验室的老师', role: '教师', lines: [],
      persona: {
        key: '_probe_close', name: '实验室的老师', identity: '本校教师',
        personality: '温和', speech: '亲切', stance: '关注学生',
        relations: '与同校教师点头之交',
        towardPlayer: '他是本校的学生 —— 你作为老师对他既有要求也有关照。',
        greeting: '「今天有没有受伤？」'
      } }
  ]);
  Ainpc._protagonist = undefined;

  const mk = (key) => {
    Ainpc._protagonist = undefined;
    const msgs = Ainpc.buildMessages({
      key: key, npc: Ainpc.npcByKey(key),
      gameState: {
        mapName: '实验室', gold: 100, currency: 'G',
        party: [], mapKey: 1, level: 1
      },
      playerText: '你好。',
      firstMeeting: true
    });
    return (msgs || []).map(m => (m && m.content) || '').join('\n');
  };
  const sys1 = mk('_probe_plain'), sys2 = mk('_probe_close');

  ok('④a 有人设卡时初次见面用 firstMeetKnown', sys2.indexOf(T('prompt.firstMeetKnown').slice(0, 12)) >= 0);
  ok('④b 无人设卡时仍是 firstMeet（老行为不变）', sys1.indexOf(T('prompt.firstMeet').slice(0, 12)) >= 0);
  ok('④c 人设卡的对主角关系进了 system',
    sys2.indexOf('老师对他既有要求也有关照') >= 0);
  /* ★ 断言要点：stranger 与 strangerKnown 前半句是同一句（「你们今天才第一次打交道」），
     所以不能拿前缀比 —— 要比各自**独有**的那半句。 */
  ok('④d 首次见面的关系段用 strangerKnown',
    sys2.indexOf(T('prompt.strangerKnown')) >= 0
    && sys2.indexOf('生分不必') >= 0);
  ok('④e 没人设卡时关系段仍是 stranger（不含 strangerKnown 的独有后半句）',
    sys1.indexOf(T('prompt.stranger')) >= 0 && sys1.indexOf('生分不必') < 0);
  ok('④f 人设卡的 towardPlayer 经 tieOf() 过滤后传进 buildMessages',
    /var tie = Ainpc\.persona\.tieOf\(PC\)/.test(SRC)
    && /tie \? \(Ainpc\.t\('prompt\.personaToward'\) \+ tie\) : ''/.test(SRC)
    && /tie \? 'prompt\.firstMeetKnown' : 'prompt\.firstMeet'\)\);/.test(SRC));
  ok('④g 主角档案非空时 worldYou 段出现在 system（这台机器的世界书有没有写是另一回事）',
    /world\.push\(Ainpc\.t\('prompt\.worldYou'\) \+ pgTxt\)/.test(SRC));

  /* ★ 端到端：Mira 真实世界里，那个"实验室的老师"拿到主角档案后，
   * 提示词里必须**同时**出现主角身份 + 与主角的关系，且**不再**说"彼此都不认识"。 */
  const real = Ainpc.buildMessages({
    key: '_probe_close', npc: Ainpc.npcByKey('_probe_close'),
    gameState: { mapName: '实验室', gold: 100, currency: 'G', party: [], mapKey: 1, level: 1 },
    playerText: '你好。', firstMeeting: true
  });
  const realTxt = (real || []).map(m => (m && m.content) || '').join('\n');
  const pgNow = Ainpc.protagonist();
  if (pgNow && (pgNow.name || '')) {
    ok('④h 真实提示词里带上了主角名字',
      realTxt.indexOf(String(pgNow.name).slice(0, 3)) >= 0, String(pgNow.name));
  } else {
    ok('④h 本机无主角档案 → 该段缺席但不报错（老机器照常跑）', true, '跳过');
  }
  /* ★ 只查 firstMeet 的**独有**那句「彼此都不认识」。
     firstMeetKnown 里「别演成素不相识的路人」本身就是在否定这种演法，属于正确文案。 */
  ok('④i 全程没有「彼此都不认识」这种把人推成路人的句子',
    realTxt.indexOf('彼此都不認識') < 0 && realTxt.indexOf('彼此都不认识') < 0);
  ok('④j 提示词明确要求「照人设里的关系演，别当路人」',
    realTxt.indexOf(T('prompt.firstMeetKnown')) >= 0);
}

/* ================================================================ ⑤ 审计补漏（v2.10.5）
 *
 *  这五条不是设计问题，是审计出来的**真实 bug**，全部踩在"探针只测设计意图"的盲区里：
 *  ① 占位值把修复反转：playerTieRule 要求模型无线索时写「素不相识，按平常的分寸对待」，
 *     那是非空串，裸真值判断会当成"有关系" → 提示词里三句自相矛盾，
 *     对真正的陌生人硬说"你们不是陌生人"。
 *  ② 预算把开场白挤掉：`persona.slice(0,1600)` 从尾部硬切，而 greeting 靠后。
 *  ③ 编辑器删行 ≠ 清空：删掉整行时 rec 里没这个键，白名单跳过 → 旧值照旧生效。
 *  ④ playerTieRule 硬编码中文：日/英游戏里发给模型的要求会突然变成中文。
 *  ⑤ npcByKey 没有 npcIndex 守卫。
 */
console.log('\n⑤ 审计补漏（占位值 / 预算 / 删行 / 国际化 / 防御）');
{
  /* ⑤-1~3 占位值判定 */
  const PLACE = ['素不相识，按平常的分寸对待', '素不相识', '素不相識', '无', '無', '没有', '沒有',
    'none', 'N/A', 'na', '-', '—', '不知道', '不清楚', '不详', 'NULL', '面識なし'];
  const wrong = PLACE.filter(v => Ainpc.persona.tieOf({ towardPlayer: v }) !== '');
  ok('⑤-1 占位值一律不算「有关系」', wrong.length === 0,
    wrong.join(',') || PLACE.length + ' 种占位全过滤');

  const KEEP = ['他是本校的学生 —— 你作为老师对他既有要求也有关照。',
    '你们素不相识，但他知道你叫什么',
    '不认识，但听说过你的名声',
    '面識はないが名前は知っている'];
  const lost = KEEP.filter(v => Ainpc.persona.tieOf({ towardPlayer: v }) !== v.trim());
  ok('⑤-2 真关系描述不被误伤（含顺带提到"素不相识"的句子）',
    lost.length === 0, lost.join(' | ') || KEEP.length + ' 例全部保留');

  ok('⑤-3 空 / 空白 / 缺字段都算「没写」',
    Ainpc.persona.tieOf(null) === '' && Ainpc.persona.tieOf({}) === ''
    && Ainpc.persona.tieOf({ towardPlayer: '' }) === ''
    && Ainpc.persona.tieOf({ towardPlayer: '  \u3000 ' }) === ''
    && Ainpc.persona.tieOf({ towardPlayer: null }) === ''
    && Ainpc.persona.tieOf({ towardPlayer: undefined }) === '');

  /* ⑤-4 三处读取必须全走 tieOf，不能留裸真值判断 */
  const bare = SRC.match(/PC\.towardPlayer\s*\?|!!\(PC && PC\.towardPlayer\)|PC && PC\.towardPlayer/g) || [];
  ok('⑤-4 三处读取再无裸真值判断', bare.length === 0, bare.join(',') || '已全改走 tieOf');

  /* ⑤-5~7 端到端：占位值 NPC 不该被当成"有既定关系" */
  putNpcs([{
    key: '_probe_ph', name: '陌生路人', role: '居民', lines: [],
    persona: {
      key: '_probe_ph', name: '陌生路人', identity: '居民',
      relations: '与镇上的人点头之交',
      towardPlayer: '素不相识，按平常的分寸对待'
    }
  }]);
  Ainpc._protagonist = undefined;
  const phTxt = Ainpc.buildMessages({
    key: '_probe_ph', npc: Ainpc.npcByKey('_probe_ph'),
    gameState: { mapName: '村口', gold: 100, currency: 'G', party: [], mapKey: 1, level: 1 },
    playerText: '你好。', firstMeeting: true
  }).map(m => (m && m.content) || '').join('\n');
  ok('⑤-5 占位值 NPC 拿不到「不是陌生人」那两句',
    phTxt.indexOf('生分不必') < 0 && phTxt.indexOf(T('prompt.firstMeetKnown')) < 0);
  ok('⑤-6 占位值 NPC 不进 persona 段（不占预算、不添乱）',
    phTxt.indexOf('你和主角的关系') < 0);
  ok('⑤-7 占位值 NPC 仍走原版 firstMeet',
    phTxt.indexOf(T('prompt.firstMeet')) >= 0);

  /* ⑤-8 反向：真关系必须仍然生效（别把修复改没了） */
  putNpcs([{
    key: '_probe_real', name: '实验室的老师', role: '教师', lines: [],
    persona: {
      key: '_probe_real', name: '实验室的老师', identity: '本校教师',
      relations: '与同校教师点头之交',
      towardPlayer: '他是本校的学生 —— 你作为老师对他既有要求也有关照。'
    }
  }]);
  Ainpc._protagonist = undefined;
  const realTxt2 = Ainpc.buildMessages({
    key: '_probe_real', npc: Ainpc.npcByKey('_probe_real'),
    gameState: { mapName: '实验室', gold: 100, currency: 'G', party: [], mapKey: 1, level: 1 },
    playerText: '你好。', firstMeeting: true
  }).map(m => (m && m.content) || '').join('\n');
  ok('⑤-8 真关系仍然生效（没被过滤过头）',
    realTxt2.indexOf('既有要求也有关照') >= 0
    && realTxt2.indexOf(T('prompt.firstMeetKnown')) >= 0);

  /* ⑤-9~10b 预算顺序（★ 必须限定在 persona 数组内匹配 ——
     全局 indexOf 会先命中注释里的同名文字，判出来的顺序是假的） */
  const pa = SRC.slice(SRC.indexOf('persona = ['),
    SRC.indexOf("].filter(Boolean).join('\\n');", SRC.indexOf('persona = [')));
  const iTie = pa.indexOf("tie ? (Ainpc.t('prompt.personaToward')");
  const iGreet = pa.indexOf("PC.greeting ? (Ainpc.t('prompt.personaGreet')");
  const iRel = pa.indexOf("PC.relations ? ('你与其他人的关系：'");
  /* 期望顺序：… stance → relations → **tie** → taboo → greeting。
     tie 在 relations 后 = 不挤掉既有字段；在 greeting 前 = 长卡里开场白不会先被切。 */
  ok('⑤-9 persona 里 towardPlayer 排在 greeting 之前（不被预算先砍）',
    iTie > 0 && iGreet > iTie, 'tie@' + iTie + ' greet@' + iGreet);
  ok('⑤-10 persona 里 towardPlayer 排在 relations 之后（不挤掉既有字段）',
    iRel >= 0 && iTie > iRel, 'rel@' + iRel + ' tie@' + iTie);
  ok('⑤-10b persona 里 towardPlayer 排在 taboo 之前',
    pa.indexOf('PC.taboo') > iTie);

  /* ⑤-11~13 编辑器：删行 = 清空
     ★ 曾经想用「记录哪些标签出现过」来区分 —— **行不通**：
       整行删掉时那个标签也就不出现了，seen 里同样没有它，
       跟"没碰过这一行"长得一模一样。正确口径是**由表单声明它管辖哪些字段**
       （编辑器把每个字段的标签都预填出来，所以管不着的一律视作玩家删掉了）。 */
  ok('⑤-11 personaSaveCard 支持 rec.managed（表单声明管辖范围）',
    /var managed = rec\.managed \|\| null;/.test(SRC)
    && /var isManaged = function \(f\) \{ return !!managed && managed\.indexOf\(f\) >= 0; \};/.test(SRC));
  ok('⑤-12 编辑器把 managed 传给保存层（并覆盖全部 ACTOR_FIELDS）',
    /rec\.managed = ACTOR_FIELDS\.map\(function \(f\) \{ return f\[0\]; \}\);/.test(SRC));
  ok('⑤-13 knowledge 也归 managed 管（删掉那一行同样清空）',
    /if \(rec\.knowledge !== undefined \|\| isManaged\('knowledge'\)\)/.test(SRC));

  /* 行为验证：删掉整行 vs 只把值清空 —— 两者都必须让卡里变空。
     ★ 必须连 managed 一起传，否则测的不是真实编辑器那条路径。 */
  Ainpc._wbWrite = function () { return true; };            // 别真写盘
  const MANAGED = ['name', 'identity', 'appearance', 'personality', 'speech', 'knowledge',
    'stance', 'relations', 'towardPlayer', 'taboo', 'greeting'];
  function trySave(lines) {
    const AF = [
      ['name', /^\s*(名字|名称|姓名)\s*[:：]\s*(.*)$/],
      ['identity', /^\s*(身份|职业)\s*[:：]\s*(.*)$/],
      ['relations', /^\s*(与别人的关系|关系|人际)\s*[:：]\s*(.*)$/],
      ['towardPlayer', /^\s*(与主角的关系|对主角的态度|对玩家的态度)\s*[:：]\s*(.*)$/],
      ['greeting', /^\s*(开场白|问候语)\s*[:：]\s*(.*)$/]
    ];
    const rec = {};
    String(lines).split('\n').forEach(function (line) {
      if (!line.trim()) return;
      for (var i = 0; i < AF.length; i++) {
        var m = AF[i][1].exec(line); if (!m) continue;
        rec[AF[i][0]] = m[2].trim(); return;
      }
    });
    const n2 = {
      key: '_managed', name: '老师',
      persona: { name: '老师', identity: '教师', relations: '点头之交', towardPlayer: '老师对学生有关照' }
    };
    Ainpc.npcIndex._managed = n2;
    rec.managed = MANAGED;                 // ← 模拟编辑器提交
    Ainpc.personaSaveCard('_managed', rec);
    return n2.persona.towardPlayer;
  }
  Ainpc.worldbook = Ainpc.worldbook || { npcs: [] };
  Ainpc.npcIndex = Ainpc.npcIndex || {};
  const base = '名字：老师\n身份：教师\n与别人的关系：点头之交\n与主角的关系：老师对学生有关照\n开场白：「受伤了吗？」';
  const delLine = '名字：老师\n身份：教师\n与别人的关系：点头之交\n开场白：「受伤了吗？」';
  const emptyVal = '名字：老师\n身份：教师\n与别人的关系：点头之交\n与主角的关系：\n开场白：「受伤了吗？」';
  ok('⑤-14 原样保存 → 值保留', trySave(base) === '老师对学生有关照');
  ok('⑤-15 ★ 整行删掉 → 卡里也变空（不再留旧值）', trySave(delLine) === '');
  ok('⑤-16 只把值清空 → 卡里变空', trySave(emptyVal) === '');

  /* ⑤-16b 不带 managed 的老调用方（非表单路径）必须仍是"没给就保持原样" */
  {
    const n3 = { key: '_nomg', name: '老师', persona: { name: '老师', towardPlayer: '旧值' } };
    Ainpc.npcIndex._nomg = n3;
    Ainpc.personaSaveCard('_nomg', { name: '老师' });
    ok('⑤-16b 不传 managed 时维持合并语义（其它调用方不受影响）',
      n3.persona.towardPlayer === '旧值', String(n3.persona.towardPlayer));
  }

  /* ⑤-17~19 国际化 */
  ok('⑤-17 tieRule 有四语言', defs('tieRule') === 4, defs('tieRule') + '/4');
  const prf = SRC.slice(SRC.indexOf('playerTieRule: function'), SRC.indexOf('repairJsonText'));
  ok('⑤-18 playerTieRule 走语言包（不再硬编码中文）',
    /Ainpc\.t\('prompt\.tieRule'\)/.test(prf));
  ok('⑤-19 四语言 tieRule 都保留字段名 towardPlayer（判重靠它）',
    (function () {
      /* ★ 不能用 blocks()：那个函数按 `{…}` 配对，而 tieRule 的值是**字符串**
         不是对象，挖出来必然是空。四条语言包逐个把字符串抠出来数。 */
      const re = /tieRule\s*:\s*'/g; let m, n = 0, allHave = true;
      while ((m = re.exec(SRC))) {
        n++;
        let i = m.index + m[0].length, out = '';
        while (i < SRC.length) { if (SRC[i] === "'" && SRC[i - 1] !== '\\') break; out += SRC[i]; i++; }
        if (out.indexOf('towardPlayer') < 0) allHave = false;
      }
      return n === 4 && allHave;
    })());

  /* ⑤-20~21 防御 */
  ok('⑤-20 npcByKey 有 npcIndex 守卫',
    /Ainpc\.npcByKey = function \(k\) \{ return \(Ainpc\.npcIndex && Ainpc\.npcIndex\[k\]\) \|\| null; \};/.test(SRC));
  {
    const saveIdx = Ainpc.npcIndex;
    Ainpc.npcIndex = undefined;
    let threw = null;
    try { Ainpc.relationBrief('_probe_real'); } catch (e) { threw = e; }
    Ainpc.npcIndex = saveIdx;
    ok('⑤-21 npcIndex 未初始化时 relationBrief 不抛异常', !threw, threw ? threw.message : '');
  }
}

console.log('\n────────────────────────────');
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);