# install.ps1 - DeepSeek Harness 环境一键安装（迁移到新电脑用）
# 用法（在迁移包根目录）:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# 可选项:
#   -NoDsh    跳过安装 dsh 本体
#   -NoPlugin 跳过安装余额插件 dsh-whale-widget
#   -NoRtk    跳过安装 RTK
#   -NoLauncher 跳过编译/放置启动器 launcher
param(
    [switch]$NoDsh,
    [switch]$NoPlugin,
    [switch]$NoRtk,
    [switch]$NoLauncher
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "== DeepSeek Harness 迁移包一键安装 ==" -ForegroundColor Cyan
Write-Host "包目录: $root"

# ---------------- 0. Node & npm ---------------- #
Write-Host "`n[0/5] 检查 Node.js / npm ..." -ForegroundColor Green
$nodeOk = $false
try { $nv = node --version; $npmv = npm --version; $nodeOk = $true; Write-Host "  node $nv / npm $npmv" -ForegroundColor Green } catch {
    Write-Warning "  未检测到 Node.js / npm。请先安装 Node LTS 并加入 PATH: https://nodejs.org/"
}
if (-not $nodeOk) {
    Write-Warning "  已跳过后续安装（需要 Node）。安装 Node 后重新运行本脚本。"
    exit 1
}

# ---------------- 1. dsh 本体 ---------------- #
if (-not $NoDsh) {
    Write-Host "`n[1/5] 安装/更新 dsh 本体 (@deepseek-ai/dsh) ..." -ForegroundColor Green
    try {
        $haveDsh = (Get-Command dsh -ErrorAction SilentlyContinue) -ne $null
        if ($haveDsh) {
            Write-Host "  检测到 dsh，升级到最新: npm install -g @deepseek-ai/dsh"
            npm install -g @deepseek-ai/dsh
        } else {
            Write-Host "  安装 dsh: npm install -g @deepseek-ai/dsh"
            npm install -g @deepseek-ai/dsh
        }
        Write-Host "  完成: $(dsh --version)" -ForegroundColor Green
    } catch {
        Write-Error "  安装 dsh 失败: $($_.Exception.Message)"
    }
} else {
    Write-Host "`n[1/5] 跳过 dsh 安装 (-NoDsh)" -ForegroundColor Yellow
}

# ---------------- 2. 余额插件 dsh-whale-widget ---------------- #
if (-not $NoPlugin) {
    Write-Host "`n[2/5] 安装余额插件 dsh-whale-widget ..." -ForegroundColor Green
    # 若需代理，先设置 $env:https_proxy / $env:http_proxy
    try {
        dsh plugin --profile web add github:MeteorNOX/DeepSeek-Balance-Whale-Widget
        Write-Host "  完成。插件会出现在 Web 界面右下角（小鲸鱼）。" -ForegroundColor Green
    } catch {
        Write-Warning "  dsh plugin add 失败: $($_.Exception.Message)"
        Write-Warning "  若需代理，重新运行前设置:  `$env:https_proxy='http://127.0.0.1:7897'"
    }
} else {
    Write-Host "`n[2/5] 跳过余额插件 (-NoPlugin)" -ForegroundColor Yellow
}

# ---------------- 3. RTK ---------------- #
if (-not $NoRtk) {
    Write-Host "`n[3/5] 安装 RTK (Rust Token Killer) ..." -ForegroundColor Green
    try {
        $binDir = Join-Path $env:USERPROFILE ".local\bin"
        New-Item -ItemType Directory -Force $binDir | Out-Null
        Copy-Item (Join-Path $root "rtk\rtk.exe") (Join-Path $binDir "rtk.exe") -Force
        Write-Host "  已复制 rtk.exe -> $binDir\rtk.exe" -ForegroundColor Green
        # 把 .local\bin 加进当前会话 PATH（永久加入需要改用户环境变量）
        $env:Path += ";$binDir"
        Write-Host "  生成默认配置: rtk config --create"
        rtk config --create 2>$null
        Write-Host "  初始化指令 (--global): rtk init --global"
        rtk init --global 2>$null
        Write-Host "  RTK 版本: $(rtk --version)" -ForegroundColor Green
        Write-Host "  提示: 重开终端后 rtk 即在 PATH；对每个项目运行 'rtk init' 会写入该目录 CLAUDE.md。" -ForegroundColor Cyan
    } catch {
        Write-Warning "  安装 RTK 失败: $($_.Exception.Message)"
    }
} else {
    Write-Host "`n[3/5] 跳过 RTK (-NoRtk)" -ForegroundColor Yellow
}

# ---------------- 4. Launcher ---------------- #
if (-not $NoLauncher) {
    Write-Host "`n[4/5] 编译并放置启动器 ..." -ForegroundColor Green
    try {
        $build = Join-Path $root "launcher\build.ps1"
        if (Test-Path $build) {
            powershell -ExecutionPolicy Bypass -File $build
            $outExe = Join-Path $root "launcher\dist\Launcher.exe"
            if (Test-Path $outExe) {
                $desktop = [Environment]::GetFolderPath("Desktop")
                $dest = Join-Path $desktop "DeepSeek Harness 启动器.exe"
                Copy-Item $outExe $dest -Force
                Write-Host "  已放置到桌面: $dest" -ForegroundColor Green
            }
        } else {
            Write-Warning "  未找到 build.ps1"
        }
    } catch {
        Write-Warning "  编译/放置启动器失败: $($_.Exception.Message)"
    }
} else {
    Write-Host "`n[4/5] 跳过启动器 (-NoLauncher)" -ForegroundColor Yellow
}

# ---------------- 5. API 设置迁移（其他平台 provider） ---------------- #
Write-Host "`n[5/6] 迁移其他平台 API 设置 (settings.yaml) ..." -ForegroundColor Green
try {
    $cfgSettings = Join-Path $root "config\settings.yaml"
    if (Test-Path $cfgSettings) {
        $dshHome = Join-Path $env:USERPROFILE ".dsh"
        New-Item -ItemType Directory -Force $dshHome | Out-Null
        $dst = Join-Path $dshHome "settings.yaml"
        if (Test-Path $dst) {
            $bak = Join-Path $dshHome "settings.yaml.bak-migration"
            Copy-Item $dst $bak -Force
            Write-Host "  已备份现有 settings.yaml -> settings.yaml.bak-migration" -ForegroundColor Cyan
        }
        Copy-Item $cfgSettings $dst -Force
        Write-Host "  已复制 provider/API 设置 -> $dst" -ForegroundColor Green
        $providers = @('google','volcengine-coding-plan','volcengine-agent-plan','aliyun-bailian','siliconflow','deepseek-qq')
        Write-Host ("  已带过来的 provider: " + ($providers -join ', ')) -ForegroundColor Cyan
    } else {
        Write-Warning "  未找到 config\settings.yaml"
    }
    $credScript = Join-Path $root "config\set-credentials.ps1"
    if (Test-Path $credScript) {
        Write-Host "  密钥: 仓库不含真实 Key（只有占位模板）。可交互式填写：" -ForegroundColor Cyan
        $ans = Read-Host "  现在填写各平台 API Key? (y/n，直接回车跳过)"
        if ($ans -match "^[yY]") {
            powershell -ExecutionPolicy Bypass -File $credScript
        }
    }
} catch {
    Write-Warning "  迁移 API 设置失败: $($_.Exception.Message)"
}

# ---------------- 6. 收尾 ---------------- #
Write-Host "`n[6/6] 完成。" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor White
Write-Host "  1. API 设置已迁 (settings.yaml)；若未在刚才步骤填 Key，请运行 config\set-credentials.ps1，或把旧机 .credentials.yaml 私下拷到 %USERPROFILE%\.dsh\"
Write-Host "  2. 启动: 双击桌面的 'DeepSeek Harness 启动器.exe'"
Write-Host "  3. (可选) 若访问 Google/Gemini 需要代理，运行前设置 DSH_HTTP_PROXY=http://127.0.0.1:<port>"
Write-Host ""
Write-Host "全部完成，祝使用愉快！" -ForegroundColor Green
