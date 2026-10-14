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

/* ── ai_npc · 去重助手（替代 [...new Set(x)]，老引擎无迭代器协议也能用）── */
function __ainpcUniq(list) {
    var out = [], i, j, v, dup;
    if (list === null || list === undefined) return out;
    for (i = 0; i < list.length; i++) {
        v = list[i]; dup = false;
        for (j = 0; j < out.length; j++) { if (out[j] === v || (out[j] !== out[j] && v !== v)) { dup = true; break; } }
        if (!dup) out.push(v);
    }
    return out;
}
/**
 * 人设线索打包器 —— 为每个可对话 NPC 组装一份"线索包"，交给大模型去写人设。
 *
 * 一个角色的线索来自四处：
 *   ① 外观：行走图 + 位置 —— 由 _lore/sprite_atlas.json 提供（多模态识别的结果）
 *   ② 位置：他在哪张地图、什么设施 —— 由地图名 areaNN_xxx_town_in_yyy 解析
 *   ③ 台词：他自己说过的话 —— 由 extraract_lore 的 speakerLines 按 speakerId 还原
 *   ④ 同类：同场景的其他 NPC —— 用来推断彼此关系
 *
 * 产出 _lore/persona_input.json，按地区分组，方便大模型一批写一组。
 *
 * 用法: node tools/build_persona_input.js --www="<游戏 www 目录>" [--out=<路径>]
 */
'use strict';

var fs = require('fs');
var path = require('path');
function arg(n) {
  var p = '--' + n + '=';
  for (var _i2 = 0, _process$argv$slice2 = process.argv.slice(2); _i2 < _process$argv$slice2.length; _i2++) {
    var a = _process$argv$slice2[_i2];
    if (a.startsWith(p)) return a.slice(p.length);
  }
  return null;
}
var WWW = arg('www') || process.env.AINPC_WWW;
if (!WWW) {
  console.error('✘ 需要 --www="<游戏 www 目录>"');
  process.exit(1);
}
var HERE = path.join(__dirname, '..');
/* 【通用化 v2.8.0】线索目录可整体指定（游戏内跑时这些文件在 www/ai_npc/ 下平铺，
 * 不是开发机上的 <项目>/_lore/）。单项 --lore/--atlas/--bible/--out 仍可覆盖。 */
var LORE_DIR = arg('loreDir') || path.join(HERE, '_lore');
var LORE = arg('lore') || path.join(LORE_DIR, 'lore_raw.json');
var ATLAS = arg('atlas') || path.join(LORE_DIR, 'sprite_atlas.json');
var BIBLE = arg('bible') || path.join(LORE_DIR, 'world_bible.json');
var OUT = arg('out') || path.join(LORE_DIR, 'persona_input.json');
var read = function read(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
};
/* 行走图识别（多模态）与世界观圣经在通用流水线里都可能还不存在 ——
 * 缺了要能照跑：外观退化成「哪张行走图第几位」，世界观退化成空。 */
var readIf = function readIf(p) {
  try {
    return read(p);
  } catch (e) {
    return null;
  }
};
var lore = read(LORE);
var atlas = readIf(ATLAS) || {};
var bible = readIf(BIBLE) || {};
var wb = read(path.join(WWW, 'ai_npc/worldbook.json'));

/* ============================================================ 地图名 → 中文地名
 *
 * 【v2.9.7 通用化】以前这里**内联了自己一份**地名解析，于是和 tools/place_names.js
 * 各写一遍、必然走偏（旧版 `_in` 会命中 `_INN`，给教堂硬加一个「室内」—— 而 place_names.js
 * 早就修了）。现在只留一处真源：place_names.js。它同时认得两派命名：
 *   · 路径派 `MAP010/area01_hel_town_in_church_1F_01`（伊莉莎这类）→「赫尔镇 · 教堂」
 *   · 编号派 `001：アウイル / 002：学校 / 004：校門`（Mira 这类）→「アウイル › 学校 › 校门」
 * 并且**地点原始串优先取 worldbook.mapPaths[mapId]**（含父子链）而不是单段 mapName ——
 * 那条链一直躺在世界书里没被用，而它正是最好的「他在哪」语境。
 */
