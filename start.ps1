param(
    [ValidateRange(1024, 65515)][int]$Port = 8768,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$taskProjectRoot = $PSScriptRoot.TrimEnd([char[]]'\/')

function Get-StudioStatus([int]$CandidatePort) {
    try {
        $taskStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$CandidatePort/__cgscene_status" -TimeoutSec 1
        if ($taskStatus.app -eq 'cg-scene-studio' -and
            $taskStatus.root.TrimEnd([char[]]'\/') -eq $taskProjectRoot) {
            return $taskStatus
        }
    } catch { }
    return $null
}

function Test-PortAvailable([int]$CandidatePort) {
    $taskListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $CandidatePort)
    try { $taskListener.Start(); return $true }
    catch { return $false }
    finally { $taskListener.Stop() }
}

try {
    $taskServerFile = Join-Path $taskProjectRoot 'server.mjs'
    $taskLogs = Join-Path $taskProjectRoot 'tmp'
    $taskUrl = $null
    $taskNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $taskNodePath = if ($taskNode) { $taskNode.Source } else { 'D:\tools\node_js\node.exe' }

    foreach ($taskCandidatePort in $Port..($Port + 20)) {
        if (-not (Test-PortAvailable $taskCandidatePort)) {
            if (Get-StudioStatus $taskCandidatePort) {
                $taskUrl = "http://127.0.0.1:$taskCandidatePort/"
                break
            }
            continue
        }

        if (-not (Test-Path -LiteralPath $taskNodePath -PathType Leaf)) {
            throw 'Node.js was not found. Install Node.js or add node.exe to PATH.'
        }
        New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
        $taskErrorLog = Join-Path $taskLogs "server-$taskCandidatePort.stderr.log"
        $taskProcess = Start-Process -FilePath $taskNodePath `
            -ArgumentList @(('"{0}"' -f $taskServerFile), '--port', [string]$taskCandidatePort) `
            -WorkingDirectory $taskProjectRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $taskLogs "server-$taskCandidatePort.stdout.log") `
            -RedirectStandardError $taskErrorLog -PassThru

        for ($taskAttempt = 0; $taskAttempt -lt 25; $taskAttempt++) {
            if (Get-StudioStatus $taskCandidatePort) {
                $taskUrl = "http://127.0.0.1:$taskCandidatePort/"
                break
            }
            $taskProcess.Refresh()
            if ($taskProcess.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
        if ($taskUrl) { break }
        throw "The server did not become ready. See $taskErrorLog"
    }

    if (-not $taskUrl) { throw "No available port between $Port and $($Port + 20)." }
    Write-Host "Huangli Player: $taskUrl"
    if (-not $NoBrowser) { Start-Process $taskUrl }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
