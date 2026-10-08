@echo off
chcp 65001 >nul
title Elias OS - Telegram setup
cd /d "%~dp0.."
if not exist config\secrets.json copy config\secrets.example.json config\secrets.json >nul
echo.
echo  1) Notepad will open.
echo  2) Replace PASTE_TOKEN_HERE with the token from BotFather (keep the quotes).
echo  3) Save with Ctrl+S and close Notepad.
echo.
start /wait notepad config\secrets.json
call bin\elias.cmd telegram pair
if errorlevel 1 goto end
call bin\elias.cmd telegram test
echo.
echo  Elias OS is starting. Keep this window open (minimize it).
echo.
call bin\elias.cmd daemon
:end
pause
