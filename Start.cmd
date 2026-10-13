@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
    echo.
    echo Huangli Player could not start. Press any key to close.
    pause >nul
    exit /b 1
)
exit /b 0
