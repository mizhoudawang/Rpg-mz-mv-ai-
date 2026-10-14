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
 * 语料摘要器 —— 把 extract_lore.js 抽出来的那份 1.6 MB 的大语料，压成一份
 * 「够大模型读懂这部游戏在讲什么、又不至于烧掉几万 token」的摘要。
 *
 * 【为什么要单独抽一个模块】
 * 「AI 现写世界观圣经」和「AI 现拟世界设定主题清单」两步都要先读语料，
 * 而这两步在**命令行**（tools/gen_bible.js）和**游戏内**（插件的一键准备）都要跑。
 * 摘要规则只写这一份，两边加载同一段源码 —— 否则两边摘要不同，生成结果就对不上。
 *
 * 【摘要给什么】
 *   ① 游戏名 / 货币 / 引擎术语（System.json）
 *   ② 官方角色名 + 简介（谁是主角、谁有戏份）
 *   ③ 地图名（能看出这游戏有几个城镇、几处地牢）
 *   ④ 世界词汇表：道具 / 武器 / 防具 / 技能 / 敌种 / 状态（世界观的名词骨干）
 *   ⑤ 台词样本：从全量语料里挑「有信息量」的句子（去成人内容、去语气词）
 *   ⑥ 作者注释：分区标记、剧情提示
 *
 * 用法（一般不用直接跑，被 gen_bible / gen_topics 调用）:
 *   node -e "console.log(require('./tools/corpus_digest.js').digest(...))"
 */
'use strict';

/** 成人内容 —— 本作是成人向，命中句里混着大量性描写。
 *  不筛的话模型会把世界观写成色情设定 —— 我们要的是「世界」，不是那种内容。 */
var ADULT = /♡|♥|做爱|性爱|阴茎|阴部|阴道|胸部|乳房|乳头|射精|高潮|发情|色情|淫|肉棒|精液|爱抚|插入|舔|口交|肛|屁股|下体|生殖|受精|播种|怀孕/;

/** 台词可信度：越像「在讲一件事」越高，越像呻吟 / 语气词越低 */
function scoreLine(t) {
  var s = String(t).trim();
  if (s.length < 8 || s.length > 100) return -1;
  if (ADULT.test(s)) return -1;
  var n = 0;
  if (/[。！？]$/.test(s)) n += 1;
  if (/是|有|在|叫|因为|所以|如果|可以|不能|必须|应该|据说|听说|以前|这里|那里/.test(s)) n += 2;
  if (s.length >= 14 && s.length <= 80) n += 1;
  if (/^(啊|嗯|呀|哦|呃|哈|咦|唔|诶)/.test(s)) n -= 2;
  if ((s.match(/[，。！？]/g) || []).length >= 2) n += 1;
  return n;
}
var clean = function clean(t) {
  return String(t || '').replace(/^【\\N\[\d+\]】\s*/, '').replace(/\\N\[\d+\]/g, '').replace(/\\C\[\d+\]/g, '').replace(/\\[<>|.^!$]/g, '').replace(/\s+/g, ' ').trim();
};

/** 作者自己的测试数据 / 废弃条目 —— 喂给模型会让它当成真实存在的东西写进设定 */
var isJunk = function isJunk(s) {
  return /^test|^【old】|^【\s*old\s*】|^＿|^_|^[-=_*\s]+$/i.test(String(s || '').trim());
};
var uniq = function uniq(a) {
  var s = new Set();
  return a.filter(function (x) {
    return s.has(x) ? false : (s.add(x), true);
  });
};
var cap = function cap(a, n) {
  return a.slice(0, n);
};

/**
 * @param {object} raw     lore_raw.json 的内容
 * @param {object} [opts]  { maxDialogue, maxVocab, maxActors }
 * @returns {object} 摘要（纯 JSON，便于两边传递与断言）
 */
