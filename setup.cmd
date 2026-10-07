@echo off
setlocal
cd /d "%~dp0"
set "LOG=%~dp0setup-log.txt"
echo ===== Elias OS setup %date% %time% ===== > "%LOG%"
call :main >> "%LOG%" 2>&1
echo ===== END ===== >> "%LOG%"
type "%LOG%"
echo.
echo Done. You can close this window.
timeout /t 15
exit /b

:main
echo --- node ---
where node
node -v
echo --- npm ---
call npm -v
echo --- claude ---
where claude
call claude --version
where node >nul 2>nul
if errorlevel 1 (
  echo NODE_MISSING
  exit /b 1
)
echo --- npm install ---
call npm install --no-audit --no-fund
echo --- npm test ---
call npm test
echo --- init ---
call bin\elias.cmd init
echo --- doctor ---
call bin\elias.cmd doctor
echo --- smoke task echo ---
call bin\elias.cmd task add "Smoke test" --prompt "hello elias" --provider echo --verify contains:hello
call bin\elias.cmd run
echo --- real task claude-code ---
call bin\elias.cmd task add "First real task" --prompt "Reply with one short Persian sentence greeting Elias. Start the reply with OK:" --verify contains:OK --timeout 180
call bin\elias.cmd run
echo --- status ---
call bin\elias.cmd status
call bin\elias.cmd log --limit 20
exit /b 0
