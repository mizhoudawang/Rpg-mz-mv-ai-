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
 * 人设生成核心 —— 拼提示词 / 调用大模型 / 解析结果 / 写回世界书。
 * 命令行（tools/gen_persona.js）与游戏内一键生成共用同一份提示词模板，
 * 保证两条路上跑出来的风格一致。
 */
'use strict';

var fs = require('fs');
var path = require('path');

/* ============================================================ 读数据 */
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

/* ============================================================ 世界观压缩成一段文本
 * world_bible.json 有 6 KB，原样塞进每次请求太费。压成 ~700 字的紧凑叙述，
 * 保留所有「人设不得违背」的硬事实，丢掉解释性文字。 */
function compactWorld(b) {
  var L = [];
  L.push('世界：' + b.world.summary);
  L.push('王国：' + b.world.kingdom.name + ' —— ' + b.world.kingdom.note);
  L.push('主要城镇：' + (b.world.regions || []).map(function (r) {
    return r.town + '（' + r.key + '）：' + (r.note || '');
  }).join('；'));
  L.push('地点：' + Object.keys(b.world.places || {}).map(function (k) {
    return k + '＝' + b.world.places[k];
  }).join(' / '));
  L.push('信仰：' + b.faith.goddess + '。' + b.faith.desc + ' 信众问候语：「' + (b.faith.greetings || []).join('」「') + '」');
  L.push('势力：' + Object.keys(b.factions || {}).map(function (k) {
    return k + '：' + b.factions[k];
  }).join(' '));
  L.push('魔物：' + b.monsters.nature + ' 已知种类：' + (b.monsters.known || []).join('、') + '。');
  L.push('社会：' + b.society.daily + ' 货币为' + b.society.currency + '。' + b.society.attitude);
  L.push('主角：' + b.protagonist.name + '，' + b.protagonist.desc + ' 同伴：' + (b.protagonist.companions_actors || []).map(function (c) {
    return c.name;
  }).join('、') + '。');
  L.push('命名：' + b.naming_convention.rule + b.naming_convention.implication);
  return L.join('\n');
}

/* ============================================================ 渲染一个成员
 * 【与插件同源 · v2.9.5 原作定位】{{ROLE}} 必须渲染。漏掉它会有两个后果：
 *   ① 提示词里留下字面量「{{ROLE}}」，模型看到一行占位符；
 *   ② 扫描器认出的身份（100 学生 / 7 魔女 / 7 素材商人 …）整条丢失 ——
 *      这是"他是谁、该长什么样"最直接的线索。
 * 分支归属商人（事件本体没有台词）还会带上在售商品。
 * 此处实现与 RM_AI_NPC.js 的 Ainpc.renderMember 逐句一致，改一边必须改另一边。 */
function renderMember(m, idx, tpl) {
  var dlg = m.dialogues && m.dialogues.length ? m.dialogues.slice(0, 12).map(function (t) {
    return '    「' + t + '」';
  }).join('\n') : tpl.noDialogueNote;
  var roleTxt = String(m.oldRole || '（未标注）');
  if (m.goods && m.goods.length) roleTxt += '（本店在售：' + m.goods.slice(0, 12).join('、') + '）';
  return tpl.memberTemplate.replace('{{INDEX}}', String(idx + 1)).replace('{{KEY}}', m.key).replace('{{SPRITE}}', m.sprite || '（未知）').replace('{{ROLE}}', roleTxt).replace('{{ACTOR_NAME}}', m.actorName || '（无）').replace('{{DIALOGUES}}', dlg).replace('{{NEIGHBORS}}', (m.neighbors || []).join('、') || '（无）');
}

/* ============================================================ 渲染范例
 * 【关键】范例卡必须与本次要生成的 key 彻底脱钩：否则模型会直接把范例的 key 照抄回来，
 * 导致生成结果错位（把 M10:E5 的人设贴到别人身上）。所以把 key 换成占位符并删掉无关字段。 */
