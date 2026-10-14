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
 * l10n.js —— 本地化占位符还原（通用，跨游戏）
 *
 * 【为什么需要它】
 * 《Knights of Messiah IF》用 ODW_MultiLanguageSystem 这套多语言插件，把**所有正文**
 * 都换成了占位符：台词是 `${text.message000745}`、事件名是 `${text.message101000}`、
 * 道具名是 `${text.items000011}`、地图名也一样。真值放在
 *     <根>/languages/<语言>/main.json      ← 平铺键，形如 "text.message101000": "アリシア"
 * 游戏里由语言插件在**绘制时**替换，所以玩家看到的是一切正常。
 *
 * 但我们的扫描器 / 语料抽取器是**直接读 data/*.json 的**，拿到的是原始占位符：
 *   · 人名显示成 `${text.message101000}`；
 *   · 整份语料是 512 种 `${text.xxx}`，AI 拿它写世界观 / 写人设 = 纯编。
 * 实测这一款：世界书里 512 个占位符，**512/512 都能在语言表里找到**。
 *
 * 【还原规则：与游戏内插件逐字同口径】
 *   占位符正则照抄 ODW 源码：`/\$\{([\w|\.]+)\}/gm`
 *   命中 key → 换成真值；**未命中 → 原样保留**（由上层决定丢弃还是保留）。
 *   语言插件自己未命中时是把 `${x}` 换成裸 `x`，我们**不学这一步**——
 *   对 AI 来说 `text.message101000` 和 `${text.message101000}` 一样是垃圾，
 *   保留原样至少还能被人一眼看出「这里没还原」。
 *
 * 【★ 零回归红线】
 * 找不到语言表时 `available=false`，`resolve()` 一律**原样返回**。
 * 于是对没有这套多语言的游戏（伊莉莎 / Mira / 水族馆 / 呆呆 …）逐字节零差异。
 *
 * 【用法】
 *   const L10N = require('./l10n.js').load({ root: GAME.root, www: GAME.www });
 *   if (L10N.available) { ... }
 *   L10N.resolve(s)        // 已知 key 还原，未知原样
 *   L10N.resolveText(s)    // 还原 + 抹掉剩下的 ${...}（用于"内容"）
 *   L10N.deepResolve(obj)  // 递归还原（在 JSON.parse 之后挂一次就全覆盖了）
 *   L10N.hasPlaceholder(s)
 */
'use strict';

var fs = require('fs');
var path = require('path');

/* ODW 的占位符：`${code}`，code 只允许 [\w|.] */
var PH_RE = /\$\{([\w|.]+)\}/g;
var PH_TEST = /\$\{[\w|.]+\}/;

/* 语言目录名候选（按优先级；`locale/locales` 垫底 —— NW.js 每个游戏根目录都自带
 * 一个放 en-US.pak 的 locales/，优先探它纯属浪费，还容易撞上别的含义） */
var DIR_NAMES = ['languages', 'language', 'lang', 'i18n', 'translations', 'locale', 'locales'];

/* System.locale / 语言码 → 目录名候选，按优先级 */
var LOCALE_ALIAS = {
  ja: ['jpn', 'ja', 'jp', 'japanese', '日本語'],
  zh: ['chn', 'chs', 'zh', 'zh_cn', 'zh-cn', 'cn', 'cht', 'chinese', '简体中文', '繁體中文'],
  en: ['eng', 'en', 'english'],
  ko: ['kor', 'ko', 'korean'],
  fr: ['fra', 'fr', 'french'],
  de: ['deu', 'de', 'german'],
  es: ['spa', 'es', 'spanish'],
  it: ['ita', 'it', 'italian'],
  pt: ['por', 'pt', 'portuguese'],
  ru: ['rus', 'ru', 'russian'],
  cs: ['cs', 'cze', 'czech'],
  pl: ['pol', 'pl', 'polish'],
  tr: ['tur', 'tr', 'turkish'],
  th: ['tha', 'th', 'thai'],
  vi: ['vie', 'vi', 'vietnamese']
};
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}
function readJson(p) {
  try {
    var s = fs.readFileSync(p, 'utf8');
    return JSON.parse(s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
  } catch (e) {
    return null;
  }
}
function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch (e) {
    return [];
  }
}

/** 语言码归一：'ja_JP' → 'ja'；'zh-CN' → 'zh'；'ja' → 'ja' */
function normLocale(loc) {
  var s = String(loc == null ? '' : loc).trim().toLowerCase();
  if (!s) return '';
  var m = /^([a-z]{2,3})/.exec(s);
  return m ? m[1] : s;
}

