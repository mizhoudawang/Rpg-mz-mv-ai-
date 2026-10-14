/* eslint-disable */
/**
 * RM_AI_NPC 无头测试台
 * ---------------------------------------------------------------
 * 目标：不启动游戏 GUI，也能把插件真正 eval 进一个「够用的 RPG Maker MV 环境」里，
 *       然后直接调用插件内部函数，验证：
 *         - 玩家名黑名单是否真的抓到了主角名（伊丽莎）
 *         - displayName() 会不会把旅店老板显示成主角名
 *         - 提示词里的样本台词有没有被排毒
 *
 * 用法：
 *   node harness.js                 # 对当前插件跑测试
 *   node harness.js --plugin=<path> # 指定别的插件副本
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * 自动定位游戏目录：从本文件所在目录一路往上找，直到看见 data/System.json
 * （本文件既可以放在工作区里跑，也可以丢进 www/ai_npc/tools/ 里跟随插件一起走）。
 */
function findWww(start) {
  let d = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'data', 'System.json'))) return d;          // 自己就是 www/
    if (fs.existsSync(path.join(d, 'www', 'data', 'System.json'))) return path.join(d, 'www');
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  return null;
}
const ARGV = process.argv.slice(2);
/** 允许显式指定：node run_test.js --www="D:/.../扶他那里魔驯兽师伊丽莎/www" */
const wwwArg = (ARGV.find(a => a.startsWith('--www=')) || '').split('=')[1];
const WWW = wwwArg ? path.resolve(wwwArg) : findWww(__dirname);
if (!WWW || !fs.existsSync(path.join(WWW, 'data', 'System.json'))) {
  console.error('找不到游戏的 www/ 目录。');
  console.error('  本文件需要放在游戏目录内，或用 --www=<游戏的 www 目录> 指定。');
  process.exit(1);
}
const GAME = path.dirname(WWW);

const argv = ARGV;
const pluginArg = (argv.find(a => a.startsWith('--plugin=')) || '').split('=')[1];
const PLUGIN = pluginArg ? path.resolve(pluginArg) : path.join(WWW, 'js/plugins/RM_AI_NPC.js');

/* ------------------------------------------------------------------ 环境桩 */
function makeClass(name, base) {
  const C = function () { };
  C.prototype = Object.create(base ? base.prototype : Object.prototype);
  C.prototype.constructor = C;
  Object.defineProperty(C, 'name', { value: name });
  return C;
}
function noop() { }

// --- Window / Scene 基类 -------------------------------------------------
const Window_Base = makeClass('Window_Base');
Window_Base.prototype.initialize = noop;
Window_Base.prototype.update = noop;
Window_Base.prototype.open = noop;
Window_Base.prototype.close = noop;
Window_Base.prototype.hide = noop;
Window_Base.prototype.show = noop;
Window_Base.prototype.standardFontSize = function () { return 28; };
Window_Base.prototype.standardPadding = function () { return 18; };
Window_Base.prototype.textPadding = function () { return 18; };
Window_Base.prototype.contentsWidth = function () { return 780; };
Window_Base.prototype.fittingHeight = function () { return 36; };
Window_Base.prototype.drawText = noop;
Window_Base.prototype.setHelpWindow = noop;
Window_Base.prototype.addWindow = noop;
Window_Base.prototype.itemRect = function () { return { x: 0, y: 0, width: 700, height: 36 }; };

const Window_Selectable = makeClass('Window_Selectable', Window_Base);
Window_Selectable.prototype.initialize = noop;
Window_Selectable.prototype.activate = noop;
Window_Selectable.prototype.select = noop;
Window_Selectable.prototype.index = function () { return 0; };
Window_Selectable.prototype.setHandler = noop;
Window_Selectable.prototype.isOkTriggered = function () { return false; };
Window_Selectable.prototype.isCancelTriggered = function () { return false; };

const Window_Command = makeClass('Window_Command', Window_Selectable);
const Window_MenuCommand = makeClass('Window_MenuCommand', Window_Command);
Window_MenuCommand.prototype.addOriginalCommands = noop;
Window_MenuCommand.prototype.makeCommandList = noop;
Window_MenuCommand.prototype.addCommand = noop;

