@echo off
cd /d "%~dp0"
set "LOG=%~dp0data\voice-test.log"
set "PY=data\voice-venv\Scripts\python.exe"
echo --- versions --- > "%LOG%"
%PY% -c "import sys,platform;print(sys.version);print(platform.processor())" >> "%LOG%" 2>&1
echo --- import ctranslate2 --- >> "%LOG%"
%PY% -X faulthandler -c "import ctranslate2;print('ct2',ctranslate2.__version__);print(ctranslate2.get_supported_compute_types('cpu'))" >> "%LOG%" 2>&1
call :code
echo --- import av --- >> "%LOG%"
%PY% -X faulthandler -c "import av;print('av',av.__version__)" >> "%LOG%" 2>&1
call :code
echo --- import onnxruntime --- >> "%LOG%"
%PY% -X faulthandler -c "import onnxruntime;print('ort',onnxruntime.__version__)" >> "%LOG%" 2>&1
call :code
echo --- import faster_whisper --- >> "%LOG%"
%PY% -X faulthandler -c "import faster_whisper;print('fw ok')" >> "%LOG%" 2>&1
call :code
echo --- load model --- >> "%LOG%"
%PY% -X faulthandler -c "from faster_whisper import WhisperModel;m=WhisperModel('small',device='cpu',compute_type='int8',download_root=r'data\models');print('loaded')" >> "%LOG%" 2>&1
call :code
echo --- vc runtime --- >> "%LOG%"
dir C:\Windows\System32\msvcp140*.dll C:\Windows\System32\vcruntime140*.dll >> "%LOG%" 2>&1
py -0 >> "%LOG%" 2>&1
exit /b
:code
echo exit=%errorlevel% >> "%LOG%"
exit /b
