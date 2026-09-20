@echo off
rem Runs the MT5 price bridge and restarts it after 3 seconds if it ever stops.
cd /d "%~dp0"
:loop
.venv\Scripts\python.exe mt5_bridge.py
echo Bridge stopped - restarting in 3 s (close this window to stop it)...
timeout /t 3 >nul
goto loop
