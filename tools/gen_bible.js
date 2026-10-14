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
 * 世界观圣经生成器 —— 让 AI 读原作语料，现场归纳出这部游戏的世界观概览。
 *
 * 【v2.8.0 为什么要有它】在此之前 world_bible.json 是**人肉写的**：我读了一遍语料，
 * 手敲了「赫尔镇 / 女神妮拉 / 圣法王国」那一整套。换一部游戏就整个作废 ——
 * 这正是「插件只能给同一款游戏用」的根因。现在改成 AI 现写，任何 MV/MZ 游戏都能出。
 *
 * 【同一份源码两边跑】命令行（现在）和游戏内的一键准备跑的是**这一个文件**。
 * 游戏内由插件的 runTool 用 new Function 包起来执行，跑完通过注入的 AinpcDone 回调报信。
 *
 * 用法:
 *   node tools/gen_bible.js --www="<游戏 www 目录>" --dry     # 只导出提示词，不花钱
 *   node tools/gen_bible.js --www="<游戏 www 目录>"           # 真生成（读 config.json 的 Key）
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

/* 游戏内跑的时候，插件会注入 AinpcDone；命令行跑的时候没有它。 */
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
/* 线索目录：命令行默认 <项目>/_lore；游戏内由插件指到 www/ai_npc。 */
var LORE_DIR = arg('loreDir') || path.join(HERE, '_lore');
var RAW = arg('raw') || path.join(LORE_DIR, 'lore_raw.json');
var TPL = arg('tpl') || _findTpl('bible_prompt.json');
var OUT = arg('out') || path.join(LORE_DIR, 'world_bible.json');

/** 提示词模板可能落在两处：项目的 _lore/，或（游戏内）www/ai_npc/ */
function _findTpl(name) {
  var cands = [path.join(LORE_DIR, name), path.join(HERE, '_lore', name)];
  for (var _i4 = 0; _i4 < cands.length; _i4++) {
    var c = cands[_i4];
    if (fs.existsSync(c)) return c;
  }
  return cands[0];
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}
var raw, tpl;
try {
  raw = readJson(RAW);
} catch (e) {
  console.error('✘ 读不到语料 ' + RAW + '：' + e.message + '\n  （先跑 tools/extract_lore.js）');
  process.exit(1);
}
try {
  tpl = readJson(TPL);
} catch (e) {
  console.error('✘ 读不到提示词模板 ' + TPL + '：' + e.message);
  process.exit(1);
}
var d = CD.digest(raw);
var corpus = CD.render(d);
var user = tpl.userTemplate.replace(/\{\{CORPUS\}\}/g, corpus).replace(/\{\{SHAPE\}\}/g, S.BIBLE_SHAPE);
console.log('');
console.log('语料摘要：台词 ' + d.lineCount + ' 条 / 地图 ' + d.mapCount + ' 张 / 角色 ' + d.actorCount + ' 个');
console.log('摘要正文 ' + corpus.length + ' 字（约 ' + Math.round(corpus.length / 1.5) + ' tokens）');
if (flag('dry')) {
  var dir = path.join(LORE_DIR, 'prompts-ai');
  try {
    fs.mkdirSync(dir, {
      recursive: true
    });
  } catch (e) {
    if (!fs.existsSync(dir)) throw e;
  }
  fs.writeFileSync(path.join(dir, 'bible.txt'), '======= SYSTEM =======\n' + tpl.system + '\n\n======= USER =======\n' + user + '\n', 'utf8');
  console.log('干跑完成：提示词 → ' + path.join(dir, 'bible.txt'));
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
  cfg.timeoutMs = parseInt(arg('timeout') || '300000', 10); // 带推理的模型很慢，给足 5 分钟
  console.log('模型 ' + cfg.model + ' ｜ 端点 ' + cfg.endpoint);
  if (fs.existsSync(OUT)) {
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(OUT, OUT.replace(/\.json$/, '.bak-' + stamp + '.json'));
    console.log('已备份旧的 world_bible.json');
  }

  /* 【跑两次才明白的坑】本机用的模型（deepseek-flash）是**带推理**的：
   * 实测一次生成花了 6963 个输出 token，其中 5072 个是 reasoning —— 正文只占 1900。
   * 上限给 4000 时，推理还没结束就把额度吃光了，返回的 JSON 从中间截住（finish_reason=stop，
   * 所以**看不出是截断**，只会表现为「解析不出 JSON」）。给了 8000 才够。
   * 万一某个服务端上限就是 4096、发 8000 被 400 拒掉，就摘掉这个字段退回默认值。 */
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
      var bible = S.normalizeBible(Object.assign({
        _game: d.gameTitle
      }, o));
      if (!S.bibleIsUsable(bible)) return fail('生成结果太空（世界观摘要不足 60 字），请重试或换模型');
      try {
        fs.mkdirSync(path.dirname(OUT), {
          recursive: true
        });
      } catch (e) {
        if (!fs.existsSync(path.dirname(OUT))) throw e;
      }
      fs.writeFileSync(OUT, JSON.stringify(bible, null, 1), 'utf8');
      console.log('✔ 世界观圣经已写出 → ' + OUT);
      console.log('   类型：' + bible.genre);
      console.log('   世界：' + bible.world.summary.slice(0, 60) + '…');
      console.log('   势力 ' + Object.keys(bible.factions).length + ' 个 / 地区 ' + bible.world.regions.length + ' 个 / 主角 ' + (bible.protagonist.name || '(未识别)'));
      console.log('');
      done({
        ok: true,
        file: OUT,
        bytes: fs.statSync(OUT).size
      });
    }, {
      maxTokens: 8000,
      noMaxTokens: noMaxTokens
    });
  }
  call();
}