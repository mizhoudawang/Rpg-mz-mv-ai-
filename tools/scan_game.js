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
 * RM_AI_NPC 世界书扫描器  (RPG Maker MV/MZ  ->  worldbook.json + actors_ai.json)
 *
 * 用法:
 *   node tools/scan_game.js [游戏根目录] [--out <输出目录>] [--unknown-cond true|false]
 *                           [--keepActor 3,7] [--dropActor 99]
 *   --keepActor / --dropActor 是 +actorN 指名角色的**逃生舱**（判据没覆盖到时用）：
 *     --keepActor=3    第 3 号角色被误判成怪物 → 强制放行（也可以写素材名）
 *     --dropActor=99   第 99 号角色是个摆件、判据没认出来 → 强制剔除
 *
 * 原理（针对本作"文本ID系统"结构）:
 *   地图事件通常只是薄触发器：写变量 -> 调用公共事件。
 *   公共事件里是一张巨大的 if 变量==7位文本ID 的分支表。
 *   因此本扫描器实现了一个【常量传播静态解释器】：按缩进跟踪 if/else 分支，
 *   把已知的变量写入（如 Event_No/Event_Text）代入条件求值，只收真正会执行到的 401 台词。
 *
 *   注意: 本作 rpg_objects.js 的 command111 参数布局为
 *         [类型, 变量ID, 操作数种类, 操作数, 比较符]     (原版 MV 为 ...比较符, 操作数种类, 操作数)
 *         脚本以引擎实测为准。
 */
'use strict';

var fs = require('fs');
var path = require('path');

// ============================================================ 命令行
function parseArgs(argv) {
  var o = {
    game: null,
    out: null,
    unknownCond: false,
    keepActor: [],
    dropActor: [],
    lang: ''
  };
  var list = function list(v) {
    return String(v == null ? '' : v).split(',').map(function (s) {
      return s.trim();
    }).filter(Boolean);
  };
  var _loop = function _loop(_i) {
    var a = argv[_i];
    /* 【v2.9.9】分隔符两种写法都收：`--out 目录` 与 `--out=目录`。
     * 插件内部一直用的是前者；但手敲命令行很容易写成后者 ——
     * 而写错**不会报错**：参数匹配不上，就被当成"游戏目录"静默忽略，
     * 输出直接落进游戏里（扫描是原地覆盖 worldbook.json）。这个坑踩过一次，堵上。 */
    var k = a,
      v = null;
    var eq = a.indexOf('=');
    if (a.charAt(0) === '-' && eq > 0) {
      k = a.slice(0, eq);
      v = a.slice(eq + 1);
    }
    var take = function take() {
      return v !== null ? v : argv[++_i];
    };
    if (k === '--out') o.out = take();else if (k === '--game') o.game = take();else if (k === '--lang') o.lang = take();else if (k === '--unknown-cond') o.unknownCond = String(take()) !== 'false';else if (k === '--keepActor') o.keepActor = list(take());else if (k === '--dropActor') o.dropActor = list(take());else if (!o.game) o.game = a;
    i = _i;
  };
  for (var i = 2; i < argv.length; i++) {
    _loop(i);
  }
  return o;
}
var ARGS = parseArgs(process.argv);
var DEFAULT_GAME = process.env.AINPC_GAME || null;

// ============================================================ 定位游戏
function tryGameDir(p) {
  if (!p || !fs.existsSync(p)) return null;
  if (fs.existsSync(path.join(p, 'data', 'System.json'))) return {
    www: p,
    root: path.dirname(p)
  };
  if (fs.existsSync(path.join(p, 'www', 'data', 'System.json'))) return {
    www: path.join(p, 'www'),
    root: p
  };
  // 向下钻（游戏常有多层压缩包外壳）
  var stack = [[p, 0]];
  var _loop2 = function _loop2() {
      var _stack$shift = stack.shift(),
        dir = _stack$shift[0],
        d = _stack$shift[1];
      if (d > 3) return 0; // continue
      // 同上：withFileTypes 是 Node 10.10 才有的，老内核下退化成字符串数组，
      // 后面的 e.isDirectory() 会抛。这里自己判，两种内核都能走。
      var ents = [];
      try {
        ents = fs.readdirSync(dir, {
          withFileTypes: true
        });
        if (ents.length && typeof ents[0] === 'string') {
          ents = ents.map(function (n) {
            return {
              name: n,
              isDirectory: function isDirectory() {
                try {
                  return fs.statSync(path.join(dir, n)).isDirectory();
                } catch (e2) {
                  return false;
                }
              }
            };
          });
        }
      } catch (e) {
        return 0; // continue
      }
      for (var _i3 = 0, _ents2 = ents; _i3 < _ents2.length; _i3++) {
        var e = _ents2[_i3];
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.') || ['node_modules', 'img', 'audio', 'fonts', 'js', 'save', 'locales', 'swiftshader'].includes(e.name)) continue;
        stack.push([path.join(dir, e.name), d + 1]);
      }
      if (fs.existsSync(path.join(dir, 'data', 'System.json'))) return {
        v: {
          www: dir,
          root: path.dirname(dir)
        }
      };
      if (fs.existsSync(path.join(dir, 'www', 'data', 'System.json'))) return {
        v: {
          www: path.join(dir, 'www'),
          root: dir
        }
      };
    },
    _ret;
  while (stack.length) {
    _ret = _loop2();
    if (_ret === 0) continue;
    if (_ret) return _ret.v;
  }
  return null;
}
var GAME = tryGameDir(ARGS.game) || tryGameDir(DEFAULT_GAME);
if (!GAME) {
  console.error('找不到游戏目录，请用 node tools/scan_game.js <游戏根目录> 指定');
  process.exit(1);
}
var DATA = path.join(GAME.www, 'data');
var OUT = ARGS.out || path.join(GAME.www, 'ai_npc');
console.log('[scan] 游戏根目录 :', GAME.root);
console.log('[scan] data       :', DATA);
console.log('[scan] 输出       :', OUT);
console.log('[scan] 未知条件   :', ARGS.unknownCond ? '按"可能成立"处理' : '按"不成立"处理（推荐，等同新档默认状态）');

/* ====================================================== 本地化占位符还原（v2.9.17）
 * 《Knights of Messiah IF》这类用了多语言插件的游戏，data/*.json 里**所有正文**
 * 都是 `${text.message000745}` 这种占位符，真值在 <根>/languages/<语言>/*.json。
 * 不还原的话：人名显示成 `${text.message101000}`、整份语料变成 512 种占位符。
 * 见 l10n.js 顶部注释。**找不到语言表时 available=false，一切行为与以前逐字节一致。** */
