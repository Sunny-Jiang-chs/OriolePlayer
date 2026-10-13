@echo off
setlocal
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0build-android.ps1" -Variant Both %*
if errorlevel 1 (
    echo.
    echo Huangli Player APK build failed. Review the error above.
    echo Press any key to close.
    pause >nul
    exit /b 1
)
echo.
echo Huangli Player APK build completed. Output: %~dp0dist\android
start "" "%~dp0dist\android"
echo Press any key to close.
pause >nul
exit /b 0
