# install.ps1 — DeepSeek Harness 环境一键安装（Windows）
#
# 用法（在包根目录）:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun      # 只打印将做什么
#
# Ubuntu / Linux 请用 install.sh（本脚本的 Windows 对应物）。
#
# 设计原则（2026-09-19 修订）:
#   · **只增不删**：settings.yaml / .credentials.yaml 一律走合并，不整份覆盖。
#     老版本用 Copy-Item 覆盖，会把本机已调好的 spill-policy / compaction-basic /
#     compaction-acp / agent-default-model 全部抹掉（实测：183 行 → 77 行）。
#   · **不擅自升级 / 不擅自装第三方**：升级 dsh、装 GitHub 上的插件、改 `~/.claude/CLAUDE.md`
#     这三件事**默认全部不做**，必须用 -UpgradeDsh / -InstallPlugin / -RtkInitGlobal 显式打开。
#     理由：本机 dsh 是 0.1.5-rc.2，升级会让 presets/*.cordis.yml 与 standard-leash 对齐失效；
#     而那三件事都会改动 DSH 之外的用户环境，属于"用户自己该决定"的范围。
#   · 幂等：重复运行不会重复追加 PATH / 规则块。
#   · 不静默吞错：每步失败都明确报告，并继续跑其余步骤（最后汇总）。
param(
    [switch]$NoDsh,
    [switch]$NoPlugin,
    [switch]$NoRtk,
    [switch]$NoLauncher,
    [switch]$NoSettings,
    [switch]$NoPreset,
    [switch]$NoHandoff,
    [switch]$NoScripts,
    [string]$Profile = "web",
    [switch]$UpgradeDsh,        # 显式要求把 dsh 升到最新（默认：已装就不动）
    [switch]$InstallPlugin,     # 显式要求装 GitHub 上的余额插件（默认不装）
    [switch]$RtkInitGlobal,     # 显式要求跑 rtk init --global（会改 ~/.claude/CLAUDE.md）
    [switch]$HardenDefaultPreset, # 把护栏打进**你实际在用的**那个 preset（会备份，默认只报告不改）
    [switch]$NonInteractive,    # 不问任何问题（CI / 自动化用；会跳过填 Key 的交互）
    [switch]$ForceSettings,     # 真的想整份覆盖 settings.yaml（仍会备份）
    [switch]$ForceLauncher,     # 即使检测到已装启动器也照放
    [switch]$ForceRtkConfig,    # 覆盖已有的 rtk config.toml / filters.toml
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$script:Failures = @()
$script:StepNo = 0
$script:StepTotal = 7

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step([string]$title) {
    $script:StepNo++
    Write-Host "`n[$($script:StepNo)/$($script:StepTotal)] $title" -ForegroundColor Green
}
function SkipStep([string]$title, [string]$flag) {
    $script:StepNo++
    Write-Host "`n[$($script:StepNo)/$($script:StepTotal)] 跳过 $title ($flag)" -ForegroundColor Yellow
}
function Fail([string]$what, [string]$why) {
    $script:Failures += "$what : $why"
    Write-Host "  [!] $what 失败 — $why" -ForegroundColor Red
}
function Say([string]$msg) { Write-Host "  $msg" -ForegroundColor Cyan }
# 注意：**不能**把这个函数命名为 Do —— 会和 PowerShell 的 `do {} while` 关键字冲突，
# 于是 `Do "desc" { ... }` 被解析成 do 循环，报 "Missing statement body in do loop"（已实测）。
function Exec([string]$desc, [scriptblock]$action) {
    if ($DryRun) { Write-Host "  [dry-run] $desc" -ForegroundColor DarkGray; return }
    & $action
}

Write-Host "== DeepSeek Harness 迁移包一键安装（Windows） ==" -ForegroundColor Cyan
Write-Host "包目录: $root"
Write-Host "DSH_HOME: $(Join-Path $env:USERPROFILE '.dsh')"
if ($DryRun) { Write-Host "*** DRY RUN：不会改动任何文件 ***" -ForegroundColor Magenta }

# ---------------- 1. Node & npm ---------------- #
Step "检查 Node.js / npm"
$nodeOk = $false
try {
    $nv = (& node --version) 2>$null
    $npmv = (& npm --version) 2>$null
    if ($LASTEXITCODE -eq 0 -and $nv) {
        $nodeOk = $true
        Write-Host "  node $nv / npm $npmv" -ForegroundColor Green
        # node 24 起才支持 --use-env-proxy（启动器要用，且要用它做版本门控）
        $major = [int]($nv.TrimStart('v').Split('.')[0])
        if ($major -lt 24) {
            Write-Host "  [i] node < 24：启动器将不会注入 NODE_OPTIONS=--use-env-proxy（该参数在老版本会直接报 bad option）" -ForegroundColor Yellow
        }
        if ($major -lt 20) {
            Fail "Node 版本" "dsh 需要较新的 Node（建议 LTS 20+），当前 $nv"
        }
    } else { throw "node --version 无输出" }
} catch {
    Fail "Node.js/npm" "未检测到。请先装 Node LTS 并加入 PATH: https://nodejs.org/  （Ubuntu: sudo apt install nodejs npm 或用 nvm）"
}
if (-not $nodeOk) {
    Write-Host "`n没有 Node，后续步骤无法进行。装好 Node 后重新运行本脚本。" -ForegroundColor Red
    exit 1
}

# ---------------- 2. dsh 本体 ---------------- #
if (-not $NoDsh) {
    Step "安装/更新 dsh 本体 (@deepseek-ai/dsh)"
    $installed = Get-Command dsh -ErrorAction SilentlyContinue
    if ($installed -and -not $UpgradeDsh) {
        # 默认**不**升级：本机 dsh 可能是 rc 版，而且 presets/*.cordis.yml 与
        # presets/standard-leash/agent.cordis.yml 都是按**当前**版本的 shipped preset 对齐的
        # （见 presets/standard-leash/SOURCE.txt 里的 dsh version 与 sha256）。
        # 升级会让这些副本悄悄漂移，所以升级必须是用户的显式决定。
        $cur = (& dsh --version) 2>$null
        Say "已装 dsh $cur —— 默认不升级（升级会改动 presets 对齐）"
        Say "    要升到最新请显式加 -UpgradeDsh"
        Say "    升级后务必跑: node tools\regen-standard-leash.mjs --check"
    } else {
        try {
            if ($installed) { Say "按 -UpgradeDsh 升级到最新" } else { Say "未检测到 dsh，安装" }
            Exec "npm install -g @deepseek-ai/dsh" { & npm install -g @deepseek-ai/dsh }
            if (-not $DryRun) {
                $ver = (& dsh --version) 2>$null
                Say "dsh 版本: $ver"
            }
        } catch { Fail "dsh 安装" $_.Exception.Message }
    }
} else { SkipStep "dsh 安装" "-NoDsh" }

# ---------------- 3. 余额插件（默认不装） ---------------- #
if (-not $NoPlugin) {
    if (-not $InstallPlugin) {
        Step "余额插件 dsh-whale-widget"
        Say "默认**不装**：它来自第三方仓库 github:MeteorNOX/DeepSeek-Balance-Whale-Widget，"
        Say "    属于供应链决定，不该由安装脚本替你做。要装请显式加 -InstallPlugin。"
    } else {
        Step "安装余额插件 dsh-whale-widget (profile: $Profile)"
        $profDir = Join-Path (Join-Path $env:USERPROFILE ".dsh") "profiles\$Profile"
        if (-not (Test-Path $profDir)) {
            Say "[i] profile '$Profile' 还不存在。dsh 的 plugin 子命令要求 profile 已存在，"
            Say "    先跑一次 ``dsh web``（然后关掉），或改用 -Profile <已有 profile>。"
        }
        try {
            Exec "dsh plugin --profile $Profile add github:MeteorNOX/DeepSeek-Balance-Whale-Widget" {
                & dsh plugin --profile $Profile add github:MeteorNOX/DeepSeek-Balance-Whale-Widget
            }
            Say "完成。插件会出现在 Web 界面右下角（小鲸鱼）。"
        } catch {
            Fail "余额插件" "$($_.Exception.Message)（若需代理，先设 `$env:https_proxy='http://127.0.0.1:7897'）"
        }
    }
} else { SkipStep "余额插件" "-NoPlugin" }

# ---------------- 4. RTK ---------------- #
if (-not $NoRtk) {
    Step "安装 RTK (Rust Token Killer)"
    try {
        $binDir = Join-Path $env:USERPROFILE ".local\bin"
        Exec "建目录 $binDir" { New-Item -ItemType Directory -Force $binDir | Out-Null }
        $src = Join-Path $root "rtk\rtk.exe"
        if (Test-Path $src) {
            Exec "复制 rtk.exe -> $binDir" { Copy-Item $src (Join-Path $binDir "rtk.exe") -Force }
            Say "已复制 rtk.exe -> $binDir\rtk.exe"
        } else { Fail "RTK 二进制" "包里没有 rtk\rtk.exe" }

        # 永久写进用户 PATH（老版本只改了当前会话，README 却承诺"重开终端即在 PATH"）
        if (-not $DryRun) {
            $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
            if ($null -eq $userPath) { $userPath = "" }
            $parts = $userPath.Split(';') | Where-Object { $_ -ne "" }
            if ($parts -notcontains $binDir) {
                $newPath = (@($parts) + $binDir) -join ';'
                [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
                Say "已把 $binDir 写入用户 PATH（重开终端生效）"
            } else { Say "$binDir 已在用户 PATH 中" }
        } else { Say "[dry-run] 把 $binDir 写入用户 PATH" }
        $env:Path += ";$binDir"

        # RTK 配置：包里带着 config.toml / filters.toml，老版本从不复制它们，
        # README 却说"已生成配置"——实测本机 %APPDATA%\rtk 下只有 filters.toml。
        # Windows 配置目录证据：rtk.exe 内含字面量 "rtk/config.toml"，
        # 且自行文档化 "~/.config/rtk/filters.toml"（Linux/XDG）→ Windows 用 %APPDATA%。
        $rtkCfgDir = Join-Path $env:APPDATA "rtk"
        Exec "建目录 $rtkCfgDir" { New-Item -ItemType Directory -Force $rtkCfgDir | Out-Null }
        foreach ($pair in @(@("config.toml", "rtk\config.toml"), @("filters.toml", "rtk\filters.toml"))) {
            $name = $pair[0]; $rel = $pair[1]
            $s = Join-Path $root $rel
            $d = Join-Path $rtkCfgDir $name
            if (-not (Test-Path $s)) { continue }
            if ((Test-Path $d) -and -not $ForceRtkConfig) {
                Say "保留已有 $d（要覆盖加 -ForceRtkConfig）"
            } else {
                Exec "复制 $rel -> $d" { Copy-Item $s $d -Force }
                Say "已写 $d"
            }
        }
        # `rtk init --global` 会往 ~/.claude/CLAUDE.md 里写全局指令块 —— 那是**另一个工具**的
        # 用户级配置，不该被本脚本悄悄改。默认不跑。
        if ($RtkInitGlobal) {
            Exec "rtk init --global（写全局指令块）" { & rtk init --global 2>$null | Out-Null }
        } else {
            Say "[i] 未跑 rtk init --global：它会改 ~/.claude/CLAUDE.md（另一个工具的全局配置）。"
            Say "    需要就用 -RtkInitGlobal。"
        }
        if (-not $DryRun) { Say "RTK 版本: $((& rtk --version) 2>$null)" }
    } catch { Fail "RTK" $_.Exception.Message }
} else { SkipStep "RTK" "-NoRtk" }

# ---------------- 5. settings.yaml（合并，不覆盖） ---------------- #
if (-not $NoSettings) {
    Step "合并 API/provider 与成本治理设置 -> ~/.dsh/settings.yaml"
    try {
        $merger = Join-Path $root "tools\merge-settings.mjs"
        $tpls = @("config\settings.yaml", "config\settings.cost.yaml",
                  "config\settings.deepseek-cheap.yaml", "config\settings.preset.yaml")
        $tplArgs = @()
        foreach ($t in $tpls) {
            $p = Join-Path $root $t
            if (Test-Path $p) { $tplArgs += @("--template", $p) } else { Say "[i] 跳过不存在的模板 $t" }
        }
        if (-not (Test-Path $merger)) { Fail "settings 合并" "缺少 tools\merge-settings.mjs" }
        elseif ($tplArgs.Count -eq 0) { Fail "settings 合并" "一个模板都没找到" }
        else {
            # ⚠️ 变量**不能**叫 $args —— 那是 PowerShell 的自动变量（本脚本自己的参数数组），
            # 赋值会被自动值盖掉，于是 `@args` 展开成空，合并器只收到 usage 而什么都没做。
            # 实测踩过：真部署时第 5 步静默什么都没合并（只打印了 merger 的用法）。
            $margs = $tplArgs + @("--target", (Join-Path $env:USERPROFILE ".dsh\settings.yaml"))
            if ($ForceSettings) { $margs += "--force" }
            if ($DryRun) { $margs += "--dry-run" }
            Exec "node tools\merge-settings.mjs $($margs -join ' ')" { & node $merger @margs }
            if (-not $DryRun) { Say "（合并器只增不删；本机已有的 spill-policy/compaction-* 原样保留）" }
        }
        $credScript = Join-Path $root "config\set-credentials.ps1"
        if ((Test-Path $credScript) -and -not $NonInteractive) {
            Say "密钥：仓库不含真实 Key（只有占位模板）。可交互式填写（会保留已有 records 段）："
            if ($DryRun) { Say "[dry-run] 询问是否填写 API Key" }
            else {
                $ans = Read-Host "  现在填写各平台 API Key? (y/n，回车跳过)"
                if ($ans -match "^[yY]") { & powershell -ExecutionPolicy Bypass -File $credScript }
            }
        } elseif ($NonInteractive) { Say "-NonInteractive：跳过填 Key（仓库本来也不含 Key）" }
    } catch { Fail "settings 合并" $_.Exception.Message }
} else { SkipStep "settings 合并" "-NoSettings" }

# ---------------- 6. preset / handoff / AGENTS.md / 脚本 ---------------- #
if (-not $NoPreset) {
    $presetSrc = Join-Path $root "presets\standard-leash"
    if (Test-Path $presetSrc) {
        try {
            $dst = Join-Path $env:USERPROFILE ".dsh\.agent-presets\standard-leash"
            Exec "复制 standard-leash preset -> $dst" {
                New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
                Copy-Item $presetSrc $dst -Recurse -Force
            }
            Say "已装 preset: standard-leash（禁递归 + 子代理降档 + persona）"
            Say "[i] 只在 settings.preset.yaml 合并成功后才成为默认；"
            Say "    若本机已有别的 agent-presets.default，合并器会保留本机的，不覆盖。"
        } catch { Fail "preset" $_.Exception.Message }
    } else { Write-Host "  跳过 preset（包里没有 presets\standard-leash）" -ForegroundColor Yellow }
}

# 关键补漏：standard-leash 只影响"选了它的会话"。若本机 agent-presets.default 是别人
# （本机实测是用户自定义的 router-standard），装 standard-leash **一点防护都没有**。
# 所以要检查**实际在用的**那份 preset 有没有护栏，并给出可直接照做的命令。
$hardenScript = Join-Path $root "tools\harden-preset.mjs"
$settingsPath = Join-Path $env:USERPROFILE ".dsh\settings.yaml"
if (Test-Path $hardenScript) {
    Write-Host "`n  — 检查**实际在用**的默认 preset 是否已加护栏" -ForegroundColor Green
    $defaultName = $null
    if (Test-Path $settingsPath) {
        $inAp = $false
        foreach ($line in (Get-Content $settingsPath -Encoding UTF8)) {
            if ($line -match '^agent-presets:\s*$') { $inAp = $true; continue }
            if ($inAp) {
                if ($line -match '^\S') { break }
                if ($line -match '^\s+default:\s*(.+?)\s*$') { $defaultName = $Matches[1].Trim().Trim('"'); break }
            }
        }
    }
    if (-not $defaultName) {
        Say "[i] settings.yaml 里没有 agent-presets.default —— DSH 会用内置 standard（无护栏）"
    } elseif ($defaultName -eq "standard-leash") {
        Say "默认 preset = standard-leash（已含护栏）"
    } else {
        $target = Join-Path $env:USERPROFILE ".dsh\.agent-presets\$defaultName"
        Say "默认 preset = $defaultName（**不是** standard-leash）"
        if (Test-Path (Join-Path $target "agent.cordis.yml")) {
            if ($DryRun) { Say "[dry-run] node tools\harden-preset.mjs `"$target`" --check" }
            else {
                # 必须临时把 $ErrorActionPreference 放回 Continue：
                # 本脚本顶部设的是 Stop，而 native 命令往 stderr 写东西 + 被 2>&1 接进管道时，
                # PowerShell 会生成 NativeCommandError —— 在 Stop 下**直接终止整个脚本**。
                # 实测踩过：harden-preset --check 正常返回 1（"未加固"），却把第 6/7 步全带走了。
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                try {
                    $hardenOut = (& node $hardenScript $target --check 2>&1 | Out-String)
                    $hardenOk = ($LASTEXITCODE -eq 0)
                } finally { $ErrorActionPreference = $prevEap }
                if (-not $hardenOk) {
                    foreach ($l in ($hardenOut -split "`r?`n" | Where-Object { $_.Trim() })) { Say "  $($l.Trim())" }
                    if ($HardenDefaultPreset) {
                        $ErrorActionPreference = "Continue"
                        try {
                            $runOut = (& node $hardenScript $target 2>&1 | Out-String)
                            $runOk = ($LASTEXITCODE -eq 0)
                        } finally { $ErrorActionPreference = $prevEap }
                        foreach ($l in ($runOut -split "`r?`n" | Where-Object { $_.Trim() })) { Say "  $($l.Trim())" }
                        if ($runOk) { Say "已加固 $defaultName（原文件已备份为 *.bak-harden-<时间戳>）" }
                        else { Fail "加固默认 preset" "harden-preset.mjs 退出非 0" }
                    } else {
                        Say "  [!] 该 preset 里 tool-subagent / tool-subagent-fork 没有 maxDepth/toolFilter ——"
                        Say "      子代理可以无限递归再派子代理（仓库记录的 ¥8.34 扇出事故就是这条路）。"
                        Say "      要修就加 -HardenDefaultPreset 重跑，或手工执行:"
                        Say "        node tools\harden-preset.mjs `"$target`""
                    }
                } else { Say "该 preset 已加护栏" }
            }
        } else { Say "[i] 找不到 $target\agent.cordis.yml，跳过" }
    }
}

