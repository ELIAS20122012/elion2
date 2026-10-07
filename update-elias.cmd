@echo off
chcp 65001 >nul
title Elias OS - update
cd /d "%~dp0"
echo Running tests...
call npm test 2>nul | findstr /b /c:"# pass" /c:"# fail"
echo.
echo Restarting Elias OS...
call bin\elias.cmd stop --force
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
ping -n 10 127.0.0.1 >nul
call bin\elias.cmd status
echo.
call bin\elias.cmd plugins
echo.
call bin\elias.cmd skill list
echo.
echo Done. In Telegram type / to see the skills.
pause