var L10N = function () {
  try {
    return require('./l10n.js').load({
      root: GAME.root,
      www: GAME.www,
      lang: ARGS.lang || ''
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
      table: {},
      lang: '',
      languages: [],
      keys: 0
    };
  }
}();
console.log('[scan] 本地化     :', L10N.summary());

// ============================================================ 载入
/* 没启用本地化时，顺手统计「原文里其实藏着占位符」的文件数 ——
 * 用来在最后提醒一句"这份语料是占位符，AI 写不出东西"。只有一次 indexOf，代价可忽略。 */
var PH_SEEN_FILES = 0;
function load(n) {
  var p = path.join(DATA, n + '.json');
  if (!fs.existsSync(p)) return null;
  try {
    var s = fs.readFileSync(p, 'utf8');
    if (!L10N.available && s.indexOf('${') >= 0) PH_SEEN_FILES++;
    var j = JSON.parse(s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
    /* ★ 一次性全覆盖：事件名 / 401 台词 / 道具名 / 地图名 / 角色名……
     *   全都是在 JSON.parse 之后读的，所以在这里挂一道就够了。
     *   没语言表的游戏这个调用是空转（available=false 直接 return）。 */
    return L10N.deepResolve(j);
  } catch (e) {
    console.warn('  ! 解析失败', n, e.message);
    return null;
  }
}

/* ====================================================== 场景脚本里的「称呼」（v2.9.13）
 * 【为什么值得读】Mira 有一批 NPC 的**名字只写在台词脚本里**：事件本体没有指令、
 *   页上的立绘名是 `mob_096` / `Mob_Uniform_A` 这种素材名，于是扫描器把素材名当了人名，
 *   玩家在对话横幅上看到的就是「mob_098」—— 完全不是人话。
 *   而游戏自己的台词文件 `scenario/mob_096.sl` 开头就是
 *       [学生]「啊呜呜～。搅锅真累人啊…」
 *   那个 `[学生]` 才是游戏给这个人用的称呼（`mob_011.sl` → `[老师]`，
 *   `mob_075.sl` → `[达观的学生]`，`mob_psy.sl` → `[药水商人]` …）。
 *   实测 120 个 `mob_*.sl`：**「第一个 [x]」与「最高频 [x]」100% 一致** ⇒ 取第一个即可。
 *
 * 编码：`TS_Decode.js` 在 `Decode=true` 时把整份文件**按字符**异或 Key（默认 255），
 *   并把扩展名换成 `.sl`（`TS_Function.getScenarioExtension`）。所以
 *   `.sl` ⇒ 需要异或、`.txt` ⇒ 明文；Key 从 `js/plugins.js` 的 TS_Decode 参数里读。
 *   两个扩展名都试，谁先命中用谁。
 *
 * ★ 只在**当前名字本身就是素材名/占位名**时才启用（见 isAssetName），
 *   绝不覆盖已有的好名字 —— 于是没有 scenario 目录的游戏（伊莉莎）逐字节不变。 */
var SCEN_DIR = function () {
  /* 经典布局根目录在 www 上一层；扁平布局 www 自己就是游戏根（根目录可能是
   * Steam 的 common/，那底下没有 scenario）。先看根、再看 www，命中即用。 */
  var a = path.join(GAME.root, 'scenario');
  if (fs.existsSync(a)) return a;
  return path.join(GAME.www, 'scenario');
}();
var SCEN_CFG = function () {
  var key = 255,
    decoded = false;
  try {
    var src = fs.readFileSync(path.join(GAME.www, 'js', 'plugins.js'), 'utf8');
    var m = /"name"\s*:\s*"TS_Decode"[\s\S]{0,600}?"parameters"\s*:\s*(\{[^}]*\})/.exec(src);
    if (m) {
      var p = JSON.parse(m[1]);
      decoded = String(p.Decode) === 'true';
      var k = parseInt(p.Key, 10);
      if (!isNaN(k)) key = k;
    }
  } catch (e) {}
  return {
    key: key,
    decoded: decoded
  };
}();
var SCEN_CACHE = {};
function scenarioSpeakerName(evName) {
  var nm = String(evName == null ? '' : evName).trim();
  if (!nm) return '';
  if (SCEN_CACHE[nm] !== undefined) return SCEN_CACHE[nm];
  SCEN_CACHE[nm] = ''; // 先占位，防重入
  var out = '';
  var exts = SCEN_CFG.decoded ? ['.sl', '.txt'] : ['.txt', '.sl'];
  for (var i = 0; i < exts.length; i++) {
    var ext = exts[i];
    var raw = '';
    try {
      var p = path.join(SCEN_DIR, nm + ext);
      if (!fs.existsSync(p)) continue;
      raw = fs.readFileSync(p, 'utf8');
    } catch (e) {
      continue;
    }
    if (ext === '.sl') {
      var d = '';
      for (var j = 0; j < raw.length; j++) d += String.fromCharCode(raw.charCodeAt(j) ^ SCEN_CFG.key);
      raw = d;
    }
    var m = /\[([^\[\]]{1,14})\]/.exec(raw);
    if (m && m[1].trim()) {
      out = m[1].trim();
      break;
    }
  }
  SCEN_CACHE[nm] = out;
  return out;
}
/** 这个名字是不是「素材名 / 占位名」？（只有这种情况才值得去脚本里找真称呼）
 *  ⚠ 本作的事件名是 `mob_076`（**带下划线**），而立绘名是 `mob06`（不带）——
 *    两套命名空间。第一版只写了 `^mob\d+$`，于是一条都没匹配上、改名 0 条。
 *    `mob_?` 把两种都盖住。 */
function isAssetName(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return false;
  if (/^mob_?\d+$/i.test(s)) return true;
  if (/^Mob_[A-Za-z0-9_]+$/.test(s)) return true;
  if (/^[!$]/.test(s)) return true;
  return false;
}

/* ====================================================== ADV 剧本里的「日文演员名 → 中文名」（v2.10.0）
 * 【问题】剧情驱动型游戏（TS_ADVsystem 一系）常常是**汉化版**：正文全中文，
 *   地图名 / 剧本 / 道具名都翻了，**唯独 `Actors.json` 里的演员名还是原文**。
 *   于是 `+actorN` 指名的角色在世界书 / AI 扮演菜单里显示成 `リア` / `ロシェ` / `ベリル`
 *   —— 实测《米拉与奇妙的炼金术》205 个 NPC 里 32 个是日文名。
 * 【怎么认出中文名】剧本里说话人写作 `[莉娅]「…」`，立绘写作 `@bs f=Ria@Smile`；
 *   两者在同一段里**共现**，于是能就地建出「立绘名 → 中文名」词典：
 *       ria→莉娅  roche→罗谢  beryl→贝丽尔  grana→格拉娜  esmeralda→埃斯梅拉达
 *   再把演员的原文名转罗马字（片假名五十音表，纯查表）去比：
 *       `リア`→ria、`グラナ`→gurana、`エスメラルダ`→esumeraruda。
 * 【红线：宁可漏判不可误杀】只接受**唯一最佳**或**显著优于次佳**的候选，且
 *   ① 首字母必须相同；② 去元音后编辑距离 ≤1，或完整距离 ≤3 且长度差 ≤2 且共同前缀 ≥2。
 *   实测 5 个主要角色全部命中；3 个怪物名（コウモリ / スライム / キノコ）**一个都没误配**
 *   —— 它们首字母就对不上；メイドＡ/Ｂ 因候选歧义而主动放弃。说不准就**原样保留**。
 * 【成本】只在「有 scenario 目录」且「演员表里确实存在含假名的名字」时才建词典
 *   （≈0.4 s / 520 个文件，一次性）。没有剧本的游戏（伊莉莎 / 水族馆 / 呆呆 …）
 *   一步都不走，逐字节零回归。 */
var KANA_ROMAJI = function () {
  var K = {};
  ('ア:a イ:i ウ:u エ:e オ:o カ:ka キ:ki ク:ku ケ:ke コ:ko サ:sa シ:shi ス:su セ:se ソ:so ' + 'タ:ta チ:chi ツ:tsu テ:te ト:to ナ:na ニ:ni ヌ:nu ネ:ne ノ:no ハ:ha ヒ:hi フ:fu ヘ:he ホ:ho ' + 'マ:ma ミ:mi ム:mu メ:me モ:mo ヤ:ya ユ:yu ヨ:yo ラ:ra リ:ri ル:ru レ:re ロ:ro ワ:wa ヲ:wo ン:n ' + 'ガ:ga ギ:gi グ:gu ゲ:ge ゴ:go ザ:za ジ:ji ズ:zu ゼ:ze ゾ:zo ダ:da ヂ:ji ヅ:zu デ:de ド:do ' + 'バ:ba ビ:bi ブ:bu ベ:be ボ:bo パ:pa ピ:pi プ:pu ペ:pe ポ:po ヴ:vu ' + 'ァ:a ィ:i ゥ:u ェ:e ォ:o ャ:ya ュ:yu ョ:yo ー:').split(' ').forEach(function (p) {
    var i = p.indexOf(':');
    if (i > 0) K[p.slice(0, i)] = p.slice(i + 1);
  });
  return K;
}();
function toRomaji(s) {
  var o = '';
  for (var _i5 = 0, _String2 = String(s); _i5 < _String2.length; _i5++) {
    var ch = _String2[_i5];
    o += KANA_ROMAJI[ch] !== undefined ? KANA_ROMAJI[ch] : ch;
  }
  return o.toLowerCase().replace(/[^a-z]/g, '');
}
function dropVowels(s) {
  return s.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}
function editDistance(a, b) {
  var m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  var prev = new Array(n + 1);
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    var cur = [i];
    for (var _j = 1; _j <= n; _j++) cur[_j] = Math.min(prev[_j] + 1, cur[_j - 1] + 1, prev[_j - 1] + (a[i - 1] === b[_j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
var HAS_KANA = /[\u3040-\u30FF]/;
var SCEN_LOC = null; /* 懒建：'リア' → '莉娅' */
function scenLocalizeBuild() {
  var out = {};
  if (!SCEN_DIR) return out;
  var files = [];
  try {
    files = fs.readdirSync(SCEN_DIR).filter(function (f) {
      return /\.(sl|txt)$/i.test(f);
    });
  } catch (e) {
    return out;
  }
  if (!files.length) return out;
  /* 建「立绘名 → 中文名」共现表 */
  var pair = {};
  for (var _i7 = 0, _files2 = files; _i7 < _files2.length; _i7++) {
    var f = _files2[_i7];
    var s = '';
    try {
      var p = path.join(SCEN_DIR, f);
      var raw = fs.readFileSync(p, 'utf8');
      if (/\.sl$/i.test(f) && SCEN_CFG.decoded) {
        var d = '';
        for (var i = 0; i < raw.length; i++) d += String.fromCharCode(raw.charCodeAt(i) ^ SCEN_CFG.key);
        s = d;
      } else s = raw;
    } catch (e) {
      continue;
    }
    var lastFace = null;
    for (var _i9 = 0, _s$split2 = s.split('\n'); _i9 < _s$split2.length; _i9++) {
      var L = _s$split2[_i9];
      var mf = /@(?:bs|change)\s+f=([A-Za-z][A-Za-z0-9_]*)/.exec(L);
      if (mf) lastFace = mf[1].toLowerCase();
      var mc = /^\[([^\[\]]{1,14})\]/.exec(L);
      if (mc && lastFace) {
        var nm = mc[1].trim();
        if (nm && /[\u4E00-\u9FFF]/.test(nm)) {
          pair[lastFace] = pair[lastFace] || {};
          pair[lastFace][nm] = (pair[lastFace][nm] || 0) + 1;
        }
      }
    }
  }
  var faceMap = {};
  Object.keys(pair).forEach(function (k) {
    var top = Object.entries(pair[k]).sort(function (a, b) {
      return b[1] - a[1];
    })[0];
    if (top) faceMap[k] = {
      name: top[0],
      n: top[1]
    };
  });
  /* 演员原文名 → 罗马字 → 匹配立绘名 */
  var _loop3 = function _loop3() {
      var a = actorsDb[_i0];
      if (!a || !HAS_KANA.test(String(a.name || ''))) return 0; // continue
      var jp = String(a.name).trim();
      if (out[jp]) return 0; // continue
      var r = toRomaji(jp);
      if (r.length < 3) return 0; // continue
      var rn = dropVowels(r);
      var cands = [];
      Object.keys(faceMap).forEach(function (k) {
        if (!k || k.charAt(0) !== r.charAt(0)) return; /* 首字母必须相同 */
        var kn = dropVowels(k);
        var dn = editDistance(rn, kn),
          df = editDistance(r, k);
        var lenDiff = Math.abs(r.length - k.length);
        var common = 0;
        while (common < Math.min(r.length, k.length) && r.charAt(common) === k.charAt(common)) common++;
        if (dn <= 1 || df <= 3 && lenDiff <= 2 && common >= 2) cands.push({
          k: k,
          name: faceMap[k].name,
          n: faceMap[k].n,
          score: Math.min(dn, df)
        });
      });
      if (!cands.length) return 0; // continue
      cands.sort(function (x, y) {
        return x.score - y.score || y.n - x.n;
      });
      /* 唯一最佳，或最佳严格优于次佳 —— 否则放弃（宁可漏判）。 */
      if (cands.length === 1 || cands[1].score > cands[0].score) out[jp] = cands[0].name;
    },
    _ret2;
  for (var _i0 = 1; _i0 < actorsDb.length; _i0++) {
    _ret2 = _loop3();
    if (_ret2 === 0) continue;
  }
  return out;
}
/** 日文演员名 → 中文名（查不到返回 ''）。 */
function localizeActorName(name) {
  var s = String(name == null ? '' : name).trim();
  if (!s || !HAS_KANA.test(s)) return '';
  if (SCEN_LOC === null) SCEN_LOC = scenLocalizeBuild();
  return SCEN_LOC[s] || '';
}

/* ====================================================== 「事件标签」不是人名（v2.9.14 / v2.9.15）
 * 【问题】作者给事件起的是**标签**而不是人名 —— 中英日文三语同病。
 *   英文：`OreVein Spawner`（矿脉生成器）、`TemplateMob`（模板怪）、`Boat` / `Inn` / `Cutscene`。
 *   中日文：`主线 斯卡雷特` / `分支 宝箱` / `调查书架` / `调查任意` / `解锁书架 梦` /
 *     `必经提示` / `猛犸传送门` / `圣堂水晶` —— Steam 实测（《偕老同穴》《呆呆大冒险》
 *     《Routine Soul》）这些都会原样摆进 AI 扮演菜单，"分支 宝箱"这种谁会去点。
 *   它们既不是人名，`isAssetName` 也抓不到（它只认 `mob_*` / `Mob_*` / `!` / `$`）。
 *   与 v2.9.13 的 `mob_098` 是同一类病，只是形状不同。
 * 【英文判据】按「空格 / 下划线 / 小驼峰」切词，**任一词命中系统词表**即标签。
 *   实测命中 13/13；不误伤 Reed / Jim / Doc / Frank / Evan / Bob / Sky / John / Troll /
 *   Smith / Old Smith / MacDonald。
 * 【英文两档词表】有些词本身就是常见人名（`Crystal` 很可能是女主角），单独出现时不动它；
 *   只有整串不止一个词时才当标签 —— `Crystal` 放行、`Blacksmithing Crystal` 命中。
 * 【中日文判据（v2.9.15）】① 整名命中「物件/场景词表」→ 标签；
 *   ② 剥掉「场景前缀」（主线/支线/分支/剧情/调查/解锁/必经/提示…）后，
 *      剩余为空、命中词表、或**含**物件词 → 标签；剩余部分就是清洗后的名字
 *      —— 于是 `主线 斯卡雷特` → `斯卡雷特`（角色名保住），`分支 宝箱` → 弃用；
 *   ③ 以「强后缀」（传送门/公告牌/宝箱/书架/水晶…）结尾 → 标签。
 *   中日文能放心用词表，因为 `宝箱`/`书架`/`传送门` 这类词不会出现在人名里。
 *   实测放行：路明泽 / 铁砧公主 / 梅琳达 / 斯卡雷特 / 旅店老板 / 守门人 / 读书人 / 猫。
 * ★ 与插件 `Ainpc.isLabelName` 同口径，改一边要改另一边；守门员 `_probe_names.js`。 */
/* 英文：强词 —— 出现即判标签。 */
var LABEL_WORDS = ('spawner template test cutscene event script battle chest door gate boat inn ' + 'shop sign marker trigger spawn manager system debug quest scene item weapon armor potion ' + 'gold save load title menu credits intro outro ending start return exit entrance wake ' + 'get give use open close collect dialogue message choice village town map area').split(' ');
/* 英文：高度歧义（本身常做人名）→ 只在「不止一个词」时才算标签。 */
var LABEL_WEAK = ['crystal', 'rose', 'sky', 'star', 'sun', 'river', 'stone'];
var LABEL_WORD_SET = {};
LABEL_WORDS.forEach(function (w) {
  LABEL_WORD_SET[w] = 1;
});
var LABEL_WEAK_SET = {};
LABEL_WEAK.forEach(function (w) {
  LABEL_WEAK_SET[w] = 1;
});
/* 中日文：物件 / 场景名词 —— 整名命中，或出现在「前缀剥离后的剩余」里，即为标签。 */
var CJK_LABEL = ['宝箱', '木箱', '箱子', '箱', '道具箱', '储物箱', '书架', '书柜', '书桌', '桌子', '椅子', '凳子', '床', '马桶', '柜子', '衣柜', '窗户', '窗帘', '镜子', '壁画', '画像', '门', '大门', '房门', '石碑', '墓碑', '石像', '雕像', '喷泉', '水晶', '宝珠', '传送门', '传送点', '传送阵', '公告牌', '告示牌', '招牌', '牌子', '机关', '开关', '出口', '入口', '楼梯', '电梯', '地图', '记录点', '存档点', '保存点', '水井', '井', '树', '花', '火', '画', '墙壁', '地板', '屋顶', '水桶', '水缸', '罐子', '罐', '瓶子', '篮子', '台子', '座位', '坐垫', '地毯', '指示牌', '路牌', '门牌', '纸', '紙', '绷带', '包帯', '回忆', '回想'];
/* 中日文：动作前缀 —— **直接判标签**（`调查花` / `必经提示` / `解锁书架 梦`）。
 * 剥掉动作前缀剩下的（"花" / "提示" / "书架梦"）不可能是名字，所以不做剥离。 */
var CJK_TAG_PREFIX = ['调查', '检查', '查看', '必经', '提示', '解锁', '确认', '选择', '触摸', '推开', '打开', '关闭', '操作', /* 【v2.9.16】日文同义前缀（`解説キイロハギ` / `プロローグ3へ`）。 */
'解説', '説明', '案内', '注意', '警告', 'ヒント', 'チュートリアル', 'プロローグ'];
/* 中日文：剧情前缀 —— **可剥离**（`主线 斯卡雷特` → `斯卡雷特`）；
 * 剥离后若剩的是物件词 / 通用词 / 动作词，才判标签。 */
var CJK_STORY_PREFIX = ['主线', '支线', '分支', '剧情', '事件', '场景', '任务', '开场', '序章', '结局', '隐藏', '可选'];
/* 中日文：剥掉剧情前缀后，剩余若是这些「通用 / 动作词」也算标签（`主线 出门` → `出门`）。 */
var CJK_STOP = ['任意', '物资', '所有', '全部', '周围', '附近', '说明', '介绍', '确认', '检查', '查看', '出门', '邀请', '写作', '睡觉', '起床', '战斗', '出发', '返回', '开始', '结束', '前进', '后退', '等待', '移动', '离开', '进入', '使用', '出现', '消失', '回忆', '独白', '思考', '说话', '继续', '休息', '洗澡', '吃饭', '喝水', '开门', '关门'];
/* 中日文：强后缀 —— 以它结尾即为标签（`猛犸传送门` / `圣堂水晶`）。 */
var CJK_SUFFIX = ['传送门', '传送点', '传送阵', '公告牌', '告示牌', '宝箱', '书架', '书柜', '书桌', '石像', '雕像', '水晶', '机关', '开关', '墓碑', '石碑', '喷泉', '记录点', '存档点', '之门', '指示牌', '路牌', '门牌'];
/* 【v2.9.16】日文：物件 / 场景名词 —— 整名命中，或作为**后缀**出现即为标签。
 * 实测（《水族馆不会跳舞》）：`ドア` / `自動ドア` / `チケット` / `エレベーター1` /
 * `レトロ階段` / `デメキン板` / `診察室` / `病院前駅` / `2号車` 全被当成角色名摆进菜单。 */
var JA_LABEL = ['ドア', '扉', 'ゲート', 'チケット', 'エレベーター', 'エスカレーター', '階段', 'はしご', '看板', 'ポスター', '受付', '券売機', 'ベンチ', '机', '椅子', 'ベッド', '棚', '鏡', '像', '噴水', '井戸', '水槽', '箱', '宝箱', '紙', 'メモ', '日記', '手紙', '鍵', 'カギ', '地図', '記録', 'セーブ', '広場', '公園', '教会', '城', '店', '館', '室', '駅', '号車', '地下', '通路', '廊下', 'カフェ', '病院', '学校', '屋上', '入口', '出口', '包帯', /* 注：单字后缀里**不要**放 `板` —— 中文「旅店老板」「木板」会被误判成标签。 */
'説明', '解説', '案内', '注意', '警告', 'ヒント', 'チュートリアル', '回想', 'イベント', '制限'];
/* 【v2.9.16】日文：动作后缀 —— **可剥离**（`キティ話す`→`キティ` / `レトロに会う`→`レトロ` /
 * `デメキン歩き回り`→`デメキン`）。剥完剩下的若是标签，整名弃用。 */
var CJK_ACTION_SUFFIX = ['話しかける', '歩きまわる', 'と話す', 'に会う', 'と会う', '聞き込み', '歩き回り', '歩き回る', '立ち去る', '話す', '会う', '気絶', '調査', '移動', '登場', '退場', '消える', '現れる', '逃げる', '待つ', '見る', '行く', '来る', '帰る'];
CJK_ACTION_SUFFIX.sort(function (a, b) {
  return b.length - a.length;
});
/* 【v2.9.16】日文/中文：描述句结尾（状态词）—— 命中即标签（`優雅に泳いでいる`）。 */
var CJK_DESC_TAIL = ['聞こえる', '見える', '感じる', 'ください', 'でしょう', 'らしい', 'みたい', 'いる', 'ある', 'たく', 'そう', 'よう', 'こと', 'もの', 'ため', 'ない'];
/* 【v2.9.16】日文/中文：助词 —— 结尾或**出现在中间**都是句子而非名字
 * （`怪しい雰囲気の` / `背筋が冷たく` / `クラゲが優雅に`）。 */
var CJK_PARTICLE = ['から', 'まで', 'より', 'が', 'を', 'は', 'も', 'へ', 'と', 'や', 'の', 'に', 'で'];
CJK_PARTICLE.sort(function (a, b) {
  return b.length - a.length;
});
/* 事件名的机器前缀：`EV020:トト` / `21:クラゲ調査` / `5＿クラゲ` / `EV049_優雅に泳いでいる` /
 * 【v2.9.18】`EV027/door_01B` / `EV083/Dash01`（作者用**目录**组织事件，斜杠当前缀分隔符）。
 * 只脱「编号 + 分隔符」，脱完为空就原样返回（别把 `EV001` 这种纯占位也吞了）。
 * ★ 与插件 `Ainpc.stripEventPrefix` 同口径，改一边要改另一边。 */
function stripEventPrefix(s) {
  var v = String(s == null ? '' : s).replace(/\s+/g, '');
  var out = v.replace(/^(?:EV|ev)?[0-9０-９]+[:：_＿.．、\-\/\\|／＼｜]+/, '');
  return out || v;
}
/* ======================================================== 【v2.9.18】通用「形状闸门」
 * 从 13 台真实游戏的世界书里挖出来的四种「长得就不是名字」的形态，**全部语言无关**：
 *   ① 机器路径：`EV027/door_01B` / `EV083/Dash01` —— 编号 + 斜杠 + 纯 ASCII 段；
 *   ② 注解包裹：`（上层）` —— 作者把「楼层」写进 Actor 表当说话人横幅，整串被括号套住；
 *   ③ 中英混排标签：`大保BOSS` / `随机BOSS战斗` —— CJK 里嵌 BOSS / NPC 这类系统词；
 *   ④ 占位编号：`居民N` —— CJK 紧挨一个孤立拉丁字母收尾。
 * 挂点：`isLabelName` 开头（于是 `cleanEventName` / `isBadNpcName` / `displayName` 全部受益）
 *   ＋ `looksLikeName`（说话人名字走的是那条路，`（上层）` / `居民N` 正是从那儿漏进来的）。
 * ★ 与插件 `Ainpc.isPlaceholderShape` 同口径，改一边要改另一边。 */
var SYS_LATIN_IN_CJK = ('boss npc enemy monster mob dummy ' + 'spawner template cutscene event test item map quest battle door gate chest key').split(' ');
var SYS_LATIN_SET = {};
SYS_LATIN_IN_CJK.forEach(function (w) {
  SYS_LATIN_SET[w] = 1;
});
function isPlaceholderShape(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return false;
  /* ① 机器路径：编号 + 路径分隔符 + **纯 ASCII** 段。刻意要求"纯 ASCII"——
   *    `EV023/旅人ノア` 这种斜杠后面是真名的，剥掉前缀即可，不能误杀。 */
  var mp = /^(?:EV|ev)?[0-9０-９]+[\/\\|／＼｜]([\x20-\x7E]+)$/.exec(s);
  if (mp) return true;
  /* ② 整串被一对括号套住 → 注解（`（上层）` / `[食堂]` / `【主线】`）。
   *    只认半角/全角圆括号与方括号 —— `「」『』` 在有些游戏里是"对话引号"，不放。 */
  if (/^[（(【\[｛{][^（()）【】\[\]｛｝{}]{1,20}[）)】\]｝}]$/.test(s)) return true;
  /* ③ CJK 串里嵌拉丁系统词（`大保BOSS` / `随机BOSS战斗`）。
   *    纯英文名**不走这条** —— 那是 isLabelName 的英文词表管的，
   *    两档词表的分工不能混（`Crystal` 要放行、`Blacksmithing Crystal` 才算标签）。 */
  if (!/^[\x20-\x7E]+$/.test(s)) {
    var ws = s.match(/[A-Za-z]{2,}/g);
    if (ws) {
      for (var _i10 = 0; _i10 < ws.length; _i10++) {
        var w = ws[_i10];
        if (SYS_LATIN_SET[w.toLowerCase()]) return true;
      }
    }
  }
  /* ③ CJK 串里嵌拉丁系统词（`大保BOSS` / `随机BOSS战斗`）。
   *    纯英文名**不走这条** —— 那是 isLabelName 的英文词表管的，
   *    两档词表的分工不能混（`Crystal` 要放行、`Blacksmithing Crystal` 才算标签）。 */
  if (!/^[\x20-\x7E]+$/.test(s)) {
    var _ws = s.match(/[A-Za-z]{2,}/g);
    if (_ws) {
      for (var _i12 = 0; _i12 < _ws.length; _i12++) {
        var _w = _ws[_i12];
        if (SYS_LATIN_SET[_w.toLowerCase()]) return true;
      }
    }
  }
  /* ④ 【已删除，别再捡回来】曾想拦「CJK + 尾随单个拉丁字母」（`居民N` / `武术家E`）。
   *    A/B 实测证明**拦了更糟**：这些名字来自说话人表，拒掉之后名字会退到
   *    `area01_NPC00B` 这种原始素材名 —— 比 `居民A` 难读得多，还丢掉了 A..N 的区分度。
   *    `居民A` 本身就是个可用的名字，不动它。 */
  return false;
}
/* 素材名形状：含下划线 **且** 含数字（`area05_NPC13` / `area01_NPC00B` / `EV_007`）。
 * ★ 必须在**剥掉机器前缀之后**才判 —— 这是 A/B 第三次对拍才发现的坑：
 *   《水族馆不会跳舞》里的角色**就叫** `海月水母` / `クラゲ` / `ベタ`，事件名是
 *   `12_海月水母`（**编号 + 下划线**），剥掉 `12_` 之后 `海月水母` 是真名。
 *   拿原始串判会把整馆的水母全变成"居民"。剥完还是原样（`area05_NPC13`）才是素材名。 */
function isAssetShape(s) {
  return /_/.test(s) && /[0-9０-９]/.test(s);
}
function isLabelName(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return false;
  if (isPlaceholderShape(s)) return true;
  /* 【v2.9.18】先脱机器前缀再判 —— 于是 `EV027/door_01B` → `door_01B` → 命中 `door` 标签词。
   *  ⚠ **不能**直接用 `stripEventPrefix`：它会吃掉**所有空白**（`Stay Out Sign 2` → `StayOutSign2`
   *    → 切词变 `sign2` → 词表失配 → 该拦的标签没拦住，A/B 实测把 mz-smith 两条从
   *    `居民` 改回了 `Stay Out Sign 2`）。这里只脱**前缀那一段**，其余原样保留。 */
  var t = s.replace(/^(?:EV|ev)?[0-9０-９]+[:：_＿.．、\-\/\\|／＼｜]+/, '') || s;
  if (isAssetShape(t)) return true; // `area05_NPC13`（剥完还是原样）
  /* 【v2.9.15】中日文（含全角）走词表判据 —— 英文那套"纯 ASCII 闸门"在中文事件名上等于没闸。 */
  if (!/^[\x20-\x7E]+$/.test(t)) return isCjkLabelName(t);
  var ws = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ').split(/\s+/).filter(function (w) {
    return !!w;
  });
  if (!ws.length) return false;
  var multi = ws.length >= 2; // 整串是否多于一个词
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i].toLowerCase();
    if (LABEL_WORD_SET[w]) return true;
    if (multi && LABEL_WEAK_SET[w]) return true;
  }
  return false;
}
/* 中日文「词表命中」这一层（拆出来便于递归：剥掉动作后缀后还要再判一次）。 */
function isCjkLabelCore(core) {
  if (!core) return false;
  if (CJK_LABEL.indexOf(core) >= 0) return true;
  if (JA_LABEL.indexOf(core) >= 0) return true;
  if (CJK_STORY_PREFIX.indexOf(core) >= 0) return true; // `开场` / `序章` / `事件` 本身即标签
  /* 动作前缀：直接判标签，不剥离。 */
  for (var _i14 = 0; _i14 < CJK_TAG_PREFIX.length; _i14++) {
    var pre = CJK_TAG_PREFIX[_i14];
    if (core.indexOf(pre) === 0) return true;
  }
  /* 剧情前缀：剥离后看剩余。 */
  for (var _i16 = 0; _i16 < CJK_STORY_PREFIX.length; _i16++) {
    var _pre = CJK_STORY_PREFIX[_i16];
    if (core.length > _pre.length && core.slice(0, _pre.length) === _pre) {
      var rest = core.slice(_pre.length);
      if (!rest || CJK_LABEL.indexOf(rest) >= 0 || CJK_STOP.indexOf(rest) >= 0) return true;
      /* 剩余里只要含任何物件词（含单字：`坐床` 含 `床`）就算标签。 */
      for (var _i18 = 0; _i18 < CJK_LABEL.length; _i18++) {
        var w = CJK_LABEL[_i18];
        if (rest.indexOf(w) >= 0) return true;
      }
      break;
    }
  }
  for (var _i20 = 0; _i20 < CJK_SUFFIX.length; _i20++) {
    var suf = CJK_SUFFIX[_i20];
    if (core.length > suf.length && core.slice(-suf.length) === suf) return true;
  }
  /* 日文物件/场景后缀（`自動ドア` / `診察室` / `病院前駅` / `2号車` / `レトロ階段` / `デメキン板`）。 */
  for (var _i22 = 0; _i22 < JA_LABEL.length; _i22++) {
    var _w2 = JA_LABEL[_i22];
    if (core.length > _w2.length && core.slice(-_w2.length) === _w2) return true;
  }
  return false;
}
/* 中日文事件名是不是「场景标签」。
 * 【v2.9.16】加了一整块「通用启发式」，**不依赖任何词表**：中日文的人名不会含空白/标点、
 * 不会长过 10 字、不会以助词或状态词收尾。于是对任何语言的 MV/MZ 游戏都成立 ——
 * 这是「换一款游戏就要再补一遍词表」的止血点。 */
function isCjkLabelName(s) {
  var raw = String(s == null ? '' : s).trim();
  if (!raw) return false;
  /* 【v2.9.18】形状闸门（注解包裹 / 中英混排标签 / 占位编号 / 机器路径）。 */
  if (isPlaceholderShape(raw)) return true;
  /* 剧情前缀先脱（`主线 斯卡雷特` 的那个空格不算异常）—— 只为判断「有没有空白」。 */
  var body = raw;
  for (var _i24 = 0; _i24 < CJK_STORY_PREFIX.length; _i24++) {
    var pfx = CJK_STORY_PREFIX[_i24];
    if (body.length > pfx.length && body.indexOf(pfx) === 0) {
      body = body.slice(pfx.length).replace(/^\s+/, '');
      break;
    }
  }
  if (!body) return false;
  if (/\s/.test(body)) return true; // `水族館6　巨大水槽`
  var core = stripEventPrefix(body.replace(/\s+/g, ''));
  if (!core) return false;
  if (isAssetShape(core)) return true; // 剥完还是素材名形状才算
  /* 标点 / 省略号 / 括号 → 描述句或标注（`从上面的某种东西让人恶寒啊...`）。 */
  if (/[.．。！？!?…、，,；;：:「」『』【】（）()\[\]{}]/.test(core)) return true;
  if (core.length > 10) return true; // 人名没有这么长
  /* 描述句结尾：状态词（`優雅に泳いでいる`）。 */
  for (var _i26 = 0; _i26 < CJK_DESC_TAIL.length; _i26++) {
    var t = CJK_DESC_TAIL[_i26];
    if (core.length > t.length && core.slice(-t.length) === t) return true;
  }
  /* 助词：结尾或出现在中间（`怪しい雰囲気の` / `背筋が冷たく` / `クラゲが優雅に`）。 */
  for (var _i28 = 0; _i28 < CJK_PARTICLE.length; _i28++) {
    var p = CJK_PARTICLE[_i28];
    if (core.length > p.length && core.slice(-p.length) === p) return true;
    var at = core.indexOf(p);
    if (at > 0 && at + p.length < core.length) return true;
  }
  /* 片假名 + 方位/单字物件（`ヤドカリ下` / `デメキン板`）是站位或招牌；
   * `田中` / `山下` / `旅店老板` 这类汉字词不受影响。 */
  if (/^[\u30A0-\u30FF]+[上下左右内外前後板]$/.test(core)) return true;
  /* 词表层：拿「含剧情前缀的整串」判，才能命中 `主线出门` / `分支宝箱` 那套剥离逻辑。 */
  var all = raw.replace(/\s+/g, '');
  all = stripEventPrefix(all) || all;
  if (isCjkLabelCore(all)) return true;
  /* 尾部个体编号先脱掉再判（`エレベーター1` → `エレベーター`）。 */
  var noNum = all.replace(/[0-9０-９]+$/, '');
  if (noNum !== all && noNum.length >= 2 && isCjkLabelCore(noNum)) return true;
  return false;
}
/** 事件名 → 可当人名的字符串。返回 '' 表示「这是标签，别用」。
 *  英文标签 / 中日文标签 → ''；带机器前缀 / 动作后缀 / 剧情前缀的 → 剥掉后保留角色名。 */
function cleanEventName(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^[\x20-\x7E]+$/.test(s)) return isLabelName(s) ? '' : s;
  var core = stripEventPrefix(s.replace(/\s+/g, ''));
  if (!core) return '';
  /* ① 动作后缀剥离（`レトロに会う` → `レトロ` / `キティ話す` → `キティ`）。
   *    **先于判标签** —— 助词判据（`に` 出现在中间）会把整名吞掉，白丢真名。 */
  for (var _i30 = 0; _i30 < CJK_ACTION_SUFFIX.length; _i30++) {
    var suf = CJK_ACTION_SUFFIX[_i30];
    if (core.length > suf.length && core.slice(-suf.length) === suf) {
      var rest = core.slice(0, -suf.length).replace(/[0-9０-９]+$/, '');
      if (rest.length >= 2) return isCjkLabelName(rest) ? '' : rest;
      break;
    }
  }
  /* ② 整名判标签（标签 / 描述句 / 含空白 → 弃用）。 */
  if (isCjkLabelName(s)) return '';
  /* ③ 尾部个体编号（`ピラニア3` → `ピラニア` / `レトロ２` → `レトロ`）。 */
  var noNum = core.replace(/[0-9０-９]+$/, '');
  if (noNum !== core && noNum.length >= 2) return isCjkLabelName(noNum) ? '' : noNum;
  /* ④ 剧情前缀剥离（`主线 斯卡雷特` → `斯卡雷特`）。
   *    【v2.9.18】剥完只剩**一个字**的一律弃用 —— `主线 粉` → `粉`（实测《偕老同穴》
   *    把"粉"当角色名摆进了菜单）。单字真名（`龙` / `猫` / `吴`）走不到这里，不受影响。 */
  for (var _i32 = 0; _i32 < CJK_STORY_PREFIX.length; _i32++) {
    var pre = CJK_STORY_PREFIX[_i32];
    if (core.length > pre.length && core.slice(0, pre.length) === pre) {
      var _rest = core.slice(pre.length);
      if (_rest.length < 2) return '';
      return isCjkLabelName(_rest) ? '' : _rest;
    }
  }
  /* 【v2.9.18】兜底：纯数字 / 纯符号的"名字"不是名字（`１` / `01` / `---`）。 */
  if (/^[0-9０-９]+$/.test(core)) return '';
  if (/^#/.test(core)) return ''; // `actorName` 的兜底值 `#145`
  if (/^[^\w\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+$/.test(core)) return '';
  return core;
}
var mapInfos = load('MapInfos') || {};
var system = load('System') || {};
var commonEvents = load('CommonEvents') || [];
var actorsDb = load('Actors') || [];
var itemsDb = load('Items') || [];
var weaponsDb = load('Weapons') || [];
var armorsDb = load('Armors') || [];
var byCe = {};
commonEvents.forEach(function (e) {
  if (e && e.id != null) byCe[e.id] = e;
});
var varNames = system.variables || [];
var swNames = system.switches || [];
var currencyUnit = system.currencyUnit || 'G';
var actorName = function actorName(id) {
  return actorsDb[id] && actorsDb[id].name || '#' + id;
};
var itemName = function itemName(t, id) {
  var db = t === 0 ? itemsDb : t === 1 ? weaponsDb : armorsDb;
  var it = db && db[id];
  return it && it.name || '#' + id;
};

/* ====================================================== 地图名的「显示版」（v2.10.0）
 * 【问题】MV 1.5.0 起，每张地图在 `<www>/data/MapXXX.json` 里多了个 `displayName` 字段，
 *   而**游戏内显示地图名用的就是它**（`Game_Map.prototype.displayName` → `$dataMap.displayName`）。
 *   `MapInfos.json` 里的 `name` 是**编辑器地图树**的名字 —— 两处可以完全不同。
 *   汉化 / 官方中文化的游戏往往只改前者：实测《米拉与奇妙的炼金术》42 张地图不一致 ——
 *   MapInfos 还是日文（`009：一階：玄関`），displayName 已是中文（`米拉的家·玄关`）。
 *   旧版只读 MapInfos，于是玩家在世界书 / AI 扮演菜单里看到一地日文地名。
 * 【判据】displayName 非空就用它，空则回退 MapInfos —— 老版本游戏（<1.5.0）没有这个字段，
 *   逐字节与旧版一致，零回归。父级面包屑同样逐级取，于是 `アウイル › … › ミラの部屋`
 *   整体变成中文。
 * 【反过来也要看】两处名字**互为前缀**时说明它们是"同一个地方、一个更具体"
 *   （《呆呆》34 张全是这种：`写字楼男厕所（2F）` vs `写字楼男厕所`、
 *   `拉芙妮雅的牢笼1（繁盛）` vs `拉芙妮雅的牢笼`）—— 这时 displayName 反而是
 *   **去掉了变体后缀**的那个，三个牢笼会缩成同一个名字。我们的用途是"告诉玩家和
 *   模型他在哪"，包含关系下取更全的那个永远不亏。**没有**包含关系时才说明两处
 *   各写各的（Mira：`009：一階：玄関` vs `米拉的家·玄关`），那才是"汉化组翻过的那份"。
 * 【成本】只在 mapInfos 列出的地图上读一次（《米拉》63 个文件 ≈ 40 ms）。 */
var mapDisplay = function () {
  var out = {};
  var names = [];
  try {
    names = fs.readdirSync(DATA);
  } catch (e) {
    return out;
  }
  for (var _i34 = 0, _names2 = names; _i34 < _names2.length; _i34++) {
    var f = _names2[_i34];
    var m = /^Map(\d+)\.json$/.exec(f);
    if (!m) continue;
    var id = +m[1];
    var j = load(f.slice(0, -5));
    var dn = j && typeof j.displayName === 'string' ? j.displayName.trim() : '';
    if (!dn) continue;
    var mi = mapInfos[String(id)];
    var miName = mi && mi.name ? String(mi.name).trim() : '';
    /* 【v2.10.0】互为前缀 → 取更长（信息更全）的那个；否则用 displayName。 */
    out[id] = miName && miName !== dn && (miName.indexOf(dn) === 0 || dn.indexOf(miName) === 0) ? miName.length > dn.length ? miName : dn : dn;
  }
  return out;
}();
// 地图名（多层 parent 合成短名：只取最后两级）
var mapPath = {},
  mapShort = {};
for (var _i36 = 0, _Object$keys2 = Object.keys(mapInfos); _i36 < _Object$keys2.length; _i36++) {
  var k = _Object$keys2[_i36];
  var mi = mapInfos[k];
  if (!mi || !mi.id) continue;
  var chain = [];
  var cur = mi,
    g = 0;
  while (cur && g++ < 10) {
    var nm = mapDisplay[cur.id] || (cur.name ? String(cur.name).trim() : '');
    if (nm) chain.unshift(nm);
    cur = cur.parentId ? mapInfos[String(cur.parentId)] : null;
  }
  mapPath[mi.id] = chain.join(' / ');
  mapShort[mi.id] = chain.slice(-1)[0] || 'Map' + mi.id;
} // ============================================================ 文本工具
function stripEscape(s) {
  return String(s == null ? '' : s).replace(/\\N\[(\d+)\]/g, function (m, id) {
    return actorName(+id);
  }) // 角色名
  .replace(/\\V\[(\d+)\]/g, function (m, id) {
    return '〈' + (varNames[+id] || '变量' + id) + '〉';
  }).replace(/\\G/g, currencyUnit) // 货币单位（原版 \G）
  .replace(/\\C\[\d+\]/g, '').replace(/\\([><\|\.\!\^\$\{\}\\]|af\[[^\]]*\]|px\[\d+\]|fs\[\d+\]|ii\[\d+\]|n\[[^\]]*\])/g, '')
  /* 【v2.9.17】本地化占位符**没还原成功**的残余：留着也是垃圾，抹掉。
   * 仅在有语言表（L10N.available）时才动 —— 没有语言表的游戏里 `${` 属玩家原文，
   * 一个字都不许改（零回归红线）。 */.replace(L10N.available ? /\$\{[\w|.]+\}/g : /(?!)/g, '').replace(/\s+$/, '').trim();
}
function speakersIn(text) {
  var out = [];
  var re = /\\N\[(\d+)\]/g;
  var m;
  while (m = re.exec(String(text))) out.push(+m[1]);
  return out;
}
/** 「这一行是说话人的名字行吗？」（v2.10.0）
 * 【为什么需要】MV 的 `code 101`（显示文字）只有 4 个参数
 *   `[faceName, faceIndex, background, position]`；第 5 个 speakerName 是 **MV 1.6 起**才有的
 *   可选参数。绝大多数工程没有它，于是作者改用「101 之后紧跟一条只写名字的 401」当说话人横幅：
 *       `101 ["Monster",5,0,2]` → `401 ["白骨："]` → `401 ["是你..."]`
 *   实测《呆呆大冒险》：8838 条 101 里 **3668 条**后面跟着这种行。
 *   旧版把 `白骨：` 当成了台词（于是世界书里出现 `"马："` 这种"台词"），
 *   而真正的名字反而没人认 —— 菜单里 317 个 NPC 一起显示成「居民」。
 * 【判据】整行就是「短名 + 冒号」：冒号前 1~12 个字符、不含引号/括号/反斜杠/换行，
 *   冒号后**只有空白**。于是 `奖励：全体法攻+5。`（冒号后有内容）不算、
 *   `是否在此休息？`（没冒号）也不算。 */
