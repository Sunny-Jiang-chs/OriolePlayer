[CmdletBinding()]
param(
    [string]$SdkPath = 'D:\tools\android-sdk',
    [string]$AvdPath = 'D:\tools\android-home',
    [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$AvdName = 'northward_api36'
)

$ErrorActionPreference = 'Stop'
$taskAdb = Join-Path $SdkPath 'platform-tools\adb.exe'
$taskEmulator = Join-Path $SdkPath 'emulator\emulator.exe'
$taskLogs = Join-Path $PSScriptRoot 'tmp'
$taskPreviousAvd = $env:ANDROID_AVD_HOME

function Find-StudioEmulator {
    $taskDevices = & $taskAdb devices 2>$null
    foreach ($taskLine in $taskDevices) {
        if ($taskLine -match '^(emulator-\d+)\s+device\b') {
            $taskCandidate = $Matches[1]
            $taskNames = & $taskAdb -s $taskCandidate emu avd name 2>$null
            if ($taskNames | Where-Object { $_.Trim() -eq $AvdName }) { return $taskCandidate }
        }
    }
    return $null
}

try {
    foreach ($taskTool in @($taskAdb, $taskEmulator)) {
        if (-not (Test-Path -LiteralPath $taskTool -PathType Leaf)) { throw "Missing Android tool: $taskTool" }
    }
    $taskApk = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'dist\android') `
        -Filter 'HuangliPlayer-*-release.apk' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $taskApk) { throw 'No APK found. Double-click Build-Android.cmd first.' }
    $env:ANDROID_AVD_HOME = $AvdPath
    & $taskAdb start-server
    if ($LASTEXITCODE -ne 0) { throw 'ADB could not start.' }
    $taskSerial = Find-StudioEmulator

    # The previous automated check used a windowless emulator. Reopen that AVD
    # with its normal window, retaining the existing userdata and imported packages.
    $taskHeadless = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'emulator.exe' -and $_.CommandLine -match '\s-no-window\b' -and
        $_.CommandLine -match ('\s-avd\s+"?' + [regex]::Escape($AvdName) + '"?(\s|$)')
    })
    if ($taskSerial -and $taskHeadless.Count) {
        if (-not (Test-Path -LiteralPath (Join-Path $AvdPath "$AvdName.ini"))) {
            throw "AVD registration not found: $AvdPath\$AvdName.ini"
        }
        Write-Host 'Reopening the preview emulator with a visible window (existing data is kept)...'
        & $taskAdb -s $taskSerial emu kill | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not close the windowless emulator.' }
        $taskDeadline = (Get-Date).AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 500
            $taskRunning = @($taskHeadless | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
        } while ($taskRunning.Count -and (Get-Date) -lt $taskDeadline)
        if ($taskRunning.Count) { throw 'Emulator shutdown is still pending. Try again after it exits.' }
        $taskSerial = $null
    }

    if (-not $taskSerial) {
        if (-not (Test-Path -LiteralPath (Join-Path $AvdPath "$AvdName.ini"))) {
            throw "AVD registration not found: $AvdPath\$AvdName.ini"
        }
        New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
        Write-Host "Starting Android preview: $AvdName"
        $taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $taskProcess = Start-Process -FilePath $taskEmulator -WindowStyle Normal `
            -ArgumentList @('-avd', $AvdName, '-no-snapshot-load', '-no-snapshot-save', '-gpu', 'swiftshader_indirect') `
            -RedirectStandardOutput (Join-Path $taskLogs "android-start-$taskStamp.stdout.log") `
            -RedirectStandardError (Join-Path $taskLogs "android-start-$taskStamp.stderr.log") -PassThru
    }

    Write-Host 'Waiting for Android to finish starting...'
    $taskDeadline = (Get-Date).AddSeconds(180)
    $taskReady = $false
    do {
        if (-not $taskSerial) { $taskSerial = Find-StudioEmulator }
        if ($taskSerial) {
            $taskBoot = & $taskAdb -s $taskSerial shell getprop sys.boot_completed 2>$null
            if (($taskBoot -join '').Trim() -eq '1') { $taskReady = $true; break }
        }
        if ($taskProcess) {
            $taskProcess.Refresh()
            if ($taskProcess.HasExited) { throw "Emulator exited. See logs in $taskLogs" }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $taskDeadline)
    if (-not $taskReady) { throw "Android startup timed out. See logs in $taskLogs" }

    Write-Host "Installing $($taskApk.Name) on $taskSerial..."
    & $taskAdb -s $taskSerial install -r $taskApk.FullName
    if ($LASTEXITCODE -ne 0) { throw 'APK installation failed. Existing application data has not been cleared.' }
    $taskLaunch = & $taskAdb -s $taskSerial shell am start -W -n com.cgscenestudio.player/.MainActivity 2>&1
    $taskLaunchExit = $LASTEXITCODE
    $taskLaunch | ForEach-Object { Write-Host $_ }
    if ($taskLaunchExit -ne 0 -or ($taskLaunch -join "`n") -match '(?m)^Error:') { throw 'The player could not open.' }
    Write-Host 'Huangli Player is open in the Android emulator.' -ForegroundColor Green
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    $env:ANDROID_AVD_HOME = $taskPreviousAvd
}
