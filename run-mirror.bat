@echo off
rem Publishes the read-only mirror of the journal to Cloudflare Pages while this PC is on, so the
rem dashboard stays viewable from anywhere after the PC is shut down. Each pass exports a snapshot
rem and deploys only if the journal actually changed - see backend/journal/publish.py.
rem Does nothing until the Cloudflare credentials are set; read docs\hosting-mirror.md first.
cd /d "%~dp0backend"
if "%CLOUDFLARE_API_TOKEN%"=="" (
  echo CLOUDFLARE_API_TOKEN is not set - mirror publishing is off. See docs\hosting-mirror.md
  timeout /t 15 >nul
  exit /b 0
)
:loop
.venv\Scripts\python.exe -m journal.publish
timeout /t 300 >nul
goto loop
