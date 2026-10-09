@echo off
chcp 65001 >nul
title ELION Trading - setup on this PC
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" where python >nul 2>nul && set PY=python
if "%PY%"=="" (
  echo  Python not found - install Python 3.12 from python.org ^(tick "Add to PATH"^) and run this again.
  goto end
)
echo  [1/5] Python environment for the journal server...
if not exist backend\.venv %PY% -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
backend\.venv\Scripts\python.exe -m pip install --quiet -r backend\requirements.txt
if errorlevel 1 ( echo  pip install failed - see the messages above. & goto end )
echo  [2/5] Dashboard packages...
pushd dashboard
call npm install --no-audit --no-fund
popd
echo  [3/5] Tests...
pushd backend
.venv\Scripts\python.exe -m pytest tests/test_journal.py tests/test_bridge.py -q
popd
echo  [4/5] Always-on: start at logon and check every 5 minutes...
schtasks /create /f /tn "RobotTrading Services" /sc minute /mo 5 /tr "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%~dp0start-services.ps1\"" >nul
schtasks /create /f /tn "RobotTrading Services Logon" /sc onlogon /tr "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%~dp0start-services.ps1\"" >nul
echo  [5/5] Starting...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-services.ps1"
timeout /t 10 >nul
start http://localhost:5173
echo.
echo  Done. The dashboard should open at http://localhost:5173 (journal + AI Lab need the journal window running).
echo  Log: copy the last lines of this window if something failed.
:end
pause