/** 把 `<某个语言文件夹>` 下所有 *.json 合成一张平铺表（后读的补前读的，不覆盖） */
function tableOf(dir) {
  var table = {};
  var n = 0,
    files = 0;
  var names = listDir(dir).filter(function (f) {
    return /\.json$/i.test(f);
  });
  /* main.json 优先读，剩下的按名字排，保证结果稳定 */
  names.sort(function (a, b) {
    var am = /^main\.json$/i.test(a) ? 0 : 1,
      bm = /^main\.json$/i.test(b) ? 0 : 1;
    return am - bm || (a < b ? -1 : a > b ? 1 : 0);
  });
  for (var _i2 = 0; _i2 < names.length; _i2++) {
    var f = names[_i2];
    var j = readJson(path.join(dir, f));
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
    files++;
    for (var _i4 = 0, _Object$keys2 = Object.keys(j); _i4 < _Object$keys2.length; _i4++) {
      var k = _Object$keys2[_i4];
      if (table[k] === undefined && typeof j[k] === 'string') {
        table[k] = j[k];
        n++;
      }
    }
  }
  return {
    table: table,
    keys: n,
    files: files
  };
}

/**
 * 找语言表。
 * @param {{root?:string, www?:string, lang?:string, locale?:string}} opts
 * @returns {{available:boolean, reason:string, table:object, lang:string, dir:string,
 *            languages:string[], keys:number, locale:string, placeholdersHit:number}}
 */
function discover(opts) {
  opts = opts || {};
  var root = opts.root || '';
  var www = opts.www || '';
  var out = {
    available: false,
    reason: '',
    table: {},
    lang: '',
    dir: '',
    languages: [],
    keys: 0,
    locale: String(opts.locale || ''),
    files: 0
  };

  /* 1a) 只在 **www** 与「像游戏根目录」的父目录里找。
   *     ★ 扁平布局（data/ 与 index.html 平铺）下 www 自己就是游戏根，而它的父目录可能是
   *       Steam 的 `steamapps/common/` —— 那里面躺着**别的游戏**的 languages/。
   *       不加这道护栏就会把邻居游戏的语言表拿来套（串味、且完全静默）。 */
  var bases = [];
  if (www) bases.push(www);
  if (root && root !== www) {
    var classic = path.basename(www || '').toLowerCase() === 'www';
    var parentIsGame = ['index.html', 'package.json', 'Game.exe', 'nw.dll', 'game.ini'].some(function (f) {
      return isFile(path.join(root, f));
    });
    if (classic || parentIsGame) bases.push(root);
  }
  if (!bases.length) {
    out.reason = '没给 root/www';
    return out;
  }

  /* 1b) 逐个候选目录试，**必须真出表**才算命中。
   *     ★ 不能"看目录名像就用"：NW.js 每个游戏根目录都自带 `locales/`（en-US.pak 那种），
   *       按名字命中会把伊莉莎 / Mira 全带偏（表为空 → 白跑一趟还报个误导性的原因）。
   *       按 DIR_NAMES 的顺序探测也保证了结果确定（不受文件系统枚举顺序影响）。 */
  var langs = [];
  for (var _i6 = 0; _i6 < bases.length; _i6++) {
    var b = bases[_i6];
    for (var _i8 = 0; _i8 < DIR_NAMES.length; _i8++) {
      var nm = DIR_NAMES[_i8];
      var d = path.join(b, nm);
      if (!isDir(d)) continue;
      for (var _i0 = 0, _listDir2 = listDir(d); _i0 < _listDir2.length; _i0++) {
        var e = _listDir2[_i0];
        var sd = path.join(d, e);
        if (!isDir(sd)) continue;
        var t = tableOf(sd);
        if (t.keys > 0) langs.push({
          name: String(e),
          table: t.table,
          keys: t.keys,
          files: t.files,
          dir: d
        });
      }
      if (!langs.length) {
        /* 罕见的扁平布局：语言目录下直接就是 json */
        var _t = tableOf(d);
        if (_t.keys > 0) langs.push({
          name: path.basename(d),
          table: _t.table,
          keys: _t.keys,
          files: _t.files,
          dir: d
        });
      }
      if (langs.length) {
        out.dir = d;
        break;
      }
    }
    if (langs.length) break;
  }
  if (!langs.length) {
    out.reason = '没找到可用的语言表（languages/ 之类）';
    return out;
  }
  out.languages = langs.map(function (l) {
    return l.name;
  });
  if (!out.locale) {
    var sys = readJson(path.join(www || root, 'data', 'System.json'));
    if (sys && sys.locale) out.locale = String(sys.locale);
  }

  /* 3) 选语言：显式 --lang > locale 别名 > 键最多的那张 */
  var want = String(opts.lang || '').trim().toLowerCase();
  var pick = null;
  var aliases = [];
  if (want) aliases.push(want);
  var base = normLocale(out.locale);
  if (base && LOCALE_ALIAS[base]) aliases.push.apply(aliases, LOCALE_ALIAS[base]);else if (base) aliases.push(base);
  var _loop = function _loop() {
    var a = aliases[_i10];
    pick = langs.filter(function (l) {
      return l.name.toLowerCase() === a;
    })[0];
    if (pick) return 1; // break
  };
  for (var _i10 = 0; _i10 < aliases.length; _i10++) {
    if (_loop()) break;
  }
  if (!pick) pick = langs.slice().sort(function (a, b) {
    return b.keys - a.keys;
  })[0];
  out.available = true;
  out.table = pick.table;
  out.lang = pick.name;
  out.keys = pick.keys;
  out.files = pick.files;
  out.reason = 'ok';
  return out;
}

