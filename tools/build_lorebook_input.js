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
 * 世界设定条目的线索打包器。
 *
 * 与「人设」不同的是：世界设定的条数**不能拍脑袋定**，得看原作留了多少证据。
 * tools/_probe_lorebook_evidence.js 量过之后，本作的实际情况是：
 *   · 证据充足（≥12 句）：只有 4 个主题（魔王 / 主角伊丽莎 / 女神妮拉 / 同伴）
 *   · 中等（5~9 句）    ：7 个
 *   · 薄（2~4 句）      ：17 个
 *   · 基本没有（≤1 句）  ：14 个（蜥蜴人、药草、香料、圣法王国…）
 * 而且「命中句」里相当一部分是成人内容（女神、吸血妖花的样本大半是），
 * 能用的更少。硬凑 45 条 = 十几条靠一句话硬扩写出 200 字，那就是臆造，违背「符合原作」。
 *
 * 所以条目按**证据密度**重新定档，并把两类来源分开标注：
 *   · dialogue —— 从原作台词里长出来的（要给足证据句）
 *   · harddata —— 从游戏数据表里直接读出来的（地图清单 / 道具表 / 敌种表），
 *                 这类**不是推断，就是原作事实**（「赫尔镇有武器店」来自 231 张地图）
 *
 * 用法: node tools/build_lorebook_input.js --www="<游戏 www 目录>"
 */
'use strict';

var fs = require('fs');
var path = require('path');
/* 【通用化 v2.8.0】地名表只在「有它」的时候才用。
 * 分发给别人的通用包里，这张表对不上别人的游戏（本作是赫尔镇/阿尔特镇，别人不是）——
 * 缺了它也要能跑：地名直接退回原作代号，功能不受影响。 */
var TOWN_CN = {};
try {
  TOWN_CN = require('./place_names.js').TOWN_CN || {};
} catch (e) {/* 没有这个文件也照跑 */}
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
/* 【通用化】线索目录与输出路径都可指定 —— 游戏内跑的时候这些文件在 www/ai_npc/ 下，
 * 而不是开发机上的 <项目>/_lore/。 */
var LORE = arg('lore') || path.join(HERE, '_lore');
var OUT = arg('out') || path.join(LORE, 'lorebook_input.json');
var read = function read(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
};
var readIf = function readIf(p) {
  try {
    return read(p);
  } catch (e) {
    return null;
  }
};
/** 目录里可能没有 ai_npc/ 这一层（游戏内指到 www/ai_npc 时它是平铺的），两条都试 */
var readRel = function readRel(rel) {
  var a = read(path.join(LORE, rel));
  return a;
};
var raw = read(path.join(LORE, 'lore_raw.json'));
/* 【通用化】world_bible 在通用流水线里是 AI 现生成的 —— 缺了就退化成空圣经，
 * 条目照样写得出，只是少了「不得违背」的世界骨架，不会崩。 */
var bible = readIf(path.join(LORE, 'world_bible.json')) || {};
var wb = function () {
  var a = readIf(path.join(WWW, 'ai_npc/worldbook.json'));
  if (a) return a;
  return readRel('worldbook.json');
}();

/* ============================================================ 台词清洗与打分 */
/* 成人内容要筛掉：本作是成人向，命中句里混着大量性描写。
 * 不筛的话模型会把条目写成色情设定 —— 我们要的是「世界」，不是那种内容。 */
var ADULT = /♡|♥|做爱|性爱|阴茎|阴部|阴道|胸部|乳房|乳头|射精|高潮|发情|色情|淫|肉棒|精液|爱抚|插入|舔|口交|肛|屁股|屁股|腿部|下体|生殖|受精|播种|怀孕/;
/** 台词的可信度打分：越像「在讲一件事」越高，越像呻吟/语气词越低 */
function scoreLine(t) {
  var s = String(t).trim();
  if (s.length < 8 || s.length > 100) return -1;
  if (ADULT.test(s)) return -1;
  var n = 0;
  if (/[。！？]$/.test(s)) n += 1;
  if (/是|有|在|叫|因为|所以|如果|可以|不能|必须|应该|据说|听说|以前|这里|那里/.test(s)) n += 2;
  if (s.length >= 14 && s.length <= 80) n += 1;
  if (/^(啊|嗯|呀|哦|呃|哈|咦|咦|唔|诶)/.test(s)) n -= 2;
  if ((s.match(/[，。！？]/g) || []).length >= 2) n += 1;
  return n;
}

