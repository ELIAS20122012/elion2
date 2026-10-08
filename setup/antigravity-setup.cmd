@echo off
chcp 65001 >nul
title Elias OS - Antigravity CLI (free Gemini, Google account)
cd /d "%~dp0.."
echo.
where agy >nul 2>nul
if errorlevel 1 if not exist "%LOCALAPPDATA%\agy\bin\agy.exe" (
  echo  Installing Antigravity CLI ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://antigravity.google/cli/install.ps1 | iex"
  rem
)
set "PATH=%PATH%;%LOCALAPPDATA%\agy\bin"
where agy >nul 2>nul
if errorlevel 1 (
  echo  agy is not on PATH yet - close this window, open it again and re-run setup\antigravity-setup.cmd
  goto end
)
agy --version
echo.
echo  Antigravity opens now. Choose "Google OAuth", sign in in the browser, paste the code back here.
echo  When you see the prompt, type  /quit  and press Enter.
echo.
agy
echo.
echo  Testing ...
agy -p "Say only: OK"
echo.
echo  If you see OK above, Antigravity is ready. Restarting Elias OS ...
call bin\elias.cmd stop --force
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
:end
pause
