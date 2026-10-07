@echo off
chcp 65001 >nul
cd /d "%~dp0"
call bin\elias.cmd stop
pause