var placeNames = require('./place_names.js');
var parsePlaceInfo = placeNames.parsePlaceInfo;

/** 这张图的地点原始串：优先父子链，退回单段地图名 */
function rawPlaceOf(mapId, mapName) {
  return wb.mapPaths && wb.mapPaths[mapId] || mapName || '';
}
/** 解析成人话；解析不出来时退回原文（旧版就是这个行为），再没有就给「未知地点」 */
function placeOf(raw, fallback) {
  var info = parsePlaceInfo(raw);
  if (info.text) return info;
  return {
    area: '',
    text: String(fallback == null ? '' : fallback) || '未知地点',
    kind: 'other'
  };
}

/* ============================================================ 非人素材（必须剔除）
 * 【v2.9.8 · 通用化】这里曾经写死 11 个名字（mom_object01 / MVenemies_02 / Damage1 …）——
 * 那是从具体的作品里抄来的，换一部游戏就全部失效。现在改成**模式判据**，不再枚举名字。
 *
 * 判据分两层，都是「任何 RPG Maker 作品都成立」的结构特征：
 *   L1 引擎自带素材名 —— Damage1~3（伤害数字）、Nature（自然景物）、Vehicle（载具）、
 *      Shadow（影子）、Transparent（透明占位）是引擎随包分发的，任何游戏里都叫这个名，
 *      而且都不是角色。
 *   L2 语义关键词 —— 名字里带这些词的，是物件 / 特效 / 战斗素材表：
 *      object / furniture / decor（摆件）、effect / particle（特效）、
 *      enemies / battler（战斗素材表）、float（漂浮物）、vehicle（载具）、marker（标记）。
 *
 * 【为什么不再额外判 `!` 前缀】RM 用 `!` 开头表示「此图不参与半格偏移」，多数是门 / 宝箱 / 火焰。
 * 但这一步**扫描阶段已经做过了** —— scan_game.js 的 hasSprite 认 `!` 开头为「没有角色图」，
 * 会直接标成 system 而不进世界书。这里再判一次反而会误杀「带真实身份标记的伪装物件」
 * （如 Mira 的 `!$field`：它带 +type7 商人标记、真的在卖素材，是个能交互的对象）。
 *
 * 【为什么不用「有没有台词」判】那会把「原作写了台词的传送点」与「沉默的真 NPC」判反，
 * 而且省额度是「重要度分档」的职责 —— 这里只负责别把椅子当成人。
 */
var NON_HUMAN_EXACT = /^(Damage\d*|Nature|Vehicle|Shadow|Transparent|Battler\d*)$/i;
var NON_HUMAN_WORDS = /(object|furniture|decor?|effect|particle|enemies|battler|float|vehicle|marker)/i;
/* 两个逃生舱（换了作品遇到判据没覆盖的情况，不用改代码）：
 *   --nonHuman=名字A,名字B   追加为素材（判据漏掉了某个摆件）
 *   --keepSprite=名字C       放行为角色（判据误杀了某个真角色）—— 优先于所有判据 */
var EXTRA_NON_HUMAN = String(arg('nonHuman') || '').split(',').map(function (s) {
  return s.trim();
}).filter(Boolean);
var KEEP_SPRITES = String(arg('keepSprite') || '').split(',').map(function (s) {
  return s.trim();
}).filter(Boolean);

/** 返回命中的**理由**（'' 表示"是人"）。理由写进 dropped 报告，方便复核有没有误杀。 */
function nonHumanReason(charName) {
  var s = String(charName == null ? '' : charName);
  if (!s) return '';
  if (KEEP_SPRITES.indexOf(s) >= 0) return ''; /* 明确要求放行 */
  if (EXTRA_NON_HUMAN.indexOf(s) >= 0) return '指定为素材（--nonHuman）';
  if (NON_HUMAN_EXACT.test(s)) return '引擎自带素材名';
  var m = NON_HUMAN_WORDS.exec(s);
  if (m) return '名字含「' + m[1] + '」（物件 / 特效 / 素材表）';
  return '';
}

