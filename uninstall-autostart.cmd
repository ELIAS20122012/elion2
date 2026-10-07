@echo off
chcp 65001 >nul
cd /d "%~dp0"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs" 2>nul
call bin\elias.cmd stop
echo Autostart removed.
pause
