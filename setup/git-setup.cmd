@echo off
chcp 65001 >nul
title Elias OS - local git (version history for agents)
cd /d "%~dp0.."
where git >nul 2>nul
if errorlevel 1 (
  echo  Installing Git ...
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;C:\Program Files\Git\cmd"
)
where git >nul 2>nul
if errorlevel 1 (
  echo  Git is not available yet - close this window, open it again and re-run setup\git-setup.cmd
  goto end
)
if not exist .git (
  git init -b main
  git config user.name "Elias"
  git config user.email "elias.trade.f@gmail.com"
)
git add -A
git commit -m "Elias OS snapshot (handbook: AGENTS.md, ROADMAP.md, HANDOFF.md)"
echo.
echo  Done. Local history only - nothing is uploaded anywhere.
echo  Check that no secret is tracked:
git ls-files config
:end
pause