const Window_Message = makeClass('Window_Message', Window_Base);
Window_Message.prototype.standardPadding = function () { return 18; };
const Window_ShopBuy = makeClass('Window_ShopBuy', Window_Selectable);
Window_ShopBuy.prototype.price = function () { return 100; };
const Window_ShopStatus = makeClass('Window_ShopStatus', Window_Base);
const Window_Help = makeClass('Window_Help', Window_Base);
Window_Help.prototype.setText = noop;
Window_Help.prototype.setItem = noop;
const Window_ScrollText = makeClass('Window_ScrollText', Window_Base);

const Scene_Base = makeClass('Scene_Base');
Scene_Base.prototype.create = noop; Scene_Base.prototype.start = noop;
Scene_Base.prototype.update = noop; Scene_Base.prototype.terminate = noop;
Scene_Base.prototype.addWindow = noop; Scene_Base.prototype.createWindowLayer = noop;
const Scene_MenuBase = makeClass('Scene_MenuBase', Scene_Base);
Scene_MenuBase.prototype.create = noop; Scene_MenuBase.prototype.start = noop;
Scene_MenuBase.prototype.update = noop; Scene_MenuBase.prototype.terminate = noop;
const Scene_Menu = makeClass('Scene_Menu', Scene_MenuBase);
Scene_Menu.prototype.createCommandWindow = noop;
Scene_Menu.prototype.create = noop;
const Scene_Map = makeClass('Scene_Map', Scene_Base);
Scene_Map.prototype.createAllWindows = noop;
Scene_Map.prototype.update = noop;
Scene_Map.prototype.create = noop;
Scene_Map.prototype.start = noop;
Scene_Map.prototype.isBusy = function () { return false; };
const Scene_Boot = makeClass('Scene_Boot', Scene_Base);
Scene_Boot.prototype.start = noop;
const Scene_Shop = makeClass('Scene_Shop', Scene_MenuBase);
Scene_Shop.prototype.create = noop; Scene_Shop.prototype.terminate = noop;
Scene_Shop.prototype.sellingPrice = function () { return 50; };

const SceneManager = { _scene: null, push: noop, pop: noop, goto: noop, isCurrent: function () { return false; } };
const Graphics = { boxWidth: 816, boxHeight: 624, width: 816, height: 624, frameCount: 0, _canvas: null };
const Input = { isTriggered: function () { return false; }, keyMapper: null, _currentState: {}, _latestButton: null };
const Rectangle = function (x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; };
const Bitmap = makeClass('Bitmap');
/* 模拟引擎的字体度量：全角字宽 = 字号、半角 = 字号 / 2。
 * 有它就走插件里「用真实字体度量」那条路，没有则退回估算 —— 两条都该给出同样的折行。 */
Bitmap.prototype.measureTextWidth = function (text) {
  const fs = this.fontSize || 28;
  let w = 0;
  for (const ch of String(text)) w += (ch.charCodeAt(0) < 256 ? 0.5 : 1) * fs;
  return w;
};
const StorageManager = { forLocalFile: function () { return null; }, localFileDirectoryPath: function () { return ''; }, objectToJson: JSON.stringify, jsonToObject: JSON.parse };
const Decrypter = { hasEncryptedImages: function () { return false; }, hasEncryptedAudio: function () { return false; } };
const ImageManager = { loadBitmap: noop };
const SoundManager = { playSe: noop };

const Game_Switches = makeClass('Game_Switches');
Game_Switches.prototype.setValue = noop;
const Game_Variables = makeClass('Game_Variables');
Game_Variables.prototype.setValue = noop;
const Game_Timer = makeClass('Game_Timer');
const Game_Screen = makeClass('Game_Screen');
const Game_Pictures = makeClass('Game_Pictures');

const Game_Interpreter = makeClass('Game_Interpreter');
/* 与真实引擎一致地记下 _list / _index / _eventId / _mapId —— 探针要靠
 * `$gameMap._interpreter → _childInterpreter → …` 这条链重建「117 进公共事件」
 * 的现场（v2.9.10 的 ADV 入口必须挂在最里面那层上）。 */
