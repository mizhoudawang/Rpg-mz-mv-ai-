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
 * 全量语料抽取器 —— 把一部 RPG Maker MV/MZ 游戏里**所有人类可读文本**挖出来，
 * 作为「符合原作」地编写世界书与角色人设的原料。
 *
 * 与 tools/scan_game.js 的区别：
 *   scan_game.js  是「按变量传播求值、只收真正会执行到的那一支」→ 精而薄（每人平均 2 句台词）。
 *   extract_lore.js 是「宁可多收」→ 把公共事件总台词库、每个地图事件的每个分支全量抓下来，
 *                  再带上角色名 / 术语 / 名词表 / 地名 / 作者注释，交给大模型去理解与归纳。
 *
 * 用法:
 *   node tools/extract_lore.js --www="<游戏 www 目录>" [--out=<输出 json 路径>]
 */
'use strict';

var fs = require('fs');
var path = require('path');
function arg(name) {
  var p = '--' + name + '=';
  for (var _i2 = 0, _process$argv$slice2 = process.argv.slice(2); _i2 < _process$argv$slice2.length; _i2++) {
    var a = _process$argv$slice2[_i2];
    if (a.startsWith(p)) return a.slice(p.length);
  }
  return null;
}
var WWW = arg('www') || process.env.AINPC_WWW || process.argv[2];
if (!WWW || !fs.existsSync(WWW)) {
  console.error('✘ 需要 --www="<游戏 www 目录>"');
  process.exit(1);
}
var OUT = arg('out') || path.join(WWW, 'ai_npc/lore_raw.json');

/* ====================================================== 本地化占位符还原（v2.9.17）
 * 《Knights of Messiah IF》这类多语言游戏把**所有正文**换成 `${text.message000745}`，
 * 真值在 <根>/languages/<语言>/*.json。不还原的话这份语料就是 512 种占位符，
 * 交给 AI 等于让它凭空编。见 l10n.js。找不到语言表时 available=false，行为与以前逐字节一致。 */
var L10N = function () {
  try {
    return require('./l10n.js').load({
      root: path.dirname(WWW),
      www: WWW,
      lang: arg('lang') || ''
    });
  } catch (e) {
    console.warn('  ! l10n.js 不可用（' + e.message + '），按"无本地化"处理');
    return {
      available: false,
      reason: '模块缺失',
      resolve: function resolve(s) {
        return s;
      },
      resolveText: function resolveText(s) {
        return s;
      },
      deepResolve: function deepResolve(o) {
        return o;
      },
      hasPlaceholder: function hasPlaceholder() {
        return false;
      },
      summary: function summary() {
        return '未启用（模块缺失）';
      },
      table: {}
    };
  }
}();
console.log('[lore] 本地化     : ' + L10N.summary());
var readJson = function readJson(p) {
  return L10N.deepResolve(JSON.parse(fs.readFileSync(path.join(WWW, p), 'utf8').replace(/^\uFEFF/, '')));
};
var exists = function exists(p) {
  return fs.existsSync(path.join(WWW, p));
};
var lore = {
  version: 2,
  generatedAt: new Date().toISOString(),
  source: {
    www: WWW,
    engine: null
  },
  game: {},
  terms: {},
  actors: [],
  names: {},
  maps: [],
  regions: {},
  ceDialogues: [],
  mapDialogues: [],
  comments: [],
  /* v2.8.0 通用化：ADV 剧本（scenario/*.sl）与「脚本指令里内嵌的台词」两条新来源。
   * 很多日式 MV 游戏不用「显示文本」指令，剧情全在 scenario/ 下——只读 401 会一无所获。 */
  scenario: [],
  scenarioNames: [],
  scenarioSpeakers: {},
  scriptStrings: [],
  stats: {}
};

/* ============================================================ 1. System / 术语 */
var sys = readJson('data/System.json');
lore.source.engine = sys.hasEncryptedImages !== undefined ? 'MV' : '未知';
lore.game = {
  title: sys.gameTitle || '',
  currency: sys.currencyUnit || '',
  versionId: sys.versionId,
  /* 【v2.9.17】本地化占位符还原的账 —— 让"这份语料是不是占位符"一眼可见。
   * ★ 没有语言表时**不写**这个字段，普通游戏的产物保持逐字节不变。 */
  localization: L10N.available ? {
    resolved: true,
    lang: L10N.lang,
    keys: L10N.keys
  } : undefined,
  terms: {}
};
/* MV 与 MZ 的 terms 结构不同，做一次归一 */
var T = sys.terms || {};
var pick = function pick(x) {
  return Array.isArray(x) ? x.filter(function (v) {
    return v && String(v).trim();
  }) : [];
};
lore.terms = {
  basic: pick(T.basic),
  commands: pick(T.commands),
  params: pick(T.params),
  messages: T.messages && typeof T.messages === 'object' ? Object.keys(T.messages).reduce(function (o, k) {
    var v = T.messages[k];
    if (typeof v === 'string' && v.trim()) o[k] = v;
    return o;
  }, {}) : {},
  armorTypes: pick(sys.armorTypes),
  weaponTypes: pick(sys.weaponTypes),
  skillTypes: pick(sys.skillTypes),
  elements: pick(sys.elements),
  equipTypes: pick(sys.equipTypes)
};

