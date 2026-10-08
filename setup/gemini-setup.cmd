@echo off
chcp 65001 >nul
title Elias OS - Gemini CLI (free, Google account)
cd /d "%~dp0.."
echo.
where gemini >nul 2>nul
if errorlevel 1 (
  echo  Installing Gemini CLI ...
  call npm install -g @google/gemini-cli
)
where gemini >nul 2>nul
if errorlevel 1 (
  echo  Install failed - check that Node.js/npm works, then run this again.
  goto end
)
echo.
echo  Gemini opens now. Choose "Login with Google" and sign in in the browser.
echo  When you see the Gemini prompt, type  /quit  and press Enter.
echo.
pause
call gemini
echo.
echo  Testing ...
echo Say only: OK | call gemini -p "Answer the request above."
echo.
echo  If you see OK above, Gemini is ready for the Elias OS team (/team agents in Telegram).
:end
pause