function speakerNameLine(text) {
  var s = String(text == null ? '' : text).trim();
  var m = /^([^：:\[\]【】「」『』\n\\]{1,12})[：:]\s*$/.exec(s);
  return m ? m[1].trim() : '';
}
/** 一段剧情里可能多人轮流说话（`老人：` 之后又冒出一个 `坤坤：`）。
 *  取出现最多的那个名字 —— 事件的主人翁总是话最多的。并列时取最先出现的
 *  （Object.entries 保持插入顺序），与 `scenarioSpeakerName` 的「取第一个」同精神。 */
function topNameLine(list) {
  var cnt = {};
  (list || []).forEach(function (n) {
    if (n) cnt[n] = (cnt[n] || 0) + 1;
  });
  var top = Object.entries(cnt).sort(function (a, b) {
    return b[1] - a[1];
  })[0];
  return top ? top[0] : '';
}
function brev(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ============================================================ 静态解释器
/**
 * 常量传播执行：按缩进跳过"确定为假"的分支体，收集真正可能显示的文字。
 * env = { vars: {id:value}, switches:{}, textId:..., eventNo:... }
 */
function evaluate(list, env, sink, budget, depth) {
  if (!Array.isArray(list) || budget.n <= 0) return;
  var baseVars = Object.assign({}, env.vars);
  var i = 0;
  var _loop4 = function _loop4() {
    var _sink$choices;
    budget.n--;
    var cmd = list[i];
    var p = cmd.parameters || [];
    /* 【v2.10.0】`nameLineNext` 只对**紧邻的下一条指令**有效：上一轮 101 设的标记，
     * 本轮先取出来、再清掉，于是「101 → 别的指令 → 401」不会误判。 */
    var wasNameNext = sink.nameLineNext;
    sink.nameLineNext = false;
    switch (cmd.code) {
      case 0:
        break;
      case 122:
        {
          // 控制变量
          var _ref = [p[0] | 0, p[1] | 0, p[2] | 0, p[3], p[4]],
            from = _ref[0],
            to = _ref[1],
            op = _ref[2],
            otype = _ref[3],
            oval = _ref[4];
          for (var v = from; v <= to && v - from < 200; v++) {
            if (op === 0 && otype === 0) env.vars[v] = oval; // 赋值常量
            else if (op === 0 && otype === 1) env.vars[v] = env.vars[p[4]]; // 赋值变量
            else delete env.vars[v]; // 其他运算 -> 未知
          }
          break;
        }
      case 111:
        {
          // 条件分支
          var r = evalCond(p, env);
          if (r === false) {
            i = skipFalseBranch(list, i);
            return 1; // continue
          }
          // true / unknown -> 继续执行分支体
          break;
        }
      case 411:
      case 412:
        break;
      // 分支标记本身无操作

      case 115:
        i = list.length;
        break;
      // 中断循环

      case 101:
        // 显示文字
        sink.pendingFace = {
          name: String(p[0] || ''),
          index: p[1] | 0
        };
        /* 【v2.10.0】标记「下一条 401 可能是名字行」（见 speakerNameLine）。 */
        sink.nameLineNext = true;
        break;
      case 401:
        {
          // 文字数据
          var raw = String(p[0] == null ? '' : p[0]);
          /* 【v2.10.0】名字行必须**挂着立绘**：`101 ["Monster",5,0,2]` → `401 ["白骨："]`。
           * 加了这一步才敢认 —— 旁白 / 物件的 101 是 `["",0,0,2]`（faceName 空），
           * 它们的正文里随便一句「打印出来了：」「里面有一张纸条：」就会被当成名字
           * （实测《Level C-1366 Demo》就是这么误判的）。 */
          if (wasNameNext && sink.pendingFace && sink.pendingFace.name) {
            var _nm = speakerNameLine(raw);
            /* 是名字行：收作说话人名，**且不当台词**（它本来就不是给玩家读的正文）。
             * 一段剧情可能多人对话（`老人：` 之后又出现 `坤坤：`），所以攒一个列表，
             * 最后由 topNameLine() 取出现最多的那个 —— 事件的主人翁总是话最多的。 */
            if (_nm) {
              sink.nameLines.push(_nm);
              break;
            }
          }
          var sp = speakersIn(raw);
          sink.blocks.push({
            text: stripEscape(raw),
            raw: raw,
            speakerId: sp.length ? sp[0] : null,
            speaker: sp.length ? actorName(sp[0]) : sink.pendingFace && sink.pendingFace.name ? sink.pendingFace.name : null,
            face: sink.pendingFace ? sink.pendingFace.name : '',
            faceIndex: sink.pendingFace ? sink.pendingFace.index : 0,
            textId: env.vars[TEXT_VAR] != null ? env.vars[TEXT_VAR] : null,
            eventNo: env.vars[NO_VAR] != null ? env.vars[NO_VAR] : null
          });
          break;
        }
      case 102:
        (_sink$choices = sink.choices).push.apply(_sink$choices, (p[0] || []).map(String));
        break;
      case 108:
      case 408:
        sink.comments.push(brev(String(p[0] || ''), 60));
        break;
      case 201:
        sink.transfers++;
        break;
      // 场所移动（门 / 传送点）
      case 301:
        sink.battles++;
        break;
      case 355:
      case 655:
        sink.scripts++;
        break;
      case 302:
        {
          // 商店
          /* 【v2.9.4】只有**事件页自己**（depth 0）里的 302 才算"这个人的商店"。
           * depth>0 说明这条 302 是钻进公共事件之后才撞见的 —— 那是公共事件的分支，
           * 属于「那条公共事件是不是商店」，由 ceShopVerdict 统一判定。
           * 以前不分层，于是 ◆MobBranch 里那条埋在「玩家选了『买东西』」里的 302
           * 被当成"每个 mob 自己的商店"，121 个路人一起变成商人。 */
          if (depth > 0) break;
          var goods = [[p[0] | 0, p[1] | 0, p[2] | 0, p[3] | 0]];
          for (var j = i + 1; j < list.length; j++) {
            if (list[j].code !== 605) break;
            budget.n--;
            var q = list[j].parameters || [];
            goods.push([q[0] | 0, q[1] | 0, q[2] | 0, q[3] | 0]);
          }
          sink.shops.push({
            via: 'direct',
            strength: 'strong',
            purchaseOnly: !!p[4],
            goods: goods.map(function (g) {
              return {
                type: g[0],
                id: g[1],
                name: itemName(g[0], g[1]),
                price: g[3] || null
              };
            })
          });
          break;
        }
      case 117:
        {
          // 调用公共事件
          var cid = p[0] | 0;
          var ce = byCe[cid];
          sink.ceChain.push(cid);
          // 记录"这个公共事件能开出商店"以及强度，供角色类型推断用
          var _cv = ceShopVerdict(cid);
          if (_cv && !sink.shops.some(function (s) {
            return s.via === 'commonEvent' && s.commonEvent === cid;
          })) {
            sink.shops.push({
              via: 'commonEvent',
              commonEvent: cid,
              ceName: ce && ce.name || '',
              strength: _cv
            });
          }
          if (ce && depth < 6 && !budget.seen[cid + '@' + depth]) {
            budget.seen[cid + '@' + depth] = 1;
            evaluate(ce.list, env, sink, budget, depth + 1);
          }
          break;
        }
    }
    i++;
  };
  while (i < list.length && budget.n > 0) {
    if (_loop4()) continue;
  }
  Object.assign(env.vars, baseVars); // 还原（保守）
}

/** 跳到"条件为假"时应执行的位置：有 else 就进 else，否则跳到 end 之后 */
function skipFalseBranch(list, i) {
  var indent = list[i].indent || 0;
  for (var j = i + 1; j < list.length; j++) {
    var c = list[j];
    if (c.indent < indent) break;
    if (c.indent === indent && c.code === 411) return j + 1; // else 分支
    if (c.indent === indent && c.code === 412) return j + 1; // end
  }
  return list.length;
}

/** 本作引擎实测格式：[类型, 变量ID, 操作数种类, 操作数, 比较符] */
function evalCond(p, env) {
  var type = p[0];
  if (type === 0) {
    // 开关
    var known = env.switches[p[1]];
    if (known === undefined) return ARGS.unknownCond ? null : p[2] === 1; // 默认未开启
    return known === (p[2] === 0);
  }
  if (type === 1) {
    // 变量
    var v1 = env.vars[p[1]];
    if (v1 === undefined) return null;
    var v2 = p[2] === 0 ? p[3] : env.vars[p[3]];
    if (v2 === undefined) return null;
    switch (p[4]) {
      case 0:
        return v1 === v2;
      case 1:
        return v1 >= v2;
      case 2:
        return v1 <= v2;
      case 3:
        return v1 > v2;
      case 4:
        return v1 < v2;
      case 5:
        return v1 !== v2;
    }
    return null;
  }
  return null; // 其他条件类型不去猜
}

// 本作约定：变量2 = Event_Text（文本ID）, 变量3 = Event_No（NPC编号）
var TEXT_VAR = 2;
var NO_VAR = 3;

/* 哪些公共事件"本质上是商店"（含间接调用）—— 用于给"薄触发器"事件定身份。
 *
 * 【v2.9.4 · 为什么不再"见到 302 就算商店"】
 *   旧实现是**平铺扫描**：只要一个公共事件里任何位置出现一条 302（商店指令），
 *   整条公共事件就被判成商店 —— 完全无视条件分支。实测 Mira 的 ◆MobBranch：
 *   609 条指令的"通用路人调度器"里只有 3 条 302，还埋在「玩家在菜单里选了
 *   『买东西』」那一支里（缩进 3 层）—— 结果**全游戏 121 个 mob 事件全被标成
 *   「商人」**，连校门口的学生都是商人：身份、标签、脾气、菜单全错。
 *
 *   现在的判据是「**商店纯度**」：
 *       商店指令（302 及其后紧跟的 605 商品行） ÷ 实质指令（剔除注释/空指令/分支标记）
 *   纯度 >= SHOP_PURITY 才认定"它就是一间商店"：
 *     · Eliza 的 Common_SHOP_Weapon = 20/20 = 100%   → 商店 ✓
 *     · Mira 的 ◆MobBranch          = 14/232 = 6.0% → 不是商店 ✗
 *   纯度不足、但**确实能开出商店**的另记一个弱标记 shop_menu（可交易），
 *   货架信息照旧保留 —— 也就是"他不是商人，但货架上确实有东西"。
 *   好处：不动运行时的任何能力（货架、买/讲价/偷都还在），只把**名字叫对**。
 */
var SHOP_PURITY = 0.5;
var ceShopMemo = {};

/** 递归统计一条公共事件（含它调用的）里的商店指令数与实质指令数 */
function ceShopStats(id, seen) {
  seen = seen || {};
  var ce = byCe[id];
  if (!ce || seen[id]) return {
    shop: 0,
    body: 0
  };
  seen[id] = 1;
  var list = ce.list || [];
  var shop = 0,
    body = 0;
  for (var i = 0; i < list.length; i++) {
    var code = list[i].code;
    /* 结构性指令不算"实质内容"：空指令 / 注释 / 分支标记 / 跳转标签 */
    if (code === 0 || code === 108 || code === 408 || code === 111 || code === 411 || code === 412 || code === 118 || code === 119 || code === 121 || code === 122) continue;
    body++;
    if (code === 302 || code === 605) shop++;else if (code === 117 && list[i].parameters) {
      var sub = ceShopStats(list[i].parameters[0] | 0, seen);
      shop += sub.shop;
      body += sub.body;
    }
  }
  return {
    shop: shop,
    body: body
  };
}

/** false = 开不出商店 ／ 'weak' = 能开店但主体不是商店 ／ 'strong' = 本质是商店 */
function ceShopVerdict(id) {
  if (ceShopMemo[id] !== undefined) return ceShopMemo[id];
  var st = ceShopStats(id, {});
  var v;
  if (!st.shop) v = false;else v = st.shop / Math.max(1, st.body) >= SHOP_PURITY ? 'strong' : 'weak';
  return ceShopMemo[id] = v;
}

/** 兼容旧调用：只要"能开出商店"就算 true */
function ceHasShop(id) {
  return !!ceShopVerdict(id);
}

/* ============================================================ 事件标记 / 分支归属
 *
 * 【v2.9.5 · 有一类游戏把"事件的类型"写在注释里，而不是写在指令里】
 *   实测 Mira（插件 CU_EventObjectResposible001/002）的事件长这样：
 *       108 // ADD_OPTIONS
 *       408 // +type7
 *       408 // +actor17
 *       0   （结束）
 *   插件在运行时读这三行注释：+type7 → 事件对象 _convertID = 7，并把事件本体的指令
 *   **整体替换**成 [117:41]（一个叫 ◆MobBranch 的调度器公共事件）。于是：
 *     · 事件本体里既没有台词、也没有商店 —— 身份**只**存在于注释与 CE 的分支条件里；
 *     · CE41 内部用 `if (变量10「◆mobBranch」 == 7 / 8 / 33)` 分派，其中 7、8、33 才通商店。
 *   不解析这两处，就永远认不出"谁是商人、谁是学生、谁是魔女" ——
 *   v2.9.4 之所以把 Mira 的商人判成 0，正是因为只看了事件本体，而真商人
 *   （037:EV031/032 带 +type7、037:EV033/034 带 +type8）本体里一条指令都没有。
 *
 *   本节做两件事：
 *     ① readMarks()     —— 把 108/408 里的 +type / +actor / +item / +rect / +life / +walk / +enemy 解析出来；
 *     ② ceBranchShops() —— 把"调度器公共事件"里 `if (分派变量 == K)` 的每个 K 分支解析出来，
 *                          记下该分支里有没有商店、卖什么。事件带 +typeK 且 K 分支有商店 → 就是商人。
 *   判据是**结构**的（分支归属），不是"纯度"的猜测 —— 谁走哪条分支由 K 精确决定。
 */

/** 解析一个事件所有页的注释标记（108/408）。 */
function readMarks(ev) {
  var out = {
    addOptions: false,
    type: null,
    actor: null,
    item: null,
    life: null,
    walk: false,
    dash: false,
    enemy: null,
    rect: null,
    raw: []
  };
  (ev && ev.pages || []).forEach(function (pg) {
    (pg && pg.list || []).forEach(function (c) {
      if (c.code !== 108 && c.code !== 408) return;
      var s = String((c.parameters || [])[0] == null ? '' : (c.parameters || [])[0]).trim();
      if (!s) return;
      if (s === 'ADD_OPTIONS') {
        out.addOptions = true;
        out.raw.push(s);
        return;
      }
      if (s.charAt(0) !== '+') return;
      out.raw.push(s);
      var m = s.match(/^\+([a-zA-Z]+)[\s_]*([0-9A-Za-z_\-]*)/);
      if (!m) return;
      var key = m[1].toLowerCase(),
        val = m[2],
        num = parseInt(val, 10);
      switch (key) {
        case 'type':
          out.type = isNaN(num) ? 0 : num;
          break;
        case 'actor':
          out.actor = isNaN(num) ? null : num;
          break;
        case 'item':
          out.item = isNaN(num) ? null : num;
          break;
        case 'life':
          out.life = val;
          break;
        case 'enemy':
          out.enemy = isNaN(num) ? null : num;
          break;
        case 'rect':
          out.rect = val;
          break;
        case 'walk':
          out.walk = true;
          break;
        case 'dash':
          out.dash = true;
          break;
      }
    });
  });
  return out;
}

/** 容器指令 start 的"直属真分支"范围 [start+1, end)：遇到同级或更浅的缩进即停（411/412 天然截断） */
function branchBody(list, start) {
  var ind = list[start].indent || 0;
  var end = start + 1;
  while (end < list.length && (list[end].indent || 0) > ind) end++;
  return end;
}

/** 找调度器公共事件里的"分派变量"：被赋成脚本、且脚本里提到 _convertID / convertID / .note 的那个变量。
 *  这就是"事件的类型→这里的哪一支"的桥：变量 = 事件的 _convertID。 */
var ceBranchVarMemo = {};
function ceBranchVar(ceId) {
  if (ceBranchVarMemo[ceId] !== undefined) return ceBranchVarMemo[ceId];
  var ce = byCe[ceId];
  if (!ce || !ce.list) return ceBranchVarMemo[ceId] = null;
  for (var _i38 = 0, _ce$list2 = ce.list; _i38 < _ce$list2.length; _i38++) {
    var c = _ce$list2[_i38];
    if (c.code !== 122) continue;
    var p = c.parameters || [];
    if ((p[3] | 0) !== 4) continue; // operandType 4 = 脚本
    var scr = String(p[4] == null ? '' : p[4]);
    if (/_convertID|convertID|\.note\b/.test(scr)) return ceBranchVarMemo[ceId] = p[0] | 0;
  }
  return ceBranchVarMemo[ceId] = null;
}

/** 「分支值 K → 该分支里的商店/台词/调用」映射。仅当该 CE 确实是"按分派变量分派"时才有值。 */
var ceBranchMemo = {};
function ceBranchShops(ceId) {
  if (ceBranchMemo[ceId] !== undefined) return ceBranchMemo[ceId];
  var varId = ceBranchVar(ceId);
  if (varId == null) return ceBranchMemo[ceId] = null;
  var list = byCe[ceId] && byCe[ceId].list || [];
  var branches = {};
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c.code !== 111) continue;
    var p = c.parameters || [];
    if ((p[0] | 0) !== 1) continue; // 只认"变量"条件（本作格式：[1, 变量ID, 操作数种类, 操作数, 比较符]）
    if ((p[1] | 0) !== varId) continue;
    if ((p[2] | 0) !== 0) continue; // 只认"常量"比较
    if ((p[4] | 0) !== 0) continue; // 只认 "=="
    var K = p[3];
    if (K == null) continue;
    var end = branchBody(list, i);
    var rec = {
      goods: [],
      texts: [],
      calls: []
    };
    for (var j = i + 1; j < end; j++) {
      var q = list[j];
      var qp = q.parameters || [];
      if (q.code === 302) {
        rec.goods.push({
          type: qp[0] | 0,
          id: qp[1] | 0,
          name: itemName(qp[0] | 0, qp[1] | 0),
          price: qp[3] || null
        });
        for (var _k = j + 1; _k < end && list[_k].code === 605; _k++) {
          var a = list[_k].parameters || [];
          rec.goods.push({
            type: a[0] | 0,
            id: a[1] | 0,
            name: itemName(a[0] | 0, a[1] | 0),
            price: a[3] || null
          });
        }
      } else if (q.code === 401) {
        rec.texts.push(brev(stripEscape(qp[0]), 60));
      } else if (q.code === 117) {
        rec.calls.push(qp[0] | 0);
      }
    }
    branches[String(K)] = rec;
  }
  var out = Object.keys(branches).length ? {
    varId: varId,
    branches: branches
  } : null;
  return ceBranchMemo[ceId] = out;
}

