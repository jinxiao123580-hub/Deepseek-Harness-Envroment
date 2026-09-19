# ===========================================================================
# set-credentials.ps1  -  securely write your provider API keys to
#                         %USERPROFILE%\.dsh\.credentials.yaml   (Windows)
#                         $DSH_HOME/.credentials.yaml           (Linux: 见 install.sh)
# ===========================================================================
# Usage:  powershell -ExecutionPolicy Bypass -File .\config\set-credentials.ps1
#         powershell -ExecutionPolicy Bypass -File .\config\set-credentials.ps1 -DryRun
#
# For each key you will be prompted (input is masked). Leave a prompt empty to
# KEEP the existing value for that key (on a fresh machine: skip it).
# The real file is written locally and is GITIGNORED - it is never committed.
# After running, restart dsh so it reloads credentials.
#
# 【2026-09-19 修】旧实现会 new 一个 List 从零构建整个文件，只写 version + refs，
# 于是把文件里原有的 **records:** 段（kind/payload/version/secret，即 dsh 自己的
# 加密密钥库）整段抹掉 —— 本机 .credentials.yaml 实为 15 行、含 records 段。
# 而且"留空跳过"在旧实现里等于"这个 key 被删掉"。
# 现在改为：**只改 refs 段里被填写的条目**，其余内容（含 records）逐行原样保留。
# ===========================================================================
param(
    [switch]$DryRun,
    [switch]$FromEnv      # 不交互：从同名环境变量取值（便于测试/自动化）
)
$ErrorActionPreference = "Stop"

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$dest = Join-Path $dshHome ".credentials.yaml"

# Ordered list of provider entries. Label is shown to the user; name is the
# ref/env-var name used by settings.yaml's `apiKeyEnv`.
$keys = @(
    @{ Name = "DEEPSEEK_API_KEY";                    Label = "DeepSeek 官方 (agent 默认 / deepseek-cheap 子代理路由)" },
    @{ Name = "DEEPSEEK_QQ_API_KEY";                 Label = "DeepSeek QQ 独立" },
    @{ Name = "GEMINI_API_KEY";                      Label = "Google Gemini" },
    @{ Name = "VOLCENGINE_CODING_PLAN_API_KEY";      Label = "火山 Coding Plan (ark-code-latest)" },
    @{ Name = "VOLCENGINE_AGENT_PLAN_API_KEY";       Label = "火山 Agent Plan" },
    @{ Name = "DASHSCOPE_API_KEY";                   Label = "阿里云百炼 DashScope" },
    @{ Name = "SILICONFLOW_API_KEY";                 Label = "硅基流动 SiliconFlow" }
)

Write-Host "== 填写 DeepSeek Harness 各平台 API Key ==" -ForegroundColor Cyan
Write-Host "目标文件: $dest"
Write-Host "留空 = 保留原值（新机器上即跳过）。完成后请重启 dsh 使配置生效。"
if ($DryRun) { Write-Host "*** DRY RUN：不会写入文件 ***" -ForegroundColor Magenta }
Write-Host ""

# ---- 读入现有文件并拆成：preamble / refs 段 / 其余原样 ----
$existing = @()
if (Test-Path $dest) { $existing = @(Get-Content $dest -Encoding UTF8) }

$refsIdx = -1
for ($i = 0; $i -lt $existing.Count; $i++) {
    if ($existing[$i] -match '^refs:\s*$') { $refsIdx = $i; break }
}

$pre = New-Object System.Collections.Generic.List[string]
$refOrder = New-Object System.Collections.Generic.List[string]
$refMap = @{}
$tail = New-Object System.Collections.Generic.List[string]

