@echo off
chcp 65001 >nul
title Elion - free AI keys
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-ai-keys.ps1"
pause