function digest(raw, opts) {
  opts = opts || {};
  var MAX_DLG = opts.maxDialogue || 220;
  var MAX_VOCAB = opts.maxVocab || 90;
  var MAX_ACTORS = opts.maxActors || 60;
  raw = raw || {};
  var game = raw.game || {};
  var terms = raw.terms || {};

  /* ① 角色 */
  var actors = cap((raw.actors || []).map(function (a) {
    return {
      id: a.id,
      name: String(a.name || '').trim(),
      profile: String(a.profile || '').trim().slice(0, 150),
      hasProfile: !!String(a.profile || '').trim()
    };
  }).filter(function (a) {
    return a.name && !isJunk(a.name);
  }), MAX_ACTORS);

  /* ② 地图名（去重、去掉纯编号） */
  var mapNames = uniq((raw.maps || []).map(function (m) {
    return String(m.name || '').trim();
  }).filter(function (n) {
    return n && !isJunk(n);
  })).slice(0, 120);

  /* ③ 世界词汇表 */
  var names = raw.names || {};
  var vocab = {};
  for (var _i2 = 0, _Object$keys2 = Object.keys(names); _i2 < _Object$keys2.length; _i2++) {
    var k = _Object$keys2[_i2];
    var list = uniq((names[k] || []).map(function (x) {
      return String(x.name || x).trim();
    }).filter(function (s) {
      return s && !isJunk(s);
    }));
    if (list.length) vocab[k] = cap(list, MAX_VOCAB);
  }
  /* ④ 台词样本：全池打分 → 高的优先，同时保留一定覆盖面 */
  var pool = (raw.allLines || []).map(function (x) {
    return clean(typeof x === 'string' ? x : x && x.text);
  }).filter(Boolean);
  var scored = uniq(pool).map(function (t) {
    return {
      t: t,
      s: scoreLine(t)
    };
  }).filter(function (x) {
    return x.s >= 1;
  }).sort(function (a, b) {
    return b.s - a.s;
  });
  /* 高分句容易全是同一角色的口癖 —— 穿插一些中分的，保证话题面广 */
  var hi = scored.filter(function (x) {
    return x.s >= 4;
  }).map(function (x) {
    return x.t;
  });
  var mid = scored.filter(function (x) {
    return x.s >= 1 && x.s < 4;
  }).map(function (x) {
    return x.t;
  });
  var dialogue = cap(uniq([].concat(hi.slice(0, Math.round(MAX_DLG * 0.7)), mid.slice(0, Math.round(MAX_DLG * 0.3)))), MAX_DLG);

  /* ⑤ 作者注释 */
  var comments = uniq((raw.comments || []).map(function (c) {
    return clean(typeof c === 'string' ? c : c && c.text);
  }).filter(function (t) {
    return t && t.length < 90 && !/^[-=_\s]*$/.test(t);
  })).slice(0, 60);
  return {
    gameTitle: String(game.title || ''),
    currency: String(game.currency || '').trim(),
    engine: raw.source && raw.source.engine || '',
    actorCount: (raw.actors || []).length,
    mapCount: (raw.maps || []).length,
    lineCount: pool.length,
    actors: actors,
    mapNames: mapNames,
    vocab: vocab,
    dialogue: dialogue,
    comments: comments,
    termsBasic: cap(terms.basic || [], 60)
  };
}

/** 把摘要渲染成给模型读的文本（提示词里 {{CORPUS}} 就是它） */
function render(d) {
  var L = [];
  L.push('【游戏名】' + (d.gameTitle || '(未命名)'));
  if (d.engine || d.currency) L.push('【引擎/货币】' + (d.engine || '?') + (d.currency ? ' ｜ 货币单位: ' + d.currency : ''));
  L.push('【规模】台词 ' + d.lineCount + ' 条 / 地图 ' + d.mapCount + ' 张 / 官方角色 ' + d.actorCount + ' 个');
  L.push('');
  if (d.actors.length) {
    L.push('【官方角色（含主角，看得出谁有戏份）】');
    d.actors.forEach(function (a) {
      return L.push('  ' + a.id + '. ' + a.name + (a.profile ? ' —— ' + a.profile : ''));
    });
    L.push('');
  }
  if (d.mapNames.length) {
    L.push('【地图名（能看出有几个城镇、几处地牢）】');
    L.push('  ' + d.mapNames.join(' / '));
    L.push('');
  }
  var vk = Object.keys(d.vocab);
  if (vk.length) {
    L.push('【世界词汇表（道具/装备/技能/敌种/状态 —— 世界观的名词骨干）】');
    vk.forEach(function (k) {
      return L.push('  ' + k + '：' + d.vocab[k].join('、'));
    });
    L.push('');
  }
  if (d.comments.length) {
    L.push('【作者注释（分区标记 / 剧情提示，来自事件指令）】');
    d.comments.forEach(function (c) {
      return L.push('  · ' + c);
    });
    L.push('');
  }
  if (d.dialogue.length) {
    L.push('【原作台词样本（已剔除成人内容，按信息量排序）】');
    d.dialogue.forEach(function (t, i) {
      return L.push('  ' + (i + 1) + '. 「' + t + '」');
    });
    L.push('');
  }
  return L.join('\n');
}
module.exports = {
  digest: digest,
  render: render,
  scoreLine: scoreLine,
  clean: clean,
  isJunk: isJunk,
  ADULT: ADULT
};