/** 所有"按 _convertID 分派"的公共事件 —— 标记驱动事件（本体无指令）的身份来源。
 *  典型：Mira 的 ◆MobBranch（CE41）。没有这类 CE 的游戏（如 Eliza）此表为空，
 *  于是"分支归属"判定自动失效，一行都不会命中。 */
var BRANCH_CES = null;
function branchDispatchCEs() {
  if (BRANCH_CES) return BRANCH_CES;
  BRANCH_CES = [];
  Object.keys(byCe).forEach(function (k) {
    if (ceBranchVar(+k) != null) BRANCH_CES.push(+k);
  });
  return BRANCH_CES;
}

/** 分支归属判定：事件带 +typeK，且某个调度器公共事件里 `if (分派变量 == K)` 那一支含商店 → 商人。
 *  优先看事件自己调用的 CE；事件本体没指令时（插件在运行时替它调调度器），回退到全部调度器 CE。 */
function branchMerchant(marks, sink) {
  if (marks == null || marks.type == null) return null;
  var cands = sink && sink.ceChain && sink.ceChain.length ? sink.ceChain : branchDispatchCEs();
  for (var _i40 = 0; _i40 < cands.length; _i40++) {
    var cid = cands[_i40];
    var bm = ceBranchShops(cid);
    if (!bm) continue;
    var br = bm.branches[String(marks.type)];
    if (br && br.goods.length) {
      return {
        commonEvent: cid,
        varId: bm.varId,
        branch: marks.type,
        goods: br.goods,
        texts: br.texts
      };
    }
  }
  return null;
}
function newSink() {
  return {
    blocks: [],
    choices: [],
    comments: [],
    shops: [],
    battles: 0,
    scripts: 0,
    transfers: 0,
    ceChain: [],
    pendingFace: null,
    /* 【v2.10.0】「101 之后紧跟一句 `名字：`」当说话人横幅的写法（见 speakerNameLine）。 */
    nameLineNext: false,
    nameLines: []
  };
}
function runEvent(ev) {
  var sink = newSink();
  var budget = {
    n: 40000,
    seen: {}
  };
  (ev.pages || []).forEach(function (pg) {
    if (!pg || !Array.isArray(pg.list)) return;
    var env = {
      vars: {},
      switches: {}
    };
    evaluate(pg.list, env, sink, budget, 0);
  });
  return sink;
}