/* ============================================================ 2. 官方角色名 */
try {
  var actors = readJson('data/Actors.json');
  lore.actors = actors.filter(Boolean).map(function (a) {
    return {
      id: a.id,
      name: String(a.name || '').trim(),
      nickname: String(a.nickname || '').trim(),
      profile: String(a.profile || '').trim(),
      classId: a.classId,
      faceName: a.faceName || '',
      faceIndex: a.faceIndex,
      charName: a.characterName || '',
      charIndex: a.characterIndex,
      initialLevel: a.initialLevel
    };
  }).filter(function (a) {
    return a.name && !/^[-=_*\s]+$/.test(a.name);
  });
} catch (e) {
  lore.stats.actorsError = e.message;
}

/* ============================================================ 3. 名词表（世界观词汇）*/
var NAME_FILES = ['Items', 'Armors', 'Weapons', 'Skills', 'States', 'Enemies', 'Classes', 'Tilesets'];
for (var _i4 = 0; _i4 < NAME_FILES.length; _i4++) {
  var f = NAME_FILES[_i4];
  if (!exists('data/' + f + '.json')) continue;
  try {
    var arr = readJson('data/' + f + '.json');
    var list = arr.filter(Boolean).map(function (x) {
      return {
        id: x.id,
        name: String(x.name || '').trim(),
        note: String(x.note || '').trim() || undefined,
        description: String(x.description || '').trim() || undefined
      };
    }).filter(function (x) {
      return x.name && !/^[-=_*\s]+$/.test(x.name);
    });
    if (list.length) lore.names[f] = list;
  } catch (e) {/* 跳过读不动的 */}
}
/* ============================================================ 4. 地图：名字 / 层级 / 作者注释 */
var mapInfos = {};
try {
  mapInfos = readJson('data/MapInfos.json') || {};
} catch (e) {
  mapInfos = {};
}
function mapInfoName(id) {
  var mi = mapInfos[id];
  if (!mi) return {
    name: '',
    displayName: ''
  };
  return {
    name: String(mi.name || ''),
    displayName: String(mi.displayName || '')
  };
}
/** 拼出地图的完整层级路径，如 "MAP001/Game / MAP007/area01_hel_town / MAP008/…" */
function mapPathOf(id) {
  var parts = [];
  var cur = mapInfos[id];
  var guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift('MAP' + String(cur.id || 0).padStart(3, '0') + (cur.name ? '/' + cur.name : ''));
    cur = cur.parentId ? mapInfos[cur.parentId] : null;
  }
  return parts.join(' / ');
}

/* ============================================================ 5. 对话抽取 */
/** 把一段指令流里的 101（说话人）+ 401（正文）合并成「台词」，遇到控制指令就断句 */
function extractDialogues(list) {
  var out = [];
  var cur = null;
  var flush = function flush() {
    if (cur && cur.lines.length) out.push({
      speaker: cur.speaker,
      text: cur.lines.join('').trim()
    });
    cur = null;
  };
  for (var _i6 = 0, _ref2 = list || []; _i6 < _ref2.length; _i6++) {
    var c = _ref2[_i6];
    if (!c) continue;
    if (c.code === 101) {
      flush();
      cur = {
        speaker: String(c.parameters && c.parameters[0] || '').trim(),
        lines: []
      };
      continue;
    }
    if (c.code === 401) {
      if (!cur) cur = {
        speaker: '',
        lines: []
      };
      cur.lines.push(String(c.parameters && c.parameters[0] || ''));
      continue;
    }
    if (cur) flush();
  }
  flush();
  return out.filter(function (d) {
    return d.text;
  });
}
/** 作者注释（108/408 指令里那些 ▼area02 之类的分区标记） */
function extractComments(list) {
  var out = [];
  for (var _i8 = 0, _ref4 = list || []; _i8 < _ref4.length; _i8++) {
    var c = _ref4[_i8];
    if (c && (c.code === 108 || c.code === 408)) {
      var t = String(c.parameters && c.parameters[0] || '').trim();
      if (t && !/^[-=_*\s]*$/.test(t) && t.length < 120) out.push(t);
    }
  }
  return out;
}

