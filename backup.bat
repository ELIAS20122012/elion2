@echo off
rem Backs up the code (git bundle) and the private data (databases, .env) into OneDrive.
rem Run any time; keeps the 15 newest bundles. Restore code:  git clone <file>.bundle robot-trading
setlocal
cd /d "%~dp0"
set "DEST=%OneDrive%\Backups\robot-trading"
if not exist "%DEST%\data" mkdir "%DEST%\data"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%i"

git add -A >nul 2>&1
git commit -q -m "backup %STAMP%" >nul 2>&1
git bundle create "%DEST%\robot-trading-%STAMP%.bundle" --all
if errorlevel 1 (echo Git bundle FAILED & exit /b 1)

rem consistent copy of the live journal database (safe while the server is running)
backend\.venv\Scripts\python.exe -c "import sqlite3,sys; s=sqlite3.connect('backend/journal.db'); d=sqlite3.connect(sys.argv[1]); s.backup(d); d.close(); s.close()" "%DEST%\data\journal.db" 2>nul
if exist backend\dev.db copy /y backend\dev.db "%DEST%\data\dev.db" >nul
if exist backend\.env copy /y backend\.env "%DEST%\data\backend.env" >nul

powershell -NoProfile -Command "Get-ChildItem '%DEST%\*.bundle' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 15 | Remove-Item -Force"
echo Backup done: %DEST%
