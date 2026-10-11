@echo off
echo Refreshing Windows icon cache...
ie4uinit.exe -show
taskkill /IM explorer.exe /F
del /A /Q "%LOCALAPPDATA%\IconCache.db"
del /A /F /Q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*"
start explorer.exe
echo Done.
timeout /t 3
