"""Automatic capture of trades.

MT4  — the read-only indicator `mt4/JournalBridge.mq4` writes `journal_open_<login>.csv` (every second) and
       `journal_hist_<login>.csv` (when history changes) into MetaQuotes' Common\\Files folder. This module watches
       those files. Plain files, no network, so MT4's WebRequest limits (port 80/443 only) never come into play.
MT5  — polled straight from the terminal through the MetaTrader5 package.

Nothing here can place or modify an order.
"""
import logging
import os
import re
import threading
import time

from . import db, engine

log = logging.getLogger("journal.bridge")

COMMON_DIR = os.environ.get("MT_COMMON_DIR") or os.path.join(os.environ.get("APPDATA", ""), "MetaQuotes", "Terminal", "Common", "Files")
FRESH_SECONDS = 6            # the indicator rewrites its file every second; older than this = disconnected
SNAPSHOT_EVERY = 10          # seconds between stored equity points
FILE_RE = re.compile(r"^journal_(open|hist)_(\d+)\.csv$")

_lock = threading.Lock()
LIVE: dict[str, dict] = {}                       # MT4 login -> latest snapshot from the indicator
MT5_STATUS: dict[str, dict] = {}                 # MT5 login -> {ok, error, time, balance, equity}
_seen: dict[tuple[str, str], float] = {}         # (login, kind) -> mtime already processed
_last_snap: dict[str, float] = {}


def _f(x: str) -> float | None:
    try:
        return float(x)
    except ValueError:
        return None


def _i(x: str) -> int | None:
    try:
        return int(float(x))
    except ValueError:
        return None


def parse_file(path: str) -> dict:
    """Returns {'account': {...}|None, 'open': [...], 'hist': [...]} from an indicator export."""
    with open(path, "rb") as fh:
        raw = fh.read()
    text = raw.decode("utf-8", errors="ignore") if raw[:2] not in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-16")
    out = {"account": None, "open": [], "hist": []}
    for line in text.replace("\r", "").split("\n"):
        p = line.split(";")
        if p[0] == "A" and len(p) >= 9:
            out["account"] = {"login": p[1], "server": p[2], "company": p[3], "balance": _f(p[4]), "equity": _f(p[5]), "margin": _f(p[6]), "currency": p[7], "server_time": _i(p[8])}
        elif p[0] == "O" and len(p) >= 13:
            out["open"].append({
                "ticket": p[1], "symbol": p[2].upper(), "direction": p[3], "volume": _f(p[4]), "open_time": _i(p[5]), "open_price": _f(p[6]),
                "sl": _f(p[7]) or None, "tp": _f(p[8]) or None, "close_time": None, "close_price": None,
                "profit": _f(p[9]) or 0.0, "swap": _f(p[10]) or 0.0, "commission": _f(p[11]) or 0.0, "comment": p[12] or None,
            })
        elif p[0] == "H" and len(p) >= 15:
            out["hist"].append({
                "ticket": p[1], "symbol": p[2].upper(), "direction": p[3], "volume": _f(p[4]), "open_time": _i(p[5]), "open_price": _f(p[6]),
                "close_time": _i(p[7]), "close_price": _f(p[8]), "sl": _f(p[9]) or None, "tp": _f(p[10]) or None,
                "profit": _f(p[11]) or 0.0, "swap": _f(p[12]) or 0.0, "commission": _f(p[13]) or 0.0, "comment": p[14] or None,
            })
    return out


def _valid(t: dict) -> bool:
    return bool(t["volume"]) and t["open_time"] and t["open_price"] is not None and t["direction"] in ("buy", "sell")


def poll_once(common: str | None = None) -> None:
    """One pass over the export files. Safe to call repeatedly."""
    common = common or COMMON_DIR
    if not os.path.isdir(common):
        return
    now = time.time()
    for name in os.listdir(common):
        m = FILE_RE.match(name)
        if not m:
            continue
        kind, login = m.groups()
        path = os.path.join(common, name)
        try:
            mtime = os.path.getmtime(path)
            data = parse_file(path)
        except OSError:
            continue  # the indicator is mid-write; next pass will get it

        with db.db() as con:
            acc = con.execute("SELECT id, enabled FROM accounts WHERE platform='mt4' AND login=?", (login,)).fetchone()
            account_id = acc["id"] if acc else None
            account_enabled = bool(acc["enabled"]) if acc else False

            if kind == "open" and data["account"]:
                with _lock:
                    # "linked" only means a row exists (so it drops off /detected once added) - disabling it later
                    # must not make it look "not yet added" again, it should just stop pulling in new trades.
                    LIVE[login] = {**data["account"], "last_seen": mtime, "linked": account_id is not None, "open_count": len(data["open"]),
                                   "floating": round(sum(t["profit"] for t in data["open"]), 2)}
            if account_id is None or not account_enabled or _seen.get((login, kind)) == mtime:
                continue  # not linked yet, disconnected, or nothing new

            if kind == "open":
                for t in filter(_valid, data["open"]):
                    row = con.execute("SELECT close_time FROM trades WHERE account_id=? AND ticket=?", (account_id, t["ticket"])).fetchone()
                    if row and row["close_time"] is not None:
                        continue  # already closed according to history; a stale open snapshot must not reopen it
                    db.upsert_trades(con, account_id, [t], "ea")
                    db.track_floating(con, account_id, t["ticket"], t["profit"])
                a = data["account"]
                if a and a["server_time"] and now - _last_snap.get(login, 0) >= SNAPSHOT_EVERY:
                    con.execute("INSERT OR REPLACE INTO snapshots (account_id, time, balance, equity) VALUES (?,?,?,?)", (account_id, a["server_time"], a["balance"], a["equity"]))
                    _last_snap[login] = now
            else:
                trades = [t for t in data["hist"] if _valid(t) and t["close_time"]]
                db.upsert_trades(con, account_id, trades, "ea")
                for t in trades:
                    db.close_excursions(con, account_id, t["ticket"])
            _seen[(login, kind)] = mtime


