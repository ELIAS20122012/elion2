@echo off
cd /d "%~dp0"
set "LOG=%~dp0data\vcredist.log"
echo --- installing Microsoft Visual C++ Redistributable (x64) --- > "%LOG%"
winget install -e --id Microsoft.VCRedist.2015+.x64 --silent --accept-package-agreements --accept-source-agreements >> "%LOG%" 2>&1
echo winget_exit=%errorlevel% >> "%LOG%"
dir C:\Windows\System32\msvcp140.dll >> "%LOG%" 2>&1
echo --- test onnxruntime + model --- >> "%LOG%"
data\voice-venv\Scripts\python.exe -X faulthandler -c "import onnxruntime;print('ort ok')" >> "%LOG%" 2>&1
echo ort_exit=%errorlevel% >> "%LOG%"
set ELIAS_WHISPER_MODEL=small
set "ELIAS_WHISPER_DIR=%~dp0data\models"
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
data\voice-venv\Scripts\python.exe voice\whisper_server.py --warmup >> "%LOG%" 2>&1
echo warmup_exit=%errorlevel% >> "%LOG%"
call bin\elias.cmd voice test data\tone.oga >> "%LOG%" 2>&1
echo test_exit=%errorlevel% >> "%LOG%"
call bin\elias.cmd stop >> "%LOG%" 2>&1
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
echo DONE >> "%LOG%"
