#!/usr/bin/env node
/* ── ai_npc · ES5 运行垫片（自动注入，请勿手改）─────────────────────────────
 * 老引擎（Mira = NW.js 0.12 / Chromium 41 / io.js 1.2.0）里没有下面这些方法，
 * 而 Babel 只管语法、不补标准库（游戏内也没法 require core-js），所以就地补。
 * 全部带「已存在就跳过」判断 —— 新引擎（伊莉莎的 NW.js 0.29）跑起来一行都不生效。
 * defineProperty 用 enumerable:false，绝不影响 for...in。
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    function def(obj, key, fn) {
        if (!obj || obj[key]) return;
        try { Object.defineProperty(obj, key, { value: fn, writable: true, enumerable: false, configurable: true }); }
        catch (e) { try { obj[key] = fn; } catch (e2) { } }
    }
    def(Object, 'assign', function (target) {
        if (target === null || target === undefined) throw new TypeError('Cannot convert undefined or null to object');
        var to = Object(target);
        for (var i = 1; i < arguments.length; i++) {
            var s = arguments[i];
            if (s === null || s === undefined) continue;
            for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) to[k] = s[k];
        }
        return to;
    });
    def(Object, 'values', function (obj) {
        if (obj === null || obj === undefined) throw new TypeError('Cannot convert undefined or null to object');
        var o = Object(obj), ks = Object.keys(o), out = [], i;
        for (i = 0; i < ks.length; i++) out.push(o[ks[i]]);
        return out;
    });
    def(Object, 'entries', function (obj) {
        if (obj === null || obj === undefined) throw new TypeError('Cannot convert undefined or null to object');
        var o = Object(obj), ks = Object.keys(o), out = [], i;
        for (i = 0; i < ks.length; i++) out.push([ks[i], o[ks[i]]]);
        return out;
    });
    def(Array.prototype, 'find', function (pred, thisArg) {
        if (this === null || this === undefined) throw new TypeError('Array.prototype.find called on null or undefined');
        if (typeof pred !== 'function') throw new TypeError('predicate must be a function');
        var o = Object(this), len = o.length >>> 0, i;
        for (i = 0; i < len; i++) { var v = o[i]; if (pred.call(thisArg, v, i, o)) return v; }
        return undefined;
    });
    def(Array.prototype, 'includes', function (search, from) {
        if (this === null || this === undefined) throw new TypeError('Array.prototype.includes called on null or undefined');
        var o = Object(this), len = o.length >>> 0;
        if (!len) return false;
        var n = (arguments.length > 1) ? Number(from) : 0;
        if (n !== n) n = 0;
        var k = n >= 0 ? Math.floor(n) : Math.max(len + Math.ceil(n), 0);
        for (; k < len; k++) { var v = o[k]; if (v === search || (v !== v && search !== search)) return true; }
        return false;
    });
    def(String.prototype, 'repeat', function (count) {
        var s = String(this);
        var n = Math.floor(Number(count) || 0);
        if (n < 0 || n === Infinity) throw new RangeError('Invalid count value');
        var out = "", i;
        for (i = 0; i < n; i++) out += s;
        return out;
    });
    function pad(self, targetLength, padString, atStart) {
        var s = String(self);
        var len = Number(targetLength) || 0;
        len = Math.floor(len);
        if (len < 0 || len === Infinity) len = 0;
        padString = (padString === undefined) ? ' ' : String(padString);
        if (s.length >= len || !padString) return s;
        var need = len - s.length, fill = "", i;
        while (fill.length < need) fill += padString;
        fill = fill.slice(0, need);
        return atStart ? fill + s : s + fill;
    }
    def(String.prototype, 'padStart', function (l, p) { return pad(this, l, p, true); });
    def(String.prototype, 'padEnd', function (l, p) { return pad(this, l, p, false); });
})();
/**
 * 两份「AI 产物」的规格与兜底 —— 世界观圣经（world_bible）与世界设定主题清单（lorebook_spec）。
 *
 * 【为什么要有这个文件】
 * 这两份在 v2.8.0 之前都是**手写**的（本作的世界观圣经、那 30 条设定主题清单）。
 * 手写的东西换一部游戏就不成立 —— 现在改成让 AI 现写。但 AI 的输出不可能百分百守规矩：
 * 少一个键、把数组写成字符串、把 regex 写成对象……下游（compactWorld / build_lorebook_input）
 * 一碰就崩。所以「要求模型写成什么样」和「拿到之后怎么修」必须成对写在一处，两边共用：
 *   · 命令行：tools/gen_bible.js / tools/gen_topics.js
 *   · 游戏内：插件的「一键准备」
 * 这个文件只依赖纯 JS，没有 fs / 网络，所以能被插件原样加载。
 */
'use strict';

var S = function S(x) {
  return x == null ? '' : String(x);
};
var A = function A(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
};
var OBJ = function OBJ(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
};

/* ============================================================ 世界观圣经 */