Game_Interpreter.prototype.setup = function (list, eventId) {
  this._list = list || [];
  this._index = 0;
  this._eventId = eventId || 0;
  if (this._mapId === undefined) this._mapId = 1;
};
Game_Interpreter.prototype.terminate = noop;
/* _list 还在 = 还在跑。activeInterpreter() 靠它一路往下找「最里面那层」。 */
Game_Interpreter.prototype.isRunning = function () { return !!this._list; };
/* 与真实引擎同形。ADV 入口靠 updateWait() 分辨「解释器正被 ADV 挂着等」
 * （TS_ADVsystem 在解释器上打 _mAdvRun，运行时它才是真正生效的那个覆写）。 */
Game_Interpreter.prototype.updateWaitCount = function () { return (this._waitCount || 0) > 0; };
Game_Interpreter.prototype.updateWait = function () {
  return this.updateWaitCount() || this.updateWaitMode();
};
Game_Interpreter.prototype.updateWaitMode = function () { return false; };
Game_Interpreter.prototype.command101 = function () { return true; };
Game_Interpreter.prototype.command302 = function () { return true; };
/* 356 = 插件指令。台子里必须有个父方法（哪怕只是桩），否则那条 typeof 兜底
 * 会让「拿不到父方法就不装钩子」的逻辑生效。 */
Game_Interpreter.prototype.command356 = function () { return true; };
Game_Interpreter.prototype.setupChild = function (list, eventId) {
  this._childInterpreter = new Game_Interpreter((this._depth || 0) + 1);
  this._childInterpreter.setup(list, eventId);
};
Game_Interpreter.prototype.pluginCommand = noop;
Game_Interpreter.prototype.setWaitMode = noop;
Game_Interpreter.prototype.clear = noop;

/* Game_Event —— 地图事件本体。v2.9.10 起插件会在它的 start 上补一个钩子
 * （「这道事件本来就什么都不做」时直接开一场 AI 对话，见 Mira 的 +type2 学生）。
 * 这里给一份最小实现：page()/list() 由测试自己替换。 */
const Game_Event = makeClass('Game_Event');
Game_Event.prototype.page = function () { return { list: [], trigger: 0 }; };
Game_Event.prototype.list = function () { return []; };
Game_Event.prototype.isTriggerIn = function () { return false; };
Game_Event.prototype.lock = noop;
Game_Event.prototype.start = function () { this._started = true; };

/* ADV_System —— TS_ADVsystem 的演出引擎。有些游戏（如 Mira）**所有台词**都
 * 交给它念（剧情写在 scenario/*.sl 里），事件页上没有一条 Show Text。
 * v2.9.10 起插件把「对话入口」钩在 ADV_System.prototype.start 上，
 * 所以只有当这部游戏真的装了 TS_ADVsystem 时才提供这个类 —— 与真实加载顺序
 * 一致（TS_ADVsystem 在 plugins.js 里排在 RM_AI_NPC 前面）。
 * 父方法返回 'VANILLA'，探针据此判断「原版脚本到底播没播」。 */
const hasAdvSystem = fs.existsSync(path.join(WWW, 'js/plugins/TS_ADVsystem.js'));
const ADV_System = makeClass('ADV_System');
ADV_System.prototype.start = function (filename) { this._last = filename; return 'VANILLA'; };
ADV_System.prototype.startAutMessage = function (filename) { this._last = filename; return 'VANILLA'; };
const $advSystem = new ADV_System();

const Utils = {
  RPGMAKER_NAME: 'MV',
  isNwjs: function () { return false; },
  isMobileDevice: function () { return false; },
  generateRuntimeId: function () { return 1; }
};
const PluginManager = {
  _parameters: {
    'RM_AI_NPC': {
      configPath: 'ai_npc/config.json', endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: '', model: 'deepseek-chat', maxTurns: '8', debug: 'false'
    }
  },
  parameters: function (name) { return this._parameters[name] || {}; }
};

