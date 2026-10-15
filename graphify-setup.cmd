@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" set PY=python
echo [1/4] install graphify
if not exist data\graphify-venv %PY% -m venv data\graphify-venv
data\graphify-venv\Scripts\python.exe -m pip install --quiet --upgrade graphifyy
if errorlevel 1 ( echo pip failed & exit /b 1 )
set G=%~dp0data\graphify-venv\Scripts\graphify.exe
echo [2/4] graph: elias-os
"%G%" update .
echo [3/4] graph: trading-robot
if exist ..\trading-robot ( pushd ..\trading-robot & "%G%" update . & findstr /x /c:"graphify-out/" .gitignore >nul 2>nul || echo graphify-out/>>.gitignore & popd )
echo [4/4] skill for coding agents
"%G%" install --platform claude
"%G%" install --platform antigravity
"%G%" install --platform codex
echo done