function renderSample(sample, max) {
  var cards = (sample.cards || []).slice(0, max || 3);
  return cards.map(function (c) {
    var o = Object.assign({}, c);
    o.key = '（占位符，不要照抄 —— 你必须用上面每一行里给出的真实 key）';
    delete o.actorId;
    return JSON.stringify(o, null, 1);
  }).join(',\n');
}
function buildMessages(world, group, tpl, sample, opts) {
  opts = opts || {};
  var members = group.members.slice(0, tpl.batch.maxMembersPerCall);
  /* 【名字黑名单】每组是独立一次调用，模型看不见别的组取了什么名 ——
   * 于是「莉赛尔」在六个镇上各出现一次。把已经用掉的名字带进来，让它避开。
   * 注意：这条只加提示，不加约束；模型偶尔仍会撞，所以审计里还要再查一遍。 */
  var avoid = (opts.avoidNames || []).filter(Boolean);
  /* 同一份清单要在两个地方各出现一次：开头（立规矩）和结尾（紧挨着"开始写"）。
   * 实测只写在开头时，模型偶尔会无视 —— 10 组里有 4 组撞名。
   * 结尾那条是防呆，措辞短、祈使句、不含清单正文（免得又长又容易被忽略）。 */
  var avoidTxt = avoid.length ? '【已被占用的名字 —— 本作别处已经有人叫这些名字了，你不要再用】\n' + avoid.join('、') + '\n（请给你的角色另取不同的名字。同一个名字在这个世界里只能有一个人，' + '也不能落在上面这份清单里。）\n\n' : '';
  var avoidTail = avoid.length ? '④ 名字逐个对照上面那份「已被占用的名字」清单 —— 任何一个撞上都必须换掉，一个都不许重复。' : '';
  var user = tpl.userTemplate.replace('{{AVOID}}', avoidTxt).replace('{{AVOID_TAIL}}', avoidTail).replace('{{WORLD_BIBLE}}', world).replace('{{COUNT}}', String(members.length)).replace(/\{\{COUNT\}\}/g, String(members.length)).replace('{{PLACE}}', group.title + '（' + group.place + '）').replace('{{MEMBERS}}', members.map(function (m, i) {
    return renderMember(m, i, tpl);
  }).join('\n\n')).replace('{{SAMPLE}}', renderSample(sample, 3));
  return {
    system: tpl.system,
    messages: [{
      role: 'system',
      content: tpl.system
    }, {
      role: 'user',
      content: user
    }],
    keys: members.map(function (m) {
      return m.key;
    })
  };
}

/* ============================================================ 脏 JSON 清洗
 * 「解析不出 JSON」占人设生成失败的绝大多数，而且几乎都不是"模型没写"，是**写了但写脏了**。
 * 实测四种坏毛病，逐个治：
 *   ① ```json 围栏 / 前后夹解说      -> parseCards 外面已剥掉
 *   ② 尾随逗号   {"a":1,}  ["x",]   -> 删掉 , 前面的 }/]
 *   ③ 注释       // 行注释 / 块注释   -> 删掉（只删独立成行的，避免误伤 URL 的 //）
 *   ④ 字符串里写了**裸换行/制表符**   -> 转义成 \n \t（JSON 规范禁止字符串里出现裸控制字符）
 * 注意：清洗只在**原文 parse 失败之后**才做；改坏了就退回原文，绝不比原文更差。 */
function repairJsonText(s) {
  var t = String(s || '');
  t = t.replace(/^\s*\/\/.*$/gm, ''); // ③ 独立成行的 // 注释
  t = t.replace(/\/\*[\s\S]*?\*\//g, ''); // ③ 块注释
  t = t.replace(/,\s*([}\]])/g, '$1'); // ② 尾随逗号
  var out = '',
    inStr = false,
    esc = false; // ④ 字符串内的裸控制字符
  for (var i = 0; i < t.length; i++) {
    var ch = t[i];
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        esc = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inStr = false;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        out += ' ';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    }
    out += ch;
  }
  return out;
}

/** 抢救**最后一个没写完**的对象 —— 它才是被截断的那张卡。
 *  常见物：`{"key":"M8:E5","personality":"他是个热心` 这种半句话结尾。
 *  试几种"补上收尾"的组合，能 parse 出来就留下。多救一张是一张。 */