if (-not $NoHandoff) {
    Step "安装交接体系 (handoff) 与全局规则"
    try {
        $src = Join-Path $root "handoff"
        if (Test-Path $src) {
            $dst = Join-Path $env:USERPROFILE ".handoff"
            Exec "复制 handoff -> $dst" {
                New-Item -ItemType Directory -Force $dst | Out-Null
                Copy-Item (Join-Path $src "*") $dst -Recurse -Force
                foreach ($sub in @("reports", "review", "research")) {
                    New-Item -ItemType Directory -Force (Join-Path $dst $sub) | Out-Null
                }
            }
            Say "已装交接体系: $dst"
        } else { Write-Host "  跳过 handoff（包里没有 handoff\ 目录）" -ForegroundColor Yellow }

        # 关键：DSH 的**用户全局**指令文件是 $DSH_HOME/AGENTS.md，不是 ~/AGENTS.md。
        # 证据：dsh-agent-instructions/lib/index.js:141 USER_GLOBAL_FILE = "AGENTS.md";
        #       :148 displayPath === "~/.dsh/AGENTS.md" -> user-global。
        # 仓库老文档让人写进 ~/AGENTS.md —— DSH 从不读那个路径。
        $block = Join-Path $root "handoff\AGENTS.block.md"
        $agents = Join-Path $env:USERPROFILE ".dsh\AGENTS.md"
        if (Test-Path $block) {
            $body = (Get-Content $block -Raw -Encoding UTF8)
            $marker = "## 成本与交接规程"
            if ((Test-Path $agents) -and ((Get-Content $agents -Raw -Encoding UTF8) -like "*$marker*")) {
                Say "保留已有 $agents（已含成本与交接规程，不重复追加）"
            } else {
                Exec "写入 $agents" {
                    $dir = Split-Path -Parent $agents
                    New-Item -ItemType Directory -Force $dir | Out-Null
                    # 用 .NET 写，不用 Add-Content -Encoding UTF8 —— PS 5.1 的 Add-Content
                    # 在追加时可能塞进 BOM，而 markdown 里一个 BOM 会变成可见字符。
                    # UTF8Encoding($false) = 不带 BOM。
                    $enc = New-Object System.Text.UTF8Encoding($false)
                    if (Test-Path $agents) {
                        [System.IO.File]::AppendAllText($agents, "`r`n`r`n$body", $enc)
                    } else {
                        [System.IO.File]::WriteAllText($agents, $body, $enc)
                    }
                }
                Say "已把 6 条成本/交接规则写进 $agents"
            }
        } else { Write-Host "  跳过全局规则（缺 handoff\AGENTS.block.md）" -ForegroundColor Yellow }
    } catch { Fail "handoff/规则" $_.Exception.Message }
} else { SkipStep "handoff/规则" "-NoHandoff" }