/* 5-0. 脚本指令里内嵌的台词（355/655）与 ADV 剧本（scenario/*.sl）
 *
 * 有一大类游戏（尤其日式）不用「显示文本」指令，而是：
 *   (a) 用「脚本」指令直接调自己的消息窗口：
 *       $autoMessageWindow.dataSet("student", 0, "それじゃいくよー♪\fだーるまさんがー……")
 *   (b) 把整部剧情写在**游戏根目录的 scenario/** 里（.sl 文件），运行时逐行播放
 *       （TS_ADVsystem 那一系），而且常常 XOR 加密（同系 TS_Decode 用 charCode ^ 255）。
 * 这两种情况下地图事件里几乎没有 401 —— 只读 401 的抽取器会一无所获（实测某作只有 52 条）。
 * 下面两段全部**不依赖任何具体作品/插件名**，只靠通用规律：
 *   · 脚本里含假名或成串汉字、且不像路径/URL/文件名的字符串 → 当台词；
 *   · 剧本目录里按「可读字符占比」自动试出 XOR 密钥，再逐行取正文。
 */
var SCRIPT_LIT = /"((?:[^"\\]|\\.)*)"/g;
/** 把剧本/脚本正文里的显示控制符剥掉（\C[2] \n \f \N[3] \> 等都是排版用的） */
function cleanScriptText(s) {
  return String(s).replace(/\\C\[\d+\]/g, '').replace(/\\N\[\d+\]/g, '').replace(/\\V\[(\d+)\]/g, '〔变量$1〕').replace(/\\[A-Za-z]{1,3}/g, ' ').replace(/\\[<>|.^!${}*]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}
function harvestScriptTexts(text) {
  var out = [];
  var m;
  SCRIPT_LIT.lastIndex = 0;
  while (m = SCRIPT_LIT.exec(text)) {
    var s = m[1];
    if (!s || s.length < 2 || s.length > 400) continue;
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(s)) continue;
    if (/^(https?:|\/|\.\.?[\/\\])/.test(s)) continue;
    if (/\.(png|jpe?g|gif|bmp|json|js|ogg|m4a|mp3|wav|webm|mp4|txt|dll|css|html?)$/i.test(s)) continue;
    s = cleanScriptText(s.replace(/\\[nf]/g, ' '));
    if (!s || s.length < 2 || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(s)) continue;
    out.push(s);
  }
  return out;
}
function scriptTextsOf(list) {
  var out = [];
  for (var _i0 = 0, _ref6 = list || []; _i0 < _ref6.length; _i0++) {
    var c = _ref6[_i0];
    if (!c) continue;
    if (c.code === 355 || c.code === 655) {
      var t = String(c.parameters && c.parameters[0] || '');
      if (t) {
        for (var _i10 = 0, _harvestScriptTexts2 = harvestScriptTexts(t); _i10 < _harvestScriptTexts2.length; _i10++) {
          var s = _harvestScriptTexts2[_i10];
          out.push(s);
        }
      }
    }
  }
  return out;
}

/* 5a. 公共事件：全部 401 都要（这里是本作的总台词库） */
try {
  var ce = readJson('data/CommonEvents.json');
  ce.forEach(function (e, id) {
    if (!e) return;
    var ds = extractDialogues(e.list);
    var ss = scriptTextsOf(e.list);
    if (ss.length) lore.scriptStrings.push({
      ce: id,
      name: String(e.name || ''),
      texts: ss
    });
    if (!ds.length) return;
    lore.ceDialogues.push({
      ceId: id,
      name: String(e.name || ''),
      trigger: e.trigger,
      switchId: e.switchId,
      lines: ds.slice(0, 400) // 防止个别巨型公共事件撑爆文件
    });
  });
} catch (e) {
  lore.stats.ceError = e.message;
}

/* 5b. 地图事件：每个事件的每个 page 全量抓 */
var mapFiles = [];
try {
  for (var _i12 = 0, _fs$readdirSync2 = fs.readdirSync(path.join(WWW, 'data')); _i12 < _fs$readdirSync2.length; _i12++) {
    var _f = _fs$readdirSync2[_i12];
    var m = /^Map(\d{3})\.json$/.exec(_f);
    if (m) mapFiles.push({
      file: _f,
      id: parseInt(m[1], 10)
    });
  }
} catch (e) {/* ignore */}
mapFiles.sort(function (a, b) {
  return a.id - b.id;
});
var _loop = function _loop() {
    var mf = mapFiles[_i14];
    var map;
    try {
      map = readJson('data/' + mf.file);
    } catch (e) {
      return 0; // continue
    }
    if (!map) return 0; // continue
    var info = mapInfoName(mf.id);
    var entry = {
      id: mf.id,
      name: info.name,
      displayName: info.displayName,
      note: String(map.note || '').trim() || undefined,
      path: mapPathOf(mf.id),
      width: map.width,
      height: map.height,
      events: []
    };
    (map.events || []).forEach(function (ev, eid) {
      if (!ev) return;
      /* 【v2.9.17】事件名也走本地化还原 —— 产物里不许留 ${text.xxx}（没有语言表时是恒等） */
      var evEntry = {
        eventId: eid,
        name: L10N.resolveText(String(ev.name || '')),
        x: ev.x,
        y: ev.y,
        pages: []
      };
      (ev.pages || []).forEach(function (pg, pi) {
        if (!pg) return;
        var ds = extractDialogues(pg.list);
        var cm = extractComments(pg.list);
        var ss = scriptTextsOf(pg.list);
        if (ss.length) lore.scriptStrings.push({
          map: mf.id,
          eventId: eid,
          eventName: String(ev.name || ''),
          texts: ss
        });
        var chars = pg.image && pg.image.characterName || '';
        /* 只留下有内容的页，省体积 */
        if (ds.length || cm.length) {
          evEntry.pages.push({
            page: pi,
            charName: chars,
            charIndex: pg.image && pg.image.characterIndex || 0,
            dialogues: ds,
            comments: cm
          });
        }
      });
      if (evEntry.pages.length) entry.events.push(evEntry);
    });
    lore.maps.push(entry);
  },
  _ret;
