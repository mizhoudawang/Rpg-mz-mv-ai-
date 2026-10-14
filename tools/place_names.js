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
 * 地点解析 —— **唯一真源**（v2.9.7：从「只认一种命名」升级为「几种命名都能读懂」）
 *
 * 【为什么要改】v2.9.6 的结论是：换一部游戏就得手改词典，这不行。根因是这里的解析
 * **只认一种地图命名**（`MAP073/area03_kas_town_in_ite_1F_01`）。而现实中有好几派：
 *
 *   ① 路径派（伊莉莎 / 大多数欧美 RM 汉化）：MapInfos 是内部路径 `areaNN_鎮_设施_...`
 *   ② 编号派（Mira / 很多日文 RM）：MapInfos 就是给玩家看的 `004：校門`、`029：夢の世界`
 *      —— 而且往往带 parentId 层级，`004：校門` 的父是 `002：学校`，再上是 `001：アウイル`。
 *      这条链本身就是极好的语境（比光秃秃一个「校门」强得多），以前**完全被浪费**。
 *   ③ 通用派：`Game` / `dungeon` / `town` / `Event_reminiscence` 这类引擎惯用图名。
 *
 * 现在三种都读，且**解析不出来时优雅降级**（返回空串让调用方兜底，而不是乱猜）。
 *
 * 【两条不能破的规矩】
 *   · 伊莉莎（路径派）的 231 张地图，解析结果必须**逐字节不变** —— 它是既有正确行为，
 *     这次只是「加功能」，不是「改口径」。
 *   · 插件里有一份**手抄本**（`Ainpc.parsePlaceName`，插件不能 require 工具脚本）。
 *     两边规则必须一致，改这里就要同步改那里。
 *
 * 这份实现同时被四处用到：
 *   ① tools/build_persona_input.js（人设线索的「所在位置」）
 *   ② tools/build_lorebook_input.js（世界观线索的地名）
 *   ③ 插件 Ainpc.parsePlaceName / cnMapName / locationOf（运行时「当前地点」）
 *   ④ 发行包里给人用的同名工具
 * 各写一遍必然走偏（第一版就有：`_in` 前缀命中 `_INN`，给教堂硬加上「室内」）。
 */
'use strict';

/* ====================================================== ① 路径派词表 */

/* 城镇代号 → 中文。area06~09 是四处隐藏地牢（olr/gen/gasA/gasB），不是城镇。 */
var TOWN_CN = {
  hel: '赫尔镇',
  alt: '阿尔特镇',
  kas: '卡斯镇',
  ise: '伊势镇',
  goi: '戈伊镇',
  olr: '地牢（olr）',
  gen: '地牢（gen）',
  gasA: '地牢（gasA）',
  gasB: '地牢（gasB）'
};

/* 设施 token → 中文。**按整 token 精确匹配**，不用子串 —— 子串会把
 * `_INN_` 里的 `in`、`_in_church_` 里的 `in` 都当成设施。 */
var FAC_CN = {
  church: '教堂',
  chief: '镇长家',
  wea: '武器店',
  arm: '防具店',
  ite: '道具店',
  INN: '旅店',
  houseA: '民宅A',
  houseB: '民宅B',
  houseC: '民宅C',
  houseD: '民宅D',
  dungeon: '地牢',
  secret: '隐藏区域',
  res: '秘境',
  ent: '入口',
  roomA: '房间A',
  roomB: '房间B',
  roomC: '房间C',
  roomD: '房间D',
  roomE: '房间E',
  roomF: '房间F'
};

/* 区域词（不是设施）—— 只在没有任何设施命中时才用，否则「赫尔镇 · 教堂」会被写成
 * 「赫尔镇 · 室内 / 教堂」，读起来像是说这教堂在屋里。 */
var ZONE_CN = {
  out: '街道',
  in: '室内'
};

