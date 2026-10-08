@echo off
chcp 65001 >nul
title Elias OS - connect ChatGPT + Gemini
cd /d "%~dp0.."
echo.
echo  [1/3] Installing Codex CLI (ChatGPT) and Gemini CLI...
call npm install -g @openai/codex @google/gemini-cli
echo.
echo  [2/3] ChatGPT login: a browser opens - sign in with your ChatGPT Plus account.
call codex login
echo.
echo  [3/3] Gemini login: choose "Login with Google" and sign in.
echo        When you see the Gemini prompt, type /quit and press Enter.
call gemini
echo.
call bin\elias.cmd doctor > data\doctor.log 2>&1
call bin\elias.cmd stop >> data\doctor.log 2>&1
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
type data\doctor.log
pause
