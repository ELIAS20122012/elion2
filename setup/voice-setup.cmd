@echo off
chcp 65001 >nul
title Elias OS - Voice setup
cd /d "%~dp0.."
if not exist data mkdir data
set "LOG=%~dp0..\data\voice-setup.log"
echo ===== Voice setup %date% %time% ===== > "%LOG%"
echo  Installing local speech-to-text (faster-whisper). This takes a few minutes...
call :main >> "%LOG%" 2>&1
type "%LOG%"
echo.
echo  Done. Send a voice message to @Elion_OS_bot to try it.
timeout /t 20
exit /b

:main
if not exist data\voice-venv\Scripts\python.exe (
  echo --- creating venv ---
  py -3 -m venv data\voice-venv
)
echo --- installing faster-whisper ---
data\voice-venv\Scripts\python.exe -m pip install --disable-pip-version-check -q --upgrade pip
data\voice-venv\Scripts\python.exe -m pip install --disable-pip-version-check -q faster-whisper==1.2.1
if errorlevel 1 (
  echo VOICE_INSTALL_FAILED
  exit /b 1
)
echo --- downloading + loading speech model small ---
set "ELIAS_WHISPER_MODEL=small"
set "ELIAS_WHISPER_DIR=%~dp0..\data\models"
data\voice-venv\Scripts\python.exe voice\whisper_server.py --warmup
echo --- restarting Elias OS ---
call bin\elias.cmd stop
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
echo VOICE_SETUP_OK
exit /b 0
