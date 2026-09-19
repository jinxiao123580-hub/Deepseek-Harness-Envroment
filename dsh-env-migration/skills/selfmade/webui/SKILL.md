---
name: webui
description: Start the Claude Paper web viewer to browse and study papers
disable-model-invocation: false
---

# Start Web UI

This skill starts the Claude Paper web viewer (Nuxt.js production server) on
Windows. The web app reads papers from `D:/claude-papers/`.

The viewer root is `C:/Users/10905/claude-paper/plugin/src/web`.

## Step 1: Install web dependencies (first run only)

Run in PowerShell (from the web root):

```powershell
Set-Location "C:\Users\10905\claude-paper\plugin\src\web"
if (-not (Test-Path "node_modules\@nuxt")) {
  npm install
}
```

(On this machine npm works via the system registry; if it is slow or fails,
set `HTTPS_PROXY=http://127.0.0.1:7897` first.)

## Step 2: Build production server (first run / version change)

```powershell
Set-Location "C:\Users\10905\claude-paper\plugin\src\web"
if (-not (Test-Path ".output\server\index.mjs")) {
  npm run build
  New-Item -ItemType Directory -Force -Path ".output" | Out-Null
  "1.1.1" | Out-File -Encoding ascii ".output\.build-version"
}
```

## Step 3: Check port 5815

```powershell
$existing = Get-NetTCPConnection -LocalPort 5815 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Port 5815 already in use (pid $($existing.OwningProcess)); viewer already running."
  return
}
```

If a stale server occupies the port, stop it before continuing:
```powershell
Get-NetTCPConnection -LocalPort 5815 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

## Step 4: Start production server (background)

```powershell
Set-Location "C:\Users\10905\claude-paper\plugin\src\web"
$env:PORT = "5815"
Start-Process -FilePath "node.exe" -ArgumentList ".output\server\index.mjs" `
  -WorkingDirectory (Get-Location) -WindowStyle Hidden
```

## Step 5: Verify health

```powershell
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:5815/api/papers" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $ok) { Write-Error "Web viewer failed to start" }
```

## Step 6: Tell the user

```
Claude Paper web UI is now running!
Access it at: http://localhost:5815
To stop it:  Get-NetTCPConnection -LocalPort 5815 -State Listen |
             ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```