// --- document / window --------------------------------------------------
const documentStub = {
  createElement: function () {
    return { style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop, removeEventListener: noop, remove: noop };
  },
  querySelector: function () { return null; },
  getElementById: function () { return null; },
  addEventListener: noop,
  body: { appendChild: noop, removeChild: noop },
  head: { appendChild: noop }
};

/* ------------------------------------------------------------------ 启动 */
const code = fs.readFileSync(PLUGIN, 'utf8');

const sandbox = {
  console: console,
  require: require,
  process: process,
  Buffer: Buffer,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  Promise: Promise,
  JSON: JSON,
  Math: Math,
  Date: Date,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  Boolean: Boolean,
  RegExp: RegExp,
  Error: Error,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  escape: escape,
  unescape: unescape,
  __dirname: path.dirname(PLUGIN),
  __filename: PLUGIN,
  window: null, document: documentStub, navigator: { language: 'zh-CN', userAgent: 'node' },
  location: { href: 'file:///' + PLUGIN },
  Utils: Utils, PluginManager: PluginManager, Graphics: Graphics, Input: Input,
  SceneManager: SceneManager, StorageManager: StorageManager, Decrypter: Decrypter,
  ImageManager: ImageManager, SoundManager: SoundManager, Rectangle: Rectangle, Bitmap: Bitmap,
  Window_Base: Window_Base, Window_Selectable: Window_Selectable, Window_Command: Window_Command,
  Window_MenuCommand: Window_MenuCommand, Window_Message: Window_Message, Window_ShopBuy: Window_ShopBuy,
  Window_ShopStatus: Window_ShopStatus, Window_Help: Window_Help, Window_ScrollText: Window_ScrollText,
  Scene_Base: Scene_Base, Scene_MenuBase: Scene_MenuBase, Scene_Menu: Scene_Menu, Scene_Map: Scene_Map,
  Scene_Boot: Scene_Boot, Scene_Shop: Scene_Shop, Game_Interpreter: Game_Interpreter,
  Game_Event: Game_Event,
  ADV_System: hasAdvSystem ? ADV_System : undefined,
  $advSystem: hasAdvSystem ? $advSystem : undefined,
  Game_Switches: Game_Switches, Game_Variables: Game_Variables,
  Game_Timer: Game_Timer, Game_Screen: Game_Screen, Game_Pictures: Game_Pictures,
  // 全局数据（由下面的装配函数填充）
  $dataSystem: {}, $dataActors: [], $dataClasses: [], $dataItems: [], $dataSkills: [],
  $dataStates: [], $dataWeapons: [], $dataArmors: [], $dataMapInfos: [], $dataCommonEvents: [],
  $gameSystem: null, $gameParty: null, $gameActors: null, $gameMap: null, $gameMessage: null,
  $gameSwitches: null, $gameVariables: null, $gamePlayer: null
};
sandbox.window = sandbox;
sandbox.global = sandbox;

/* --- 装配「游戏已载入、主角在队伍里」的现场 --- */
function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }

const Actors = loadJson(path.join(WWW, 'data/Actors.json'));
const System = loadJson(path.join(WWW, 'data/System.json'));
sandbox.$dataActors = Actors;
sandbox.$dataSystem = System;
/* 物品 / 武器 / 防具 / 敌群也读真数据：
 * 偷窃与抢劫的掉落物名字、以及 robTroopId 的战斗都依赖它们，
 * 空数组会让台词里出现「#15」这种编号，测不出真实观感。 */
sandbox.$dataItems = loadJson(path.join(WWW, 'data/Items.json'));
sandbox.$dataWeapons = loadJson(path.join(WWW, 'data/Weapons.json'));
sandbox.$dataArmors = loadJson(path.join(WWW, 'data/Armors.json'));
sandbox.$dataTroops = loadJson(path.join(WWW, 'data/Troops.json'));

// 构造一个够用的 Game_Actor：注意 actorId 是【方法】——和真实引擎一致，这正是踩坑点
/* 【v2.9.14 加固】Actors.json 允许空洞（index 0 是 null，删过角色的工程中间也会空）
 * 而 System.partyMembers[0] 可能指到一个不存在的编号 —— 老写法 `Actors[id].name` 当场抛，
 * 整个 harness 连加载都过不去（engine-demo 就是这样挂的）。
 * 口径：主角编号 = partyMembers[0]（存在且是真角色）→ 否则第一个非空 actor → 否则 1。 */