// ============================================================ 角色/命名推断

/** 按货架商品给商人分类（取关键词命中最多的那一类） */
function shopKindOf(goods) {
  var s = (goods || []).map(function (g) {
    return String(g.name || '');
  }).join(' ');
  var score = [['武器商人', /武器|剑|刀|枪|弓|刃|斧/g], ['防具商人', /防具|铠|盾|甲|护具/g], ['药品商人', /药|薬|回复|治愈|伤|解毒/g], ['素材商人', /素材|矿|石|草|花|木|羽|皮|油/g], ['食品商人', /面包|食|料理|果|肉|酒|水/g]];
  var best = null,
    bv = 0;
  score.forEach(function (pair) {
    var c = (s.match(pair[1]) || []).length;
    if (c > bv) {
      bv = c;
      best = pair[0];
    }
  });
  return best || '商人';
}
/** 商人细分类 → 细标签（与插件 LIB_TAG_KEYS 对齐） */
function shopTagOf(role, tags) {
  if (role === '武器商人') tags.push('shop_weapon');else if (role === '防具商人') tags.push('shop_armor');else if (role === '药品商人' || role === '素材商人' || role === '食品商人') tags.push('shop_item');
}

/* 【v2.9.5 · 多源身份线索】当"事件名/台词/商店"都给不出身份时，用**立绘名**与**地图名**补。
 * 只在仍是默认「居民」时生效，且在 asSys 判定之后 —— 不影响已有的任何判定。 */
var SPRITE_IDENTITY = [[/uniform/i, '学生'], [/witch/i, '魔女'], [/slime|fairy|werewolf/i, '魔物'], [/^mob0\d$/i, '魔物']];
var MAP_IDENTITY = [[/教室|校舎|学校|実験室|校門/, '学生'], [/屋敷/, '宅邸的人']];
/* 【v2.9.9 · 指名角色（+actorN）的身份以**角色名**为准】
 * 上面两张表是给**无名 mob** 用的（没有台词、没有角色名，只能靠立绘和地图猜）。
 * +actorN 指名的事件有 Actors 表里的真名，比"这张图叫実験室"精确得多 ——
 * 若放任地图推断去猜，会把见习炼金术师ロシェ误标成「学生」。
 * 所以：有角色名时只查这张表；查不到就**不再用地图名猜**（宁可留中性的「居民」）。 */
var ACTOR_IDENTITY = [[/魔女|witch/i, '魔女'], [/メイド|maid/i, '女仆'], [/ポーション屋|道具屋|薬屋|商店|pharmacy/i, '商人'], [/妖精|fairy/i, '妖精'], [/狐娘|fox/i, '狐狸精']];
function identityOf(charName, mapShortName, actorName) {
  var an = String(actorName || '');
  if (an) {
    for (var _i42 = 0; _i42 < ACTOR_IDENTITY.length; _i42++) {
      var pair = ACTOR_IDENTITY[_i42];
      if (pair[0].test(an)) return pair[1];
    }
  }
  var cn = String(charName || '');
  for (var _i44 = 0; _i44 < SPRITE_IDENTITY.length; _i44++) {
    var _pair = SPRITE_IDENTITY[_i44];
    if (_pair[0].test(cn)) return _pair[1];
  }
  if (an) return null; /* 指名角色：名字给不出身份就不猜 */
  var mn = String(mapShortName || '');
  for (var _i46 = 0; _i46 < MAP_IDENTITY.length; _i46++) {
    var _pair2 = MAP_IDENTITY[_i46];
    if (_pair2[0].test(mn)) return _pair2[1];
  }
  return null;
}

