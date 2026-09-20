@echo off
rem Starts everything (bridge, journal server, dashboard) unless it is already running, then opens the dashboard.
rem MT5 must be open and logged in for live prices / MT5 sync.
rem Each service restarts itself within 3 seconds if it stops. A scheduled task also does this check at logon and every 5 minutes.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-services.ps1"
timeout /t 6 >nul
start http://localhost:5173