/* 缓存：同一进程内每个 root 只扫一次（游戏内工具是 `new Function` 跑同一份源码，也复用） */
var CACHE = null;
function cacheKey(o) {
  return String(o.www || o.root || '') + '|' + String(o.lang || '') + '|' + String(o.locale || '');
}
function load(opts) {
  var k = cacheKey(opts || {});
  if (CACHE && CACHE.key === k) return CACHE.val;
  var raw = discover(opts);
  var API = makeApi(raw);
  CACHE = {
    key: k,
    val: API
  };
  return API;
}

/** 把 discover 的结果包成 API 对象 */
function makeApi(dis) {
  var table = dis.table || {};
  function resolve(s) {
    if (!dis.available) return s;
    var str = String(s == null ? '' : s);
    if (str.indexOf('${') < 0) return str;
    var cur = str;
    /* 真值里可能还嵌着别的 code —— 展开最多 3 层，防环 */
    for (var i = 0; i < 3; i++) {
      if (cur.indexOf('${') < 0) break;
      var next = cur.replace(PH_RE, function (m, code) {
        var v = table[code];
        return v === undefined ? m : v;
      });
      if (next === cur) break;
      cur = next;
    }
    return cur;
  }

  /** 内容用：还原之后，把仍然没还原的 ${...} 抹掉（否则它会进语料喂给 AI） */
  function resolveText(s) {
    var t = resolve(s);
    if (dis.available && t.indexOf('${') >= 0) t = t.replace(PH_RE, '');
    return t;
  }
  function hasPlaceholder(s) {
    return PH_TEST.test(String(s == null ? '' : s));
  }

  /** 递归还原（原地）。只在字符串里出现 '${' 时才动，代价可忽略。 */
  function deepResolve(o, depth) {
    if (!dis.available || o == null) return o;
    depth = depth || 0;
    if (depth > 24) return o;
    if (typeof o === 'string') return o.indexOf('${') < 0 ? o : resolve(o);
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length; i++) {
        var v = o[i];
        if (typeof v === 'string') {
          if (v.indexOf('${') >= 0) o[i] = resolve(v);
        } else if (v && typeof v === 'object') deepResolve(v, depth + 1);
      }
      return o;
    }
    if (typeof o === 'object') {
      for (var _i12 = 0, _Object$keys4 = Object.keys(o); _i12 < _Object$keys4.length; _i12++) {
        var k = _Object$keys4[_i12];
        var _v = o[k];
        if (typeof _v === 'string') {
          if (_v.indexOf('${') >= 0) o[k] = resolve(_v);
        } else if (_v && typeof _v === 'object') deepResolve(_v, depth + 1);
      }
      return o;
    }
    return o;
  }
  return {
    available: dis.available,
    reason: dis.reason,
    lang: dis.lang,
    dir: dis.dir,
    languages: dis.languages,
    keys: dis.keys,
    files: dis.files,
    locale: dis.locale,
    table: table,
    resolve: resolve,
    resolveText: resolveText,
    hasPlaceholder: hasPlaceholder,
    deepResolve: deepResolve,
    /** 给 worldbook / 日志用的一行摘要 */
    summary: function summary() {
      if (!dis.available) return '未启用（' + dis.reason + '）';
      return dis.lang + '（' + dis.keys + ' 键）';
    }
  };
}

/** 扫描一段任意数据，返回其中出现的、**没还原成功**的占位符种类 */
function unknownPlaceholders(api, data) {
  var bad = {};
  var s = typeof data === 'string' ? data : JSON.stringify(data);
  var re = /\$\{([\w|.]+)\}/g;
  var m;
  while (m = re.exec(s)) {
    if (!api.table[m[1]]) bad[m[1]] = (bad[m[1]] || 0) + 1;
  }
  return bad;
}
module.exports = {
  discover: discover,
  load: load,
  makeApi: makeApi,
  normLocale: normLocale,
  unknownPlaceholders: unknownPlaceholders,
  PH_RE: PH_RE
};