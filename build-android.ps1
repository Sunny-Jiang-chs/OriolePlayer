[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release', 'Both')]
    [string]$Variant = 'Both',
    [string]$SdkPath = 'D:\tools\android-sdk',
    [string]$JdkPath = 'D:\tools\jdk17\jdk-17.0.20+8',
    [string]$GradlePath = '',
    [string]$GradleCachePath = 'D:\tools\gradle-user-home',
    [switch]$Online
)

$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$androidPath = Join-Path $projectPath 'android'
$outputPath = Join-Path $projectPath 'dist\android'

if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-36\android.jar'))) {
    throw "Android SDK 36 not found: $SdkPath. Install platforms;android-36 and build-tools;36.1.0 in D:\tools, or pass -SdkPath."
}
$aaptPath = Join-Path $SdkPath 'build-tools\36.1.0\aapt2.exe'
if (-not (Test-Path -LiteralPath $aaptPath)) {
    throw "Android Build Tools 36.1.0 not found: $aaptPath."
}
if (-not (Test-Path -LiteralPath (Join-Path $JdkPath 'bin\java.exe'))) {
    throw "JDK 17+ not found: $JdkPath. Pass -JdkPath with a local JDK installation."
}
if (-not $GradlePath) {
    $gradleDistribution = Join-Path $GradleCachePath 'wrapper\dists\gradle-8.13-all'
    $gradleCandidates = @(Get-ChildItem -LiteralPath $gradleDistribution -Filter gradle.bat -File -Recurse -ErrorAction SilentlyContinue)
    if (-not $gradleCandidates.Count) {
        $gradleDistribution = Join-Path $GradleCachePath 'wrapper\dists\gradle-8.13-bin'
        $gradleCandidates = @(Get-ChildItem -LiteralPath $gradleDistribution -Filter gradle.bat -File -Recurse -ErrorAction SilentlyContinue)
    }
    if ($gradleCandidates.Count) { $GradlePath = $gradleCandidates[0].FullName }
}
if (-not $GradlePath -or -not (Test-Path -LiteralPath $GradlePath -PathType Leaf)) {
    throw 'Gradle 8.13 is required. Install it under D:\tools or pass -GradlePath with the path to bin\gradle.bat.'
}

$localProperties = 'sdk.dir=' + $SdkPath.Replace('\', '/').Replace(':', '\:') + "`n"
[System.IO.File]::WriteAllText((Join-Path $androidPath 'local.properties'), $localProperties, [System.Text.UTF8Encoding]::new($false))
$previousEnvironment = @{
    JAVA_HOME = $env:JAVA_HOME
    ANDROID_HOME = $env:ANDROID_HOME
    GRADLE_USER_HOME = $env:GRADLE_USER_HOME
}

try {
    $env:JAVA_HOME = $JdkPath
    $env:ANDROID_HOME = $SdkPath
    $env:GRADLE_USER_HOME = $GradleCachePath
    $tasks = switch ($Variant) {
        'Debug' { @('assembleDebug') }
        'Release' { @('assembleRelease') }
        'Both' { @('assembleDebug', 'assembleRelease') }
    }
    $gradleArguments = @('--project-dir', $androidPath, '--console=plain', '--no-daemon')
    # Use the installed SDK tool so offline builds need no separate Maven aapt2 download.
    $gradleArguments += "-Pandroid.aapt2FromMavenOverride=$aaptPath"
    if (-not $Online) { $gradleArguments += '--offline' }
    $gradleArguments += $tasks
    Write-Host "Building Huangli Player $Variant APK (player + author example only)..."
    & $GradlePath @gradleArguments
    if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE." }

    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
    $versionMatch = [regex]::Match([System.IO.File]::ReadAllText((Join-Path $androidPath 'app\build.gradle')), "versionName\s+'([^']+)'")
    if (-not $versionMatch.Success) { throw 'Cannot read versionName from android/app/build.gradle.' }
    $version = $versionMatch.Groups[1].Value
    $variants = if ($Variant -eq 'Both') { @('debug', 'release') } else { @($Variant.ToLowerInvariant()) }
    foreach ($buildVariant in $variants) {
        $sourceApk = Join-Path $androidPath "app\build\outputs\apk\$buildVariant\app-$buildVariant.apk"
        if (-not (Test-Path -LiteralPath $sourceApk)) { throw "Expected APK missing: $sourceApk" }
        $targetApk = Join-Path $outputPath "HuangliPlayer-$version-$buildVariant.apk"
        Copy-Item -LiteralPath $sourceApk -Destination $targetApk -Force
        $hash = (Get-FileHash -LiteralPath $targetApk -Algorithm SHA256).Hash.ToLowerInvariant()
        [System.IO.File]::WriteAllText("$targetApk.sha256", "$hash  $([System.IO.Path]::GetFileName($targetApk))`n", [System.Text.UTF8Encoding]::new($false))
        Write-Host "APK: $targetApk"
        Write-Host "SHA256: $hash"
    }
    Write-Host 'Release is signed with the local Android development key for direct installation; it is not a store release.'
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}
