"""Per-platform on/off switches for everything that talks to MetaTrader.

MT5: the MetaTrader5 Python package starts the terminal if it is not running, so an always-on sync loop (and the
price-bridge process) reopens terminals by themselves. MT4: the terminal has to be open for its indicator to report.
Both switches are OFF every time the journal server starts, and each is turned on/off on its own from the
Connection page. Switching on opens the terminals (and the MT5 price bridge); switching off stops the app's
contact and closes that platform's terminal windows (a normal window close - open positions stay open at the
broker). Nothing here ever force-kills a terminal.
"""
import json
import os
import subprocess
import threading

_mt5 = threading.Event()
_mt4 = threading.Event()
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE_BAT = os.path.join(BACKEND_DIR, "run-bridge.bat")
OFF_MESSAGE = "موتور MT5 خاموش است — از صفحه‌ی Connection کلید MetaTrader 5 را روشن کنید."
PROC = {"mt5": "terminal64", "mt4": "terminal"}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _flag(platform: str) -> threading.Event:
    return _mt4 if platform == "mt4" else _mt5


def is_on(platform: str = "mt5") -> bool:
    return _flag(platform).is_set()


def require(exc: type[Exception]) -> None:
    """Guard for every MT5 call: refuse before mt5.initialize() could launch a terminal."""
    if not _mt5.is_set():
        raise exc(OFF_MESSAGE)


def _ps(script: str) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
    return r.stdout.strip()


#   [x] in a -like pattern is a one-character class: the pattern text itself then does not match the command
#   line of the powershell that carries it, and $PID excludes it anyway.
_BRIDGE_PY = "*mt5_bridg[e].py*"
_BRIDGE_BAT = "*run-bridg[e].bat*"


def bridge_running() -> bool:
    out = _ps(f"(Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and ($_.CommandLine -like '{_BRIDGE_PY}' -or $_.CommandLine -like '{_BRIDGE_BAT}') }} | Measure-Object).Count")
    return out.isdigit() and int(out) > 0


def start_bridge() -> None:
    if bridge_running():
        return
    subprocess.Popen(["cmd.exe", "/c", "start", "/min", "", BRIDGE_BAT], cwd=BACKEND_DIR, creationflags=NO_WINDOW)


def stop_bridge() -> None:
    kill = "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    # the watchdog .bat first, otherwise it restarts the python process we are about to kill
    _ps(f"Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and $_.CommandLine -like '{_BRIDGE_BAT}' }} | {kill};"
        f"Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and $_.CommandLine -like '{_BRIDGE_PY}' }} | {kill}")


def terminals_running() -> list[dict]:
    out = _ps("Get-Process terminal64,terminal -ErrorAction SilentlyContinue | Select-Object Id,Path | ConvertTo-Json -Compress")
    if not out:
        return []
    data = json.loads(out)
    data = data if isinstance(data, list) else [data]
    return [{"id": d["Id"], "path": d["Path"], "name": os.path.basename(os.path.dirname(d["Path"] or "")) or "MetaTrader",
             "platform": "mt5" if (d["Path"] or "").lower().endswith("terminal64.exe") else "mt4"} for d in data]


def close_terminals(platform: str) -> None:
    """Asks that platform's terminal windows to close, the same as clicking X (no force-kill)."""
    _ps(f"Get-Process -Name {PROC[platform]} -ErrorAction SilentlyContinue | ForEach-Object {{ [void]$_.CloseMainWindow() }}")


def find_mt4_terminals() -> list[str]:
    """MT4 installs on this PC (terminal.exe): standard install folders plus the folders MetaTrader recorded in its data directories."""
    import glob

    found: dict[str, str] = {}

    def add(folder: str) -> None:
        exe = os.path.join(folder.strip(), "terminal.exe")
        if os.path.isfile(exe):
            found[os.path.normcase(exe)] = exe

    for root in filter(None, (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), "C:\\", "D:\\", "E:\\")):
        for exe in glob.glob(os.path.join(root, "*", "terminal.exe")):
            add(os.path.dirname(exe))
    for origin in glob.glob(os.path.join(os.environ.get("APPDATA", ""), "MetaQuotes", "Terminal", "*", "origin.txt")):
        try:
            raw = open(origin, "rb").read()
            add(raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8", errors="ignore").strip())
        except OSError:
            continue
    return sorted(found.values())


def launch_mt4() -> list[str]:
    """Opens every installed MT4 terminal that is not already running, so its journal indicator (kept on a chart) resumes."""
    running = {os.path.normcase(t["path"] or "") for t in terminals_running()}
    opened = []
    for exe in find_mt4_terminals():
        if os.path.normcase(exe) in running:
            continue
        subprocess.Popen([exe], cwd=os.path.dirname(exe), creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        opened.append(exe)
    return opened


def status() -> dict:
    terms = terminals_running()
    return {
        "mt5": {"on": _mt5.is_set(), "bridge": bridge_running(), "terminals": [t for t in terms if t["platform"] == "mt5"]},
        "mt4": {"on": _mt4.is_set(), "terminals": [t for t in terms if t["platform"] == "mt4"]},
    }


def start(platform: str) -> dict:
    _flag(platform).set()
    if platform == "mt5":
        start_bridge()
        from . import bridge

        threading.Thread(target=bridge.sync_mt5_once, kwargs={"wait": True}, name="engine-first-sync", daemon=True).start()
    else:
        launch_mt4()
    return status()


def stop(platform: str, close: bool = True) -> dict:
    _flag(platform).clear()
    if platform == "mt5":
        stop_bridge()
    if close:
        close_terminals(platform)
    return status()


def boot() -> None:
    """Server start: everything off, and no leftover price bridge from before (so the state on screen is true). Terminals are left alone."""
    _mt5.clear()
    _mt4.clear()
    stop_bridge()