/* 全语料池（含说话人标注，便于知道是谁说的） */
var pool = (raw.allLines || []).map(function (x) {
  var t = typeof x === 'string' ? x : x.text || '';
  var sp = typeof x === 'object' && x && x.speaker ? x.speaker : '';
  return {
    text: String(t).replace(/^【\\N\[\d+\]】\s*/, '').replace(/\\[A-Z]+\[\d+\]/g, '').trim(),
    speaker: sp
  };
}).filter(function (x) {
  return x.text;
});

/** 取某主题的证据：命中 → 打分 → 去重 → 排序 → 截断 */
function evidence(res, max) {
  var hit = [];
  var seen = new Set();
  pool.forEach(function (p) {
    if (!res.test(p.text)) return;
    var sc = scoreLine(p.text);
    if (sc < 1) return;
    var k = p.text.replace(/\s/g, '');
    if (seen.has(k)) return;
    seen.add(k);
    hit.push({
      t: p.text,
      s: sc
    });
  });
  hit.sort(function (a, b) {
    return b.s - a.s;
  });
  return hit.slice(0, max || 24).map(function (x) {
    return x.t;
  });
}

/* ============================================================ 硬数据（不是推断，是原作事实） */
/* ① 每座城镇有哪些设施 —— 直接数 231 张地图
 * 【坑】mapPaths 的值是**地图链**（"MAP001/Game / MAP200/dungeon2 / MAP166/area06_olr_dungeon"），
 * 一条链里含多个段。按「所有段」去数会把同一张图数进去十几遍 ——
 * 第一版就数出了「每镇旅店×16」这种荒唐数字。
 * 正确做法：先取**这张图自己那一段**（最后一个含 areaNN_ 的段），再按地图 id 计一次。 */
var townFac = {};
Object.keys(wb.mapPaths || {}).forEach(function (id) {
  var s = String(wb.mapPaths[id] || '');
  var segs = s.split(' / ');
  var own = '';
  for (var _i4 = 0; _i4 < segs.length; _i4++) {
    var g = segs[_i4];
    if (/area\d\d_/i.test(g)) own = g;
  }
  if (!own) own = segs[segs.length - 1] || s;
  var mm = /area(\d\d)_([A-Za-z0-9]+)/.exec(own);
  if (!mm) return;
  var town = TOWN_CN[mm[2]] || mm[2]; /* 通用化：认不出代号就原样用 */
  if (/^地牢/.test(town)) return;
  townFac[town] = townFac[town] || {
    maps: 0,
    fac: {}
  };
  townFac[town].maps++;
  /* 只看自己那一段的 token，按整 token 匹配 */
  var rest = own.replace(/^MAP\d+([\/\\]|(?=[A-Za-z]))/i, '').replace(/^area\d\d_[A-Za-z0-9]+_?/, '');
  var F = {
    church: '教堂',
    chief: '镇长家',
    wea: '武器店',
    arm: '防具店',
    ite: '道具店',
    INN: '旅店',
    dungeon: '地牢'
  };
  rest.split('_').filter(Boolean).forEach(function (t) {
    if (F[t]) townFac[town].fac[F[t]] = 1;else if (/^house[A-Da-d]$/.test(t)) townFac[town].fac['民宅'] = 1;else if (/^room[A-Fa-f]$/.test(t)) townFac[town].fac['房间'] = 1;
  });
});

/* ② 道具 / 装备的品级阶梯 —— 直接从数据表读，不是猜的 */
var nm = raw.names || {};
/** 数据表里混着作者自己的测试数据与废弃条目（`test_ポイズンスライム` / `【old】攻撃`）。
 *  喂给模型会让它把这些当成真实存在的东西写进设定里。 */
