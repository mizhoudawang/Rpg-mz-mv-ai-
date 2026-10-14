#!/usr/bin/env node
/**
 * RM_AI_NPC 配置面板 · 本地服务（可选）
 *
 * 用途：当你不想从游戏里打开面板时，双击「打开配置面板.bat」即可在浏览器里改配置。
 * 面板本体是 config-panel.html —— 同一个文件在游戏内（NW.js 窗口）会自动切换成
 * 直接读写文件的模式，只有浏览器里才需要这个服务。
 *
 * 零依赖，只监听 127.0.0.1，不对外暴露。
 *
 *   node config-server.js [--ai-dir=<目录>] [--port=8317] [--no-open]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/* ------------------------------------------------------------------ 参数 */
const argv = process.argv.slice(2);
const getArg = (name) => {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const NO_OPEN = argv.includes('--no-open');
const AI_DIR = path.resolve(getArg('ai-dir') || __dirname);
const CONFIG_FILE = path.join(AI_DIR, 'config.json');
const PANEL_FILE = path.join(__dirname, 'config-panel.html');
const START_PORT = parseInt(getArg('port') || process.env.AINPC_PORT || '8317', 10);

/* ------------------------------------------------------------------ 工具 */
function send(res, code, body, type) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store'
  });
  res.end(data);
}
function sendJson(res, obj, code) { send(res, code || 200, obj, 'application/json; charset=utf-8'); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { ok: true, config: {}, raw: {}, path: CONFIG_FILE, existed: false };
  const txt = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
  const o = JSON.parse(txt);
  return { ok: true, config: o, raw: o, path: CONFIG_FILE, existed: true };
}

function writeConfig(raw, values) {
  const out = {};
  Object.keys(raw || {}).forEach(k => { out[k] = raw[k]; });
  Object.keys(values || {}).forEach(k => { out[k] = values[k]; });
  out._说明 = 'AI NPC 配置。apiKey 留空 = 仿真模式（不联网）。改完保存即可，游戏下次搭话时自动读取。';
  try { if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch (e) { }
  if (!fs.existsSync(AI_DIR)) fs.mkdirSync(AI_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return { ok: true, path: CONFIG_FILE };
}

/** 与插件 RM_AI_NPC.postJson 保持同一套请求语义 */
function httpJson(method, urlStr, headers, bodyObj, timeoutMs) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: 'Endpoint 不是合法 URL：' + urlStr }); }
    const mod = u.protocol === 'https:' ? require('https') : require('http');
    const body = bodyObj == null ? null : JSON.stringify(bodyObj);
    const h = Object.assign({}, headers);
    if (body) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(body, 'utf8'); }
    const t0 = Date.now();
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: (u.pathname || '/') + (u.search || ''), method: method, headers: h
    }, r => {
      const ch = [];
      r.on('data', c => ch.push(c));
      r.on('end', () => resolve({
        ok: r.statusCode >= 200 && r.statusCode < 300,
        status: r.statusCode, ms: Date.now() - t0,
        text: Buffer.concat(ch).toString('utf8')
      }));
    });
    req.on('error', e => resolve({ ok: false, error: e.message, ms: Date.now() - t0 }));
    req.setTimeout(timeoutMs || 30000, () => {
      try { req.abort(); } catch (e) { }
      resolve({ ok: false, error: '请求超时（' + Math.round((timeoutMs || 30000) / 1000) + ' 秒）' });
    });
    if (body) req.write(body);
    req.end();
  });
}

function extractApiError(text, status) {
  let msg = String(text || '').slice(0, 500);
  try {
    const j = JSON.parse(text);
    if (j && j.error) msg = j.error.message || j.error.code || msg;
    else if (j && j.message) msg = j.message;
  } catch (e) { }
  return msg || ('HTTP ' + status);
}

/* 【v2.9.1】Endpoint 自动补全 —— 与插件里 Ainpc.normalizeEndpoint / 面板里 normEp 同一套规则。
 * 中转站在控制台上给的是**站点域名**，真正的接口是 /v1/chat/completions。
 * 玩家照抄域名，请求打到首页，服务端回 HTML —— 表现为「测试连接 200 但空回复」，
 * 或者「该服务商可能不支持 /models」。这里发请求前先补齐地址。 */