/* ====================================================== ② 编号派：日文地名小词表
 *
 * 【为什么要有它】编号派的地图名本来就是给玩家看的日文，模型其实也看得懂日文。
 * 这张表**只是让中文提示词读起来统一**，所以它刻意做得很小、很保守：
 *   · 只收「跨作品通用」的日文地名汉字词（学校 / 教室 / 屋敷 / 地下水道 …）；
 *   · **专有名词一律不进表**（アウイル、ロシェ、ミラ、グラナ 这些人名地名保留原文 ——
 *     硬翻反而会翻错，而模型看原文照样懂）。
 * 查不到就原样保留，绝不瞎猜。 */
var JA_CN = {
  '学校': '学校',
  '学園': '学园',
  '学院': '学院',
  '校門': '校门',
  '校舎': '校舍',
  '校舎入口': '校舍入口',
  '教室': '教室',
  '実験室': '实验室',
  '実習室': '实习室',
  '図書室': '图书室',
  '図書館': '图书馆',
  '屋敷': '宅邸',
  '自宅': '自宅',
  '工房': '工房',
  '教会': '教堂',
  '聖堂': '圣堂',
  '神殿': '神殿',
  '広場': '广场',
  '市場': '市场',
  '酒場': '酒馆',
  '宿屋': '旅店',
  '道具屋': '道具店',
  '武器屋': '武器店',
  '防具屋': '防具店',
  '商店': '商店',
  '地下水道': '地下水道',
  '水道': '水道',
  '洞窟': '洞窟',
  '迷宮': '迷宫',
  '遺跡': '遗迹',
  '城': '城堡',
  '城下町': '城下镇',
  '離宮': '离宫',
  '町': '镇',
  '街': '街道',
  '村': '村',
  '集落': '村落',
  '草原': '草原',
  '森': '森林',
  '森の中': '森林深处',
  '丘': '山丘',
  '山': '山',
  '峠': '山道',
  '港': '港口',
  '海岸': '海岸',
  '砂浜': '沙滩',
  '一階': '一层',
  '二階': '二层',
  '三階': '三层',
  '地下': '地下',
  '屋上': '楼顶',
  '玄関': '玄关',
  '廊下': '走廊',
  '部屋': '房间',
  '寝室': '卧室',
  '風呂': '浴室',
  '脱衣所': '更衣室',
  'リビング': '客厅',
  '台所': '厨房',
  '食堂': '食堂',
  '庭': '庭院',
  '倉庫': '仓库',
  '物置': '杂物间',
  '中央区': '中央区',
  '南区': '南区',
  '北区': '北区',
  '東区': '东区',
  '西区': '西区',
  'テンプレートマップ': '模板地图',
  'テスト': '测试地图'
};

/* ====================================================== 通用工具 */

var pad2 = function pad2(n) {
  return ('0' + n).slice(-2);
};

/* 有的路径漏了斜杠（`MAP216area02_...`），所以分隔符可有可无 */
var stripPrefix = function stripPrefix(s) {
  return String(s == null ? '' : s).replace(/^MAP\d+([\/\\]|(?=[A-Za-z]))/i, '').replace(/^AP\d+([/\u005C]|(?=[A-Za-z]))/i, '').replace(/^\s+|\s+$/g, '');
};

/* 编号派：`004：校門` / `011-1：教室1` / `124:模板` —— 全角冒号与半角冒号都认 */
var LABEL_RE = /^(\d+)(?:-(\d+))?\s*[：:]\s*(.+)$/;
/* 整条链是不是「编号派」：最末一段长得像编号名就算 */
var isLabelSeg = function isLabelSeg(nm) {
  return LABEL_RE.test(stripPrefix(nm));
};

/** 日文地名 → 中文。三步都查不到就**保留原文**（模型看得懂日文，绝不瞎猜）：
 *  ① 整词命中；② 剥尾部数字再试（`教室1` / `草原2`）；③ 剥美化语前缀 お / ご 再试
 *  （`お風呂` → 風呂 → 浴室）—— お/ご 是日语地名的通用现象，比逐个补词条靠谱。 */