var isJunk = function isJunk(s) {
  return /^test|^【old】|^【\s*old\s*】|^＿|^_/i.test(String(s).trim());
};
var pick = function pick(list, re) {
  return (nm[list] || []).map(function (x) {
    return x.name || x;
  }).filter(function (s) {
    return !isJunk(s);
  }).filter(function (s) {
    return re.test(s);
  });
};
var items = (nm.Items || []).filter(function (x) {
  return !isJunk(x.name || x);
});
var groups = {
  potion: items.filter(function (x) {
    return /ポーション/.test(x.name || x);
  }).length ? ['恢复药（ポーション）'] : [],
  herb: pick('Items', /药草/),
  spice: pick('Items', /香料/),
  material: pick('Items', /狼牙|斗牛角|光亮鳞片|美丽羽毛|金子|光之果实|光之浆果|种子/),
  weaponTier: pick('Weapons', /剑|剣|斧|杖|弓|法术书|魔典|圣典|之书|权杖|之眼/),
  armorTier: pick('Armors', /甲|盾|长袍|斗篷|铠甲|外衣|披风/),
  books: pick('Weapons', /书|圣典|魔典|教科书/),
  enemies: (nm.Enemies || []).map(function (x) {
    return x.name || x;
  }).filter(function (s) {
    return !isJunk(s);
  })
};
/* 敌种按类归并（原作里「魔物少女」是一整个类别：狼女/吸血妖花少女/炎魔少女/史莱姆少女） */
groups.monsterGirls = groups.enemies.filter(function (s) {
  return /少女|女$/.test(s);
});
groups.slimeFamily = groups.enemies.filter(function (s) {
  return /史莱姆|スライム/i.test(s);
});
groups.hazardFamily = groups.enemies.filter(function (s) {
  return /蜂|虫|蜘蛛|蘑菇|蝎|蛙|蛇怪/i.test(s);
});
groups.knightFamily = groups.enemies.filter(function (s) {
  return /骑士|无头|巨魔|魔像|元素|怪/i.test(s);
});
groups.wildFamily = groups.enemies.filter(function (s) {
  return /狼|蜥蜴|人鱼|鹰身|迦楼罗|牛头|ミノタウロス|鲵|地精/i.test(s);
});
/* 【必须去重】Enemies 表里同一个敌种可能有多条记录（本作「魅魔少女」出现 6 次）——
 * 直接喂给模型，它会以为这个世界有六种魅魔少女。 */
