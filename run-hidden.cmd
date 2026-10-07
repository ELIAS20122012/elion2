@echo off
rem Supervisor used by autostart: runs the daemon hidden and restarts it if it crashes.
cd /d "%~dp0"
if not exist data mkdir data
:loop
call bin\elias.cmd daemon >> data\daemon.log 2>&1
set "CODE=%errorlevel%"
if "%CODE%"=="0" goto end
if "%CODE%"=="3" goto end
echo [%date% %time%] daemon exited with code %CODE% - restarting in 15s >> data\daemon.log
ping -n 16 127.0.0.1 >nul
goto loop
:end