function salvageTail(s) {
  var i = s.lastIndexOf('{');
  if (i < 0) return null;
  var tail = s.slice(i);
  if (tail.length > 4000) return null; // 明显不是一张卡了
  for (var _i2 = 0, _ref2 = ['"', '']; _i2 < _ref2.length; _i2++) {
    var q = _ref2[_i2];
    for (var _i4 = 0, _ref4 = [false, true]; _i4 < _ref4.length; _i4++) {
      var trim = _ref4[_i4];
      var t = tail;
      if (trim) t = t.replace(/[,\s]+$/, '');
      for (var k = 1; k <= 3; k++) {
        try {
          var o = JSON.parse(t + q + '}'.repeat(k));
          if (o && typeof o === 'object' && o.key) return o;
        } catch (e) {/* 换个补法 */}
      }
    }
  }
  return null;
}

/** 宽松解析：容忍围栏 / 前后杂字 / 尾随逗号 / 注释 / 裸控制字符 / 单个对象 / **被截断的回复** */
function parseCards(text) {
  var raw = String(text == null ? '' : text);
  var s = raw.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  /* 依次尝试：原文 → 清洗版。哪一步先出结果用哪个。 */
  var tries = [s];
  var fixed = repairJsonText(s);
  if (fixed !== s) tries.push(fixed);
  var arr = null;
  for (var _i6 = 0; _i6 < tries.length; _i6++) {
    var t = tries[_i6];
    try {
      arr = JSON.parse(t);
    } catch (e) {/* 下一招 */}
    if (arr) break;
  }
  if (!arr) {
    for (var _i8 = 0; _i8 < tries.length; _i8++) {
      var _t = tries[_i8];
      var i = _t.indexOf('['),
        j = _t.lastIndexOf(']');
      if (i >= 0 && j > i) {
        try {
          arr = JSON.parse(_t.slice(i, j + 1));
        } catch (e) {}
      }
      if (arr) break;
    }
  }
  if (!arr) {
    /* 单个对象也接受 —— **但仅当原文里根本没有数组括号**时。
     * 否则会把"被截断的数组"误读成"只有第一个对象"：实测 [{"key":"a"},{"key":"b"
     * 会被"第一个{ 到最后一个}"这一招捞成只有 a，后面那张永远救不回来。
     * 没有 '[' 才说明模型本来就只写了一个对象。 */
    for (var _i0 = 0; _i0 < tries.length; _i0++) {
      var _t2 = tries[_i0];
      if (_t2.indexOf('[') >= 0) continue;
      var _i1 = _t2.indexOf('{'),
        _j = _t2.lastIndexOf('}');
      if (_i1 >= 0 && _j > _i1) {
        try {
          arr = [JSON.parse(_t2.slice(_i1, _j + 1))];
        } catch (e) {}
      }
      if (arr) break;
    }
  }
  if (!arr) {
    var _loop = function _loop() {
      var t = tries[_i11];
      var objs = salvageObjects(t);
      var extra = salvageTail(t);
      if (extra && !objs.some(function (o) {
        return o && o.key === extra.key;
      })) objs.push(extra);
      if (objs.length) {
        arr = objs;
        return 1; // break
      }
    };
    /* 【截断抢救】把回复里所有**配平**的 {...} 逐个抠出来；再救一把末尾那个没写完的对象
     * （salvageTail）。写完的救回来，没写的丢掉。
     * ⚠ 注意顺序：**不能**因为"抠到了配平对象"就跳过末尾抢救 —— 数组被掐断时，
     * 前面几张是配平的、最后一张是半截的，两张都得救。 */
    for (var _i11 = 0; _i11 < tries.length; _i11++) {
      if (_loop()) break;
    }
  }
  if (!arr) return null;
  if (!Array.isArray(arr)) arr = [arr];
  return arr.filter(function (c) {
    return c && typeof c === 'object' && c.key;
  });
}

/** 从任意（可能是截断的）文本里抠出所有配平的 JSON 对象。
 *  字符串内的花括号会被正确跳过，所以人设文本里写「{」也不会误判。 */
function salvageObjects(s) {
  var out = [];
  var depth = 0,
    start = -1,
    inStr = false,
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
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(s.slice(start, i + 1)));
        } catch (e) {/* 这一个坏了就跳过 */}
        start = -1;
      }
    }
  }
  return out;
}

/* ============================================================ 写回世界书 */
/** 空字段的确定性兜底。
 *  relations 留空在多见于"独门独户的单人场景"（店主、隐藏区域里的人）——
 *  模型不写也不影响扮演，但字段规范里要求它写一句克制的说明，
 *  而且 AI 拿到一句"和镇上人点头之交"总比拿到空串更有分寸感。
 *  greeting 留空则真的会让 NPC 开场没气质，给一句中性的。 */
