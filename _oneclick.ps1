# RM_AI_NPC 一键安装（Windows 原生 · 不需要 Node.js）
#
#   由「一键安装.bat」双击调用；也可以手动：
#     powershell -NoProfile -ExecutionPolicy Bypass -File _oneclick.ps1 -Game "D:\游戏根目录"
#
#   把【游戏文件夹】拖到 bat 上 = 给 -Game 传路径，这是最稳的用法。
#
#   ── 找游戏的规矩（宁可问你，也绝不猜错） ──────────────────────────
#     1) 给了路径（拖拽 / -Game）→ 就装这个。路径直接命中最好；命不中就在它「下面」
#        找（最多 3 层，因为很多游戏是 xxx\游戏名\www 这种套娃）。仍然找不到就**报错退出**，
#        绝不会偷偷装到别的游戏里去（v2.7.3 之前的版本会，那是 bug）。
#     2) 没给路径（直接双击）→ 只有一种情况不问：“安装包就解压在游戏文件夹里面”；
#        其余情况一律列出候选让你选，直接回车 = 取消。
#
#   参数（脚本自动化时才用得到）：
#     -Quiet   不提问、末尾不等回车；需要二选一时直接放弃（退出码 3）
#     -Yes     自动确认（配合 -Quiet 全自动）
#     -Pick N  多个候选时直接选第 N 个
#
#   做的事：备份 plugins.js → 复制插件 → 注册到 $plugins 末位 → 建 www/ai_npc/ →
#           放置面板与配置模板 → 铺上世界书 / 人设（若包内带了）→ 打印下一步。
param(
    [string]$Game = '',
    [switch]$Quiet,
    [switch]$Yes,
    [int]$Pick = 0
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$PKG = $PSScriptRoot                                       # 包根目录（本脚本与 RM_AI_NPC.js 同一层）
if ([string]::IsNullOrWhiteSpace($PKG)) {
    try { $PKG = Split-Path -Parent $MyInvocation.MyCommand.Path } catch { }
}
if ([string]::IsNullOrWhiteSpace($PKG)) { $PKG = (Get-Location).Path }

function Say($t, $c) { Write-Host $t -ForegroundColor $c }
function Head($t) { Write-Host ''; Say "── $t" Cyan }
function Ok($t) { Say "  [OK] $t" Green }
function Info($t) { Say "  ·  $t" DarkGray }
function Warn($t) { Say "  [!] $t" Yellow }
function Pause-Close($code) {
    if (-not $Quiet) { try { Read-Host '按回车关闭' | Out-Null } catch { } }
    exit $code
}
function Die($t, $hints) {
    Write-Host ''
    Say "  [X] $t" Red
    foreach ($h in @($hints)) { if ($h) { Say "      $h" DarkGray } }
    Write-Host ''
    Pause-Close 1
}

# ──────────────────────────────────────────────── 定位游戏
function Clean-Path([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return '' }
    return $p.Trim().Trim('"').TrimEnd('\', '/')
}

# 直接命中：这个目录本身就是游戏，或它的下一层是游戏（www / data 两种布局）。
# 注意路径里常带 [ ] 方括号（游戏名里就有），一律用 -LiteralPath，别让 PS 当通配符。
function Get-WwwOf([string]$p) {
    $p = Clean-Path $p
    if (-not $p) { return $null }
    if (Test-Path -LiteralPath $p -PathType Leaf) { $p = Split-Path -Parent $p }   # 拖进来的是 Game.exe 也行
    if (-not (Test-Path -LiteralPath $p -PathType Container)) { return $null }
    if (Test-Path -LiteralPath (Join-Path $p 'www\data\System.json')) { return (Join-Path $p 'www') }
    if (Test-Path -LiteralPath (Join-Path $p 'data\System.json')) { return $p }
    return $null
}

# 在 $root 之下（含自己）广度优先找游戏，最多 $maxDepth 层。
# 用来兼容「游戏根目录上面还套了两层解压目录名」这类结构。
function Get-GamesUnder([string]$root, [int]$maxDepth) {
    $found = @()
    $root = Clean-Path $root
    if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { return $found }
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($root, 0))
    while ($queue.Count -gt 0) {
        $cur = $queue.Dequeue(); $d = $cur[0]; $n = $cur[1]
        $w = Get-WwwOf $d
        if ($w) { $found += $w; continue }                       # 命中就不再往里钻
        if ($n -ge $maxDepth) { continue }
        try { $kids = @(Get-ChildItem -LiteralPath $d -Directory -ErrorAction SilentlyContinue) } catch { $kids = @() }
        foreach ($k in $kids) {
            if ($k.Name -eq 'node_modules' -or $k.Name.StartsWith('.')) { continue }
            $queue.Enqueue(@($k.FullName, ($n + 1)))
        }
    }
    return $found
}

# 往候选表里加一条（$bag 一定是 ArrayList）。
function Add-Cand($bag, [string]$dir, [int]$rank, [int]$dist, [string]$why) {
    $w = Get-WwwOf $dir
    if (-not $w) { return }
    [void]$bag.Add([PSCustomObject]@{ Www = $w; Rank = $rank; Dist = $dist; Why = $why })
}

# 以安装包为中心，找「相邻」的游戏。只认三种关系，不去别处瞎逛：
#   Rank 0 = 包就放在这个游戏文件夹里（最可信，不用问）
#   Rank 1 = 包目录自己 / 包目录里
#   Rank 2 = 和包挨着的兄弟目录（可能是，也可能不是 → 必须问）
# Dist 越小越近，同 Rank 优先近的。
function Get-GameCandidates {
    $bag = New-Object System.Collections.ArrayList

    Add-Cand $bag $PKG 1 0 '安装包就在这个目录里'
    try { $kids = @(Get-ChildItem -LiteralPath $PKG -Directory -ErrorAction SilentlyContinue) } catch { $kids = @() }
    foreach ($s in $kids) {
        if ($s.Name -eq 'node_modules' -or $s.Name.StartsWith('.')) { continue }
        Add-Cand $bag $s.FullName 1 1 '安装包里面'
    }

    $d = Split-Path -Parent $PKG
    for ($i = 1; $i -le 4 -and $d; $i++) {
        Add-Cand $bag $d 0 $i '安装包就解压在这个游戏文件夹里'
        if ($i -le 2) {                                          # 只看紧邻的两层，别把整个盘翻一遍
            try { $sibs = @(Get-ChildItem -LiteralPath $d -Directory -ErrorAction SilentlyContinue) } catch { $sibs = @() }
            foreach ($s in $sibs) {
                if ($s.Name -eq 'node_modules' -or $s.Name.StartsWith('.')) { continue }
                Add-Cand $bag $s.FullName 2 $i '和安装包挨着'
            }
        }
        $d = Split-Path -Parent $d
    }

    # 同一个 www 去重，保留最优（Rank/Dist 最小）的那条
    $out = @()
    $seen = @{}
    foreach ($c in ($bag | Sort-Object Rank, Dist)) {
        $k = $c.Www.ToLowerInvariant()
        if ($seen.ContainsKey($k)) { continue }
        $seen[$k] = $true
        $out += $c
    }
    return $out
}

# 列候选让人选。返回选中的 www，或 $null（取消）。
function Ask-Choose($cands) {
    Write-Host ''
    Say "  找到 $($cands.Count) 个游戏目录 —— 请告诉我要装哪一个（不会替你猜）：" Yellow
    for ($i = 0; $i -lt $cands.Count; $i++) {
        Say ("   {0}) {1}" -f ($i + 1), (Split-Path -Parent $cands[$i].Www)) White
        Say ("      通过：$($cands[$i].Why)") DarkGray
    }
    Write-Host ''
    Say '   输入编号后回车；或把【游戏文件夹】拖进窗口后回车；直接回车 = 取消。' DarkGray
    while ($true) {
        $line = Read-Host '  要装到哪个'
        if ([string]::IsNullOrWhiteSpace($line)) { return $null }
        $n = 0
        if ([int]::TryParse($line.Trim(), [ref]$n) -and $n -ge 1 -and $n -le $cands.Count) { return $cands[$n - 1].Www }
        $w = Get-WwwOf $line
        if (-not $w) {
            $under = @(Get-GamesUnder $line 2)
            if ($under.Count -eq 1) { $w = $under[0] }
        }
        if ($w) { return $w }
        Warn '这个位置里没找到游戏（里面应该有 www\data\System.json），再试一次。'
    }
}

Write-Host ''
Say '  RM_AI_NPC  一键安装' White
Say '  ====================================' DarkGray

$Www = $null
$others = @()          # 顺带发现的其它游戏，末尾提示用
$how = ''

if (-not [string]::IsNullOrWhiteSpace($Game)) {
    # ── 情形 1：指定了游戏（拖拽 / -Game）。指定的就是指定的，找不到就退出。
    $Www = Get-WwwOf $Game
    $how = '你指定的'
    if (-not $Www) {
        $under = @(Get-GamesUnder $Game 3)
        if ($under.Count -eq 1) {
            $Www = $under[0]
            $how = '在指定的目录下面找到的'
        }
        elseif ($under.Count -gt 1) {
            if ($Quiet -and $Pick -le 0) {
                Warn "指定的目录下有 $($under.Count) 个游戏，静默模式无法确认。"
                Pause-Close 3
            }
            $cands = @($under | ForEach-Object { [PSCustomObject]@{ Www = $_; Rank = 2; Dist = 0; Why = '在你指定的目录下面' } })
            $Www = Ask-Choose $cands
            if (-not $Www) { Warn '已取消，什么都没改。'; Pause-Close 0 }
            $how = '你指定的目录下面的'
        }
        else {
            Die "这里没找到游戏：$Game" @(
                '要装到哪个游戏，就把【那个游戏的文件夹】拖到「一键安装.bat」上。',
                '拖动的是最外层目录也没关系，只要它下面 3 层内有 www\data\System.json。',
                '游戏根目录的标志：里面有 Game.exe，还有 www\data\System.json。',
                '（找不到就报错，不会自动装到电脑里别的游戏上 —— 免得装错。）'
            )
        }
    }
}
else {
    # ── 情形 2：没指定（双击）。先看「包是不是就在游戏里」，再考虑要不要问。
    $cands = @(Get-GameCandidates)
    if ($cands.Count -gt 0 -and $cands[0].Rank -eq 0) {
        $Www = $cands[0].Www
        $how = '安装包就解压在这个游戏文件夹里'
        $others = @($cands | Select-Object -Skip 1)
    }
    elseif ($Pick -gt 0 -and $Pick -le $cands.Count) {
        $Www = $cands[$Pick - 1].Www
        $how = "你选的第 $Pick 个（$($cands[$Pick - 1].Why)）"
        $others = @($cands | Where-Object { $_.Www -ne $Www })
    }
    elseif ($cands.Count -eq 1) {
        $g = Split-Path -Parent $cands[0].Www
        if ($Quiet -and -not $Yes) {
            Write-Host ''
            Warn "只找到一个游戏，但它不是「包所在的那个」：$g"
            Warn '静默模式下不替你拍板。要么用 -Yes 确认，要么用 -Game 指过去。'
            Pause-Close 3
        }
        Write-Host ''
        Warn "要把插件装到这个游戏里吗？（$($cands[0].Why)）"
        Say "     $g" White
        $yn = 'y'
        if (-not $Quiet) { $yn = Read-Host '  回车 = 是；输入 n = 换个游戏' }
        if ($yn -and $yn.Trim().ToLower().StartsWith('n')) {
            $Www = Ask-Choose $cands
            if (-not $Www) { Warn '已取消，什么都没改。'; Pause-Close 0 }
            $how = '你选的'
        }
        else {
            $Www = $cands[0].Www
            $how = '你确认过的'
        }
    }
    elseif ($cands.Count -gt 1) {
        if ($Quiet -and -not $Yes -and $Pick -le 0) {
            Write-Host ''
            Warn "找到 $($cands.Count) 个游戏，静默模式无法确认是哪一个。"
            foreach ($c in $cands) { Say ("     · " + (Split-Path -Parent $c.Www)) DarkGray }
            Warn '用 -Game 指定，或用 -Pick N 选第 N 个。'
            Pause-Close 3
        }
        if ($Yes) {
            $Www = $cands[0].Www
            $how = "-Yes 取了最可信的一个（$($cands[0].Why)）"
        }
        else {
            $Www = Ask-Choose $cands
            if (-not $Www) { Warn '已取消，什么都没改。'; Pause-Close 0 }
            $how = '你选的'
        }
        $others = @($cands | Where-Object { $_.Www -ne $Www })
    }
    else {
        # 一个都没找到 → 问用户要
        Write-Host ''
        Warn '安装包旁边没找到游戏目录。'
        Say '  请把【游戏文件夹】拖进这个窗口，然后按回车。' Yellow
        Say '  （就是那个里面有 Game.exe、并且有 www 文件夹的目录）' DarkGray
        Say '  直接按回车 = 放弃。' DarkGray
        if ($Quiet) { Say '  （静默模式下不会提问，取消安装。）' DarkGray; Pause-Close 0 }
        while (-not $Www) {
            $line = Read-Host '  游戏文件夹'
            if ([string]::IsNullOrWhiteSpace($line)) { Say ''; Warn '已取消，什么都没改。'; Pause-Close 0 }
            $Www = Get-WwwOf $line
            if (-not $Www) {
                $under = @(Get-GamesUnder $line 3)
                if ($under.Count -eq 1) { $Www = $under[0] }
                elseif ($under.Count -gt 1) {
                    $Www = Ask-Choose @($under | ForEach-Object { [PSCustomObject]@{ Www = $_; Rank = 2; Dist = 0; Why = '在你拖进来的目录下面' } })
                }
            }
            if (-not $Www) { Warn '这下面没找到游戏（应该有 www\data\System.json），再试一次。' }
        }
        $how = '你拖进来的'
    }
}

if (-not $Www) { Warn '已取消，什么都没改。'; Pause-Close 0 }

$GameRoot = Split-Path -Parent $Www
Write-Host ''
Say '  ==================================================' DarkGray
Say '   安装目标' Cyan
Say "     $GameRoot" White
Say "   插件会写进 $Www\js\plugins  和  $Www\ai_npc" DarkGray
Say "   （$how）" DarkGray
Say '  ==================================================' DarkGray

# ──────────────────────────────────────────────── 前置检查
$pluginsJs = Join-Path $Www 'js\plugins.js'
if (-not (Test-Path -LiteralPath $pluginsJs)) { Die "这不是 MV / MZ 工程：找不到 $pluginsJs" @('换个游戏根目录再试（要能找到 www\js\plugins.js）。') }
$srcPlugin = Join-Path $PKG 'RM_AI_NPC.js'
if (-not (Test-Path -LiteralPath $srcPlugin)) { Die "包不完整：找不到 $srcPlugin" @('请把压缩包完整解压后再运行。') }

$pluginsDir = Join-Path $Www 'js\plugins'
# 用 .NET 建目录：路径里的 [ ] 不会被 PowerShell 当通配符
[void][IO.Directory]::CreateDirectory($pluginsDir)

# ──────────────────────────────────────────────── 1) 备份 + 复制插件
Head '第 1 步 / 4　安装插件'
$orig = [IO.File]::ReadAllText($pluginsJs)
if ($orig -notmatch 'RM_AI_NPC') {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $pluginsJs -Destination "$pluginsJs.bak-$stamp" -Force
    Ok "已备份 plugins.js → plugins.js.bak-$stamp"
} else {
    Info '之前装过，跳过备份（最早那份原版备份还在）'
}
Copy-Item -LiteralPath $srcPlugin -Destination (Join-Path $pluginsDir 'RM_AI_NPC.js') -Force
Ok '插件 → www\js\plugins\RM_AI_NPC.js'

# ──────────────────────────────────────────────── 2) 注册到 $plugins 末位
Head '第 2 步 / 4　注册到插件列表末位'
$a = $orig.IndexOf('['); $b = $orig.LastIndexOf(']')
$list = @()
if ($a -ge 0 -and $b -gt $a) {
    try {
        # 坑：PS 5.1 的 ConvertFrom-Json 对「顶层数组」是不枚举输出（一次吐出整个数组对象），
        # 直接 @(ConvertFrom-Json ...) 会得到「装着数组的单元素数组」——
        # 于是筛选条件对不上、写回时又会把整个数组当成一个条目。
        # 症状：第二次安装时把别人的插件从 plugins.js 里抹掉。必须显式 foreach 摊平。
        foreach ($item in (ConvertFrom-Json $orig.Substring($a, $b - $a + 1))) {
            if ($item -and $item.name) { $list += $item }
        }
    }
    catch {
        Warn "plugins.js 解析失败：$($_.Exception.Message)"
        Warn '为安全起见会按「只有本插件」重写 —— 原来的列表请从 plugins.js.bak-* 里找回来。'
        $list = @()
    }
}
$list = @($list | Where-Object { $_ -and $_.name -ne 'RM_AI_NPC' })
$entry = [PSCustomObject]([ordered]@{
        name        = 'RM_AI_NPC'
        status      = $true
        description = 'AI NPC 扮演引擎 —— 世界书驱动 + 结构化动作白名单（支持 MV / MZ）'
        parameters  = [PSCustomObject]([ordered]@{
                configPath = 'ai_npc/config.json'
                endpoint   = 'https://api.deepseek.com/chat/completions'
                apiKey     = ''
                model      = 'deepseek-chat'
                maxTurns   = '8'
                debug      = 'false'
            })
    })
$list = @($list) + $entry

$jsonLines = @()
foreach ($p in $list) { $jsonLines += ($p | ConvertTo-Json -Compress -Depth 10) }
$out = "// Generated by RPG Maker.`r`n// Do not edit this file directly.`r`nvar `$plugins =`r`n[`r`n" +
($jsonLines -join ",`r`n") + "`r`n];`r`n"
[IO.File]::WriteAllText($pluginsJs, $out, (New-Object System.Text.UTF8Encoding($false)))
Ok "已写入（现在共 $($list.Count) 个插件，RM_AI_NPC 在最末位）"

# ──────────────────────────────────────────────── 3) 配置面板与提示词模板
Head '第 3 步 / 4　放置配置面板'
$AI = Join-Path $Www 'ai_npc'
$aiNew = -not (Test-Path -LiteralPath $AI)
[void][IO.Directory]::CreateDirectory($AI)

$panelCount = 0
foreach ($f in @('config-panel.html', 'config-server.js', 'panel-help.txt', '打开配置面板.bat')) {
    $s = Join-Path $PKG ("tools\" + $f)
    if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination (Join-Path $AI $f) -Force; $panelCount++ }
}
Info "配置面板 → www\ai_npc（$panelCount 个文件）"

# 游戏内工具 → www\ai_npc\tools\
# 插件启动时会就地跑它们：世界书扫描 / 全量语料 / 世界观圣经 / 人设线索 / 设定主题 / 设定线索。
# v2.8.0 起「配置好 Key 一键生成」走的正是这几个 —— 跑的是和命令行**同一份源码**，缺一个就断链。
# 放在 www\ai_npc 下而不是包目录 —— 万一接收方只把 www 整个搬走，它们也跟着走。
$toolDst = Join-Path $AI 'tools'
[void][IO.Directory]::CreateDirectory($toolDst)
$toolCount = 0
foreach ($f in @('scan_game.js', 'extract_lore.js', 'corpus_digest.js', 'ai_schema.js',
                 'persona_core.js', 'gen_bible.js', 'build_persona_input.js',
                 'gen_topics.js', 'build_lorebook_input.js', 'place_names.js')) {
    $s = Join-Path $PKG ("tools\" + $f)
    if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination (Join-Path $toolDst $f) -Force; $toolCount++ }
}
Info "游戏内工具 $toolCount 个 → www\ai_npc\tools（世界书 / 世界观 / 人设线索 / 设定线索，游戏里自动完成）"

$rootBat = Join-Path $PKG 'tools\打开AI配置面板.bat'
if (Test-Path -LiteralPath $rootBat) {
    Copy-Item -LiteralPath $rootBat -Destination (Join-Path $GameRoot '打开AI配置面板.bat') -Force
    Info '快捷入口 → 游戏根目录的「打开AI配置面板.bat」'
}

foreach ($f in @('persona_prompt.json', 'persona_sample.json', 'lorebook_prompt.json',
                 'bible_prompt.json', 'topics_prompt.json')) {
    $s = Join-Path $PKG ("_lore\" + $f)
    if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination (Join-Path $AI $f) -Force }
}

# ──────────────────────────────────────────────── 4) 世界书 / 配置模板
Head '第 4 步 / 4　铺数据'
$contentDir = Join-Path $PKG 'content'
$hasContent = $false
if (Test-Path -LiteralPath $contentDir) {
    foreach ($f in @('worldbook.json', 'actors_ai.json', 'lorebook.json')) {
        $s = Join-Path $contentDir $f
        if (Test-Path -LiteralPath $s) {
            Copy-Item -LiteralPath $s -Destination (Join-Path $AI $f) -Force
            $hasContent = $true
        }
    }
}
if ($hasContent) { Ok '世界书 + 角色档案 + 世界设定 已就位' }

# config.json：绝不覆盖玩家已经填过 Key 的那份
$cfg = Join-Path $AI 'config.json'
$tpl = Join-Path $PKG 'config.template.json'
if (Test-Path -LiteralPath $cfg) {
    Info 'config.json 已存在，保持不动（填过的 Key 不会丢）'
}
elseif (Test-Path -LiteralPath $tpl) {
    Copy-Item -LiteralPath $tpl -Destination $cfg -Force
    Ok 'config.json 已生成（还没填 API Key）'
}
else {
    Warn '包里缺 config.template.json —— 进游戏后按 F10 面板也能自动建'
}

# ──────────────────────────────────────────────── 收尾
Write-Host ''
Say '  ==================================================' DarkGray
Say '   装好了。' White
Say "   装到了：$GameRoot" White
Say '  ==================================================' DarkGray
Write-Host ''
Say '   接下来：' White
Say '   1) 启动游戏 → 任意界面按 F10 → 填 API Key' White
Say '      （不填也能玩：走离线仿真模式，先验证装通没）' DarkGray
Say '   2) 菜单（Esc / M / Home）→「AI 角色」→ 勾选想交给 AI 的 NPC' White
Say '   3) 去和它说话' White
Write-Host ''
if (-not $hasContent) {
    Say '   · 本包没带世界书 —— 不用管：进游戏第一次启动时插件会自己扫一遍' Green
    Say '     （读原作数据生成 NPC 名录与台词，约 1 秒，不联网、不花额度、不用装 Node.js）' DarkGray
    Write-Host ''
}
if ($others.Count -gt 0) {
    Say '   ⚠ 本次只改了上面那一个。电脑里还发现这些游戏，没动：' Yellow
    foreach ($o in $others) { Say ("     · " + (Split-Path -Parent $o.Www)) DarkGray }
    Say '     要装到它们，把那个游戏文件夹拖到「一键安装.bat」上重跑一次。' Yellow
    Write-Host ''
}
Say '   出问题先看  www\ai_npc\startup.log' DarkGray
Say '   想还原：把 www\js\plugins.js.bak-* 覆盖回 plugins.js' DarkGray
Say '  ==================================================' DarkGray
Write-Host ''
Pause-Close 0
