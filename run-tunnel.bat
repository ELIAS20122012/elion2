@echo off
rem Cloudflare Tunnel: makes https://trade.eliongroup.org reach the dashboard (behind the Cloudflare Access email login).
rem Restarts after 5 seconds if it ever stops. Config: %USERPROFILE%\.cloudflared\config.yml
:loop
"%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" tunnel run robot-trading
echo Tunnel stopped - restarting in 5 s (close this window to stop it)...
timeout /t 5 >nul
goto loop