function ja(t) {
  var s = String(t == null ? '' : t).trim();
  if (!s) return s;
  var hit = function hit(x) {
    if (JA_CN[x]) return JA_CN[x];
    var m = /^(.+?)(\d+)$/.exec(x);
    if (m && JA_CN[m[1]]) return JA_CN[m[1]] + m[2];
    return null;
  };
  return hit(s) || /^[おご]/.test(s) && hit(s.slice(1)) || s;
}

/* 引擎惯用图名 —— 任何 RM 都可能有 */
function genericOf(nm) {
  if (/^Event_reminiscence/i.test(nm)) return {
    text: '回忆场景（主线剧情的过去片段）',
    kind: 'main'
  };
  if (/^area90_/i.test(nm) || /^(SCENE|AreaClear|Game|Event)$/i.test(nm)) return {
    text: '主线剧情演出场景',
    kind: 'main'
  };
  if (/^dungeon\d*$/i.test(nm)) return {
    text: '地牢（公用地图）',
    kind: 'dungeon'
  };
  if (/^town$/i.test(nm)) return {
    text: '城镇（公用地图）',
    kind: 'town'
  };
  return null;
}

/* 场合归类（编号派用；路径派沿用原有判定，保持一致） */
function kindOfText(text) {
  var t = String(text || '');
  if (/夢|梦/.test(t)) return 'main';
  if (/地下水道|ダンジョン|迷宮|迷宫|地下|洞窟|坑道|遺跡|遗迹|城|ダンジョン/.test(t)) return 'dungeon';
  if (/校|学園|学院|教室|実験|实验|図書|图书/.test(t)) return 'school';
  if (/教会|聖堂|チャペル|神殿/.test(t)) return 'church';
  return 'town';
}

/** 单段 `areaNN_xxx_yyy` 路径 → 结构化信息（解析不出返回 null）。nm 须已剥 MAP 前缀。 */
function pathInfoOf(nm) {
  var gen = genericOf(nm);
  if (gen) return {
    area: '',
    text: gen.text,
    kind: gen.kind
  };
  var mm = /^area(\d+)_([A-Za-z0-9]+)(?:_(.*))?$/.exec(nm);
  if (!mm) return null;
  var area = 'area' + pad2(mm[1]);
  var town = mm[2];
  var rest = mm[3] || '';
  if (area === 'area00' || /^wolrd$/i.test(town)) return {
    area: area,
    text: '世界地图',
    kind: 'town'
  };
  var facs = [],
    zones = [];
  rest.split('_').filter(Boolean).forEach(function (t) {
    if (FAC_CN[t]) {
      if (facs.indexOf(FAC_CN[t]) < 0) facs.push(FAC_CN[t]);
    } else if (/^dungeon\d*$/i.test(t)) {
      if (facs.indexOf('地牢') < 0) facs.push('地牢');
    } else if (/^house([A-Da-d])$/.test(t)) {
      var c = '民宅' + RegExp.$1.toUpperCase();
      if (facs.indexOf(c) < 0) facs.push(c);
    } else if (/^room([A-Fa-f])$/.test(t)) {
      var _c = '房间' + RegExp.$1.toUpperCase();
      if (facs.indexOf(_c) < 0) facs.push(_c);
    } else if (ZONE_CN[t]) {
      if (zones.indexOf(ZONE_CN[t]) < 0) zones.push(ZONE_CN[t]);
    }
  });
  var text = TOWN_CN[town] || town;
  /* area06~09 的城镇名本身就已经是「地牢（gasB）」，再拼一个「地牢」就成了
   * 「地牢（gasB） · 地牢 / 秘境」—— 去掉重复的那个。 */
  var dupDungeon = /^地牢/.test(text);
  var tail = (facs.length ? facs : zones).filter(function (f) {
    return !(dupDungeon && f === '地牢');
  });
  if (tail.length) text += ' · ' + tail.join(' / ');
  var kind = /dungeon|secret/i.test(nm) ? 'dungeon' : /church/i.test(nm) ? 'church' : 'town';
  return {
    area: area,
    town: town,
    townCn: TOWN_CN[town] || town,
    text: text,
    kind: kind,
    facilities: facs
  };
}