if (-not $NoScripts) {
    if ($NoHandoff) { Step "安装度量脚本 -> ~/.dsh-analysis" }
    else { Write-Host "`n  — 度量脚本 -> ~/.dsh-analysis" -ForegroundColor Green }
    try {
        $src = Join-Path $root "scripts"
        if (Test-Path $src) {
            $dst = Join-Path $env:USERPROFILE ".dsh-analysis"
            Exec "复制 scripts -> $dst" {
                New-Item -ItemType Directory -Force $dst | Out-Null
                Copy-Item (Join-Path $src "*.py") $dst -Force
            }
            Say "已装: $dst（跨平台版本，不再依赖 zstdcat）"
        }
    } catch { Fail "度量脚本" $_.Exception.Message }
}

# ---------------- 7. Launcher ---------------- #
if (-not $NoLauncher) {
    Step "编译并放置启动器"
    $existing = Join-Path $env:LOCALAPPDATA "Programs\DSH Launcher\DSH Launcher.exe"
    try {
        $build = Join-Path $root "launcher\build.ps1"
        if (Test-Path $build) {
            Exec "编译 launcher" { & powershell -ExecutionPolicy Bypass -File $build }
            $outExe = Join-Path $root "launcher\dist\Launcher.exe"
            if ((Test-Path $outExe) -or $DryRun) {
                if ((Test-Path $existing) -and -not $ForceLauncher) {
                    Say "[i] 检测到本机已装 Electron 版启动器:"
                    Say "    $existing"
                    Say "    再放一个 C# 启动器会造成双启动器。默认**不**放置。"
                    Say "    确实要放请加 -ForceLauncher；只用它的能力也可以直接跑 $outExe"
                } else {
                    # 放 %LOCALAPPDATA%\Programs\ —— **不要**放桌面。
                    # 老版本直接 Copy-Item 到桌面，而老版 PickWorkingDirectory 会把 exe 所在
                    # 目录当成 dsh 的工作目录，于是**桌面**成了 workdir，用户产物写到桌面上。
                    # 现在 exe 放固定安装目录，桌面只放一个快捷方式（快捷方式不参与该探测）。
                    $installDir = Join-Path $env:LOCALAPPDATA "Programs\dsh-launcher"
                    $dest = Join-Path $installDir "Launcher.exe"
                    Exec "复制到 $dest" {
                        New-Item -ItemType Directory -Force $installDir | Out-Null
                        Copy-Item $outExe $dest -Force
                    }
                    Say "已安装: $dest"

                    # 固定工作目录（可选）：写边车文件比"把 exe 放某处"可靠得多
                    $wdSidecar = Join-Path $installDir "dsh-workdir.txt"
                    if ((Test-Path "D:\Deepseek Harness") -and -not (Test-Path $wdSidecar) -and -not $DryRun) {
                        [System.IO.File]::WriteAllText($wdSidecar, "D:\Deepseek Harness",
                            (New-Object System.Text.UTF8Encoding($false)))
                        Say "已写工作目录边车: $wdSidecar"
                    }

                    # 桌面放快捷方式（而不是 exe 副本）
                    Exec "在桌面建快捷方式" {
                        $lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "DeepSeek Harness.lnk"
                        $sh = New-Object -ComObject WScript.Shell
                        $sc = $sh.CreateShortcut($lnk)
                        $sc.TargetPath = $dest
                        $sc.WorkingDirectory = $installDir
                        $sc.IconLocation = "$dest,0"
                        $sc.Save()
                        Say "已建快捷方式: $lnk"
                    }
                }
            }
        } else { Fail "launcher" "找不到 launcher\build.ps1" }
    } catch { Fail "launcher" $_.Exception.Message }
} else { SkipStep "launcher" "-NoLauncher" }