function normEp(u) {
  let s = String(u || '').trim();
  if (!s) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(s)) return s;
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([?][^#]*)?(#.*)?$/i.exec(s);
  const m2 = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(s);
  let path = '';
  if (m) path = ''; else if (m2) path = m2[1] || '';
  if (path === '' || path === '/') return s + '/v1/chat/completions';
  if (/\/(v1|openai|api\/v1)$/i.test(path)) return s + '/chat/completions';
  return s;
}

/* ------------------------------------------------------------------ 路由 */
const ROUTES = {
  'POST /api/load': async (req, res) => {
    try { sendJson(res, readConfig()); }
    catch (e) { sendJson(res, { ok: false, error: '读取失败：' + e.message }); }
  },

  'POST /api/save': async (req, res) => {
    const body = await readBody(req);
    try { sendJson(res, writeConfig(body.raw, body.values)); }
    catch (e) { sendJson(res, { ok: false, error: '保存失败：' + e.message }); }
  },

  'POST /api/test': async (req, res) => {
    const c = await readBody(req);
    const r = await httpJson('POST', normEp(c.endpoint),
      { 'Authorization': 'Bearer ' + c.apiKey },
      { model: c.model, messages: [{ role: 'user', content: '只回复两个字：可用' }], max_tokens: 24, stream: false },
      c.timeoutMs);
    if (r.error) return sendJson(res, { ok: false, error: r.error });
    if (!r.ok) return sendJson(res, { ok: false, status: r.status, ms: r.ms, error: extractApiError(r.text, r.status) });
    /* v2.9.1：200 但不是 JSON —— Endpoint 只填到域名时最典型，别再显示「可用（空回复）」了 */
    if (/^\s*<(!doctype|html|head|body)/i.test(r.text || '')) {
      return sendJson(res, { ok: false, status: r.status, ms: r.ms, error:
        '服务端返回的是网页（HTML）不是 JSON —— Endpoint 多半只填到了域名，应填到 ' + normEp(c.endpoint) });
    }
    let reply = '';
    try { const j = JSON.parse(r.text); reply = ((j.choices || [])[0] || {}).message ? j.choices[0].message.content : ''; } catch (e) { }
    sendJson(res, { ok: true, status: r.status, ms: r.ms, reply: reply || '(空回复)' });
  },

  'POST /api/models': async (req, res) => {
    const c = await readBody(req);
    const base = normEp(c.endpoint).replace(/\/chat\/completions.*$/, '').replace(/\/completions.*$/, '');
    const mUrl = base + '/models';
    const r = await httpJson('GET', mUrl, { 'Authorization': 'Bearer ' + c.apiKey }, null, 20000);
    if (r.error) return sendJson(res, { ok: false, error: r.error });
    if (!r.ok) return sendJson(res, { ok: false, status: r.status, error: '该服务商可能不支持 /models（HTTP ' + r.status + '），手动填模型名即可' });
    try {
      const j = JSON.parse(r.text);
      const list = (j.data || j.models || []).map(x => x.id || x.name || x.model).filter(Boolean);
      sendJson(res, { ok: true, models: list, url: mUrl });
    } catch (e) { sendJson(res, { ok: false, error: '返回不是 JSON：' + String(r.text).slice(0, 200) }); }
  },

  'POST /api/overview': async (req, res) => {
    const out = { worldbook: null, actors: null };
    try {
      const wb = path.join(AI_DIR, 'worldbook.json');
      if (fs.existsSync(wb)) {
        const w = JSON.parse(fs.readFileSync(wb, 'utf8'));
        let merchants = 0, lines = 0;
        (w.npcs || []).forEach(n => {
          if (n.tags && n.tags.indexOf('merchant') >= 0) merchants++;
          lines += (n.stats && n.stats.lines) || (n.dialogues || []).length || 0;
        });
        out.worldbook = { npcs: (w.npcs || []).length, maps: Object.keys(w.maps || {}).length, merchants, lines, version: w.version };
      }
      const aa = path.join(AI_DIR, 'actors_ai.json');
      if (fs.existsSync(aa)) {
        const a = JSON.parse(fs.readFileSync(aa, 'utf8'));
        out.actors = { count: Object.keys(a.actors || {}).length };
      }
    } catch (e) { out.error = e.message; }
    sendJson(res, out);
  },

  'POST /api/folder': async (req, res) => {
    try {
      if (process.platform === 'win32') exec('explorer "' + AI_DIR.replace(/\//g, '\\') + '"');
      else if (process.platform === 'darwin') exec('open "' + AI_DIR + '"');
      else exec('xdg-open "' + AI_DIR + '"');
      sendJson(res, { ok: true });
    } catch (e) { sendJson(res, { ok: false, error: e.message }); }
  },

  'GET /api/ping': async (req, res) => sendJson(res, { ok: true, aiDir: AI_DIR, version: 1 }),

  'GET /favicon.ico': async (req, res) => { res.writeHead(204); res.end(); }
};

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // 面板本体
  if (req.method === 'GET' && (urlPath === '/' || urlPath === '/index.html' || urlPath === '/config-panel.html')) {
    if (!fs.existsSync(PANEL_FILE)) return send(res, 500, '找不到 config-panel.html，请确认它和本脚本在同一目录。', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(PANEL_FILE), 'text/html; charset=utf-8');
  }

  const handler = ROUTES[req.method + ' ' + urlPath];
  if (!handler) return sendJson(res, { ok: false, error: '未知接口 ' + req.method + ' ' + urlPath }, 404);

  try { await handler(req, res); }
  catch (e) { sendJson(res, { ok: false, error: e.message }, 500); }
});

/* ------------------------------------------------------------------ 启动 */
function openBrowser(url) {
  if (NO_OPEN) return;
  try {
    if (process.platform === 'win32') exec('start "" "' + url + '"');
    else if (process.platform === 'darwin') exec('open "' + url + '"');
    else exec('xdg-open "' + url + '"');
  } catch (e) { }
}

let port = START_PORT;
let retries = 0;
function listen() {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && retries < 20) {
      retries++; port++;
      console.log('· 端口被占用，换到 ' + port);
      setTimeout(listen, 60);
    } else {
      console.error('✘ 服务启动失败：' + err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('');
    console.log('  AI NPC 配置面板已启动');
    console.log('  ─────────────────────────────────');
    console.log('  配置目录 : ' + AI_DIR);
    console.log('  配置文件 : ' + CONFIG_FILE);
    console.log('  浏览器   : ' + url);
    console.log('');
    console.log('  改完点「保存配置」即可。这个窗口可以最小化，');
    console.log('  关掉它面板就打不开了（配置本身不受影响）。');
    console.log('');
    openBrowser(url);
  });
}
listen();
