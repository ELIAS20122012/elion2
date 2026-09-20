@echo off
rem Starts everything: MT5 bridge (read-only live prices), journal server (local database) and the dashboard.
rem MT5 must be open and logged in for live prices / MT5 sync.
cd /d "%~dp0"
start "MT5 Bridge" cmd /k "cd backend && .venv\Scripts\python.exe mt5_bridge.py"
start "Journal API" cmd /k "cd backend && .venv\Scripts\python.exe -m uvicorn journal.api:app --port 8000"
start "Dashboard" cmd /k "cd dashboard && npm run dev"
timeout /t 5 >nul
start http://localhost:5173