/* ============================================================ 指名角色（+actorN）是不是"人"
 *
 * 【v2.9.9 · 「带 +actorN」只说明这是有名有姓的实体，不说明它是个人】
 *   Mira 用 CU_EventObjectResposible001 把**角色表（Actors.json）的第 N 号**指派给地图事件：
 *       108 // ADD_OPTIONS
 *       408 // +type1
 *       408 // +actor3
 *   插件在运行时执行 `pages[0].image.characterName = $dataActors[N].characterName` ——
 *   这类事件的立绘**静态永远是空的**。这正是罗谢（heroine002）、埃斯梅拉达（heroine003）
 *   在地图上站着、扫描器却一条都没收的根因（v2.9.5 只给"分支归属商人"破了例）。
 *
 *   但同一张 Actors 表里也塞着**怪物与摆件**（蝙蝠 / 史莱姆 / 蘑菇怪 / 杂兵）。
 *   若把带 +actorN 的一律当人收进来，v2.9.8「别把椅子当人」就白做了。
 *   于是按**素材命名空间**再分一次流，只认结构、不认作品：
 *     ① 通用怪物/摆件名 —— 各作品素材作者通行叫法（bat / slime / wolf / ghost …）
 *     ② 纯编号杂兵 `^mob\d+$` —— **锚定到结尾**，所以 Mob_Uniform_A 这类人形学生不受牵连
 *     ③ 角色名自带「敵 / 敌」（日・中 RPG 常见的自述）
 *   两个逃生舱（换了作品判据不灵时，不用改一行代码）：
 *     --keepActor=3    判据误杀了真角色 → 强制放行（编号或素材名都认）
 *     --dropActor=99   判据漏了某个摆件   → 强制剔除
 *
 *   ★ 命中者**照样收进世界书**（世界书是地图的镜像，丢掉就再也找不回来），
 *     只是标 aiHint='system' —— 插件菜单按它跳过，因此绝不会出现在 AI 扮演列表里。
 *     这跟 v2.9.8「宁留一个摆件，不错杀一个角色」是同一条原则。
 */
var NONHUMAN_SPRITE_GENERIC = /^(damage\d*|nature|vehicle|shadow|transparent|battler\d*|bats?|slime|wolf|werewolf|spider|snake|ghost|skeleton|zombie|goblin|orc|rat|bee|moth|bug|fish|bird|boar|bear|tiger|dragon|golem|mushroom|plant|enemy\d*|monster\d*|boss\d*)$/i;
var NONHUMAN_SPRITE_WORDS = /(object|furniture|decor?|effect|particle|battler|float|vehicle|marker|enemies|monster|enemy|plant)/i;
var NONHUMAN_SPRITE_MOB = /^mob\d+$/i;
/* 本作（Mira）实测补充的素材名 —— 通用表漏掉的生物名。换作品按需往这里加即可。 */
var NONHUMAN_SPRITE_TITLE = /^(matango|arlaune\d*|holstauros)$/i;
var NONHUMAN_ACTOR_NAME = /^敵|^敌/;

/** 演员名清洗：Mira 的 Actor 名带"地图限定前缀"（`まちはずれ2：魔女1`）→ 取冒号后的部分。 */
function actorDisplayName(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var i = Math.max(s.lastIndexOf('：'), s.lastIndexOf(':'));
  if (i >= 0 && i < s.length - 1) s = s.slice(i + 1).trim();
  return s;
}

/** 返回命中的**理由**（'' = 这个实体确实是"人"，可以被 AI 扮演）。
 *  理由会写进扫描报告，方便一眼复核有没有误杀。 */
function spriteIsNonHuman(actorId, charName, actorName) {
  var s = String(charName == null ? '' : charName).trim();
  var nm = String(actorName == null ? '' : actorName).trim();
  var idStr = actorId == null ? '' : String(actorId);
  var kept = function kept(v) {
    return v && ARGS.keepActor.indexOf(v) >= 0;
  };
  var drop = function drop(v) {
    return v && ARGS.dropActor.indexOf(v) >= 0;
  };
  if (kept(idStr) || kept(s) || kept(nm)) return ''; /* 明确要求放行 */
  if (drop(idStr) || drop(s) || drop(nm)) return '指定为素材（--dropActor）';
  if (!s) return ''; /* 无立绘：交给 hasSprite 去判 system */
  if (NONHUMAN_ACTOR_NAME.test(nm)) return '角色名自称「' + nm + '」（敌方）';
  if (NONHUMAN_SPRITE_MOB.test(s)) return '编号杂兵素材「' + s + '」';
  if (NONHUMAN_SPRITE_TITLE.test(s)) return '魔物素材「' + s + '」（本作实测补充）';
  if (NONHUMAN_SPRITE_GENERIC.test(s)) return '通用怪物素材「' + s + '」';
  var m = NONHUMAN_SPRITE_WORDS.exec(s);
  if (m) return '素材名含「' + m[1] + '」（物件 / 特效 / 素材表）';
  return '';
}
function inferRole(ev, sink, marks, mapShortName, actorName) {
  marks = marks || readMarks(ev);
  var n = String(ev && ev.name || '');
  var tags = [];
  var role = '居民';
  /* 【v2.9.5 · 判据分三层，由强到弱】
   * ① branchMerchant —— **分支归属**：事件带 +typeK，K 分支里确实有商店。
   *    最硬的证据（谁走哪一支由 K 精确决定，不是猜）。Mira 的真商人走这条：
   *      037:EV031/032（+type7 → 素材摊）、037:EV033/034（+type8 → 杂货铺）。
   *    v2.9.4 之所以把 Mira 商人判成 0，是因为只看了事件本体 —— 而真商人本体
   *    里一条指令都没有（只有注释），身份全在注释与 CE41 的分支条件里。
   * ② strong —— 纯度法：事件本体 / 它调用的公共事件"本质就是商店"（Eliza 的武器店 20/20）。
   * ③ weak —— 能开出商店但主体不是商店（路人调度器）。只记 shop_menu（可交易），不改身份。 */
  var bm = branchMerchant(marks, sink);
  var strongShops = sink.shops.filter(function (s) {
    return s.strength === 'strong';
  });
  var shop = strongShops.find(function (s) {
    return s.via === 'commonEvent';
  }) || strongShops[0];
  if (bm) {
    tags.push('merchant');
    role = shopKindOf(bm.goods);
    shopTagOf(role, tags);
  } else if (strongShops.length) {
    tags.push('merchant');
    var ceName = (byCe[shop.commonEvent] && byCe[shop.commonEvent].name || '').toLowerCase();
    if (/weapon/.test(ceName) || /weapon/i.test(n)) {
      role = '武器商人';
      tags.push('shop_weapon');
    } else if (/armor/.test(ceName) || /armor/i.test(n)) {
      role = '防具商人';
      tags.push('shop_armor');
    } else if (/item/.test(ceName) || /shop_.*item/i.test(n)) {
      role = '道具商人';
      tags.push('shop_item');
    } else role = '商人';
  } else if (sink.shops.length) {
    tags.push('shop_menu');
  }
  if (/inn/i.test(n)) {
    tags.push('inn');
    if (role === '居民') role = '旅馆老板';
  }
  if (/door|扉/i.test(n)) tags.push('door');
  if (/SCENE_/i.test(n)) tags.push('scene');
  if (/damage|DamageFloor|FallObject|針|针|Hazard/i.test(n)) tags.push('hazard');
  if (/Gimmick|gimmick/.test(n)) tags.push('gimmick');
  if (/Treasure|宝箱/i.test(n)) tags.push('treasure');
  var sysTags = ['door', 'scene', 'hazard', 'gimmick', 'treasure'];
  var isSys = tags.some(function (t) {
    return sysTags.includes(t);
  });

  /* 【v2.5.2 · 交互点识别】以前只看事件名字里有没有 door/扉/SCENE_，
   * 于是 area01_INN（旅店入口）、EV006~EV015（一排门）、!Door1（门图块）
   * 全被编成了「居民 / 旅馆老板」，v2.0 默认全开后玩家一撞门就弹 AI 对话。
   * 现在补两条硬判据，与插件运行时 Ainpc.eventIsTalkable 完全一致：
   *   ① 没有可见角色形象：所有页行走图都空、或以 `!` 开头（MV 的图块事件）
   *   ② 执行流（含 117 公共事件）里有 201 场所移动 —— 门 / 传送点 / 住宿点
   * 满足任一条 → 不是"可以聊天的人"，归 system。 */
  var charNames = (ev && ev.pages || []).map(function (pg) {
    return pg && pg.image && pg.image.characterName || '';
  });
  /* 【v2.9.9 · `!` 开头的特例】`!` 前缀在 MV 里是"图块事件"，历来判为没有角色形象。
   * 但 `!$` 前缀是"**单张大图**"（$ = 单张，! = 不偏移），常用于大人形 / 大物件 ——
   * Mira 的 おなほ 就是 `!$hon24`。不过 `!` 开头的门图块（!Door1）也很多，
   * 一刀切放开风险太大。所以只在**游戏自己指名了角色**（+actorN 且该角色有立绘）时豁免：
   * 这时候"有没有形象"由 Actors 表说了算，不需要靠事件页去猜。 */
  var actorHasSprite = !!(marks && marks.actor != null && actorsDb[marks.actor] && actorsDb[marks.actor].characterName);
  var hasSprite = charNames.some(function (cn) {
    return cn && cn.charAt(0) !== '!';
  }) || actorHasSprite;
  var hasTransfer = (sink.transfers || 0) > 0;
  /* 【v2.9.0 · 判据放宽】原来「有传送就判死」过于粗暴。
   * 有一大批游戏（实测 Mira）把 NPC 的对话 / 开店做在**公共事件**里，事件本身带 201
   * 场所移动 —— 于是**有行走图、有名字、玩家主动按确定键才触发**的正经角色被整片判成
   * 系统事件（那款游戏 151 个 NPC 无一幸免，等于插件的脸都认不出来）。
   * 现在：只有当它「有行走图、却每一页都是自动/接触触发（没有任何按确定键的页）」时，
   * 才当成门 / 传送点。真正的门几乎都是「走上去就触发」或不带行走图，这两条仍能拦住。 */
  var triggers = (ev && ev.pages || []).map(function (pg) {
    return pg && pg.trigger;
  }).filter(function (t) {
    return t != null;
  });
  var hasManual = triggers.indexOf(0) >= 0; // 0 = 按确定键交互
  /* 【v2.9.5】商人不受"无立绘"牵连：Mira 的梦境商人立绘由 +actorN 在运行时替换，
   * 静态看可能是空的 —— 不该因此被判成系统事件。 */
  if (!hasSprite) {
    tags.push('sys_no_sprite');
    if (!tags.includes('merchant')) isSys = true;
  } else if (hasTransfer && !hasManual) {
    tags.push('sys_transfer');
    isSys = true;
  }

  /* 【v2.9.9 · +actorN 指名的实体未必是"人"】
   * 蝙蝠 / 史莱姆 / 蘑菇怪也在同一张 Actors 表里。收进来没问题（世界书是地图的镜像，
   * 丢掉就再也找不回来），但必须标 system —— 否则它们会大摇大摆地出现在 AI 扮演列表里。
   * 与 v2.9.8「宁留一个摆件，不错杀一个角色」同一条原则：留住 + 明确标注，不静默丢弃。
   *
   * ★ 但**商人不受牵连**（与上面"无立绘"那条豁免同一个道理）：
   *   「夢の世界」的素材摊立绘就是 敵7 / 敵8（mob07 / mob08）—— 梦里什么都可能。
   *   它们有货架、能买能卖，判成 system 会让玩家白丢这几家店的 AI 交易，
   *   而这跟"能不能扮演"是两码事。 */
  var nonHumanWhy = '';
  if (marks && marks.actor != null) {
    /* 这里**不能**沿用上面那个"跳过 ! 开头"的筛子：`!$ThePlantofMagic`（魔精植物）
     * 恰恰是被 `!` 滤掉、判据拿到空串、于是被当成"人"放行的 —— 判据要看的是
     * 游戏自己指派的立绘名，`!$` 与否与"是不是人"无关。 */
    var cname0 = charNames.find(function (cn) {
      return cn;
    }) || '';
    nonHumanWhy = spriteIsNonHuman(marks.actor, cname0, actorName);
    if (nonHumanWhy) {
      tags.push('sprite_nonhuman');
      if (!tags.includes('merchant')) {
        isSys = true; /* ★ 不进 actors_ai、不进菜单 */
        if (role === '居民') role = '素材';
      }
    }
  }

  /* 【v2.9.5 · 多源身份补全】到这里仍是默认「居民」、又不是系统事件时，
   * 用立绘名 / 地图名给出更具体的人设身份（学生 / 魔女 / 魔物 …）。
   * 只在默认值上覆盖，因此不会动摇前面任何一条判定。
   * 【v2.9.9】指名角色改以**角色名**为准（见 identityOf）。 */
  if (role === '居民' && !isSys) {
    var cname = charNames.find(function (cn) {
      return cn && cn.charAt(0) !== '!';
    });
    var idr = identityOf(cname, mapShortName, actorName);
    if (idr) role = idr;
  }
  var hasText = sink.blocks.some(function (b) {
    return b.text;
  });
  /* 【v2.9.4】aiHint 只被 `=== 'system'` / `=== 'persona-only'` 消费（能不能被 AI 接管），
   * 其余取值纯属「给数据加一句注脚」。这里把「没台词 + 有货架」的两种情形分开标：
   * merchant  = 他本人就是柜台（strong）
   * shop_menu = 他的事件里能开出商店，但主体不是商店（weak，典型：路人调度器） */
  var hint = 'none';
  if (isSys) hint = 'system';else if (hasText) hint = 'npc';else if (tags.includes('merchant')) hint = 'merchant';else if (tags.includes('shop_menu')) hint = 'shop_menu';
  return {
    role: role,
    tags: tags,
    aiHint: hint,
    nonHumanWhy: nonHumanWhy
  };
}

/** 该名字像不像一个人/店铺的名字（本作用的 Actor 表里混进了大量显示字符串）
 *  【v2.9.18】加「形状闸门」—— 实测《伊丽莎》的 Actor 表里躺着 `（上层）`（楼层标注）
 *  与 `居民N`（占位编号），被 `pickSpeaker` 当成说话人名摆进菜单。 */