def detected() -> list[dict]:
    """MT4 accounts the indicator reports that are not in the journal yet."""
    now = time.time()
    if not engine.is_on("mt4"):
        return []
    with _lock:
        return [
            {"platform": "mt4", "login": k, "server": v["server"], "company": v["company"], "balance": v["balance"], "currency": v["currency"],
             "open_count": v["open_count"], "connected": now - v["last_seen"] < FRESH_SECONDS}
            for k, v in LIVE.items() if not v["linked"]
        ]


def live_status(platform: str, login: str | None) -> dict:
    """Connection state and live numbers for one account."""
    now = time.time()
    if not login:
        return {"source": None, "connected": False}
    if platform == "mt4":
        if not engine.is_on("mt4"):
            return {"source": "mt4-indicator", "connected": False, "engine_off": True, "last_seen_ago": None}
        with _lock:
            v = LIVE.get(login)
        if not v:
            return {"source": "mt4-indicator", "connected": False, "last_seen_ago": None}
        ago = now - v["last_seen"]
        return {"source": "mt4-indicator", "connected": ago < FRESH_SECONDS, "last_seen_ago": round(ago, 1), "balance": v["balance"],
                "equity": v["equity"], "floating": v["floating"], "open_count": v["open_count"], "server": v["server"]}
    if platform == "mt5":
        if not engine.is_on("mt5"):
            return {"source": "mt5-auto", "connected": False, "engine_off": True, "last_seen_ago": None}
        with _lock:
            s = MT5_STATUS.get(login)
        if not s:
            return {"source": "mt5-auto", "connected": False, "last_seen_ago": None}
        ago = now - s["time"]
        return {"source": "mt5-auto", "connected": bool(s["ok"]) and ago < 40, "last_seen_ago": round(ago, 1), "error": s.get("error"),
                "balance": s.get("balance"), "equity": s.get("equity"), "floating": s.get("floating"), "open_count": s.get("open_count")}
    return {"source": None, "connected": False}


_sync_running = threading.Lock()


def sync_mt5_once(wait: bool = False) -> None:
    """Refresh every MT5 account whose login matches the terminal that is currently logged in.

    Passes never overlap. The periodic loop skips a busy pass (`wait=False`); a newly added account waits its turn."""
    from . import mt5sync

    if not engine.is_on("mt5"):  # MT5 switch off: never touch MT5 (it would launch a terminal)
        return
    if not _sync_running.acquire(blocking=wait):
        return
    try:
        _sync_all(mt5sync)
    finally:
        _sync_running.release()


def _sync_all(mt5sync) -> None:
    with db.db() as con:
        accounts = con.execute("SELECT id, login, terminal_path FROM accounts WHERE platform='mt5' AND login IS NOT NULL AND kind != 'backtest' AND enabled=1").fetchall()
        for a in accounts:
            count = con.execute("SELECT COUNT(*) n FROM trades WHERE account_id=?", (a["id"],)).fetchone()["n"]
            try:
                trades, info = mt5sync.fetch(a["login"], 365 if count == 0 else 14, a["terminal_path"])
            except mt5sync.SyncError as e:
                with _lock:
                    MT5_STATUS[a["login"]] = {"ok": False, "error": str(e), "time": time.time()}
                continue
            db.upsert_trades(con, a["id"], trades, "mt5-sync")
            for t in trades:
                if t["close_time"] is None:
                    db.track_floating(con, a["id"], t["ticket"], t["profit"])
                else:
                    db.close_excursions(con, a["id"], t["ticket"])
            open_ = [t for t in trades if t["close_time"] is None]
            with _lock:
                MT5_STATUS[a["login"]] = {"ok": True, "time": time.time(), "balance": info["balance"], "equity": info["equity"],
                                          "floating": round(sum(t["profit"] for t in open_), 2), "open_count": len(open_)}


def start(stop: threading.Event) -> list[threading.Thread]:
    def files_loop():
        while not stop.is_set():
            try:
                if engine.is_on("mt4"):  # MT4 switch off: ignore the indicator's files (no new trades imported)
                    poll_once()
            except Exception:  # keep the watcher alive whatever a single file contains
                log.exception("poll_once failed")
            stop.wait(1.0)

    def mt5_loop():
        while not stop.is_set():
            try:
                sync_mt5_once()
            except Exception:
                log.exception("MT5 auto-sync failed")
            stop.wait(10.0)

    threads = [threading.Thread(target=files_loop, name="journal-files", daemon=True), threading.Thread(target=mt5_loop, name="journal-mt5", daemon=True)]
    for t in threads:
        t.start()
    return threads
