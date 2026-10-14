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
 * 世界设定「主题清单」生成器 —— 让 AI 读原作语料，现场拟出这部游戏该写哪些设定条目。
 *
 * 【v2.8.0 为什么要有它】在此之前，条目清单是 build_lorebook_input.js 里一段**写死的
 * SPEC 数组**（女神妮拉 / 赫尔镇 / 魔物使…）。换一部游戏，那段数组整个不成立 ——
 * 这是「世界设定只能给同一款游戏用」的根因。现在改成 AI 现拟，任何 MV/MZ 游戏都能出。
 *
 * 产出 <LORE>/lorebook_spec.json，紧接着由 build_lorebook_input.js --spec= 消费掉：
 * 它会照这份清单去台词库里搜证据，组装成最终喂给写手的 lorebook_input.json。
 *
 * 用法:
 *   node tools/gen_topics.js --www="<游戏 www 目录>" --dry
 *   node tools/gen_topics.js --www="<游戏 www 目录>"
 */
'use strict';

var fs = require('fs');
var path = require('path');
var S = require('./ai_schema.js');
var CD = require('./corpus_digest.js');
var C = require('./persona_core.js');
function arg(n) {
  var p = '--' + n + '=';
  for (var _i2 = 0, _process$argv$slice2 = process.argv.slice(2); _i2 < _process$argv$slice2.length; _i2++) {
    var a = _process$argv$slice2[_i2];
    if (a.startsWith(p)) return a.slice(p.length);
  }
  return null;
}
function flag(n) {
  return process.argv.slice(2).includes('--' + n);
}
var reported = false;
function done(res) {
  if (reported) return;
  reported = true;
  if (typeof AinpcDone === 'function') return AinpcDone(res);
  if (!res.ok) {
    console.error('✘ ' + (res.reason || '失败'));
    process.exit(1);
  }
}
function fail(reason) {
  done({
    ok: false,
    reason: reason
  });
}
var WWW = arg('www') || process.env.AINPC_WWW;
if (!WWW) {
  console.error('✘ 需要 --www="<游戏 www 目录>"');
  process.exit(1);
}
var HERE = path.join(__dirname, '..');
var LORE_DIR = arg('loreDir') || path.join(HERE, '_lore');
var RAW = arg('raw') || path.join(LORE_DIR, 'lore_raw.json');
var BIBLE = arg('bible') || path.join(LORE_DIR, 'world_bible.json');
var OUT = arg('out') || path.join(LORE_DIR, 'lorebook_spec.json');
function _findTpl(name) {
  var cands = [path.join(LORE_DIR, name), path.join(HERE, '_lore', name)];
  for (var _i4 = 0; _i4 < cands.length; _i4++) {
    var c = cands[_i4];
    if (fs.existsSync(c)) return c;
  }
  return cands[0];
}
var TPL = arg('tpl') || _findTpl('topics_prompt.json');
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}
var raw,
  tpl,
  bible = null;
