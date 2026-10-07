@echo off
chcp 65001 >nul
title Elias OS - autostart
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\EliasOS.vbs"
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>> "%VBS%" echo sh.Run """%~dp0run-hidden.cmd""", 0, False
echo Autostart installed: %VBS%
echo.
echo Stopping the visible Elias OS window (if running)...
call bin\elias.cmd stop --force
echo.
echo Starting Elias OS in the background...
wscript "%VBS%"
ping -n 8 127.0.0.1 >nul
call bin\elias.cmd status
echo.
echo Done. Elias OS now runs in the background and starts with Windows.
echo To stop it: stop-elias.cmd   To remove autostart: uninstall-autostart.cmd
ping -n 20 127.0.0.1 >nul
