@echo off
rem Runs the dashboard server and restarts it after 3 seconds if it ever stops.
cd /d "%~dp0"
:loop
call npm run dev
echo Dashboard stopped - restarting in 3 s (close this window to stop it)...
timeout /t 3 >nul
goto loop