for (var _i14 = 0; _i14 < mapFiles.length; _i14++) {
  _ret = _loop();
  if (_ret === 0) continue;
}
/* 5c. 汇总：作者注释单独抽一份（含地图名上下文）——常含分区、剧情提示 */
for (var _i16 = 0, _lore$maps2 = lore.maps; _i16 < _lore$maps2.length; _i16++) {
  var _m = _lore$maps2[_i16];
  for (var _i18 = 0, _m$events2 = _m.events; _i18 < _m$events2.length; _i18++) {
    var ev = _m$events2[_i18];
    for (var _i20 = 0, _ev$pages2 = ev.pages; _i20 < _ev$pages2.length; _i20++) {
      var pg = _ev$pages2[_i20];
      for (var _i22 = 0, _pg$comments2 = pg.comments; _i22 < _pg$comments2.length; _i22++) {
        var c = _pg$comments2[_i22];
        lore.comments.push({
          map: _m.name || 'MAP' + _m.id,
          event: L10N.resolveText(ev.name),
          text: c
        });
      }
    }
  }
}
/* ============================================================ 5d. 脚本指令里内嵌的台词（355/655）—— 见下方 §5f 的实现
 * （函数定义放在 §5 助手区，这里只是标记位置，避免 const 的 TDZ 问题） */
/* ============================================================ 5e. ADV 剧本（scenario/*.sl 等）
 *
 * 【为什么必须有这一段】TS_ADVsystem 那一系的游戏把整部剧情写在**游戏根目录的 scenario/**
 * 里（.sl 文件），运行时由插件读文件逐行播放。这种游戏的地图事件里几乎没有 401 ——
 * 只读 401 的抽取器在它身上捞不到任何东西（实测某作只有 52 条）。
 * 剧本文件通常还是 XOR 加密的（同系 TS_Decode 用 charCode ^ 255）。
 *
 * 下面三件事全部与具体作品无关：
 *   ① 在常见位置找剧本目录；
 *   ② 自动探测 XOR 密钥（用「可读字符占比」当评分，1..255 逐个试，取最高分；明文则为 0）；
 *   ③ 逐行解析：@ 开头的是指令（跳过，但顺带收 txt=【名字】这种名牌），其余含假名/汉字的
 *      行当台词；`[说话人]「正文」` 这种把说话人抠出来。
 */
var GAME_ROOT = path.dirname(WWW);
function xorStr(s, k) {
  if (!k) return s;
  var out = [];
  for (var i = 0; i < s.length; i++) out.push(String.fromCharCode(s.charCodeAt(i) ^ k));
  return out.join('');
}
/** 通用结构分 —— 不认任何具体命令词、插件名或作品名。
 *  明文有结构（换行多、行首多是符号、ASCII 占比高），密钥错了解出来就是乱码。
 *  ⚠ 不能用「像不像日文」来选密钥：XOR 只翻转低字节，汉字/假名的**高位字节不变**，
 *    所以错密钥解出来依旧「一片日文」，只有结构能分辨（实测 255 得 4030，次优 181 只有 1192）。 */