/* ============================================================ 组装 */
var sp = lore.speakerLines || {};
var byMap = {};
var dropped = [];
var coveredNames = {}; /* 已作为地图 NPC 收进来的名字（用来给剧本角色去重） */
var kept = 0;
for (var _i4 = 0, _ref2 = wb.npcs || []; _i4 < _ref2.length; _i4++) {
  var n = _ref2[_i4];
  if (n.aiHint === 'system') continue;
  /* 【v2.9.0】persona-only = 只带人设、没有地图位置的条目（单人生成时给"不在世界书里的
   * 角色"补的那种）。它们本来就已经有卡，也不属于任何地图 —— 既不进分组，也不该被重复生成。 */
  if (n.aiHint === 'persona-only') continue;
  var charName = n.charName || '';
  var nonHumanWhy = nonHumanReason(charName);
  if (nonHumanWhy) {
    dropped.push({
      key: n.key,
      reason: '行走图是非人素材「' + charName + '」——' + nonHumanWhy
    });
    continue;
  }
  var place = placeOf(rawPlaceOf(n.mapId, n.mapName), n.mapName);
  var a = atlas[charName];
  var slot = a && a.slots ? a.slots[String(n.charIndex || 0)] : null;
  var spriteDesc = slot ? slot.desc : charName ? '（' + charName + ' 第 ' + (n.charIndex || 0) + ' 位）' : '（无行走图）';
  /* 台词：优先按说话人变量号取；取不到就按 B 计划用「剧本里同名说话人」的台词
   * （剧情驱动型游戏没有说话人变量，台词全在 scenario 里，key 是 name:<名字>）。 */
  var lines = n.speakerId != null && sp[String(n.speakerId)] ? sp[String(n.speakerId)].map(function (x) {
    return x.text;
  }) : [];
  var lineFrom = lines.length ? 'speakerId' : '';
  if (!lines.length) {
    for (var _i6 = 0, _ref4 = [n.name, n.eventName, n.actorName]; _i6 < _ref4.length; _i6++) {
      var nm = _ref4[_i6];
      if (nm && sp['name:' + nm] && sp['name:' + nm].length) {
        lines = sp['name:' + nm].map(function (x) {
          return x.text;
        });
        lineFrom = 'scenario:' + nm;
        break;
      }
    }
  }
  /* 【v2.10.0】最后一道：**世界书条目自带的台词**。
   * 前两条路都靠"名字"——说话人变量号、或剧本里的同名说话人。可有一大类游戏
   * 既没有说话人变量、也没有 scenario 目录（呆呆 447 个成员里 429 个两条路全空），
   * 于是全员判 extra → 菜单「生成重要角色人设」只跑出 18 个，玩家以为人设功能坏了。
   * 但扫描器其实早就把这些台词按地图/事件聚好写进了 worldbook（`dialogues`），
   * 这里白白没用。它是最直接的证据，必须兜住。放在最后 = 前面能取到的一律不受影响。 */
  if (!lines.length && Array.isArray(n.dialogues) && n.dialogues.length) {
    lines = n.dialogues.map(function (x) {
      return x && typeof x === 'object' ? x.text : x;
    }).filter(Boolean);
    if (lines.length) lineFrom = 'worldbook';
  }
  if (lines.length && n.name) coveredNames[n.name] = 1;
  /* 去掉台词开头的【\N[56]】说话人标记 —— 大模型看到的名字应当由人设给出，不是变量宏 */
  var uniq = __ainpcUniq(lines.map(function (t) {
    return String(t).replace(/^【\\N\[\d+\]】\s*/, '').replace(/\\N\[\d+\]/g, '').trim();
  })).filter(Boolean);
  var rec = {
    key: n.key,
    eventName: n.eventName,
    mapId: n.mapId,
    mapName: n.mapName,
    actorId: n.speakerId != null ? n.speakerId : null,
    actorName: n.name || '',
    // 原作代号（居民A 之类）
    oldRole: n.role || '',
    place: place.text,
    placeKind: place.kind,
    sprite: spriteDesc,
    spriteSource: charName ? charName + '#' + (n.charIndex || 0) : '',
    dialogues: uniq.slice(0, 40)
  };
  /* 【v2.9.5 · 分支归属商人】这类角色（典型：Mira 夢の世界 的素材商人）事件本体
   * 里既没有台词、也没有名字 —— 它是谁、该长什么样，**只能从"卖什么"来定**。
   * 所以把货架商品作为一等线索喂给模型（没有这条时，模型对着一堆空字段只能瞎编）。 */
  if (n.branchShop && Array.isArray(n.branchShop.goods) && n.branchShop.goods.length) {
    rec.goods = n.branchShop.goods.slice(0, 24).map(function (g) {
      return g.name;
    });
  }
  if (lineFrom) rec.dialogueFrom = lineFrom;
  (byMap[n.mapId] = byMap[n.mapId] || []).push(rec);
  kept++;
}
/* 台词里可能带【\N[56]】这种说话人变量标记 —— 剥掉 */
var stripTag = function stripTag(t) {
  return String(t).replace(/^【\\N\[\d+\]】\s*/, '').replace(/\\N\[\d+\]/g, '').trim();
};

