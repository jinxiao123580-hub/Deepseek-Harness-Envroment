# ===========================================================================
# set-credentials.ps1  -  securely write your provider API keys to
#                         %USERPROFILE%\.dsh\.credentials.yaml
# ===========================================================================
# Usage:  powershell -ExecutionPolicy Bypass -File .\config\set-credentials.ps1
# For each key you will be prompted (input is masked). Leave a prompt empty to
# skip that key. The real file is written locally and is GITIGNORED - it is
# never committed. After running, exit/restart dsh so it reloads credentials.
# ===========================================================================
$ErrorActionPreference = "Stop"
$dest = Join-Path $env:USERPROFILE ".dsh\.credentials.yaml"

# Ordered list of provider entries. Label is shown to the user; name is the
# ref/env-var name used by settings.yaml's `apiKeyEnv`.
$keys = @(
    @{ Name = "DEEPSEEK_API_KEY";                    Label = "DeepSeek 官方 (agent 默认)" },
    @{ Name = "DEEPSEEK_QQ_API_KEY";                 Label = "DeepSeek QQ 独立" },
    @{ Name = "GEMINI_API_KEY";                      Label = "Google Gemini" },
    @{ Name = "VOLCENGINE_CODING_PLAN_API_KEY";      Label = "火山 Coding Plan (ark-code-latest)" },
    @{ Name = "VOLCENGINE_AGENT_PLAN_API_KEY";       Label = "火山 Agent Plan" },
    @{ Name = "DASHSCOPE_API_KEY";                   Label = "阿里云百炼 DashScope" },
    @{ Name = "SILICONFLOW_API_KEY";                 Label = "硅基流动 SiliconFlow" }
)

Write-Host "== 填写 DeepSeek Harness 各平台 API Key ==" -ForegroundColor Cyan
Write-Host "目标文件: $dest"
Write-Host "留空则跳过。完成后请重启 dsh 使配置生效。"
Write-Host ""

$out = New-Object System.Collections.Generic.List[string]
$out.Add("version: 1")
$out.Add("refs:")
foreach ($e in $keys) {
    Write-Host ("[" + $e.Name + "] " + $e.Label)
    $sec = Read-Host -AsSecureString "  输入 Key (留空跳过)"
    if ($sec -ne $null -and $sec.Length -gt 0) {
        $plain = [System.Net.NetworkCredential]::new("", $sec).Password
        $out.Add("  " + $e.Name + ": " + $plain)
        $sec = $null; $plain = $null
    } else {
        Write-Host "  (跳过)"
    }
}

$dir = Split-Path -Parent $dest
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[System.IO.File]::WriteAllLines($dest, $out)
Write-Host ""
Write-Host ("已写入: " + $dest) -ForegroundColor Green
Write-Host "请重启 dsh (退出后重新打开)。" -ForegroundColor Cyan
