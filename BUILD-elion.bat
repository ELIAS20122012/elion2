@echo off
setlocal
cd /d "%~dp0InkFlowRebuild"
set LOG=%~dp0build.log
set DOTNET=%ProgramFiles%\dotnet\dotnet.exe
set INSTALLED=%LOCALAPPDATA%\Programs\InkFlow
echo ===== elion build %DATE% %TIME% ===== > "%LOG%"
taskkill /IM InkFlow.exe /F >>"%LOG%" 2>&1

"%DOTNET%" --list-sdks > "%TEMP%\elion_sdks.txt" 2>&1
findstr /B "8." "%TEMP%\elion_sdks.txt" >NUL
if errorlevel 1 (
  echo Installing .NET 8 SDK via winget...
  winget install --id Microsoft.DotNet.SDK.8 -e --accept-source-agreements --accept-package-agreements >>"%LOG%" 2>&1
)

echo Building elion (1-3 min)...
"%DOTNET%" publish InkFlow.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish >>"%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo EXIT=%RC% >>"%LOG%"
if not "%RC%"=="0" (
  echo.
  echo BUILD FAILED - see build.log
  pause
  exit /b 1
)

taskkill /IM InkFlow.exe /F >>"%LOG%" 2>&1
timeout /t 1 >NUL
if exist "%INSTALLED%\InkFlow.exe" (
  echo Updating installed app in %INSTALLED% ...
  copy /Y "publish\InkFlow.exe" "%INSTALLED%\InkFlow.exe" >>"%LOG%" 2>&1
  echo INSTALLED_COPY=%ERRORLEVEL% >>"%LOG%"
  start "" "%INSTALLED%\InkFlow.exe"
) else (
  start "" "%~dp0InkFlowRebuild\publish\InkFlow.exe"
)
echo.
echo BUILD OK - elion started.
pause