if ($refsIdx -lt 0) {
    # 没有 refs 段：保留全部原内容作为 pre，refs 段新起
    foreach ($l in $existing) { $pre.Add($l) }
} else {
    for ($i = 0; $i -lt $refsIdx; $i++) { $pre.Add($existing[$i]) }
    $i = $refsIdx + 1
    while ($i -lt $existing.Count) {
        $line = $existing[$i]
        if ($line -match '^\s*$' -or $line -match '^\s*#') { $tail.Add($line); $i++; continue }
        if ($line -match '^\S') { break }                       # 回到顶层 → refs 段结束
        $m = [regex]::Match($line, '^\s+([A-Za-z0-9_]+):\s*(.*)$')
        if ($m.Success) {
            $n = $m.Groups[1].Value
            if (-not $refMap.ContainsKey($n)) { $refOrder.Add($n) }
            $refMap[$n] = $m.Groups[2].Value.Trim()
        }
        $i++
    }
    while ($i -lt $existing.Count) { $tail.Add($existing[$i]); $i++ }
}

$hasVersion = $false
foreach ($l in $pre) { if ($l -match '^\s*version:') { $hasVersion = $true; break } }

# ---- 交互 ----
Write-Host "已有 refs: $(if ($refOrder.Count) { ($refOrder -join ', ') } else { '(无)' })" -ForegroundColor DarkGray
Write-Host ""
foreach ($e in $keys) {
    $cur = if ($refMap.ContainsKey($e.Name)) { "(已有)" } else { "(未设置)" }
    $plain = $null
    if ($FromEnv) {
        $plain = [Environment]::GetEnvironmentVariable($e.Name)
        Write-Host ("[" + $e.Name + "] 环境变量 " + $cur + " -> " + $(if ($plain) { "已提供" } else { "未提供，保留" }))
    } else {
        Write-Host ("[" + $e.Name + "] " + $e.Label + "  " + $cur)
        $sec = Read-Host -AsSecureString "  输入 Key (留空保留原值)"
        if ($sec -ne $null -and $sec.Length -gt 0) {
            $plain = [System.Net.NetworkCredential]::new("", $sec).Password
        }
        $sec = $null
    }
    if ($plain) {
        if (-not $refMap.ContainsKey($e.Name)) { $refOrder.Add($e.Name) }
        $refMap[$e.Name] = $plain.Trim()
        if (-not $FromEnv) { Write-Host "  已设置" -ForegroundColor Green }
    } elseif (-not $FromEnv) {
        Write-Host "  (保留)" -ForegroundColor DarkGray
    }
    $plain = $null
}

# ---- 组装输出 ----
$out = New-Object System.Collections.Generic.List[string]
if (-not $hasVersion) { $out.Add("version: 1") }
foreach ($l in $pre) { $out.Add($l) }
$out.Add("refs:")
foreach ($n in $refOrder) {
    $v = $refMap[$n]
    if ($v -ne "") { $out.Add("  " + $n + ": " + $v) } else { $out.Add("  " + $n + ":") }
}
foreach ($l in $tail) { $out.Add($l) }

$removed = @($refOrder | Where-Object { -not $refMap[$_] })
if ($removed.Count) { Write-Host ("警告：以下 key 原文件里存在但值为空，将写成空值: " + ($removed -join ', ')) -ForegroundColor Yellow }

if ($DryRun) {
    Write-Host ""
    Write-Host "--- 将写入的内容（值已用 <len N> 代替）---" -ForegroundColor DarkGray
    foreach ($l in $out) {
        if ($l -match '^(\s+[A-Za-z0-9_]+:\s*)(\S.*)$') { Write-Host ("  " + $matches[1] + "<len " + $matches[2].Length + ">") }
        else { Write-Host ("  " + $l) }
    }
    Write-Host "*** DRY RUN：未写入 ***" -ForegroundColor Magenta
    exit 0
}

$dir = Split-Path -Parent $dest
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
if (Test-Path $dest) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $dest "$dest.bak-$stamp" -Force
    Write-Host ""
    Write-Host ("已备份原文件 -> " + "$dest.bak-$stamp") -ForegroundColor Cyan
}
# UTF-8 无 BOM；dsh 读的是 UTF-8
[System.IO.File]::WriteAllLines($dest, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host ("已写入: " + $dest) -ForegroundColor Green
Write-Host "records 段等其它内容已原样保留。" -ForegroundColor Green
Write-Host "请重启 dsh (退出后重新打开)。" -ForegroundColor Cyan
