# Starts whichever of the three services is not already running: MT5 price bridge, journal server, dashboard.
# Safe to run any number of times (start-live.bat and the scheduled task both call it).
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Runner-Alive($name) {
    [bool](Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$name*" })
}
function Start-Runner($name, $path) {
    if (-not (Runner-Alive $name)) {
        Start-Process cmd.exe -ArgumentList '/c', "`"$path`"" -WindowStyle Minimized
    }
}

# The MT5 price bridge (run-bridge.bat) is NOT started here any more: it launches an MT5 terminal, and the app now
# does that only when you press "Start Engine" on the Connection page (the journal server starts it then).
Start-Runner 'run-journal.bat'   "$root\backend\run-journal.bat"
Start-Runner 'run-dashboard.bat' "$root\dashboard\run-dashboard.bat"
# remote access from any browser (Cloudflare Tunnel + Access login); skipped if cloudflared is not installed
if (Test-Path "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe") { Start-Runner 'run-tunnel.bat' "$root\run-tunnel.bat" }
# keeps the hosted mirror fresh so the dashboard is still viewable after this PC shuts down;
# run-mirror.bat exits immediately unless the Cloudflare credentials are set (docs\hosting-mirror.md)
if ($env:CLOUDFLARE_API_TOKEN) { Start-Runner 'run-mirror.bat' "$root\run-mirror.bat" }