var NOT_A_NAME = {
  '获得了': 1,
  '收到了': 1,
  '是': 1,
  '否': 1,
  '吧': 1,
  '住宿': 1,
  '离开': 1,
  '一般': 1,
  '特别': 1,
  '是！': 1,
  '不！': 1
};
function looksLikeName(name) {
  if (!name) return false;
  var n = String(name).trim();
  if (!n || n.startsWith('#') || /^[-—=]+$/.test(n)) return false;
  if (NOT_A_NAME[n]) return false;
  if (isPlaceholderShape(n) || isAssetShape(n)) return false; // 【v2.9.18】
  if (n.length > 8) return false; // 显示字符串通常很长
  if (/[。？！…，、]$/.test(n)) return false; // 句末标点 -> 是句子
  if (/[\d０-９]/.test(n)) return false;
  return true;
}

/** 从台词里统计说话人 -> 生成 NPC 名字 */
function pickSpeaker(blocks) {
  var cnt = {};
  blocks.forEach(function (b) {
    if (b.speakerId == null || !b.text) return;
    if (!looksLikeName(actorName(b.speakerId))) return;
    cnt[b.speakerId] = (cnt[b.speakerId] || 0) + 1;
  });
  var top = Object.entries(cnt).sort(function (a, b) {
    return b[1] - a[1];
  })[0];
  if (!top) return null;
  return {
    id: +top[0],
    name: actorName(+top[0]),
    count: top[1]
  };
}

// ============================================================ 主循环
var mapFiles = fs.readdirSync(DATA).filter(function (f) {
  return /^Map\d+\.json$/.test(f);
}).sort();
console.log('[scan] 地图文件:', mapFiles.length);
var npcs = [];
var speakerStats = {};
/* 【v2.9.9】nonHumanNotes：带 +actorN 但被判为"不是人"的实体（供扫描报告逐条列出，
 * 一眼看出判据有没有误杀）。actorNamed / actorPlayable / actorNonHuman 是它的统计口径。 */
var nonHumanNotes = [];
var S = {
  events: 0,
  withText: 0,
  txtLines: 0,
  merchants: 0,
  shopMenus: 0,
  sys: 0,
  actorNamed: 0,
  actorPlayable: 0,
  actorNonHuman: 0
};
/* 【v2.10.0】ADV 剧本本地化命中的演员名（原文 → 中文），供扫描报告列出来。 */
var localizedNames = {};
for (var _i48 = 0; _i48 < mapFiles.length; _i48++) {
  var file = mapFiles[_i48];
  var mapId = parseInt(file.slice(3, -5), 10);
  var map = load(file.slice(0, -5));
  if (!map || !Array.isArray(map.events)) continue;
  var _loop5 = function _loop5() {
      var ev = _map$events2[_i50];
      if (!ev || !ev.id) return 0; // continue
      S.events++;
      var marks = readMarks(ev);
      /* 【v2.9.9 · 立绘补正】复刻 CU_EventObjectResposible001 在运行时的这一句：
       *     $dataMap.events[id].pages[0].image.characterName = $dataActors[+actorN].characterName
       * 补上之后，下面每一处读立绘的地方（inferRole 的 hasSprite、rec.charName、身份推断）
       * 看到的就与**玩家在游戏里看到的**一致。
       * 事件页上那份静态立绘**不可信**：Mira 的 46 个 +actorN 事件里，16 个挂的是主角占位
       * `hero`、20 个挂的是 `heroine001`（リア）—— 都是编辑期随手放的，与运行时真正站在
       * 这儿的**那个人**毫无关系。不补正，收进来的角色会成片变成"主角"或"リア"。 */
      var actorRow = marks.actor != null && actorsDb[marks.actor] ? actorsDb[marks.actor] : null;
      if (actorRow && actorRow.characterName) {
        var pg0 = (ev.pages || [])[0];
        if (pg0) {
          pg0.image = pg0.image || {};
          pg0.image.characterName = actorRow.characterName;
          if (actorRow.characterIndex) pg0.image.characterIndex = actorRow.characterIndex;
        }
      }
      var actorName = function () {
        var raw = actorRow ? actorDisplayName(actorRow.name) : '';
        if (!raw || !HAS_KANA.test(raw)) return raw;
        /* 【v2.10.0】汉化版游戏的 Actors 表常常还是原文（`リア`），而剧本里有官方中文名
         * （`莉娅`）—— 用「立绘共现 + 片假名罗马字」对上就用它；对不上原样保留。 */
        return function () {
          var loc = localizeActorName(raw);
          if (loc) localizedNames[raw] = loc;
          return loc || raw;
        }();
      }();
      var sink = runEvent(ev);
      var textBlocks = sink.blocks.filter(function (b) {
        return b.text;
      });
      var mShort = mapShort[mapId] || 'Map' + mapId;
      var bmRec = branchMerchant(marks, sink);
      var _inferRole = inferRole(ev, sink, marks, mShort, actorName),
        role = _inferRole.role,
        tags = _inferRole.tags,
        aiHint = _inferRole.aiHint,
        nonHumanWhy = _inferRole.nonHumanWhy;
      /* 【v2.9.5 · 收录条件放宽】原来只收「有台词或有商店」，于是 Mira 的 4 个真商人
       * （本体只有 ADD_OPTIONS/+type 注释，指令被插件在运行时替换成 [117:41]）被整批漏掉 ——
       * 扫描器看到的是一条空事件。这里**只**为"分支归属确认的商人"破例；
       * 不因为"有 note / 有标记"就无差别收录，否则 Mira 那 400 多个系统事件会被一起捞进来。
       * 【v2.9.9】再加一类：**+actorN 指名**的事件。它们的立绘与身份只在运行时才存在
       * （见上面的立绘补正），本体同样是空事件 —— 罗谢 / 埃斯梅拉达 就是这样被漏掉的。
       * 仍不是"有标记就收"：只有明确指名了角色的才收，且收进来后还会按性质分流。 */
      var hasNote = !!(ev.note && String(ev.note).trim());
      if (!textBlocks.length && !sink.shops.length && !bmRec && marks.actor == null) return 0; // continue
      // 纯触发器

      // 去重
      var seenTxt = {};
      var unique = textBlocks.filter(function (b) {
        if (seenTxt[b.text]) return false;
        seenTxt[b.text] = 1;
        return true;
      });
      unique.forEach(function (b) {
        if (b.speakerId != null) speakerStats[b.speakerId] = (speakerStats[b.speakerId] || 0) + 1;
      });
      var sp = pickSpeaker(unique);
      /* 【v2.9.17】事件名可能是本地化占位符。正常的已经在 load() 里还原掉了；
       * 走到这里还带 `${...}` 说明**语言表里没有这个 key** —— 那它是个垃圾名，
       * 直接当"没有名字"，让命名优先级往下退到 role，别把它摆给玩家看。 */
      var evNameRaw = String(ev.name || '').trim();
      var evNameTrim = L10N.hasPlaceholder(evNameRaw) ? '' : evNameRaw;
      /* 【v2.9.13】若事件名本身是素材名（`mob_096` / `Mob_Uniform_A`），去台词脚本里
       * 找游戏自己用的称呼（`[学生]` / `[老师]` / `[药水商人]`…）。只在「名字是素材名」
       * 时才查 —— 于是不会覆盖台词/指名角色/有意义事件名给出的任何好名字。 */
      var scenName = isAssetName(evNameTrim) ? scenarioSpeakerName(evNameTrim) : '';
      /* 【v2.9.9】命名优先级：台词里的说话人 > +actorN 指名的角色名 > 脚本里的称呼 >
       * 有意义的事件名 > 角色类型。
       * 指名角色的名字来自 Actors 表（罗谢 / 埃斯梅拉达 / ポーション屋），
       * 比 `EV007` 这种占位事件名有意义得多。
       * 【v2.9.14】再加一档「事件名是英文标签」（`OreVein Spawner` / `TemplateMob` / `Boat`）——
       * 同样退到 role，别把作者的标签当人名摆给玩家看。只挡「名字就是事件名」这一种情形，
       * 说话人 / 指名角色 / 脚本称呼给出的名字一概不动。
       * 【v2.9.15】中文/日文游戏同病（`分支 宝箱` / `调查书架` / `主线 斯卡雷特`）。
       * 改用 `cleanEventName`：标签 → 退 role；带场景前缀 → 剥掉前缀保留角色名
       * （`主线 斯卡雷特` → `斯卡雷特`）。 */
      var evClean = cleanEventName(evNameTrim);
      /* 【v2.10.0】再接一档「名字行」（code 101 之后的 `名字：`）—— 那是**游戏内真正的说话人
       * 横幅**，比 Actors 表的代号更有意义。放在 `sp`（说话人变量）之后、`actorName` 之前：
       * 用了说话人变量的游戏（伊莉莎 / Mira）行为不变；没用变量、只靠名字行的游戏
       * （呆呆：473 个 NPC 有台词却 429 个判成"没戏份"）从此认得出人。
       * 必须过 looksLikeName：名字行也可能是 `是否在此休息？` 这种被冒号误伤的句子。 */
      var lineName = function () {
        var n = topNameLine(sink.nameLines);
        return n && looksLikeName(n) ? n : '';
      }();
      /* 【v2.10.0】名字行排在**最后**：作者亲手给事件起的名字（`神马`）比说话人横幅（`马`）
       * 更可靠，所以只要事件名不是占位符就优先用它；只有 `EV001` 这类占位名才轮到名字行。
       * 插在这一档内侧，于是 `actorName > scenName` 这条既有顺序对伊莉莎 / Mira 一文不动。 */
      var autoName = sp ? sp.name : actorName || scenName || (/^EV\d+$/i.test(evNameTrim) || !evClean ? lineName || role : evClean);
      var img = ev.pages && ev.pages[0] && ev.pages[0].image || {};
      var face = unique.find(function (b) {
        return b.face;
      }) || null;
      var shopRec = sink.shops.find(function (s) {
        return s.via === 'commonEvent';
      });
      var shop = shopRec ? {
        type: 'commonEvent',
        commonEvent: shopRec.commonEvent,
        ceName: (byCe[shopRec.commonEvent] || {}).name || ''
      } : sink.shops[0] ? {
        type: 'direct',
        goods: sink.shops[0].goods
      } : null;
      /* 【v2.9.5】分支归属商人：事件本体里没有任何指令，运行时由插件代它调用调度器 CE。
       * 所以 sink.shops 是空的，shop 必须靠分支归属补上 ——
       * 插件里 Ainpc.isMerchant / menuMerchant / pocketTier / buildChoices 四处都以 npc.shop 为准。 */
      if (bmRec && !shop) {
        shop = {
          type: 'commonEvent',
          commonEvent: bmRec.commonEvent,
          ceName: (byCe[bmRec.commonEvent] || {}).name || '',
          branch: bmRec.branch
        };
      }
      var rec = {
        key: 'M' + mapId + ':E' + ev.id,
        mapId: mapId,
        mapId3: 'M' + mapId,
        mapName: mShort,
        mapPath: mapPath[mapId] || '',
        eventId: ev.id,
        /* 【v2.9.17】store 里也**不留占位符** —— 产物里出现 `${text.xxx}` 就是漏了。
         * 没有语言表时 resolveText 是恒等（原文是玩家数据，不许改），零回归不受影响。 */
        eventName: L10N.resolveText(evNameRaw),
        x: ev.x,
        y: ev.y,
        charName: img.characterName || '',
        charIndex: img.characterIndex || 0,
        face: face ? {
          name: face.face,
          index: face.faceIndex
        } : null,
        role: role,
        tags: tags,
        aiHint: aiHint,
        name: autoName,
        nameFrom: sp ? 'dialogue:' + sp.id : lineName ? 'nameline' : actorName ? 'actor:' + marks.actor : scenName ? 'scenario' : 'auto',
        speakerId: sp ? sp.id : null,
        /* 【v2.9.9】+actorN 的编号（undefined 会被 JSON.stringify 丢掉，
         * 因此没有这套标记的游戏输出依旧逐字节不变）。 */
        actorId: marks.actor != null ? marks.actor : undefined,
        /* 【v2.10.0 · 名字行的事后兜底】既然已经认定**这个事件的说话人就是 `autoName`**，
         * 那么正文里再出现一行只写「名字：」的必然是横幅，不是台词 —— 一个事件里两种
         * 101 写法混用时就会这样：挂了立绘的那条已经被 `case 401` 吃掉，没挂立绘的那条
         * 按"旁白红线"保留了下来（见 speakerNameLine 的注释）。
         * 实测《呆呆》601 条 `nameFrom=nameline` 里只剩 1 条这种残留（M87:E1）。
         * 只删「与自己的名字**一字不差** + 冒号后没别的字」的行 —— 正文不可能长这样。 */
        dialogues: unique.filter(function (b) {
          if (!autoName) return true;
          var t = String(b.text || '').trim();
          return !(t === autoName + '：' || t === autoName + ':');
        }).slice(0, 20).map(function (b) {
          return {
            speaker: b.speaker,
            speakerId: b.speakerId,
            text: brev(b.text, 90),
            textId: b.textId,
            eventNo: b.eventNo
          };
        }),
        choices: sink.choices.slice(0, 8),
        comments: sink.comments.slice(0, 4),
        shop: shop,
        ceChain: sink.ceChain.slice(0, 10),
        stats: {
          pages: (ev.pages || []).length,
          lines: textBlocks.length,
          battles: sink.battles,
          scripts: sink.scripts
        }
      };
      /* 【v2.9.5】把注释里的身份线索与"分支归属"结果落盘。
       * **只在 evMark 存在时写入**（即事件确实带 ADD_OPTIONS / +标记）——
       * 没有这套标记的游戏（如 Eliza）输出保持逐字节不变。note 也一并收进 evMark，
       * 免得把别的插件用的 note（如 `<可視距離:3>`）误当成身份线索。 */
      if (marks.type != null) rec.mobBranch = marks.type;
      if (marks.addOptions || marks.raw.length) {
        rec.evMark = {
          addOptions: !!marks.addOptions,
          raw: marks.raw.slice(0, 8)
        };
        if (hasNote) rec.evMark.note = String(ev.note).trim();
        if (marks.type != null) rec.evMark.type = marks.type;
        if (marks.actor != null) rec.evMark.actor = marks.actor;
        if (marks.item != null) rec.evMark.item = marks.item;
        if (marks.enemy != null) rec.evMark.enemy = marks.enemy;
      }
      if (bmRec) rec.branchShop = {
        commonEvent: bmRec.commonEvent,
        branch: bmRec.branch,
        goods: bmRec.goods
      };
      npcs.push(rec);
      S.txtLines += textBlocks.length;
      if (textBlocks.length) S.withText++;
      if (tags.includes('merchant')) S.merchants++;
      if (tags.includes('shop_menu')) S.shopMenus++;
      if (aiHint === 'system') S.sys++;
      /* 【v2.9.9】+actorN 的三种去向：收为可扮演角色 / 判为素材（标 system）/ 其余 */
      if (marks.actor != null) {
        S.actorNamed++;
        if (nonHumanWhy) {
          S.actorNonHuman++;
          nonHumanNotes.push({
            key: rec.key,
            name: rec.name,
            actorId: marks.actor,
            charName: rec.charName,
            mapName: mShort,
            why: nonHumanWhy
          });
        } else if (aiHint !== 'system') {
          S.actorPlayable++;
        }
      }
    },
    _ret3;
  for (var _i50 = 0, _map$events2 = map.events; _i50 < _map$events2.length; _i50++) {
    _ret3 = _loop5();
    if (_ret3 === 0) continue;
  }
}
console.log('[scan] 事件总数:', S.events, ' 有台词:', S.withText, ' 文本行:', S.txtLines);
console.log('[scan] 入选条目:', npcs.length, ' 商人:', S.merchants, ' 可交易:', S.shopMenus, ' 系统类:', S.sys);
if (S.actorNamed) {
  console.log('[scan] +actorN 指名实体:', S.actorNamed, ' → 收为角色:', S.actorPlayable, ' 判为素材(不进 AI 列表):', S.actorNonHuman);
}
/* 【v2.10.0】演员表还是原文（汉化版常见）时，用剧本里「立绘名 ↔ 官方中文名」共现对出来的映射。
 * 打印出来方便一眼核对：对上是改进，一个都没对上也不影响任何原有行为。 */