function realActorId(id) {
  return !!(Actors && Actors[id] && Actors[id].name);
}
function firstRealActorId() {
  if (Actors) for (let i = 1; i < Actors.length; i++) if (realActorId(i)) return i;
  return 1;
}
function makeGameActor(actorId) {
  const data = (Actors && Actors[actorId]) || null;
  const a = {
    _actorId: actorId,
    _name: data ? data.name : ('Actor' + actorId),
    actorId: function () { return this._actorId; },
    name: function () { return this._name; },
    hp: 500, mp: 100, mhp: 500, mmp: 100, luk: 20,
    setHp: noop, setMp: noop
  };
  return a;
}
const leaderId = (function () {
  const want = (System && System.partyMembers && System.partyMembers[0]) || 0;
  return realActorId(want) ? want : firstRealActorId();
})();
const leader = makeGameActor(leaderId);
sandbox.$gameParty = {
  members: function () { return [leader]; },
  leader: function () { return leader; },
  gold: function () { return 1000; },
  loseGold: noop, gainGold: noop,
  gainItem: function () { return true; },
  loseItem: noop, hasItem: function () { return false; }, numItems: function () { return 0; }
};
sandbox.$gameActors = { actor: function (id) { return id === leaderId ? leader : makeGameActor(id); } };
sandbox.$gameSystem = { _ainpc: null, playtime: function () { return 0; } };
sandbox.$gameMap = { mapId: function () { return 15; }, events: function () { return []; } };
sandbox.$gameMessage = { isBusy: function () { return false; } };
sandbox.$gameSwitches = { value: function () { return false; } };
sandbox.$gameVariables = { value: function () { return 0; } };
sandbox.$gamePlayer = { x: 0, y: 0 };

/* ------------------------------------------------------------------ 执行 */
let loadError = null;
try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: PLUGIN });
} catch (e) {
  loadError = e;
}

const Ainpc = sandbox.RM_AI_NPC;

/* --- 让插件读到真实的世界书 / 档案 --- */
if (Ainpc) {
  Ainpc.readTextFile = function (rel) {
    const p = path.join(WWW, rel);
    try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch (e) { return null; }
  };
  /* config：**必须与真实游戏同口径** —— DEFAULTS 打底，磁盘上的 config.json 只覆盖它有的键。
   * 【v2.10.2 修】原来这里是 `Ainpc.config = loadJson(...)`，**整体替换**。
   * 而磁盘上的 config.json 是安装器生成的（只含 94 个键），插件里 DEFAULTS 有 161 项 ——
   * 于是无头台里那 67 个"只在 DEFAULTS 里、没写进 config.json"的键全是 undefined。
   * 症状极隐蔽：插件每处读取都写了 `U.toInt(cfg.x, 默认)` 式的兜底，跑起来看不出问题，
   * 但只要有人**在默认值上调参**（本版：pageWaitFrames 60 → 120），无头台就永远验不到
   * ——探针会报"默认值是 undefined"，而游戏里其实一切正常。
   * 这正是 `_probe_cfgdefaults` 一直在防的"三方漂移"的另一种形态：**读取侧的漂移**。 */
  (function loadConfigLikeGame() {
    const disk = loadJson(path.join(WWW, 'ai_npc/config.json')) || {};
    const base = Ainpc.config || {};                 // 插件加载时已铺好的 DEFAULTS
    Object.keys(disk).forEach(function (k) {
      if (k.charAt(0) === '_' || k.charAt(0) === '/') return;   // 与 loadConfig 同一条过滤规则
      base[k] = disk[k];
    });
    Ainpc.config = base;
    Ainpc.configSource = 'ai_npc/config.json（harness：DEFAULTS 打底）';
  })();
  Ainpc.loadWorldbook();
  // 语言：不依赖 detectLanguage（它会数 $dataSystem 里的字），直接锁定简体
  Ainpc.LANG = 'zh-CN';
}

module.exports = { Ainpc, sandbox, loadError, PLUGIN, WWW, GAME };
