@echo off
chcp 65001 >nul
title Elias OS - Google setup
cd /d "%~dp0.."
rem Always use the NEWEST client_secret_*.json from Downloads (older ones may belong to other projects).
for /f "delims=" %%F in ('dir /b /o-d "%USERPROFILE%\Downloads\client_secret_*.json" 2^>nul') do (
  copy /y "%USERPROFILE%\Downloads\%%F" config\google-client.json >nul
  echo  Using %%F
  goto copied
)
:copied
if not exist config\google-client.json (
  echo.
  echo  config\google-client.json not found.
  echo  Download the OAuth client JSON from Google Cloud - see docs\GOOGLE-SETUP.md
  goto end
)
call bin\elias.cmd stop
echo.
echo  A Google page opens in your browser:
echo   choose your account - Advanced - Go to Elias OS - tick ALL boxes (Gmail, Calendar, YouTube, Cloud) - Continue
call bin\elias.cmd google auth
if errorlevel 1 goto restart
echo.
call bin\elias.cmd google test
call bin\elias.cmd briefing install --time 08:00
call bin\elias.cmd briefing now
:restart
echo.
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
echo  Elias OS restarted. The first briefing arrives in Telegram in about a minute.
:end
echo.
pause
