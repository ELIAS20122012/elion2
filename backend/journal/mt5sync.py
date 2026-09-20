"""Read closed and open positions of an MT5 account (read-only).

Each account may point at its own terminal (`terminal_path`), so a demo terminal and a live terminal can both be
logged in at once and the journal reads each one.
"""
import glob
import os
import threading
from datetime import datetime, timezone

import MetaTrader5 as mt5

# The MetaTrader5 package keeps one global connection per process and is not thread-safe: two threads calling
# initialize()/shutdown() at once can crash the whole interpreter. Every MT5 call in this process goes through this lock.
MT5_LOCK = threading.RLock()


class SyncError(Exception):
    pass


def find_terminals() -> list[dict]:  # filesystem only; does not touch MT5
    """MT5 installs on this PC: standard install folders plus the folders MetaTrader recorded in its data directories."""
    found: dict[str, dict] = {}

    def add(folder: str) -> None:
        exe = os.path.join(folder.strip(), "terminal64.exe")
        if os.path.isfile(exe):
            found[os.path.normcase(exe)] = {"path": exe, "name": os.path.basename(folder.strip().rstrip("\\/")) or folder}

    for root in filter(None, (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), "C:\\", "D:\\", "E:\\")):
        for exe in glob.glob(os.path.join(root, "*", "terminal64.exe")):
            add(os.path.dirname(exe))
    for origin in glob.glob(os.path.join(os.environ.get("APPDATA", ""), "MetaQuotes", "Terminal", "*", "origin.txt")):
        try:
            raw = open(origin, "rb").read()
            add(raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8", errors="ignore").strip())
        except OSError:
            continue
    return sorted(found.values(), key=lambda t: t["name"].lower())


def fetch(expected_login: str | None, days: int = 365, terminal_path: str | None = None) -> tuple[list[dict], dict]:
    """Returns (trades, account_info). Closed positions come from deals, open ones from positions_get."""
    with MT5_LOCK:
        return _fetch(expected_login, days, terminal_path)


def _fetch(expected_login: str | None, days: int, terminal_path: str | None) -> tuple[list[dict], dict]:
    ok = mt5.initialize(path=terminal_path) if terminal_path else mt5.initialize()
    if not ok:
        raise SyncError(f"اتصال به MT5 ممکن نشد ({mt5.last_error()}). ترمینال MT5 باز و لاگین باشد" + (f" ({terminal_path})." if terminal_path else "."))
    try:
        acc = mt5.account_info()
        if acc is None:
            raise SyncError("MT5 لاگین نیست.")
        if expected_login and str(acc.login) != str(expected_login):
            raise SyncError(f"این ترمینال روی حساب {acc.login} است، نه {expected_login}. با همان حساب وارد شوید، یا برای هر حساب ترمینال جدا انتخاب کنید.")

        now = datetime.now(timezone.utc)
        start = datetime.fromtimestamp(0, timezone.utc) if days <= 0 else datetime.fromtimestamp(now.timestamp() - days * 86400, timezone.utc)
        deals = mt5.history_deals_get(start, now)
        by_pos: dict[int, list] = {}
        for d in deals or []:
            if d.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL) and d.position_id:
                by_pos.setdefault(d.position_id, []).append(d)

        trades = []
        for pid, ds in by_pos.items():
            ds.sort(key=lambda d: d.time_msc)
            ins = [d for d in ds if d.entry == mt5.DEAL_ENTRY_IN]
            outs = [d for d in ds if d.entry in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY)]
            if not ins or not outs:
                continue
            first, last = ins[0], outs[-1]
            trades.append({
                "ticket": str(pid), "symbol": first.symbol, "direction": "buy" if first.type == mt5.DEAL_TYPE_BUY else "sell",
                "volume": sum(d.volume for d in ins), "open_time": int(first.time), "open_price": first.price,
                "close_time": int(last.time), "close_price": last.price,
                "commission": sum(d.commission for d in ds), "swap": sum(d.swap for d in ds),
                "profit": sum(d.profit for d in ds), "comment": first.comment or None,
            })

        for p in mt5.positions_get() or []:
            trades.append({
                "ticket": str(p.ticket), "symbol": p.symbol, "direction": "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell",
                "volume": p.volume, "open_time": int(p.time), "open_price": p.price_open, "close_time": None, "close_price": None,
                "sl": p.sl or None, "tp": p.tp or None, "commission": 0, "swap": p.swap, "profit": p.profit,
            })
        return trades, {"balance": acc.balance, "equity": acc.equity, "currency": acc.currency, "server": acc.server}
    finally:
        mt5.shutdown()