/** 提示词里给模型看的形状说明（必须与 normalize 的产出严格一致） */
var BIBLE_SHAPE = ['{', '  "genre": "类型一句话（例：中世纪奇幻 / 现代校园 / 科幻废土）",', '  "tone": "基调一句话（例：基层日常 + 教会权威 + 战争阴影）",', '  "world": {', '    "summary": "150~260 字：这个世界是什么样、人与什么对立、普通人的日子",', '    "kingdom": { "name": "主要国家/政权的名字", "note": "它的一句话说明" },', '    "regions": [ { "key": "原作里的地区代号", "town": "该地区的中文名", "note": "一句话" } ],', '    "places": { "地点名": "该地点是什么" }', '  },', '  "faith": { "goddess": "主要信仰所供奉的神/权威的名字（没有就写「无明确信仰」）",', '             "desc": "信仰的一两句话说明", "greetings": ["信众的问候语", "再来一句"] },', '  "factions": { "势力名": "该势力是什么、与主角什么关系" },', '  "monsters": { "nature": "魔物/敌人是什么东西、从哪来", "known": ["已知种类1", "种类2"], "threat": "它们对普通人的威胁" },', '  "society": { "daily": "普通人的日常生活", "classes": "社会分层", "currency": "货币单位", "attitude": "对主角/对魔物的普遍态度" },', '  "protagonist": { "name": "主角名", "actorId": 主角在原作 Actors.json 里的 id（不知道就写 null）,', '                   "desc": "主角是谁、要做什么", "companions_actors": [ { "name": "同伴名", "actorId": 0 } ] },', '  "naming_convention": { "rule": "这个世界取名遵循什么规则", "implication": "由此能推出什么（例：名字带教名的多为信徒）" }', '}'].join('\n');

/** 把模型给的对象修成下游能吃的形状。**任何一路都不许返回 null**：
 *  persona_core.compactWorld 会直接读 b.world.summary，缺 b.world 就抛异常。 */
function normalizeBible(o) {
  o = OBJ(o);
  var w = OBJ(o.world);
  var k = OBJ(w.kingdom);
  var f = OBJ(o.faith);
  var m = OBJ(o.monsters);
  var so = OBJ(o.society);
  var p = OBJ(o.protagonist);
  var nc = OBJ(o.naming_convention);
  var regions = A(w.regions).map(function (r) {
    r = OBJ(r);
    return {
      key: S(r.key),
      town: S(r.town) || S(r.key),
      note: S(r.note)
    };
  }).filter(function (r) {
    return r.key || r.town;
  });
  var places = {};
  var pl = OBJ(w.places);
  Object.keys(pl).forEach(function (x) {
    if (S(pl[x])) places[S(x)] = S(pl[x]);
  });
  var factions = {};
  var fa = OBJ(o.factions);
  Object.keys(fa).forEach(function (x) {
    if (S(fa[x])) factions[S(x)] = S(fa[x]);
  });
  var companions = A(p.companions_actors).map(function (c) {
    if (typeof c === 'string') return {
      name: c,
      actorId: null
    };
    c = OBJ(c);
    return {
      name: S(c.name),
      actorId: c.actorId == null ? null : c.actorId
    };
  }).filter(function (c) {
    return c.name;
  });
  return {
    _about: '世界观圣经 —— 由 AI 依据原作语料现场归纳，作为生成角色人设与设定时「不得违背」的事实基线。',
    _source: 'ai_npc/lore_raw.json（tools/extract_lore.js 抽取）',
    _game: S(o._game),
    _generatedByAI: true,
    genre: S(o.genre),
    tone: S(o.tone),
    world: {
      summary: S(w.summary),
      kingdom: {
        name: S(k.name),
        note: S(k.note)
      },
      regions: regions,
      places: places
    },
    faith: {
      goddess: S(f.goddess) || '无明确信仰',
      desc: S(f.desc),
      greetings: A(f.greetings).map(S).filter(Boolean)
    },
    factions: factions,
    monsters: {
      nature: S(m.nature),
      known: A(m.known).map(S).filter(Boolean),
      threat: S(m.threat)
    },
    society: {
      daily: S(so.daily),
      classes: S(so.classes),
      currency: S(so.currency),
      attitude: S(so.attitude)
    },
    protagonist: {
      name: S(p.name),
      actorId: p.actorId == null ? null : p.actorId,
      desc: S(p.desc),
      companions_actors: companions
    },
    naming_convention: {
      rule: S(nc.rule),
      implication: S(nc.implication)
    }
  };
}

/** 修完之后还够不够「有料」？全空的话等于没写，不如报错让玩家重来。 */
function bibleIsUsable(b) {
  if (!b) return false;
  var len = S(b.world.summary).length + S(b.genre).length + S(b.tone).length + S(b.protagonist.name).length + Object.keys(b.factions).length * 5;
  return len >= 60;
}

/* ============================================================ 世界设定主题清单 */

var KINDS = ['world', 'place', 'facility', 'faith', 'org', 'monster', 'economy', 'story', 'item', 'character'];
var LENS = ['long', 'mid', 'short'];
var SOURCES = ['dialogue', 'harddata', 'mixed', 'bible'];

