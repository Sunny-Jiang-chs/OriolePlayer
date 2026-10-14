param(
    [ValidateRange(1024, 65515)][int]$Port = 8780,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$taskOrganizerLauncher = Join-Path $PSScriptRoot '..\CGSceneParsers\start.ps1'
if (-not (Test-Path -LiteralPath $taskOrganizerLauncher -PathType Leaf)) {
    Write-Error 'The organizer now belongs to CGSceneParsers. Place that project beside CGSceneStudio, then launch CGSceneParsers\Start.cmd.'
    exit 1
}
& $taskOrganizerLauncher -Port $Port -NoBrowser:$NoBrowser
if ($LASTEXITCODE) { exit $LASTEXITCODE }
