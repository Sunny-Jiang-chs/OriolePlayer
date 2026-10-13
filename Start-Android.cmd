@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-android.ps1" %*
if errorlevel 1 (
    echo.
    echo Android preview could not start. Press any key to close.
    pause >nul
    exit /b 1
)
exit /b 0