Object.keys(groups).forEach(function (k) {
  if (!Array.isArray(groups[k])) return;
  var seen = new Set();
  groups[k] = groups[k].filter(function (s) {
    var t = String(s).trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
});
if (wb.shopCatalog) groups.shopCatalog = Object.keys(wb.shopCatalog).map(function (k) {
  var s = wb.shopCatalog[k] || {};
  var goods = (s.goodsSample || []).map(function (g) {
    return g.name;
  }).filter(Boolean);
  var seen = new Set();
  var uniq = goods.filter(function (g) {
    return seen.has(g) ? false : (seen.add(g), true);
  });
  return {
    event: k,
    ceName: s.ceName || '',
    shops: (s.usedBy || []).length,
    goods: uniq.slice(0, 40),
    goodsCount: uniq.length
  };
});

/* ③ 五个镇的地图张数（用来判断哪个镇"设施最全"） */
var townsSummary = Object.keys(townFac).map(function (t) {
  return {
    town: t,
    maps: townFac[t].maps,
    facilities: Object.keys(townFac[t].fac)
  };
}).sort(function (a, b) {
  return b.facilities.length - a.facilities.length;
});

/* ============================================================ 条目清单（按证据密度定档）
 * 【通用化 v2.8.0】下面这份是**本作**的清单，现在只是「缺省值」。
 * 通用流水线里，游戏内会先让 AI 读语料现拟一份清单写到 <LORE>/lorebook_spec.json，
 * 再用 --spec= 指过来 —— 换任何游戏都不用改这份代码。 */
/* source: dialogue = 从台词长出来（必须给证据）；harddata = 从数据表读出来 */
var SPEC_BUILTIN = [
/* —— 常驻骨架（每次都注入）——
 * 【只留三条】常驻是每回合都发的，重复内容等于每回合都在烧钱。
 * 第一版把「五座城镇 / 货币 / 圣法王国」也设成常驻，结果和「世界总览」大面积重复
 * （三条合计 600 多字讲的全是总览已经讲过的事）。现在改成：总览只讲世界骨架，
 * 那三条下放到 keyed —— 玩家提到城镇名、或站在某个镇上时自然就命中了。 */
{
  id: 'world-overview',
  title: '世界总览',
  kind: 'world',
  constant: true,
  len: 'long',
  source: 'bible',
  keys: [],
  note: '只写世界骨架：人与魔物的关系、王国与信仰、教会与裁判所、魔物使与魔王、' + '普通人的日子大概什么样。**不要罗列各城镇的设施清单**（那属于「五座城镇」那条），' + '也不要写货币细节（属于「货币与市井生活」那条）—— 三条常驻之间不许重复。'
}, {
  id: 'org-goddess',
  title: '女神妮拉与教会',
  kind: 'faith',
  constant: true,
  len: 'long',
  source: 'dialogue',
  keys: ['女神', '妮拉', '教会', '祷告', '祈祷', '圣光', '修女', '神父', '修士', '祝福'],
  re: /女神|妮拉|教会|祷告|祈祷|圣光|修女|神父|修士/
}, {
  id: 'org-tamer',
  title: '魔物使与人魔战争',
  kind: 'world',
  constant: true,
  len: 'mid',
  source: 'dialogue',
  keys: ['魔物使', '人魔战争', '战争', '驯服', '驱使', '怪物'],
  re: /魔物使|战争|驯服|驱使|怪物|人类与/
}, /* —— 下面三条本来是常驻，现改为触发（与总览重复，且由地点/话题自然命中）—— */
{
  id: 'world-kingdom',
  title: '圣法王国赫尔加尔',
  kind: 'world',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['圣法王国', '赫尔加尔', '王国', '律法圣地', '王都'],
  re: /圣法|赫尔加尔|王国|律法圣地/
}, {
  id: 'place-five-towns',
  title: '五座城镇',
  kind: 'place',
  constant: false,
  len: 'long',
  source: 'harddata',
  keys: ['五座城镇', '赫尔镇', '阿尔特镇', '卡斯镇', '伊势镇', '戈伊镇', '城镇设施'],
  note: '用 townsSummary 的硬数据：各镇设施清单与规模。'
}, {
  id: 'world-money',
  title: '货币与市井生活',
  kind: 'economy',
  constant: false,
  len: 'mid',
  source: 'mixed',
  keys: ['货币', '金币', '钱', '物价', '市井生活'],
  re: /货币|金币|物价|多少钱|太贵|便宜/
}, /* —— 魔物（按生态分组，不逐个魔物各写一条 —— 那样 14 条里有 10 条只有 1 句话撑着）—— */
{
  id: 'mon-ecology',
  title: '魔物的生态',
  kind: 'monster',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['魔物', '怪物', '魔物生态', '袭击'],
  re: /魔物|怪物/
}, {
  id: 'mon-girls',
  title: '魔物少女',
  kind: 'monster',
  constant: false,
  len: 'mid',
  source: 'mixed',
  keys: ['魔物少女', '魔物女孩', '狼女', '炎魔少女', '史莱姆少女', '吸血妖花少女'],
  re: /魔物少女|魔物女孩|少女/
}, {
  id: 'mon-slime-family',
  title: '史莱姆一类',
  kind: 'monster',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['史莱姆', '毒史莱姆', '熔岩史莱姆'],
  re: /史莱姆/
}, {
  id: 'mon-wild',
  title: '森林与沼泽的魔物',
  kind: 'monster',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['蜥蜴人', '美人鱼', '鹰身女妖', '哈比', '牛头怪', '巨蛙', '地精'],
  re: /蜥蜴人|美人鱼|鹰身|哈比|牛头怪|米诺陶|巨蛙|地精/
}, {
  id: 'mon-dungeon',
  title: '地牢深处的魔物',
  kind: 'monster',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['无头骑士', '烈焰骑士', '魔像', '凝视者', '不死', '骸骨'],
  re: /无头骑士|烈焰骑士|魔像|凝视者|不死|骸骨|亡灵/
}, {
  id: 'mon-hazard',
  title: '带毒带刺的魔物',
  kind: 'monster',
  constant: false,
  len: 'short',
  source: 'dialogue',
  keys: ['杀人蜂', '蜜蜂', '蘑菇怪', '人形蘑菇', '蜘蛛', '毒刺', '毒孢子'],
  re: /蜂|蘑菇|蜘蛛|毒刺|毒孢子|毒/
}, {
  id: 'mon-forest-king',
  title: '森林的统治者',
  kind: 'monster',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['吸血妖花', '治疗魔法'],
  re: /吸血妖花/
},
/* —— 城镇 ——
 * 【为什么只留两条】审计发现 place-kas ↔ place-ise 的内容重复度 0.37，一查硬数据：
 * 阿尔特 / 卡斯 / 伊势 / 戈伊 这四镇的**设施构成完全相同**（镇长家＋三店＋旅店＋民宅＋地牢），
 * 地图数也只差 1 张。分四条写必然互相重复，还占四次注入预算。
 * 合成一条才符合事实：这四镇就是同一个模具出来的，真正特殊的是赫尔镇（有教堂、没地牢）。 */
{
  id: 'place-hel',
  title: '赫尔镇',
  kind: 'place',
  constant: false,
  len: 'long',
  source: 'mixed',
  keys: ['赫尔', '赫尔镇', '赫尔加尔', '教堂', '祈祷'],
  re: /赫尔/,
  note: '顺带说明镇上那座教堂 —— 它是全王国**唯一**的一座（地图数据可证：全游戏只有 2 张 church 地图，都在 area01），' + '这正是赫尔镇被称作「律法圣地」的原因。'
}, {
  id: 'place-other-towns',
  title: '阿尔特镇・卡斯镇・伊势镇・戈伊镇',
  kind: 'place',
  constant: false,
  len: 'long',
  source: 'harddata',
  keys: ['阿尔特', '阿尔特镇', '卡斯', '卡斯镇', '伊势', '伊势镇', '戈伊', '戈伊镇', '其他城镇'],
  note: '这四镇设施构成相同，写成一条即可；重点讲它们的共同格局，以及彼此之间可辨的差别（地图规模）。'
},
/* —— 设施 ——
 * 【fac-church 已删】审计发现它与常驻的 org-goddess 内容重复度 0.34~0.44，
 * 而且它把「每座城镇都设有教堂」写成了事实 —— 与地图数据矛盾（教堂只有赫尔镇有）。
 * 「教会」作为机构归 org-goddess（常驻，总会注入）；「教堂」作为场所归 place-hel。
 * 少一条条目，少一次重复注入，还少一个错。 */
{
  id: 'fac-inn',
  title: '旅店与住宿',
  kind: 'facility',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['旅店', '旅馆', '住宿', '过夜', '房间'],
  re: /旅店|旅馆|住宿|过夜|休息/
}, {
  id: 'fac-shop',
  title: '三家店铺与买卖',
  kind: 'facility',
  constant: false,
  len: 'mid',
  source: 'harddata',
  keys: ['武器店', '防具店', '道具店', '商店', '买', '卖', '货'],
  note: '只写「这三家店是怎么经营的、各自卖什么类别的货、货架怎么组织」。' + '**不要罗列武器与防具的具体品级名称**（那属于「武器与防具的品级」那条，审计发现两条重复度 0.43）。'
}, {
  id: 'fac-dungeon',
  title: '地牢',
  kind: 'facility',
  constant: false,
  len: 'short',
  source: 'dialogue',
  keys: ['地牢', '洞窟', '深处'],
  re: /地牢|洞窟/
}, /* —— 组织与信仰 —— */
{
  id: 'org-inquisition',
  title: '宗教裁判所',
  kind: 'org',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['宗教裁判所', '审判庭', '异端', '裁决'],
  re: /裁判所|审判庭|异端|裁决/
}, {
  id: 'org-heretic',
  title: '「异形」与被改造的人',
  kind: 'org',
  constant: false,
  len: 'short',
  source: 'dialogue',
  keys: ['异形', '改造', '有罪的人'],
  re: /异形|改造/
}, {
  id: 'org-demonlord',
  title: '魔王',
  kind: 'org',
  constant: false,
  len: 'long',
  source: 'dialogue',
  keys: ['魔王', '魔王军', '讨伐'],
  re: /魔王/
}, /* —— 经济与生活 —— */
{
  id: 'eco-herbs',
  title: '药草与药材的品级',
  kind: 'economy',
  constant: false,
  len: 'mid',
  source: 'harddata',
  keys: ['药草', '药材', '中级药草', '高级药草', '解毒草'],
  note: '用 Items 表里的品级阶梯'
}, {
  id: 'eco-spice',
  title: '香料与特产',
  kind: 'economy',
  constant: false,
  len: 'mid',
  source: 'mixed',
  keys: ['香料', '陈年香料', '新鲜香料', '蜂蜜', '坚果', '特产'],
  re: /香料|蜂蜜|坚果|特产/
}, {
  id: 'eco-arms',
  title: '武器与防具的品级',
  kind: 'economy',
  constant: false,
  len: 'mid',
  source: 'harddata',
  keys: ['武器', '防具', '剑', '铠甲', '盾'],
  note: '用 Weapons/Armors 表的品级阶梯'
}, /* —— 主线与时事（用户点名要这一层）—— */
{
  id: 'story-eliza',
  title: '主角伊丽莎',
  kind: 'story',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['伊丽莎', '魔物使', '乡村女孩'],
  re: /伊丽莎|主角/
}, {
  id: 'story-party',
  title: '伊丽莎的同伴',
  kind: 'story',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['德拉莉亚', '雷米', '伊尔梅拉', '苏莱娜', '卡拉', '泽西亚', '同伴'],
  re: /德拉莉亚|雷米|伊尔梅拉|苏莱娜|卡拉|泽西亚|同伴/
}, {
  id: 'story-castle',
  title: '魔王城与讨伐之行',
  kind: 'story',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['魔王城', '最深处', '讨伐', '城堡'],
  re: /魔王城|最深处|讨伐|城堡/
}, {
  id: 'story-worldstate',
  title: '世道与时局',
  kind: 'story',
  constant: false,
  len: 'mid',
  source: 'dialogue',
  keys: ['最近', '近来', '如今', '世道', '时局'],
  re: /最近|近来|如今|世道|时局|这一带/
}];

/* ============================================================ 清单来源：外部优先
 * AI 现拟的清单是 JSON（正则只能是字符串），这里负责把它编译回 RegExp。 */
function loadSpec() {
  var p = arg('spec') || path.join(LORE, 'lorebook_spec.json');
  var s = readIf(p);
  if (!s) return null;
  var list = Array.isArray(s) ? s : s.entries || null;
  if (!list || !list.length) return null;
  return list.filter(function (e) {
    return e && e.id && e.title;
  }).map(function (e) {
    return {
      id: String(e.id),
      title: String(e.title),
      kind: e.kind || 'world',
      constant: !!e.constant,
      len: ['long', 'mid', 'short'].indexOf(e.len) >= 0 ? e.len : 'mid',
      source: e.source || 'dialogue',
      keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
      re: e.re ? e.re instanceof RegExp ? e.re : new RegExp(String(e.re)) : null,
      note: e.note || ''
    };
  });
}
/* 【绝不能悄悄回退到本作的清单】以前这里无条件 `|| SPEC_BUILTIN`：换一部游戏时，
 * 只要 AI 那份清单还没生成好，就会拿着「赫尔镇 / 女神妮拉 / 魔物使」这 28 条去写别人的世界 ——
 * 那是最坏的结果（一本正经地胡说，而且看起来还挺像样）。
 * 所以：只有在开发机上按默认路径跑（既没给 --out 也没给 --lore）才允许用内置清单；
 * 通用流水线里缺清单就直接报错，让 gen_topics.js 先去拟。 */
var SPEC = loadSpec() || (arg('out') || arg('lore') ? null : SPEC_BUILTIN);
if (!SPEC) {
  /* 【v2.9.0】原来这里 `throw new Error(msg)` —— 命令行上会先打一行 ✘ 再甩一大坨
   * node 内部栈（`at node:internal/main/run_main_module:36:49`），看着像插件崩了。
   * 这其实是**设计好的拦截**（防止拿上一部作品的清单去写别人的世界），
   * 所以改成和其他护栏一致：一行话 + 干净退出。游戏内跑时 process.exit 由假 process 接管，
   * 行为不变（依旧是「这一次工具调用失败」）。 */
  console.error('✘ 缺少条目清单（ai_npc/lorebook_spec.json）—— 请先让 AI 拟一份（gen_topics.js）');
  process.exit(1);
}

/* ============================================================ 组装 */
var entries = SPEC.map(function (s) {
  var ev = s.re ? evidence(s.re, s.len === 'long' ? 26 : 16) : [];
  return {
    id: s.id,
    title: s.title,
    kind: s.kind,
    constant: !!s.constant,
    len: s.len,
    source: s.source,
    keys: s.keys || [],
    note: s.note || '',
    evidenceCount: ev.length,
    evidence: ev
  };
});
var out = {
  version: 1,
  /* 【v2.9.0 指纹】见 build_persona_input.js 里同名注释：用来认出"别的作品留下的线索包"。 */
  gameTitle: String(wb && wb.game && (wb.game.title || wb.game.name) || wb && wb.gameTitle || '').trim(),
  generatedAt: new Date().toISOString(),
  _about: '世界设定条目的线索包 —— 由 build_lorebook_input.js 生成。' + '条数按证据密度定档，不按"想要多少条"定档。',
  stats: {
    entries: entries.length,
    constant: entries.filter(function (e) {
      return e.constant;
    }).length,
    withDialogueEvidence: entries.filter(function (e) {
      return e.evidenceCount > 0;
    }).length,
    hardDataOnly: entries.filter(function (e) {
      return e.source === 'harddata';
    }).length,
    corpusLines: pool.length,
    corpusUsableLines: pool.filter(function (p) {
      return scoreLine(p.text) >= 1;
    }).length
  },
  worldBible: bible,
  hardData: {
    towns: townsSummary,
    townFacilities: townFac,
    itemGroups: groups
  },
  entries: entries
};

/* 【Node 9 / 老内核】游戏里的 NW.js 是 Node 9，mkdirSync 的 recursive 选项会被静默忽略
 * （Node 10.12 才加的）—— 目录已存在就抛 EEXIST，自动流程必然死在最后一步。
 * 所以自己兜一层：抛了但目录其实在，就当成功。 */
try {
  fs.mkdirSync(path.dirname(OUT), {
    recursive: true
  });
} catch (e) {
  if (!fs.existsSync(path.dirname(OUT))) throw e;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('');
console.log('语料 ' + pool.length + ' 句，其中可用（非成人内容 / 有信息量）' + out.stats.corpusUsableLines + ' 句');
console.log('');
console.log('条目 ' + entries.length + ' 条（常驻 ' + out.stats.constant + ' 条）');
console.log('');
console.log('  ' + 'id'.padEnd(22) + '标题'.padEnd(16) + '来源'.padEnd(10) + '篇幅'.padEnd(6) + '证据句');
console.log('  ' + '─'.repeat(66));
entries.forEach(function (e) {
  console.log('  ' + e.id.padEnd(22) + e.title.padEnd(16) + e.source.padEnd(10) + e.len.padEnd(6) + e.evidenceCount);
});
var noEv = entries.filter(function (e) {
  return e.evidenceCount === 0;
});
console.log('');
console.log('  无台词证据、纯靠游戏数据表的条目：' + noEv.length + ' 条（' + noEv.map(function (e) {
  return e.id;
}).join(', ') + '）');
console.log('');
console.log('已写出 ' + OUT);
console.log('');