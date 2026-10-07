@echo off
chcp 65001 >nul
title Elias OS
cd /d "%~dp0"
call bin\elias.cmd daemon
pause