/* 编号派：把整条父子链翻成人话。返回 { area, text, kind } */
function labelChainInfo(list) {
  var parts = [];
  var push = function push(t) {
    var v = String(t == null ? '' : t).trim();
    if (v && parts[parts.length - 1] !== v) parts.push(v);
  };
  var areaKey = '';
  list.forEach(function (seg, i) {
    var nm = stripPrefix(seg);
    var m = LABEL_RE.exec(nm);
    if (m) {
      /* 链首的名字当 area 键（`アウイル › 学校 › 校門` 归到 `アウイル`）——
       * 比用编号更可读，也不会像 Mira 那样出现「001」重复编号。 */
      if (i === 0) areaKey = m[3];
      /* 名字里可能再带冒号：`009：一階：玄関` → 一层 / 玄关 */
      m[3].split(/[：:]/).map(function (x) {
        return x.trim();
      }).filter(Boolean).forEach(function (b) {
        return push(ja(b));
      });
      return;
    }
    /* 混着的链（`MAP001/Game / 004：校門`）也要能处理 */
    var g = genericOf(nm);
    if (g) {
      push(g.text);
      return;
    }
    var p = pathInfoOf(nm);
    if (p && p.text) {
      push(p.text);
      return;
    }
    if (nm && !/^\d+$/.test(nm)) push(ja(nm));
  });
  var text = parts.join(' › ');
  if (!text) return {
    area: '',
    text: '',
    kind: 'other',
    style: 'none'
  };
  return {
    area: areaKey,
    text: text,
    kind: kindOfText(text),
    style: 'label'
  };
}

/* ====================================================== 主解析 */

/**
 * 结构化解析。返回 `{ area, text, kind, chain, style }`。
 * **解析不出来时 `text` 是空串**（调用方自己决定兜底成什么），绝不瞎猜。
 * `style`：'label'（编号派）/ 'path'（路径派）/ 'generic'（引擎惯用）/ 'none'（没认出来）
 */
function parsePlaceInfo(raw) {
  var s = String(raw == null ? '' : raw);
  /* 可能是 "MAP001/Game / MAP200/dungeon2 / MAP166/area06_olr_dungeon" 这种父子链 */
  var segs = s.split(' / ').map(function (x) {
    return x.trim();
  }).filter(Boolean);
  var list = segs.length ? segs : [s];
  var lastNm = stripPrefix(list[list.length - 1]);

  /* ── 分支 A：编号派 —— 整条链都是给玩家看的地名，逐段翻出来 ── */
  if (isLabelSeg(lastNm)) {
    var r = labelChainInfo(list);
    return {
      area: r.area,
      text: r.text,
      kind: r.kind,
      chain: list,
      style: r.style
    };
  }

  /* ── 分支 B：路径派 —— 取**最后一个含 areaNN_ 的段**才是这张图自己 ── */
  var target = '';
  for (var _i2 = 0; _i2 < list.length; _i2++) {
    var g = list[_i2];
    if (/area\d\d_/i.test(g)) target = g;
  }
  if (!target) target = list[list.length - 1] || s;
  var info = pathInfoOf(stripPrefix(target));
  if (!info) return {
    area: '',
    text: '',
    kind: 'other',
    chain: list,
    style: 'none'
  };
  return {
    area: info.area || '',
    text: info.text || '',
    kind: info.kind || 'other',
    town: info.town,
    townCn: info.townCn,
    facilities: info.facilities,
    chain: list,
    style: info.text ? info.area ? 'path' : 'generic' : 'none'
  };
}

/** 只要人话地名（解析不出返回空串，与旧版行为一致） */
function parsePlace(raw) {
  return parsePlaceInfo(raw).text;
}
module.exports = {
  parsePlace: parsePlace,
  parsePlaceInfo: parsePlaceInfo,
  TOWN_CN: TOWN_CN,
  FAC_CN: FAC_CN,
  ZONE_CN: ZONE_CN,
  JA_CN: JA_CN
};