/* ============================================================ 分组：按地图聚合，再把同区域的地图并成一组 */
var groups = [];
var _loop = function _loop() {
  var mid = _Object$keys$map$sort2[_i8];
  var members = byMap[mid];
  var p0 = placeOf(rawPlaceOf(mid, members[0].mapName), members[0].mapName);
  groups.push({
    groupId: 'M' + mid,
    area: p0.area,
    place: members[0].mapName,
    title: p0.text,
    members: members.map(function (m) {
      var neighbors = members.filter(function (x) {
        return x.key !== m.key;
      }).map(function (x) {
        return x.actorName;
      }).filter(Boolean);
      return Object.assign({}, m, {
        neighbors: __ainpcUniq(neighbors).slice(0, 12)
      });
    })
  });
};
for (var _i8 = 0, _Object$keys$map$sort2 = Object.keys(byMap).map(Number).sort(function (a, b) {
    return a - b;
  }); _i8 < _Object$keys$map$sort2.length; _i8++) {
  _loop();
}
/* ============================================================ 剧本角色（ADV 型游戏的主力）
 *
 * 【v2.8.0 通用化 —— 这一节是「换一部游戏也能生成角色设定」的关键】
 * 有一大类游戏（TS_ADVsystem 那一系）剧情全部写在 scenario 剧本里，地图上根本没有
 * 带台词的 NPC：世界书扫出来 151 个 NPC，却**人人 0 句台词**。若只按地图 NPC 分组，
 * 人设会全部是空壳。
 * 而剧本里每个说话人（`[米拉]「…」`）天然就是角色，且台词量极大（主角 1300+ 句）。
 * 于是：凡是剧本里说了 ≥N 句、又没被上面的地图 NPC 收过的名字，各自单独成组。
 * 这一段不写死任何作品名 —— 换任何剧情驱动型游戏都成立。
 */
