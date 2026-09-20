@echo off
rem Stops the bridge, journal server and dashboard, and pauses the scheduled task that keeps them alive.
schtasks /change /tn "RobotTrading Services" /disable >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-(bridge|journal|dashboard)\.bat|mt5_bridge\.py|journal\.api|vite' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Stopped. To turn the always-on mode back on: schtasks /change /tn "RobotTrading Services" /enable
