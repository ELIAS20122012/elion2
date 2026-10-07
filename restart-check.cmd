@echo off
cd /d "%~dp0"
call bin\elias.cmd doctor > data\doctor.log 2>&1
call bin\elias.cmd stop >> data\doctor.log 2>&1
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\EliasOS.vbs"
