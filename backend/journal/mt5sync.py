"""Read closed and open positions of an MT5 account, and (since the Trade page's Place Order button went
live) send real market orders. `send_order` is the only function here that is not read-only: it places a
real TRADE_ACTION_DEAL against the broker. There is deliberately no size/SL cap or confirmation step in
here - the caller (the API layer) sends exactly the order it was given.

Each account may point at its own terminal (`terminal_path`), so a demo terminal and a live terminal can both be
logged in at once and the journal reads each one.
"""
import glob
import os
import threading
from datetime import datetime, timezone

import MetaTrader5 as mt5

from . import engine

FUTURE_MARGIN = 86400  # seconds; see the note in _fetch about the broker clock running ahead of UTC

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
    engine.require(SyncError)
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
        # MT5 stamps deals with the BROKER's clock (here UTC+3), which runs ahead of real UTC. A window that ends "now" in real
        # UTC therefore hides every deal of the last few hours: a position you just closed stayed "open" in the journal until
        # the broker clock offset had passed. End the window a day ahead so nothing recent is cut off.
        deals = mt5.history_deals_get(start, datetime.fromtimestamp(now.timestamp() + FUTURE_MARGIN, timezone.utc))
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


TF_NAMES = {60: "M1", 300: "M5", 900: "M15", 1800: "M30", 3600: "H1", 14400: "H4", 86400: "D1"}


def fetch_candles(expected_login: str | None, terminal_path: str | None, symbol: str, tf_sec: int, count: int) -> list[list[float]]:
    """Latest `count` candles from the broker's own history: [time, open, high, low, close, tick_volume] (time = broker clock)."""
    if tf_sec not in TF_NAMES:
        raise SyncError(f"تایم‌فریم {tf_sec} پشتیبانی نمی‌شود.")
    engine.require(SyncError)
    with MT5_LOCK:
        ok = mt5.initialize(path=terminal_path) if terminal_path else mt5.initialize()
        if not ok:
            raise SyncError(f"اتصال به MT5 ممکن نشد ({mt5.last_error()}). ترمینال MT5 باز و لاگین باشد.")
        try:
            acc = mt5.account_info()
            if acc is None:
                raise SyncError("MT5 لاگین نیست.")
            if expected_login and str(acc.login) != str(expected_login):
                raise SyncError(f"این ترمینال روی حساب {acc.login} است، نه {expected_login}.")
            if not mt5.symbol_select(symbol, True):
                raise SyncError(f"نماد {symbol} در این بروکر پیدا نشد.")
            rates = mt5.copy_rates_from_pos(symbol, getattr(mt5, f"TIMEFRAME_{TF_NAMES[tf_sec]}"), 0, count)
            if rates is None or len(rates) == 0:
                raise SyncError(f"بروکر برای {symbol} داده‌ای نداد ({mt5.last_error()}).")
            return [[int(r["time"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), float(r["tick_volume"])] for r in rates]
        finally:
            mt5.shutdown()


class OrderError(Exception):
    pass


def send_order(expected_login: str | None, terminal_path: str | None, symbol: str, direction: str, volume: float,
                sl: float | None, tp: float | None, comment: str | None) -> dict:
    """Places a real market order (buy/sell) on the terminal for this account. Not read-only."""
    engine.require(OrderError)
    with MT5_LOCK:
        return _send_order(expected_login, terminal_path, symbol, direction, volume, sl, tp, comment)


def _send_order(expected_login, terminal_path, symbol, direction, volume, sl, tp, comment):
    ok = mt5.initialize(path=terminal_path) if terminal_path else mt5.initialize()
    if not ok:
        raise OrderError(f"اتصال به MT5 ممکن نشد ({mt5.last_error()}). ترمینال MT5 باز و لاگین باشد" + (f" ({terminal_path})." if terminal_path else "."))
    try:
        acc = mt5.account_info()
        if acc is None:
            raise OrderError("MT5 لاگین نیست.")
        if expected_login and str(acc.login) != str(expected_login):
            raise OrderError(f"این ترمینال روی حساب {acc.login} است، نه {expected_login}. سفارش ارسال نشد.")
        if not mt5.symbol_select(symbol, True):
            raise OrderError(f"نماد {symbol} در Market Watch پیدا/فعال نشد.")
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.ask or not tick.bid:
            raise OrderError(f"قیمت لحظه‌ای {symbol} در دسترس نیست.")
        order_type = mt5.ORDER_TYPE_BUY if direction == "buy" else mt5.ORDER_TYPE_SELL
        price = tick.ask if direction == "buy" else tick.bid
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": price,
            "deviation": 20,
            "magic": 990321,
            "comment": (comment or "robot-trading")[:31],
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        if sl:
            request["sl"] = sl
        if tp:
            request["tp"] = tp
        result = mt5.order_send(request)
        if result is None:
            raise OrderError(f"سفارش ارسال نشد ({mt5.last_error()}).")
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            raise OrderError(f"بروکر سفارش را رد کرد: {result.comment} (retcode {result.retcode}).")
        return {"ticket": result.order, "price": result.price, "volume": result.volume, "retcode": result.retcode}
    finally:
        mt5.shutdown()