var SC_MIN = parseInt(arg('scenarioMin') || '5', 10);
var scenarioCast = [];
for (var _i0 = 0, _Object$keys2 = Object.keys(sp); _i0 < _Object$keys2.length; _i0++) {
  var k = _Object$keys2[_i0];
  if (k.indexOf('name:') !== 0) continue;
  var _nm = k.slice(5);
  if (!_nm || coveredNames[_nm]) continue;
  var list = sp[k];
  if (list.length < SC_MIN) continue;
  scenarioCast.push({
    name: _nm,
    n: list.length
  });
}
scenarioCast.sort(function (a, b) {
  return b.n - a.n;
});
var _loop2 = function _loop2() {
  var c = scenarioCast[_i10];
  var list = sp['name:' + c.name];
  var dialogues = __ainpcUniq(list.map(function (x) {
    return stripTag(x.text);
  })).filter(Boolean).slice(0, 40);
  if (!dialogues.length) return 1; // continue
  groups.push({
    groupId: 'C:' + c.name,
    area: '剧本',
    place: '（剧情演出场景）',
    title: '剧情角色 · ' + c.name,
    members: [{
      key: 'C:' + c.name,
      eventName: c.name,
      mapId: null,
      mapName: '（剧情演出）',
      actorId: null,
      actorName: c.name,
      oldRole: '剧情角色',
      place: '剧情演出场景',
      placeKind: 'main',
      sprite: '（见剧本/立绘）',
      spriteSource: '',
      neighbors: scenarioCast.filter(function (x) {
        return x.name !== c.name;
      }).slice(0, 10).map(function (x) {
        return x.name;
      }),
      dialogues: dialogues,
      dialogueFrom: 'scenario',
      stageLines: c.n
    }]
  });
  kept++;
};
for (var _i10 = 0; _i10 < scenarioCast.length; _i10++) {
  if (_loop2()) continue;
}
/* ============================================================ 主角团单独标注（他们戏份最重，要单独精写）
 * 【通用化 v2.8.0】主角编号不再写死：本作是 11~20 那几位，换成别人的游戏就没有这些 id 了。
 * 规则 —— 本作编号表**能对上就用它**（保证本作产出不变）；对不上（=换游戏了）就自动改成
 * 「台词量最多的前 5%」：任何 RPG 里主角团的台词量都远超路人，这条规律是通用的。 */
var MAIN_ACTOR_IDS = function () {
  var forced = arg('mainActors');
  if (forced && forced !== 'auto') return forced.split(',').map(function (s) {
    return parseInt(s.trim(), 10);
  }).filter(function (n) {
    return n > 0;
  });
  var BUILTIN = [11, 12, 13, 14, 15, 17, 20];
  if (!forced) {
    var ids = new Set((lore.actors || []).map(function (a) {
      return a.id;
    }));
    if (BUILTIN.every(function (n) {
      return ids.has(n);
    })) return BUILTIN;
  }
  var sorted = (lore.actors || []).map(function (a) {
    return {
      id: a.id,
      n: (sp[String(a.id)] || []).length
    };
  }).filter(function (c) {
    return c.n > 0;
  }).sort(function (a, b) {
    return b.n - a.n;
  });
  return sorted.slice(0, Math.max(3, Math.round(sorted.length * 0.05))).map(function (c) {
    return c.id;
  });
}();
var mainActorsById = (lore.actors || []).filter(function (a) {
  return MAIN_ACTOR_IDS.includes(a.id);
}).map(function (a) {
  return {
    id: a.id,
    name: a.name,
    dialogues: __ainpcUniq((sp[String(a.id)] || []).map(function (x) {
      return stripTag(x.text);
    })).filter(Boolean).slice(0, 60)
  };
});
/* 【v2.8.0 通用化】剧情驱动型游戏里 Actors.json 的编号对不上台词（台词在剧本里、按名字走），
 * 这时主役改用「剧本里台词最多的那几位」—— 哪里戏份最重，哪里就准是主角团。 */
var mainActors = mainActorsById.some(function (a) {
  return a.dialogues.length;
}) ? mainActorsById : Object.keys(sp).filter(function (k) {
  return k.indexOf('name:') === 0;
}).map(function (k) {
  return {
    name: k.slice(5),
    n: sp[k].length
  };
}).sort(function (a, b) {
  return b.n - a.n;
}).slice(0, 8).map(function (x) {
  return {
    id: null,
    name: x.name,
    dialogues: __ainpcUniq(sp['name:' + x.name].map(function (y) {
      return stripTag(y.text);
    })).filter(Boolean).slice(0, 60)
  };
});

