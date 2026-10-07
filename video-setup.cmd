@echo off
chcp 65001 >nul
title Elias OS - Video setup
cd /d "%~dp0"
if not exist data mkdir data
set "LOG=%~dp0data\video-setup.log"
echo ===== Video setup %date% %time% ===== > "%LOG%"
echo  Installing video tools (Persian voice, slides, ffmpeg render). A few minutes...
call :main >> "%LOG%" 2>&1
type "%LOG%"
echo.
echo  Done. A test video should open. In Telegram: /short topic
pause
exit /b

:main
where ffmpeg || (echo FFMPEG_MISSING & exit /b 1)
if not exist data\video-venv\Scripts\python.exe (
  echo --- creating venv ---
  py -3 -m venv data\video-venv
)
echo --- installing python packages ---
data\video-venv\Scripts\python.exe -m pip install --disable-pip-version-check -q --upgrade pip
data\video-venv\Scripts\python.exe -m pip install --disable-pip-version-check -q edge-tts pillow arabic-reshaper python-bidi
if errorlevel 1 (echo VIDEO_INSTALL_FAILED & exit /b 1)
data\video-venv\Scripts\python.exe -c "from PIL import features; print(\"raqm:\", features.check(\"raqm\"))"
echo --- installing Vazirmatn font ---
if not exist data\fonts mkdir data\fonts
if not exist data\fonts\Vazirmatn-Black.ttf (
  pushd data\fonts
  call npm pack vazirmatn --silent
  for %%F in (vazirmatn-*.tgz) do tar -xzf %%F package/fonts/ttf/Vazirmatn-Black.ttf package/fonts/ttf/Vazirmatn-Regular.ttf
  move /y package\fonts\ttf\*.ttf . >nul
  rmdir /s /q package
  del /q vazirmatn-*.tgz
  popd
)
dir /b data\fonts
echo --- test render ---
call bin\elias.cmd short test
echo --- restarting Elias OS ---
call bin\elias.cmd stop --force
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
exit /b 0