try {
  raw = readJson(RAW);
} catch (e) {
  console.error('✘ 读不到语料 ' + RAW + '：' + e.message);
  process.exit(1);
}
try {
  tpl = readJson(TPL);
} catch (e) {
  console.error('✘ 读不到提示词模板 ' + TPL + '：' + e.message);
  process.exit(1);
}
try {
  bible = readJson(BIBLE);
} catch (e) {/* 圣经是可选的：还没生成也能拟清单 */}
var d = CD.digest(raw);
var corpus = CD.render(d);
var bibleTxt = bible ? '====== 已归纳的世界观（拟清单时请与它保持一致）======\n' + '类型：' + (bible.genre || '') + '\n基调：' + (bible.tone || '') + '\n' + '世界：' + (bible.world && bible.world.summary || '') + '\n' + '势力：' + Object.keys(bible.factions || {}).join('、') + '\n' + '主角：' + (bible.protagonist && bible.protagonist.name || '') + '\n' + '======\n\n' : '';
var user = tpl.userTemplate.replace(/\{\{CORPUS\}\}/g, corpus).replace(/\{\{WORLD_BIBLE\}\}/g, bibleTxt).replace(/\{\{SHAPE\}\}/g, S.SPEC_SHAPE);
console.log('');
console.log('语料摘要 ' + corpus.length + ' 字 ｜ 世界观圣经 ' + (bible ? '已加载' : '未生成（跳过）'));
if (flag('dry')) {
  var dir = path.join(LORE_DIR, 'prompts-ai');
  try {
    fs.mkdirSync(dir, {
      recursive: true
    });
  } catch (e) {
    if (!fs.existsSync(dir)) throw e;
  }
  fs.writeFileSync(path.join(dir, 'topics.txt'), '======= SYSTEM =======\n' + tpl.system + '\n\n======= USER =======\n' + user + '\n', 'utf8');
  console.log('干跑完成：提示词 → ' + path.join(dir, 'topics.txt'));
  console.log('');
  done({
    ok: true,
    dry: true
  });
} else {
  realRun();
}
function realRun() {
  var cfg = C.loadLLMConfig(WWW, {
    endpoint: arg('endpoint'),
    apiKey: arg('apiKey'),
    model: arg('model'),
    temperature: arg('temperature') != null ? parseFloat(arg('temperature')) : null
  });
  if (!cfg.apiKey) return fail('没有 API Key —— 请在游戏的 www/ai_npc/config.json 里填 apiKey');
  /* 带推理的模型很慢：实测一次要 1~3 分钟。默认的 120 秒不够，会「请求超时」，
   * 而且钱都已经花掉了（服务端照样计费）。给足 5 分钟。 */
  cfg.timeoutMs = parseInt(arg('timeout') || '300000', 10);
  console.log('模型 ' + cfg.model + ' ｜ 端点 ' + cfg.endpoint);
  if (fs.existsSync(OUT)) {
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(OUT, OUT.replace(/\.json$/, '.bak-' + stamp + '.json'));
  }

  /* 与 gen_bible 同一个坑：本机模型带推理，输出额度会被 reasoning 吃掉一大截，
   * 上限给低了 JSON 会在中途截断（且 finish_reason 仍是 stop，看不出来）。 */
  var noMaxTokens = false;
  function call() {
    C.callLLM(cfg, tpl.system, user, function (err, status, text) {
      if (status === 400 && !noMaxTokens && /max_?tokens|max output|maximum/i.test(String(text))) {
        noMaxTokens = true;
        console.log('（模型不接受 8000 上限，退回默认值重试）');
        return call();
      }
      if (err) return fail('请求失败：' + err.message);
      if (status !== 200) return fail('HTTP ' + status + ' ' + String(text).slice(0, 200));
      var payload = text;
      try {
        var j = JSON.parse(text);
        if (j.choices && j.choices[0]) payload = j.choices[0].message.content;
      } catch (e) {}
      var o = S.parseLoose(payload);
      if (!o) return fail('解析不出 JSON，返回片段：' + String(payload).slice(0, 160));
      var spec = S.normalizeSpec(o);
      if (!S.specIsUsable(spec)) return fail('拟出的条目太少（' + spec.length + ' 条），请重试或换模型');
      try {
        fs.mkdirSync(path.dirname(OUT), {
          recursive: true
        });
      } catch (e) {
        if (!fs.existsSync(path.dirname(OUT))) throw e;
      }
      fs.writeFileSync(OUT, JSON.stringify(spec, null, 1), 'utf8');
      console.log('✔ 条目清单已写出 → ' + OUT + '（' + spec.length + ' 条，常驻 ' + spec.filter(function (e) {
        return e.constant;
      }).length + ' 条）');
      spec.slice(0, 8).forEach(function (e) {
        return console.log('   · ' + e.id.padEnd(20) + e.title);
      });
      if (spec.length > 8) console.log('   … 其余 ' + (spec.length - 8) + ' 条');
      console.log('');
      done({
        ok: true,
        file: OUT,
        count: spec.length
      });
    }, {
      maxTokens: 8000,
      noMaxTokens: noMaxTokens
    });
  }
  call();
}