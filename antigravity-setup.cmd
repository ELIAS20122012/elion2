@echo off
chcp 65001 >nul
title Elias OS - Antigravity CLI (agy, free, Google account)
cd /d "%~dp0"
echo.
where agy >nul 2>nul
if errorlevel 1 (
  echo  Installing Antigravity CLI ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://antigravity.google/cli/install.ps1 | iex"
  echo.
  echo  If agy is still not found below: close this window, open a NEW one and run this file again (PATH refresh).
)
where agy >nul 2>nul
if errorlevel 1 (
  echo  agy not found. Install it from https://antigravity.google/cli and run this again.
  goto end
)
agy --version
echo.
echo  agy opens now. Sign in with your Google account in the browser.
echo  When you see the agy prompt, type  /quit  and press Enter.
echo.
pause
call agy
echo.
echo  Testing headless mode with redirected output (this is how Elias OS runs it, max 60 s) ...
powershell -NoProfile -Command "$o=[IO.Path]::GetTempFileName(); $p=Start-Process agy -ArgumentList '-p','Say only: OK' -NoNewWindow -PassThru -RedirectStandardOutput $o; if(-not $p.WaitForExit(60000)){ $p.Kill(); Write-Host 'FAIL: agy hung with redirected output (known issue in some versions) - do NOT enable it, tell the agent.'; exit 2 }; Write-Host ('agy answered: ' + (Get-Content $o -Raw))"
echo.
echo  If you see "agy answered: OK" above, enable it in config\elias.config.json:
echo      "providers": { "antigravity": { "enabled": true } }
echo  then create the empty file data\restart.flag (or /restart in Telegram).
echo  Gemini members of /team will then use Antigravity first, Vertex as backup.
:end
pause
