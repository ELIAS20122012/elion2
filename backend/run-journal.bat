@echo off
rem Runs the journal server and restarts it after 3 seconds if it ever stops.
cd /d "%~dp0"
:loop
.venv\Scripts\python.exe -m uvicorn journal.api:app --port 8000
echo Journal server stopped - restarting in 3 s (close this window to stop it)...
timeout /t 3 >nul
goto loop