/* ============================================================ 重要度分档（v2.9.6）
 *
 * 【为什么要有它】一键把 100+ 个 NPC 全写一遍很贵（Mira 148 人、伊莉莎 110 人，
 * 按 5 人一组就是 22~30 次调用，费额度也费时间）。但真正让世界"活"起来的其实是一小撮人。
 * 这里给每个人打一个通用档位：菜单里「生成重要角色人设」只跑重要档，
 * 「生成全部角色人设」跑所有人 —— 两条路都留着，玩家自己选。
 *
 * 【判据为什么不写死作品名】只用"任何 RPG 都成立"的结构特征：
 *   · 台词量 —— 戏份重的人话一定多，主角团在任何游戏里都是台词之王（跨作品稳定）；
 *   · 说话人变量 speakerId —— 原作用了它就说明这个人"确实会开口"，不是纯背景板；
 *   · 明确职业身份（如扫描器认出的商人货架）—— 台词 0 句，但世界少不了他。
 * 实测：Mira「重要」33/148（省 78%）、伊莉莎 15/110（省 86%）。
 * 阈值可通过 --coreLines / --majorLines 调整，也可在 persona_prompt.json 里覆盖。
 */
var IMP_CORE_LINES = Math.max(1, parseInt(arg('coreLines') || '30', 10));
var IMP_MAJOR_LINES = Math.max(1, parseInt(arg('majorLines') || '5', 10));
var mainNames = {};
mainActors.forEach(function (a) {
  if (a.name) mainNames[a.name] = 1;
});
function importanceOf(m) {
  var n = (m.dialogues || []).length;
  var bare = String(m.key || '').replace(/^C:/, '');
  if (mainNames[m.actorName] || mainNames[bare] || n >= IMP_CORE_LINES) return 'core';
  if (n >= IMP_MAJOR_LINES) return 'major';
  if (m.goods && m.goods.length) return 'major'; // 分支归属商人：0 台词但有货架
  if (m.oldRole === '剧情角色') return 'major';
  if (n >= 1) return 'minor'; // 有台词 —— 玩家真的能和他说上话
  if (m.actorId != null) return 'minor'; // 原作写了说话人变量 = 他会开口
  return 'extra'; // 纯路人：没台词、没身份、没变量
}
var impCount = {
  core: 0,
  major: 0,
  minor: 0,
  extra: 0
};
groups.forEach(function (g) {
  g.members.forEach(function (m) {
    m.importance = importanceOf(m);
    impCount[m.importance]++;
  });
});
var IMP_TIERS = ['core', 'major'];
var impImportant = IMP_TIERS.reduce(function (n, t) {
  return n + impCount[t];
}, 0);
var out = {
  _about: '人设生成输入：每个成员的线索 + 共享的世界观。喂给大模型时，世界观只给一次，然后按 group 分批生成。',
  /* 【v2.9.0 指纹】写下这部游戏的名字。安装器/游戏内准备靠它认出「这份线索包是不是别的作品留下的」
   *  —— 旧版本曾把本作产物随安装铺到别人的游戏，导致"换个游戏跑完还是没人设"。有指纹才认得出。 */
  gameTitle: String(wb.game && (wb.game.title || wb.game.name) || wb.gameTitle || '').trim(),
  generatedAt: new Date().toISOString(),
  stats: {
    totalMembers: kept,
    groups: groups.length,
    droppedNonHuman: dropped.length,
    scenarioCast: scenarioCast.length,
    /* 【v2.9.6】重要度分档 —— 菜单「生成重要角色」只跑 importantTiers 这几档。
     * 阈值一并写进产物，插件读它当默认值（玩家仍可在 persona_prompt.json 覆盖）。 */
    byImportance: impCount,
    importantTiers: IMP_TIERS.slice(),
    importantMembers: impImportant
  },
  /* 本作实际用到的分档口径（换游戏时阈值可以不同，所以跟着产物走） */
  importanceRule: {
    tiers: IMP_TIERS.slice(),
    coreLines: IMP_CORE_LINES,
    majorLines: IMP_MAJOR_LINES
  },
  worldBible: bible,
  mainActors: mainActors,
  dropped: dropped.slice(0, 40),
  groups: groups
};

