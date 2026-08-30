# build.ps1 - compile HarnessLauncher (framework csc, no .NET SDK needed)
# usage:  powershell -ExecutionPolicy Bypass -File .\launcher\build.ps1
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $scriptDir "HarnessLauncher.cs"
$icon = Join-Path $scriptDir "logo.ico"
$out  = Join-Path $scriptDir "dist"
New-Item -ItemType Directory -Force $out | Out-Null
$exe  = Join-Path $out "Launcher.exe"
$pdb  = Join-Path $out "Launcher.pdb"

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    Write-Error "csc.exe not found (needs .NET Framework v4). Install .NET Framework 4.x and retry."
}

Write-Host "Compiling with $csc ..."
& $csc /nologo /target:exe /out:$exe /win32icon:$icon $src
if ($LASTEXITCODE -ne 0) {
    Write-Error "Compile FAILED (csc exit code $LASTEXITCODE)"
}

if (Test-Path $pdb) { Remove-Item $pdb -Force }
Write-Host "Done: $exe"
