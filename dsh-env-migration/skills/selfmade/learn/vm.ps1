#requires -Version 5.1
<#
LEAP_ROS connection helper, used by the `learn` skill.

It does four things in order:
  1. Resolve the VM's CURRENT ip by MAC from the VMware DHCP lease table
     (the NAT address drifts, so it must never be hardcoded)
  2. Probe port 22
  3. If the VM is down, start it with vmrun and wait for it
  4. Run the given remote command and pass its exit code through

ASCII only on purpose: Windows PowerShell 5.1 reads a BOM-less UTF-8 .ps1
as ANSI, which turns non-ASCII comments into mojibake that eats quotes and
breaks parsing. Keep this file 7-bit.

Usage:
  & 'C:\Users\10905\.dsh\skills\learn\vm.ps1' -RemoteCommand "source /opt/ros/humble/setup.bash && ros2 topic list"
  & 'C:\Users\10905\.dsh\skills\learn\vm.ps1' -RemoteCommand "hostname" -NoStart
  & 'C:\Users\10905\.dsh\skills\learn\vm.ps1' -ResolveOnly
#>
param(
    [string]$RemoteCommand,
    [switch]$NoStart,
    [switch]$ResolveOnly,
    [int]$BootTimeoutSec = 150
)

$ErrorActionPreference = 'Continue'

$Mac     = '00:0c:29:cb:f0:80'
$Vmx     = 'C:\ROS2car\LEAP_ROS_V2\LEAP_ROS.vmx'
$Key     = 'C:\Users\10905\.ssh\codex_vm_debug'
$Leases  = 'C:\ProgramData\VMware\vmnetdhcp.leases'
$Vmrun   = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$SshUser = 'chuyun'

function Get-VmCandidates {
    if (-not (Test-Path $Leases)) { return @() }
    $txt = Get-Content $Leases -Raw
    $rows = @()
    foreach ($m in [regex]::Matches($txt, 'lease\s+([0-9.]+)\s*\{(.*?)\}', 'Singleline')) {
        $body = $m.Groups[2].Value
        if ($body -notmatch 'hardware ethernet\s+([0-9a-fA-F:]{17})') { continue }
        if ($Matches[1].ToLower() -ne $Mac.ToLower()) { continue }
        $stamp = '0000/00/00 00:00:00'
        if ($body -match 'starts\s+\d+\s+(\d{4}/\d{2}/\d{2})\s+(\d{2}:\d{2}:\d{2})') {
            $stamp = "$($Matches[1]) $($Matches[2])"
        }
        $rows += "$stamp|$($m.Groups[1].Value)"
    }
    # lexicographic order on the timestamp equals chronological order; newest first
    return ($rows | Sort-Object -Descending | ForEach-Object { ($_ -split '\|')[1] })
}

function Test-SshPort([string]$ip) {
    try {
        return [bool](Test-NetConnection -ComputerName $ip -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue)
    } catch {
        return $false
    }
}

function Resolve-LiveVmIp {
    foreach ($ip in Get-VmCandidates) {
        if (Test-SshPort $ip) { return $ip }
    }
    return $null
}

$ip = Resolve-LiveVmIp

if ($ResolveOnly) {
    if ($ip) {
        Write-Host "[vm] LEAP_ROS is up at $ip (port 22 open)"
        exit 0
    }
    $cand = (Get-VmCandidates) -join ', '
    Write-Host "[vm] LEAP_ROS not answering. Lease candidates: $cand"
    exit 2
}

if (-not $ip -and -not $NoStart) {
    Write-Host "[vm] no answer, starting the VM with vmrun ..."
    if (Test-Path $Vmrun) {
        & $Vmrun -T ws start $Vmx nogui 2>&1 | Out-Null
        $deadline = (Get-Date).AddSeconds($BootTimeoutSec)
        while (((Get-Date) -lt $deadline) -and (-not $ip)) {
            Start-Sleep -Seconds 5
            $ip = Resolve-LiveVmIp
        }
    } else {
        Write-Host "[vm] vmrun.exe not found, start it by hand: $Vmx"
    }
}

if (-not $ip) {
    $cand = (Get-VmCandidates) -join ', '
    Write-Host "[vm] LEAP_ROS will not come up or is unreachable. Lease candidates: $cand"
    Write-Host "[vm] Check that the VM is powered on and VMware NAT services are running."
    exit 2
}

Write-Host "[vm] LEAP_ROS at $ip"

if (-not $RemoteCommand) { exit 0 }

& ssh -i $Key -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=10 "$SshUser@$ip" $RemoteCommand
exit $LASTEXITCODE