# ---------------- 收尾 ---------------- #
Write-Host "`n=== 完成 ===" -ForegroundColor Cyan
if ($script:Failures.Count -gt 0) {
    Write-Host "以下步骤失败（其余已尽力完成）：" -ForegroundColor Red
    foreach ($f in $script:Failures) { Write-Host "  - $f" -ForegroundColor Red }
} else {
    Write-Host "所有步骤成功。" -ForegroundColor Green
}
Write-Host ""
Write-Host "下一步:" -ForegroundColor White
Write-Host "  1. 若没填 Key：运行 config\set-credentials.ps1，或把旧机 .credentials.yaml 私下拷到 %USERPROFILE%\.dsh\"
Write-Host "  2. 启动：直接 ``dsh web``（默认 http://127.0.0.1:3080）。"
Write-Host "  3. 验收禁递归：开一个新会话派一次子代理，然后"
Write-Host "       Windows      : python `"$env:USERPROFILE\.dsh-analysis\verify_leash.py`""
Write-Host "       Ubuntu/macOS : python3 ~/.dsh-analysis/verify_leash.py"
Write-Host "  4. 成本/交接体系的细节见 handoff\README.md；配置文件见 config\。"
Write-Host "  5. 本次**默认没做**的三件事（要就显式加开关）:"
Write-Host "       -UpgradeDsh     把 dsh 升到最新（会让 presets 对齐漂移，升完跑 tools\regen-standard-leash.mjs --check）"
Write-Host "       -InstallPlugin  装 GitHub 上的余额插件 dsh-whale-widget"
Write-Host "       -RtkInitGlobal  跑 rtk init --global（会改 ~/.claude/CLAUDE.md）"
Write-Host "  6. 本机默认 preset 是 router-standard 的话，standard-leash **不会**自动成为默认"
Write-Host "     （合并器只增不删，会保留你已有的 agent-presets.default）。"
Write-Host "     要真正堵住子代理扇出，需要把 4 项护栏移植进 router-standard —— 见"
Write-Host "     docs\改进与问题记录.md 第七节。"
Write-Host ""