function structScore(s) {
  var lines = s.split('\n');
  var struct = 0,
    ascii = 0,
    ctrl = 0;
  for (var _i24 = 0; _i24 < lines.length; _i24++) {
    var l = lines[_i24];
    var t = l.replace(/^\s+/, '');
    if (t && /^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(t)) struct++;
  }
  var n = Math.min(s.length, 4096);
  for (var i = 0; i < n; i++) {
    var _c = s.charCodeAt(i);
    if (_c === 9 || _c === 32 || _c >= 0x21 && _c < 0x7f) ascii++;else if (_c < 0x20 && _c !== 10) ctrl++;
  }
  return (lines.length - 1) * 10 + struct * 6 + ascii * 0.15 - ctrl * 8;
}
function detectXorKey(sample) {
  var probe = sample.slice(0, 4096);
  var plain = structScore(probe);
  var scored = [];
  for (var k = 0; k < 256; k++) scored.push({
    k: k,
    s: k ? structScore(xorStr(probe, k)) : plain
  });
  scored.sort(function (a, b) {
    return b.s - a.s;
  });
  var best = scored[0],
    second = scored[1] || {
      s: 0
    };
  /* 明文本来就该是最好的 → 直接当没加密。 */
  if (!best || best.k === 0) return 0;
  /* 认定「加了密」要同时满足：
   *   ① 确实解出了结构（分 > 0）；
   *   ② 明显甩开第二名（≥1.4 倍）—— 否则说明哪个密钥都差不多，那就是乱码，宁可不解；
   *   ③ 比保持明文有实质提升 —— 否则没必要动它。
   * 猜错密钥会把整部剧本读成乱码，比不读更糟，所以这里宁严勿宽。 */
  if (best.s <= 0) return 0;
  if (second.s > 0 && best.s < second.s * 1.4) return 0;
  if (best.s < plain * 1.2 && best.s - plain < 60) return 0;
  return best.k;
}
var SCENARIO_EXT = /\.(sl|ks|scn|adv|txt|dat|s)$/i;
function findScenarioDirs() {
  /* 两种发行形态都要覆盖：
   *   · 未打包（Game.exe + www/）：剧本在 <游戏根>/scenario（TS_Decode 就是这么找的）
   *   · 已打包（data/ 与 package.json 平铺在根）：我们拿到的 WWW 就是根，剧本在 WWW/scenario
   * 所以「根的上一级」和「WWW」两边都试，外加 data/scenario 这种少见布局。 */
  var cands = [path.join(GAME_ROOT, 'scenario'), path.join(WWW, 'scenario'), path.join(GAME_ROOT, 'data', 'scenario'), path.join(WWW, 'data', 'scenario')];
  var out = [],
    seen = {};
  for (var _i26 = 0; _i26 < cands.length; _i26++) {
    var d = cands[_i26];
    var key = d.toLowerCase(); /* Windows 大小写不敏感，'scenario' 与 'Scenario' 是同一个目录 */
    if (seen[key]) continue;
    try {
      if (fs.statSync(d).isDirectory()) {
        seen[key] = 1;
        out.push(d);
      }
    } catch (e) {/* 没有就算了 */}
  }
  return out;
}
var ADV_CMD = /^[@#;]/;
var ADV_SPEAK = /^\[([^\[\]]{0,24})\]\s*([「『"'].*)$/;
/** 说话人标签清洗：有的游戏在名字后面挂语音资源名（`[贝丽尔/brr0126]「…」`）或 @ 后缀，
 *  这些不是人，去掉之后同名才聚得起来。全部规则与具体作品无关。 */
function normSpeaker(s) {
  s = String(s || '').trim().replace(/[＠@].*$/, '').trim();
  var m = /^(.+?)[\/／]([a-z_]*\d+)$/i.exec(s);
  if (m) s = m[1].trim();
  return s;
}
var scFiles = [];
for (var _i28 = 0, _findScenarioDirs2 = findScenarioDirs(); _i28 < _findScenarioDirs2.length; _i28++) {
  var d = _findScenarioDirs2[_i28];
  try {
    for (var _i30 = 0, _fs$readdirSync4 = fs.readdirSync(d); _i30 < _fs$readdirSync4.length; _i30++) {
      var _f2 = _fs$readdirSync4[_i30];
      if (SCENARIO_EXT.test(_f2)) scFiles.push(path.join(d, _f2));
    }
  } catch (e) {/* ignore */}
}
scFiles = scFiles.filter(function (v, i, a) {
  return a.indexOf(v) === i;
}).sort();

/** 用某个密钥把剧本目录整体解一遍，返回纯数据（不改 lore）。
 *  「解出多少条像样的台词」才是最终裁判 —— 密钥猜错时台词会大幅变少。 */
function parseScenarioWith(key) {
  var res = {
    key: key,
    files: 0,
    lines: 0,
    segs: [],
    speakers: {},
    names: []
  };
  for (var _i32 = 0, _scFiles2 = scFiles; _i32 < _scFiles2.length; _i32++) {
    var _f3 = _scFiles2[_i32];
    var text = void 0;
    try {
      text = fs.readFileSync(_f3, 'utf8');
    } catch (e) {
      continue;
    }
    text = xorStr(text, key);
    if (text.length > 800000) text = text.slice(0, 800000);
    var lines = [];
    for (var _i34 = 0, _text$split2 = text.split(/\r?\n/); _i34 < _text$split2.length; _i34++) {
      var raw = _text$split2[_i34];
      var ln = raw.replace(/\u0000/g, '').trim();
      if (!ln) continue;
      if (ln.charAt(0) === '@') {
        var _m2 = /txt=\s*(?:【([^】]+)】|\{([^}]+)\}|"([^"]+)")/.exec(ln);
        if (_m2) {
          var nm = String(_m2[1] || _m2[2] || _m2[3] || '').trim();
          if (nm && nm.length <= 24 && res.names.indexOf(nm) < 0) res.names.push(nm);
        }
        continue;
      }
      if (ADV_CMD.test(ln)) continue;
      var speaker = '',
        body = ln;
      var m2 = ADV_SPEAK.exec(ln);
      if (m2) {
        speaker = normSpeaker(m2[1]);
        body = m2[2];
      }
      body = cleanScriptText(body);
      if (!body || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(body)) continue;
      if (body.length > 300) body = body.slice(0, 300);
      lines.push({
        speaker: speaker,
        text: body
      });
      if (speaker) (res.speakers[speaker] = res.speakers[speaker] || []).push(body);
    }
    if (lines.length) {
      res.files++;
      res.lines += lines.length;
      res.segs.push({
        file: path.basename(_f3),
        lines: lines
      });
    }
  }
  return res;
}
var scKey = 0,
  scFileCount = 0,
  scLineCount = 0;
if (scFiles.length) {
  /* 密钥只探一次：单个文件可能很短，多凑几个当样本 */
  var sample = '';
  for (var _i36 = 0, _scFiles4 = scFiles; _i36 < _scFiles4.length; _i36++) {
    var _f4 = _scFiles4[_i36];
    try {
      sample += fs.readFileSync(_f4, 'utf8').slice(0, 4096);
    } catch (e) {/* ignore */}
    if (sample.length >= 8192) break;
  }
  scKey = detectXorKey(sample);
  var best = parseScenarioWith(scKey);
  /* 终审：拿「不带密钥」再解一遍，谁解出的台词多就用谁。
   * 这一条把「密钥探测猜错」的后果压到最小 —— 猜错只会变少，不会把乱码当台词。 */
  if (scKey !== 0) {
    var plainTry = parseScenarioWith(0);
    if (plainTry.lines >= best.lines) {
      best = plainTry;
      scKey = 0;
    }
  }
  lore.stats.scenarioKey = scKey;
  lore.scenario = best.segs;
  lore.scenarioSpeakers = best.speakers;
  lore.scenarioNames = best.names;
  scFileCount = best.files;
  scLineCount = best.lines;
}
lore.stats.scenarioFiles = scFileCount;
lore.stats.scenarioLines = scLineCount;
lore.stats.scenarioSpeakers = Object.keys(lore.scenarioSpeakers).length;
/* 剧本里从名牌（txt=【…】）抠出来的角色名，也当成「世界词汇」喂给世界观归纳 */
if (lore.scenarioNames.length) lore.names.Cast = lore.scenarioNames.map(function (n) {
  return {
    id: 0,
    name: n
  };
});

/* ============================================================ 6. 区域结构 */
/** 从地图名里解析 areaNN_xxx_town 结构，归纳出「一个区域有哪些设施」 */
for (var _i38 = 0, _lore$maps4 = lore.maps; _i38 < _lore$maps4.length; _i38++) {
  var _m3 = _lore$maps4[_i38];
  var mm = /area(\d+)_([a-z0-9]+)_([a-z0-9_]+)/i.exec(_m3.name || '');
  if (!mm) continue;
  var areaKey = 'area' + mm[1];
  var townKey = mm[2];
  lore.regions[areaKey] = lore.regions[areaKey] || {
    towns: {},
    mapIds: []
  };
  lore.regions[areaKey].mapIds.push(_m3.id);
  var t = lore.regions[areaKey].towns[townKey] = lore.regions[areaKey].towns[townKey] || {
    mapIds: [],
    facilities: []
  };
  if (!t.mapIds.includes(_m3.id)) t.mapIds.push(_m3.id);
  for (var _i40 = 0, _ref8 = ['church', 'chief', 'wea', 'arm', 'ite', 'INN', 'houseA', 'houseB', 'houseC', 'dungeon', 'secret']; _i40 < _ref8.length; _i40++) {
    var fac = _ref8[_i40];
    if (new RegExp('_' + fac, 'i').test(_m3.name) && !t.facilities.includes(fac)) t.facilities.push(fac);
  }
}
/* ============================================================ 6.5 把总台词库还原成「每个角色自己的话」
 *
 * 这是整套流程最关键的一步。本作的公共事件是**共享总台词库**，
 * 台词正文里用 `\N[52]` / `\N[53]` 这种「显示第 n 号变量」的宏来标注**说话人变量号**，
 * 而世界书里每个 NPC 恰好带一个 speakerId。两边一对上，
 * 「总库里 3000 条台词」就还原成了「每个角色属于自己的那几十句」。
 * 之前扫描器只按条件求值取一支，所以每人平均只剩 2 句 —— 那不是原作的样子。
 */
var SPEAKER_RE = /\\N\[(\d+)\]/g;
/** 清掉 MV 的显示控制符，只留可读正文（\C[14] 颜色、\> \< 显示控制、\. \| 停顿） */
function cleanText(s) {
  var t = String(s).replace(/\\C\[\d+\]/g, '').replace(/\\[<>|.^!$]/g, '').replace(/\\V\[(\d+)\]/g, '〔变量$1〕').replace(/^\s+|\s+$/g, '');
  /* 【v2.9.17】本地化占位符没还原成功的残余：留着会原样进语料喂给 AI。
   * 只在确实有语言表时才动（没有语言表的游戏里 `${` 属玩家原文，不许改）。 */
  if (L10N.available && t.indexOf('${') >= 0) t = L10N.resolveText(t).replace(/^\s+|\s+$/g, '');
  return t;
}
var bySpeaker = {};
var allLines = [];
for (var _i42 = 0, _concat2 = [].concat(lore.ceDialogues || []); _i42 < _concat2.length; _i42++) {
  var _ce = _concat2[_i42];
  for (var _i44 = 0, _ce$lines2 = _ce.lines; _i44 < _ce$lines2.length; _i44++) {
    var l = _ce$lines2[_i44];
    var ids = [];
    var _m4 = void 0;
    SPEAKER_RE.lastIndex = 0;
    while (_m4 = SPEAKER_RE.exec(l.text)) {
      var id = parseInt(_m4[1], 10);
      if (!ids.includes(id)) ids.push(id);
    }
    var rec = {
      ce: _ce.ceId,
      ceName: _ce.name,
      speaker: l.speaker || '',
      text: cleanText(l.text),
      raw: l.text,
      speakerVarIds: ids
    };
    allLines.push(rec);
    for (var _i46 = 0; _i46 < ids.length; _i46++) {
      var _id = ids[_i46];
      (bySpeaker[_id] = bySpeaker[_id] || []).push({
        ce: _ce.ceId,
        speaker: rec.speaker,
        text: rec.text
      });
    }
  }
}
/* 地图事件里那些直接写死的 401（不引用公共事件的少量 NPC）也要进池子 */
for (var _i48 = 0, _lore$maps6 = lore.maps; _i48 < _lore$maps6.length; _i48++) {
  var _m5 = _lore$maps6[_i48];
  for (var _i50 = 0, _m5$events2 = _m5.events; _i50 < _m5$events2.length; _i50++) {
    var _ev = _m5$events2[_i50];
    for (var _i52 = 0, _ev$pages4 = _ev.pages; _i52 < _ev$pages4.length; _i52++) {
      var _pg = _ev$pages4[_i52];
      for (var _i54 = 0, _pg$dialogues2 = _pg.dialogues; _i54 < _pg$dialogues2.length; _i54++) {
        var _d = _pg$dialogues2[_i54];
        var _rec = {
          map: _m5.id,
          eventId: _ev.eventId,
          eventName: L10N.resolveText(_ev.name),
          speaker: _d.speaker,
          text: cleanText(_d.text),
          raw: _d.text
        };
        allLines.push(_rec);
        if (_d.speaker && /^\[?[\u4e00-\u9fa5\w]+\]?$/.test(_d.speaker)) {
          var k = 'name:' + _d.speaker;
          (bySpeaker[k] = bySpeaker[k] || []).push({
            map: _m5.id,
            speaker: '',
            text: _rec.text
          });
        }
      }
    }
  }
}
/* 【v2.8.0 通用化】ADV 剧本里的台词也要进池子。
 * 这些游戏没有「说话人变量」，但剧本行自带 [说话人] 标记 ——
 * 直接以 `name:<说话人>` 落进 bySpeaker，下游（人设线索）就能按人拿台词。 */
var scSpeakerLineCount = 0;
for (var _i56 = 0, _ref0 = lore.scenario || []; _i56 < _ref0.length; _i56++) {
  var sc = _ref0[_i56];
  for (var _i58 = 0, _sc$lines2 = sc.lines; _i58 < _sc$lines2.length; _i58++) {
    var _l = _sc$lines2[_i58];
    var _rec2 = {
      scenario: sc.file,
      speaker: _l.speaker || '',
      text: L10N.available ? L10N.resolveText(_l.text) : _l.text,
      raw: _l.text
    };
    allLines.push(_rec2);
    scSpeakerLineCount++;
    if (_l.speaker) {
      var _k = 'name:' + _l.speaker;
      (bySpeaker[_k] = bySpeaker[_k] || []).push({
        scenario: sc.file,
        speaker: _l.speaker,
        text: _l.text
      });
    }
  }
}
/* 脚本指令里内嵌的台词（无说话人，只有正文）也进池子 —— 是理解世界观口吻的好料 */
var scriptLineCount = 0;
for (var _i60 = 0, _ref10 = lore.scriptStrings || []; _i60 < _ref10.length; _i60++) {
  var ss = _ref10[_i60];
  for (var _i62 = 0, _ss$texts2 = ss.texts; _i62 < _ss$texts2.length; _i62++) {
    var _t = _ss$texts2[_i62];
    allLines.push({
      script: ss.ce || ss.map,
      eventName: ss.name || ss.eventName || '',
      speaker: '',
      text: _t,
      raw: _t
    });
    scriptLineCount++;
  }
}
lore.stats.scenarioSpeakersFound = Object.keys(bySpeaker).filter(function (k) {
  return k.indexOf('name:') === 0;
}).length;
lore.stats.scenarioLinesInPool = scSpeakerLineCount;
lore.stats.scriptLinesInPool = scriptLineCount;
lore.speakerLines = bySpeaker;
lore.allLines = allLines;

/* ============================================================ 7. 统计 */
var ceLineCount = lore.ceDialogues.reduce(function (n, c) {
  return n + c.lines.length;
}, 0);
var mapLineCount = lore.mapDialogues.length ? 0 : lore.maps.reduce(function (n, m) {
  return n + m.events.reduce(function (k, e) {
    return k + e.pages.reduce(function (j, p) {
      return j + p.dialogues.length;
    }, 0);
  }, 0);
}, 0);
lore.stats = Object.assign(lore.stats, {
  commonEvents: lore.ceDialogues.length,
  commonEventLines: ceLineCount,
  maps: lore.maps.length,
  mapEvents: lore.maps.reduce(function (n, m) {
    return n + m.events.length;
  }, 0),
  mapLines: mapLineCount,
  actors: lore.actors.length,
  actorsWithProfile: lore.actors.filter(function (a) {
    return a.profile;
  }).length,
  nameWords: Object.keys(lore.names).reduce(function (n, k) {
    return n + lore.names[k].length;
  }, 0),
  comments: lore.comments.length,
  regions: Object.keys(lore.regions).length,
  speakerVarGroups: Object.keys(bySpeaker).length,
  allLines: allLines.length
});

/* 【Node 9 / 老内核】游戏里的 NW.js 是 Node 9，mkdirSync 的 recursive 会被静默忽略
 * （Node 10.12 才加的）—— 目录已存在就抛 EEXIST。自动流水线必然死在最后写文件那一步。
 * 自己兜一层：抛了但目录其实在，就当成功。 */
try {
  fs.mkdirSync(path.dirname(OUT), {
    recursive: true
  });
} catch (e) {
  if (!fs.existsSync(path.dirname(OUT))) throw e;
}
fs.writeFileSync(OUT, JSON.stringify(lore, null, 1), 'utf8');
var kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('');
console.log('全量语料抽取完成 → ' + OUT + '  (' + kb + ' KB)');
console.log('  公共事件 ' + lore.stats.commonEvents + ' 个 / 台词 ' + ceLineCount + ' 条');
console.log('  地图 ' + lore.stats.maps + ' 张 / 事件 ' + lore.stats.mapEvents + ' 个 / 台词 ' + mapLineCount + ' 条');
console.log('  官方角色名 ' + lore.stats.actors + ' 个（有简介 ' + lore.stats.actorsWithProfile + ' 个）');
console.log('  世界词汇 ' + lore.stats.nameWords + ' 个 ｜ 作者注释 ' + lore.stats.comments + ' 条');
console.log('  区域 ' + Object.keys(lore.regions).join(', '));
console.log('');
console.log('  ★ ADV 剧本：' + (lore.stats.scenarioFiles || 0) + ' 个文件 / 正文 ' + (lore.stats.scenarioLines || 0) + ' 行' + '（密钥 ' + (lore.stats.scenarioKey ? 'XOR ' + lore.stats.scenarioKey : '明文') + '，' + (lore.stats.scenarioSpeakers || 0) + ' 个带名说话人）');
console.log('  ★ 脚本内嵌台词：' + (lore.stats.scriptLinesInPool || 0) + ' 条');
console.log('');
console.log('  ★ 按说话人变量还原出的角色台词组：' + lore.stats.speakerVarGroups + ' 组');
var sizes = Object.entries(bySpeaker).map(function (_ref11) {
  var k = _ref11[0],
    v = _ref11[1];
  return {
    k: k,
    n: v.length
  };
}).sort(function (a, b) {
  return b.n - a.n;
});
console.log('    台词最多的 8 个说话人：' + sizes.slice(0, 8).map(function (s) {
  return s.k + '(' + s.n + '句)';
}).join('  '));
var many = sizes.filter(function (s) {
  return s.n >= 5;
}).length;
console.log('    ≥5 句的说话人 ' + many + ' 个 ／ ≥2 句的 ' + sizes.filter(function (s) {
  return s.n >= 2;
}).length + ' 个');
console.log('    台词总数 ' + lore.stats.allLines + ' 条');
console.log('');