/** 提示词里给模型看的形状说明 */
var SPEC_SHAPE = ['[', '  {', '    "id": "英文短横线小写，全局唯一（例：mon-ecology / place-capital）",', '    "title": "条目标题（中文，例：魔物的生态）",', '    "kind": "' + KINDS.join(' | ') + '",', '    "constant": false,          // 是否是「每回合都注入」的骨架条目。**最多 3 条**，其余一律 false', '    "len": "long | mid | short", // long≈300-450字, mid≈150-260字, short≈80-140字', '    "source": "dialogue | harddata | mixed | bible",', '    "keys": ["玩家提到这些词就命中这一条", "触发词2"],', '    "re": "用来在台词库里找证据的正则（JS 语法字符串，例：魔物|怪物|袭击）。没证据就写 null",', '    "note": "给写手的额外提醒（可空字符串）"', '  }', ']'].join('\n');

/** 把模型给的清单修成 build_lorebook_input.js 能吃的形状 */
function normalizeSpec(o) {
  var list = Array.isArray(o) ? o : A(OBJ(o).entries);
  var seen = new Set();
  var out = [];
  var constants = 0;
  list.forEach(function (e) {
    e = OBJ(e);
    var id = S(e.id).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) return;
    if (seen.has(id)) return;
    seen.add(id);
    var constant = !!e.constant;
    /* 常驻是每回合都发的，重复内容等于每回合烧钱 —— 硬性限 3 条 */
    if (constant && constants >= 3) constant = false;
    if (constant) constants++;
    var len = LENS.indexOf(e.len) >= 0 ? e.len : 'mid';
    var kind = KINDS.indexOf(e.kind) >= 0 ? e.kind : 'world';
    var source = SOURCES.indexOf(e.source) >= 0 ? e.source : 'dialogue';
    var re = null;
    if (e.re && typeof e.re === 'string' && e.re.trim()) re = e.re.trim();else if (e.re && e.re.source) re = String(e.re.source);
    out.push({
      id: id,
      title: S(e.title) || id,
      kind: kind,
      constant: constant,
      len: len,
      source: source,
      keys: A(e.keys).map(S).map(function (s) {
        return s.trim();
      }).filter(Boolean).slice(0, 25),
      re: re,
      note: S(e.note)
    });
  });
  return out;
}

/** 清单合不合理？条数太少等于没写；一条都没有就更不用说。 */
function specIsUsable(list) {
  return Array.isArray(list) && list.length >= 4;
}

/* ============================================================ 宽松解析
 * 模型输出 JSON 有两种常见的坏情况：
 *   ① 前后带解释文字 / Markdown 围栏
 *   ② **被输出上限掐断**（实测 deepseek-flash 会在世界观写到一半断掉，
 *      整段 JSON 从中间截住）—— 不救的话这一次生成就白跑了。
 * 所以解析器要能：剥围栏 → 截到最外层括号 → 配平后补上没关的括号再解析。
 */
function _tryParse(t) {
  try {
    return JSON.parse(t);
  } catch (e) {
    return undefined;
  }
}

/** 把一段被截断的 JSON 补全：用一个栈记住还有哪些括号没关，退到最近的边界再补。 */
function repairFrom(t) {
  var s = t;
  for (var n = 0; n < 400; n++) {
    var st = [];
    var inStr = false,
      esc = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false;else if (ch === '\\') esc = true;else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') st.push('}');else if (ch === '[') st.push(']');else if (ch === '}' || ch === ']') st.pop();
    }
    var suf = inStr ? '"' : '';
    while (st.length) suf += st.pop();
    var cand = s.replace(/[,\s]+$/, '') + suf;
    var v = _tryParse(cand);
    if (v !== undefined) return cand;
    /* 退到最近的一个结构边界再试 */
    var cut = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'), s.lastIndexOf(','));
    if (cut < 0) return null;
    s = s.slice(0, cut);
  }
  return null;
}

/** 从模型回复里抠出 JSON 对象 / 数组（容忍围栏、废话、截断） */
function parseLoose(text) {
  var s = String(text || '').trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  var v = _tryParse(s);
  if (v !== undefined) return v;
  var cands = [s.indexOf('{'), s.indexOf('[')].filter(function (i) {
    return i >= 0;
  });
  if (!cands.length) return undefined;
  var head = s.slice(Math.min.apply(null, cands));
  v = _tryParse(head);
  if (v !== undefined) return v;
  var fixed = repairFrom(head);
  if (fixed) {
    v = _tryParse(fixed);
    if (v !== undefined) return v;
  }
  return undefined;
}
module.exports = {
  BIBLE_SHAPE: BIBLE_SHAPE,
  SPEC_SHAPE: SPEC_SHAPE,
  normalizeBible: normalizeBible,
  bibleIsUsable: bibleIsUsable,
  normalizeSpec: normalizeSpec,
  specIsUsable: specIsUsable,
  parseLoose: parseLoose,
  repairFrom: repairFrom,
  KINDS: KINDS,
  LENS: LENS,
  SOURCES: SOURCES
};