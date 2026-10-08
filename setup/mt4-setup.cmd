@echo off
chcp 65001 >nul
title Elias OS - MT4 bridge setup
cd /d "%~dp0.."
set FOUND=0
for /d %%T in ("%APPDATA%\MetaQuotes\Terminal\*") do (
  if exist "%%T\MQL4\Experts" (
    copy /y "mt4\EliasBridge.mq4" "%%T\MQL4\Experts\EliasBridge.mq4" >nul
    echo  Installed into %%T\MQL4\Experts
    set FOUND=1
  )
)
if "%FOUND%"=="0" echo  No MT4 terminal data folder found. In MT4: File - Open Data Folder - MQL4\Experts, and copy mt4\EliasBridge.mq4 there.
echo.
echo  Next in MT4:
echo   1) Restart MT4 (or open MetaEditor and press Compile on EliasBridge)
echo   2) Navigator - Expert Advisors - drag EliasBridge onto ONE chart (e.g. XAUUSD)
echo   3) No "Allow live trading" needed - the bridge never trades
echo   4) In Telegram: /account
pause