if (Object.keys(localizedNames).length) {
  var pairs = Object.entries(localizedNames).map(function (_ref2) {
    var k = _ref2[0],
      v = _ref2[1];
    return k + '→' + v;
  }).join('、');
  console.log('[scan] 演员名本地化（剧本共现）:', Object.keys(localizedNames).length, '个：', pairs);
}

// ============================================================ 说话人表
var actorTable = Object.entries(speakerStats).map(function (_ref3) {
  var id = _ref3[0],
    n = _ref3[1];
  return {
    id: +id,
    name: actorName(+id),
    lines: n
  };
}).filter(function (a) {
  return looksLikeName(a.name);
}).sort(function (a, b) {
  return b.lines - a.lines;
});

// ============================================================ 商品目录
var shopCatalog = {};
npcs.forEach(function (n) {
  if (!n.shop) return;
  if (n.shop.type === 'commonEvent') {
    var _k2 = 'CE' + n.shop.commonEvent;
    shopCatalog[_k2] = shopCatalog[_k2] || {
      commonEvent: n.shop.commonEvent,
      ceName: n.shop.ceName,
      usedBy: []
    };
    shopCatalog[_k2].usedBy.push(n.key);
  } else {
    shopCatalog['direct:' + n.key] = {
      direct: true,
      goods: n.shop.goods,
      usedBy: [n.key]
    };
  }
});
// 公共事件商店里的商品（可能按变量分支，记录全部）
Object.values(shopCatalog).forEach(function (rec) {
  if (!rec.commonEvent) return;
  var ce = byCe[rec.commonEvent];
  if (!ce) return;
  var sink = newSink();
  evaluate(ce.list, {
    vars: {},
    switches: {}
  }, sink, {
    n: 20000,
    seen: {}
  }, 0);
  var all = {};
  sink.shops.forEach(function (s) {
    return (s.goods || []).forEach(function (g) {
      all[g.type + ':' + g.id] = g;
    });
  });
  rec.goodsSample = Object.values(all);
  rec.branching = '按区域变量分支，运行时由插件捕获真实商品';
});

// ============================================================ 写出世界书
/* 【这一段只在游戏里才会走到，而且踩过坑】
 * 游戏是 NW.js 0.29，内核是 **Node 9**；而 mkdirSync 的 recursive 选项是 Node 10.12 才加的。
 * 命令行（Node 22）跑得好好的，一进游戏就被忽略 → 退化成普通 mkdir → 输出目录已存在就 EEXIST。
 * 于是"自动扫描"永远死在最后写文件这一步。所以这里不能靠 recursive，得自己兜住 EEXIST。 */
try {
  fs.mkdirSync(OUT, {
    recursive: true
  });
} catch (e) {
  if (!fs.existsSync(OUT)) throw e;
}
var wbPath = path.join(OUT, 'worldbook.json');

/* 【v2.9.0 · 重扫不毁数据】扫描是"重建世界书"，但人设（persona）是**玩家花了 API 额度
 * 生成出来的**，不能因为一次重扫就消失。以前确实会 —— 于是"改进了识别规则想重扫一遍"
 * 等于把人设全清空，谁都不敢重扫。这里在写盘前把旧世界书里 AI/玩家产生的字段并回来：
 *   · 同 key 的：persona / 由人设定的名字 / 启用状态 / 玩家手动设过的开关
 *   · 这次没扫到、但已经有人设的条目：整条留下（标记 _orphan），否则人设凭空消失
 * 只在**同一部游戏**之间迁移（游戏名不符 = 换了游戏，一律不并，免得串味）。 */
var carriedPersona = 0;
try {
  if (fs.existsSync(wbPath)) {
    var old = JSON.parse(fs.readFileSync(wbPath, 'utf8').replace(/^\uFEFF/, ''));
    var oldTitle = String(old.game && old.game.title || '').trim();
    var newTitle = String(system.gameTitle || '').trim();
    var sameGame = !(oldTitle && newTitle && oldTitle !== newTitle);
    if (!sameGame) {
      console.log('[scan] 旧世界书是《' + oldTitle + '》，与本作《' + newTitle + '》不同，不迁移人设');
    } else {
      var byKey = {};
      (old.npcs || []).forEach(function (n) {
        if (n && n.key) byKey[n.key] = n;
      });
      for (var _i52 = 0; _i52 < npcs.length; _i52++) {
        var n = npcs[_i52];
        var o = byKey[n.key];
        if (!o) continue;
        if (o.persona && (o.persona.identity || o.persona.name)) {
          n.persona = o.persona;
          carriedPersona++;
        }
        if (o.nameFrom === 'persona' && o.name) {
          n.name = o.name;
          n.nameFrom = 'persona';
        }
        if (o.aiEnabled) n.aiEnabled = o.aiEnabled;
        if (o.onSet !== undefined) n.onSet = o.onSet;
      }
      /* 旧书里有、这次没扫到的角色：只要带着人设就留住（不然人设会凭空消失） */
      var newKeys = {};
      npcs.forEach(function (n) {
        newKeys[n.key] = 1;
      });
      (old.npcs || []).forEach(function (o) {
        if (!o || !o.key || newKeys[o.key]) return;
        if (!(o.persona && (o.persona.identity || o.persona.name))) return;
        o._orphan = '本次扫描没扫到，但带着已生成的人设，保留';
        npcs.push(o);
        carriedPersona++;
      });
    }
  }
} catch (e) {
  console.warn('[scan] 旧世界书读取失败，跳过人设迁移：' + e.message);
}

/* 已还原后**仍然残留**的 code（= 语言表里缺这个键）—— 收尾时点名，别让它悄悄混进产物 */
var l10nUnknown = function () {
  if (!L10N.available) return {};
  var bad = {};
  var m;
  var re = /\$\{([\w|.]+)\}/g;
  var s = JSON.stringify(npcs);
  while (m = re.exec(s)) bad[m[1]] = (bad[m[1]] || 0) + 1;
  return bad;
}();
var worldbook = {
  version: 2,
  generatedAt: new Date().toISOString(),
  engine: 'RPG Maker MV/MZ',
  game: {
    title: system.gameTitle || '',
    currency: system.currencyUnit || 'G',
    /* 【v2.9.17】本地化占位符还原的账，写进产物里 —— 「为什么这游戏人设写不出来」
     * 的答案应该一眼可见，而不是让人去猜。
     * ★ 只在**真有情况**时才写这个字段：既没语言表、正文里也没占位符的游戏
     *   （绝大多数）产物保持逐字节不变 —— 零回归是能一眼断言的红线。 */
    localization: L10N.available || PH_SEEN_FILES > 0 ? L10N.available
    /* folder 只记**目录名**（'languages'），不记绝对路径 —— 产物是要分发的，
     * 别人机器上的 `D:\...\Steam\...` 一点意义都没有，还会误导排查。 */ ? {
      resolved: true,
      lang: L10N.lang,
      keys: L10N.keys,
      folder: path.basename(L10N.dir || '')
    } : {
      resolved: false,
      reason: L10N.reason,
      placeholdersSeen: PH_SEEN_FILES
    } : undefined
  },
  textSystem: {
    note: '本作使用文本ID系统：变量2=Event_Text, 变量3=Event_No',
    textVar: TEXT_VAR,
    noVar: NO_VAR
  },
  maps: mapShort,
  mapPaths: mapPath,
  actorTable: actorTable,
  shopCatalog: shopCatalog,
  npcs: npcs
};
fs.writeFileSync(wbPath, JSON.stringify(worldbook, null, 1), 'utf8');
console.log('[scan] 写出', wbPath, (fs.statSync(wbPath).size / 1024).toFixed(1), 'KB' + (carriedPersona ? '（迁移回 ' + carriedPersona + ' 份已生成的人设）' : ''));

// ============================================================ 写出角色档案
var TONE_BY_ROLE = {
  '武器商人': '精明、嗓门大，爱吹嘘自家武器的来历，会拿"看你顺眼"当借口让利',
  '防具商人': '稳重、话少但实在，重视回头客，讨厌砍价砍到离谱的人',
  '道具商人': '热络、爱聊天，喜欢推销冷门货，对药材很有研究',
  '商人': '精明热情，会看人下菜碟',
  '旅馆老板': '爽快好客，喜欢打听旅人的八卦',
  '居民': ''
};
var actorsAi = {
  version: 2,
  note: 'aiEnabled / persona / tone 均可手改，插件启动时读取。aiEnabled 为 true 表示该 NPC 交给 AI 扮演。',
  defaults: {
    maxTurnsPerTrigger: 1,
    allowFreeInput: true,
    allowSteal: true,
    allowRob: true,
    keepOriginalText: true
  },
  actors: {}
};
npcs.forEach(function (n) {
  if (n.aiHint === 'system') return;
  actorsAi.actors[n.key] = {
    name: n.name || n.role,
    nameIsAuto: true,
    role: n.role,
    tone: TONE_BY_ROLE[n.role] !== undefined ? TONE_BY_ROLE[n.role] : '',
    persona: '',
    knowledge: '',
    location: n.mapName,
    tags: n.tags,
    aiEnabled: false
  };
});
var acPath = path.join(OUT, 'actors_ai.json');
fs.writeFileSync(acPath, JSON.stringify(actorsAi, null, 1), 'utf8');
console.log('[scan] 写出', acPath, (fs.statSync(acPath).size / 1024).toFixed(1), 'KB');

// ============================================================ 报告
/* 【v2.9.4】从旧世界书迁移回来的「孤儿角色」是**直接搬过来的对象** —— 它们带着已生成的人设，
 * 但可能没有本次扫描才会写入的 stats / role / tags / mapName 等字段。
 * 报告段以前直接读 n.stats.lines，于是在**全部产出都写完之后**、打印 TOP12 时崩掉：
 * 文件其实好好的，但玩家看到一屏红色报错，会以为「一键准备失败了」。
 * 这里先把「本次真正扫到的、字段完整」的条目挑出来，孤儿人设不参与排行统计。 */
// ============================================================ 写成世界书的收尾提醒
/* 【v2.9.17】有语言表（已还原）→ 报一句还原到什么程度；
 * 没有语言表、但原文里确实藏着占位符 → **大声说出来**。
 * 这条不报的话，玩家看到的只是"人设生成出来全是胡话"，根本不知道根因在哪。 */
if (L10N.available) {
  var bad = Object.keys(l10nUnknown || {});
  if (bad.length) {
    console.warn('\n[scan] ⚠ 有 ' + bad.length + ' 个本地化 code 在 ' + L10N.lang + ' 表里找不到（已从正文/名字里剔除）：' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ' …' : ''));
  } else {
    console.log('[scan] 本地化占位符全部还原成功（' + L10N.lang + '，' + L10N.keys + ' 键）');
  }
} else if (PH_SEEN_FILES > 0) {
  console.warn('\n[scan] ⚠⚠ 这份游戏的正文里有本地化占位符（如 ${text.xxx}），但没找到语言表 ——');
  console.warn('      看到的 ' + PH_SEEN_FILES + ' 个 data 文件是原始占位符。世界书还能用（人物/地图/台词数都在），');
  console.warn('      但**语料与人名是占位符**，AI 生成的世界观 / 人设会没有依据。');
  console.warn('      找找游戏目录下有没有别的语言文件夹，用 --lang=<文件夹名> 指一下再扫一次。');
}
var scanned = npcs.filter(function (n) {
  return n && n.stats && n.tags && n.role != null;
});
console.log('\n[scan] 说话人 TOP20（用于角色档案）：');
actorTable.slice(0, 20).forEach(function (a) {
  return console.log("   ".concat(String(a.lines).padStart(5), " \u884C  #").concat(String(a.id).padStart(3), " ").concat(a.name));
});
console.log('\n[scan] 商人清单：');
scanned.filter(function (n) {
  return n.tags.includes('merchant');
}).slice(0, 20).forEach(function (n) {
  var g = n.branchShop ? n.branchShop.goods.slice(0, 4).map(function (x) {
    return x.name;
  }).join('/') : '';
  console.log("   ".concat(n.key.padEnd(9), " ").concat(n.mapName.padEnd(26), " ev#").concat(n.eventId, " ").concat(n.role, " ") + "shop=".concat(n.shop ? n.shop.type + ':' + (n.shop.commonEvent || '') : '-', " ").concat(g ? '货=[' + g + ']' : '', " \u540D=").concat(n.name));
});
console.log('\n[scan] 台词最丰富的 NPC TOP12（AI 扮演适配度最高）：');
scanned.slice().sort(function (a, b) {
  return b.stats.lines - a.stats.lines;
}).slice(0, 12).forEach(function (n) {
  console.log("   ".concat(n.key.padEnd(9), " ").concat(n.mapName.padEnd(24), " ").concat(String(n.role).padEnd(8), " \u540D=").concat(String(n.name).padEnd(8), " \u53F0\u8BCD=").concat(n.stats.lines, " \u4F8B: ").concat((n.dialogues[0] || {}).text || '(无)'));
});

/* 【v2.9.9】+actorN 指名的实体分成两拨，两拨都列出来 —— 判据有没有误杀，一眼就能看出来。 */
var actorNamed = scanned.filter(function (n) {
  return n.actorId != null;
});
if (actorNamed.length) {
  var playable = actorNamed.filter(function (n) {
    return !n.tags.includes('sprite_nonhuman') && n.aiHint !== 'system';
  });
  console.log('\n[scan] +actorN 指名 · 收为角色（' + playable.length + '）：');
  playable.slice(0, 40).forEach(function (n) {
    return console.log("   ".concat(n.key.padEnd(9), " ").concat(n.mapName.padEnd(22), " #").concat(String(n.actorId).padEnd(3), " ").concat(String(n.name).padEnd(12), " ").concat(n.role, "  \u7ACB\u7ED8=").concat(n.charName || '(无)'));
  });
  if (nonHumanNotes.length) {
    console.log('\n[scan] +actorN 指名 · 判为素材（' + nonHumanNotes.length + ' 条，已标 system，不会进 AI 扮演列表）：');
    nonHumanNotes.slice(0, 40).forEach(function (x) {
      return console.log("   ".concat(x.key.padEnd(9), " ").concat(x.mapName.padEnd(22), " #").concat(String(x.actorId).padEnd(3), " ").concat(String(x.name).padEnd(12), " \u2014\u2014 ").concat(x.why));
    });
    console.log('   混进真角色 → --keepActor=<编号> 放行；漏了摆件 → --dropActor=<编号> 剔除。');
  }
}