var FALLBACK = {
  relations: '与同镇的人点头之交，没有特别亲近或疏远的人。',
  greeting: '「……你好。有什么事吗？」'
};
/** 把 cards 里每个人的 persona 写进 worldbook 的 npcs 条目，键用 key 匹配 */
function applyCards(wb, cards) {
  var byKey = {};
  cards.forEach(function (c) {
    if (c && c.key) byKey[c.key] = c;
  });
  var hit = 0;
  for (var _i13 = 0, _ref6 = wb.npcs || []; _i13 < _ref6.length; _i13++) {
    var n = _ref6[_i13];
    var c = byKey[n.key];
    if (!c) continue;
    n.persona = {
      name: c.name || n.name,
      identity: c.identity || '',
      appearance: c.appearance || '',
      personality: c.personality || '',
      speech: c.speech || '',
      knowledge: Array.isArray(c.knowledge) ? c.knowledge : c.knowledge ? [String(c.knowledge)] : [],
      stance: c.stance || '',
      relations: c.relations || FALLBACK.relations,
      greeting: c.greeting || FALLBACK.greeting,
      taboo: c.taboo || null,
      generatedAt: new Date().toISOString()
    };
    if (c.name) {
      n.name = c.name;
      n.nameFrom = 'persona';
    }
    hit++;
  }
  return hit;
}

/* ============================================================ 调用大模型 */
/**
 * @param opts.maxTokens  显式要的输出上限。一组最多 8 人的八件套远超常规对话长度，
 *                        不给足会让回复在 JSON 数组中途断掉（服务端默认值未必够）。
 * @param opts.noMaxTokens  true = 完全不发这个字段（上次被服务端 400 拒过时用）。
 */
function callLLM(cfg, sys, user, cb, opts) {
  opts = opts || {};
  var https = require('https'),
    http = require('http'),
    urlmod = require('url');
  var payload = {
    model: cfg.model,
    messages: [{
      role: 'system',
      content: sys
    }, {
      role: 'user',
      content: user
    }],
    temperature: cfg.temperature != null ? cfg.temperature : 1.0,
    stream: false
  };
  if (!opts.noMaxTokens) payload.max_tokens = opts.maxTokens || 8000;
  var body = JSON.stringify(payload);
  var u = urlmod.parse(cfg.endpoint);
  var mod = u.protocol === 'https:' ? https : http;
  var headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': 'Bearer ' + cfg.apiKey
  };
  var req = mod.request({
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: (u.pathname || '/') + (u.search || ''),
    method: 'POST',
    headers: headers
  }, function (res) {
    var chunks = [];
    res.on('data', function (c) {
      return chunks.push(c);
    });
    res.on('end', function () {
      return cb(null, res.statusCode, Buffer.concat(chunks).toString('utf8'));
    });
  });
  req.on('error', function (e) {
    return cb(e);
  });
  req.setTimeout(cfg.timeoutMs || 120000, function () {
    req.destroy(new Error('请求超时'));
  });
  req.write(body);
  req.end();
}

/* ============================================================ 从游戏 config.json 取配置 */
function loadLLMConfig(www, cli) {
  var p = path.join(www, 'ai_npc/config.json');
  var cfg = {};
  if (fs.existsSync(p)) {
    try {
      cfg = readJson(p);
    } catch (e) {}
  }
  return {
    endpoint: cli.endpoint || cfg.endpoint || 'https://api.deepseek.com/chat/completions',
    apiKey: cli.apiKey || cfg.apiKey || '',
    model: cli.model || cfg.model || 'deepseek-chat',
    temperature: cli.temperature != null ? cli.temperature : 1.0,
    timeoutMs: cfg.timeoutMs || 120000
  };
}
module.exports = {
  readJson: readJson,
  compactWorld: compactWorld,
  buildMessages: buildMessages,
  parseCards: parseCards,
  applyCards: applyCards,
  callLLM: callLLM,
  loadLLMConfig: loadLLMConfig,
  renderMember: renderMember,
  /* v2.9.0 导出，便于探针单独验证「脏 JSON 清洗」与「截断抢救」 */
  repairJsonText: repairJsonText,
  salvageObjects: salvageObjects,
  salvageTail: salvageTail
};