/* 【Node 9 / 老内核】游戏里的 NW.js 是 Node 9，mkdirSync 的 recursive 会被静默忽略
 * （Node 10.12 才加的）—— 目录已存在就抛 EEXIST。自己兜一层。 */
try {
  fs.mkdirSync(path.dirname(OUT), {
    recursive: true
  });
} catch (e) {
  if (!fs.existsSync(path.dirname(OUT))) throw e;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('');
console.log('线索打包完成 → ' + OUT + '  (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
console.log('  收进 ' + kept + ' 个角色，分 ' + groups.length + ' 组');
console.log('  剔除非人素材 ' + dropped.length + ' 个（物件 / 特效 / 素材表被误当成 NPC）');
/* 【v2.9.8】把命中的立绘名与理由列出来 —— 通用判据难免有误杀，列出来才看得出。
 * 如果发现某个名字其实是个真角色，用 --nonHuman= 会追加、用 --keepSprite= 可以放行。 */
if (dropped.length) {
  var byChar = {};
  dropped.forEach(function (d) {
    var mm = /「([^」]*)」/.exec(d.reason || '');
    var c = mm ? mm[1] : '(未知)';
    if (!byChar[c]) byChar[c] = {
      n: 0,
      why: (d.reason || '').split('——')[1] || ''
    };
    byChar[c].n++;
  });
  Object.keys(byChar).sort().forEach(function (c) {
    console.log('      · ' + c + ' ×' + byChar[c].n + '　—　' + byChar[c].why);
  });
  if (EXTRA_NON_HUMAN.length) console.log('      （其中由 --nonHuman 指定的：' + EXTRA_NON_HUMAN.join(', ') + '）');
}
console.log('');
console.log('  按地区分布：');
var byArea = {};
groups.forEach(function (g) {
  byArea[g.area] = (byArea[g.area] || 0) + g.members.length;
});
Object.entries(byArea).sort().forEach(function (_ref5) {
  var k = _ref5[0],
    v = _ref5[1];
  return console.log('    ' + (k || '(其他)') + ': ' + v + ' 人');
});
console.log('');
console.log('  重要度分档（「生成重要角色人设」只跑前 ' + IMP_TIERS.length + ' 档）：');
console.log('    core  主角团 / 台词 ≥ ' + IMP_CORE_LINES + ' 句 : ' + impCount.core + ' 人');
console.log('    major 台词 ≥ ' + IMP_MAJOR_LINES + ' 句 / 有明确身份 : ' + impCount.major + ' 人');
console.log('    minor 有台词或说话人变量 : ' + impCount.minor + ' 人');
console.log('    extra 纯路人（没台词没身份） : ' + impCount.extra + ' 人');
console.log('    → 重要角色共 ' + impImportant + ' / ' + kept + ' 人' + '（只写重要的可省 ' + Math.round((1 - impImportant / Math.max(1, kept)) * 100) + '% 的额度）');
console.log('');
console.log('  抽样一组看看：');
/* 【必须给个空壳兜底】换一部游戏时，第一次扫描可能一个 NPC 都没收进来
 * （地图里没有可对话事件）。那时 groups 是空的，旧代码直接 sample.groupId →
 * 整个脚本崩在这里；而它一崩，后面 build_lorebook_input 也拿不到线索 —— 一步崩、全线断。 */
var sample = groups.find(function (g) {
  return g.members.length >= 3;
}) || groups[0] || {
  groupId: '-',
  title: '(这部游戏这次没扫到可对话 NPC)',
  members: []
};
console.log('    组 ' + sample.groupId + '  ' + sample.title + '  (' + sample.members.length + ' 人)');
sample.members.slice(0, 3).forEach(function (m) {
  console.log('      · ' + m.key + '  ' + m.actorName + '  ｜ ' + m.sprite + ' ｜ ' + m.place);
  console.log('        台词 ' + m.dialogues.length + ' 句' + (m.dialogues.length ? '，例: ' + JSON.stringify(m.dialogues[0].slice(0, 40)) : ''));
  console.log('        同场景: ' + m.neighbors.slice(0, 6).join(', '));
});
console.log('');