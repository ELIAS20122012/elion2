@echo off
rem Starts everything: MT5 bridge (read-only live prices), journal server (local database) and the dashboard.
rem MT5 must be open and logged in for live prices / MT5 sync.
rem The bridge and the journal server restart themselves within 3 seconds if they ever stop unexpectedly.
cd /d "%~dp0"
start "MT5 Bridge" cmd /k "backend\run-bridge.bat"
start "Journal API" cmd /k "backend\run-journal.bat"
start "Dashboard" cmd /k "cd dashboard && npm run dev"
timeout /t 5 >nul
start http://localhost:5173
