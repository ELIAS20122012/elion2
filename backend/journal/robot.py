"""Robot EA endpoints (/events/*) — the RobotTradingEA (MT4/MT5) reports to the journal server.

Each robot account gets its own API key (only its sha256 is stored). The EA sends it as X-API-Key.
Order execution stays DISABLED: /events/signal-evaluate never returns a signal until the rules are
rebuilt and Elias confirms them, so the EA only reports trades, balance and heartbeats.
"""
import calendar
import json
import hashlib
import secrets
import time
from datetime import datetime

from pydantic import BaseModel, Field

from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS robot_keys (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS robot_candles (
    symbol TEXT NOT NULL,
    time INTEGER NOT NULL,                     -- M1 bar open, terminal server time
    open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
    volume REAL,
    PRIMARY KEY (symbol, time)
);
CREATE TABLE IF NOT EXISTS robot_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,                   -- buy | sell | buy_limit | sell_limit | buy_stop | sell_stop | modify | close | cancel
    volume REAL NOT NULL,
    sl REAL, tp REAL, comment TEXT,
    status TEXT NOT NULL,                      -- pending | taken | filled | failed | expired
    created_at REAL NOT NULL,
    ticket TEXT, price REAL, error TEXT
);
CREATE TABLE IF NOT EXISTS robot_heartbeats (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    time INTEGER NOT NULL,
    ea_version TEXT,
    terminal_info TEXT,
    last_event TEXT
);
CREATE TABLE IF NOT EXISTS robot_positions (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    time REAL NOT NULL,
    data TEXT NOT NULL                         -- JSON: equity/balance + open positions with live profit
);
"""

#: the EA treats any 2xx as delivered; this tells it plainly that no order may be placed
NO_SIGNAL = {"signal": None, "trading": "disabled"}


def init() -> None:
    with db.db() as con:
        con.executescript(SCHEMA)
        cols = {r[1] for r in con.execute("PRAGMA table_info(robot_orders)")}
        if "target" not in cols:  # ticket an order modifies / closes
            con.execute("ALTER TABLE robot_orders ADD COLUMN target TEXT")
        if "entry" not in cols:  # requested price of a limit/stop order
            con.execute("ALTER TABLE robot_orders ADD COLUMN entry REAL")


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_key(account_id: int) -> str:
    """Creates (or replaces) the account's key and returns it once in plain text."""
    key = "rk_" + secrets.token_urlsafe(24)
    with db.db() as con:
        con.execute("INSERT INTO robot_keys (account_id, key_hash, created_at) VALUES (?,?,?) "
                    "ON CONFLICT(account_id) DO UPDATE SET key_hash=excluded.key_hash, created_at=excluded.created_at",
                    (account_id, _hash(key), db.now()))
    return key


def account_for(key: str | None) -> int | None:
    if not key:
        return None
    with db.db() as con:
        r = con.execute("SELECT k.account_id FROM robot_keys k JOIN accounts a ON a.id=k.account_id "
                        "WHERE k.key_hash=? AND a.enabled=1", (_hash(key.strip()),)).fetchone()
    return r["account_id"] if r else None


def iso(s: str | None) -> int | None:
    """EA time 'YYYY-MM-DDTHH:MM:SSZ' (terminal server time) → epoch seconds, like the other importers."""
    if not s:
        return None
    return calendar.timegm(datetime.strptime(s.rstrip("Z")[:19], "%Y-%m-%dT%H:%M:%S").timetuple())


def _touch(con, account_id: int, event: str) -> None:
    con.execute("INSERT INTO robot_heartbeats (account_id, time, last_event) VALUES (?,?,?) "
                "ON CONFLICT(account_id) DO UPDATE SET time=excluded.time, last_event=excluded.last_event",
                (account_id, db.now(), event))


class WrongAccount(Exception):
    """The EA runs on a different MT login than the account its key belongs to."""


def check_login(account_id: int, login: str | None) -> None:
    if not login:
        return
    with db.db() as con:
        r = con.execute("SELECT login FROM accounts WHERE id=?", (account_id,)).fetchone()
    if r and r["login"] and str(r["login"]).strip() != str(login).strip():
        raise WrongAccount(f"This key belongs to login {r['login']}, but the EA runs on login {login}.")


class HeartbeatIn(BaseModel):
    login: str | None = None
    ea_version: str = Field(default="", max_length=40)
    terminal_info: str = Field(default="", max_length=500)


class SnapshotIn(BaseModel):
    login: str | None = None
    timestamp: str
    balance: float
    equity: float
    margin: float | None = None
    free_margin: float | None = None
    margin_level: float | None = None


class TradeIn(BaseModel):
    login: str | None = None
    ticket: str = Field(min_length=1, max_length=40)
    symbol: str = Field(min_length=1, max_length=30)
    direction: str
    volume: float
    open_time: str
    open_price: float
    close_time: str | None = None
    close_price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    profit: float = 0
    commission: float = 0
    swap: float = 0
    status: str = "open"


def heartbeat(account_id: int, b: HeartbeatIn) -> dict:
    check_login(account_id, b.login)
    with db.db() as con:
        _touch(con, account_id, "heartbeat")
        con.execute("UPDATE robot_heartbeats SET ea_version=?, terminal_info=? WHERE account_id=?",
                    (b.ea_version, b.terminal_info, account_id))
    return {"ok": True}


def snapshot(account_id: int, b: SnapshotIn) -> dict:
    check_login(account_id, b.login)
    with db.db() as con:
        _touch(con, account_id, "snapshot")
        con.execute("INSERT OR REPLACE INTO snapshots (account_id, time, balance, equity) VALUES (?,?,?,?)",
                    (account_id, iso(b.timestamp), b.balance, b.equity))
    return {"ok": True}


def trade(account_id: int, t: TradeIn) -> dict:
    check_login(account_id, t.login)
    direction = t.direction.lower()
    if direction not in ("buy", "sell"):
        raise ValueError(f"direction must be buy or sell, got {t.direction!r}")
    closed = t.status.lower() == "closed" or bool(t.close_time)
    row = {
        "ticket": t.ticket, "symbol": t.symbol, "direction": direction, "volume": t.volume,
        "open_time": iso(t.open_time), "open_price": t.open_price,
        "close_time": iso(t.close_time) if closed else None, "close_price": t.close_price if closed else None,
        "sl": t.stop_loss, "tp": t.take_profit, "commission": t.commission, "swap": t.swap, "profit": t.profit,
    }
    with db.db() as con:
        _touch(con, account_id, "trade")
        ins, _ = db.upsert_trades(con, account_id, [row], "ea")
        if closed:
            db.close_excursions(con, account_id, t.ticket)
        else:
            db.track_floating(con, account_id, t.ticket, t.profit)
    return {"ok": True, "created": bool(ins)}


def status() -> list[dict]:
    with db.db() as con:
        rows = con.execute("SELECT a.id, a.name, a.platform, k.created_at AS key_created, h.time, h.ea_version, h.last_event "
                           "FROM accounts a LEFT JOIN robot_keys k ON k.account_id=a.id "
                           "LEFT JOIN robot_heartbeats h ON h.account_id=a.id "
                           "WHERE k.account_id IS NOT NULL OR h.account_id IS NOT NULL ORDER BY a.id").fetchall()
    now = db.now()
    return [{**dict(r), "online": bool(r["time"]) and now - r["time"] < 180} for r in rows]


def live(account_id: int, fresh: int = 180) -> dict | None:
    """Live state from the EA (heartbeat + last snapshot), or None if the EA has not reported recently."""
    with db.db() as con:
        h = con.execute("SELECT time FROM robot_heartbeats WHERE account_id=?", (account_id,)).fetchone()
        if not h or db.now() - h["time"] >= fresh:
            return None
        s = con.execute("SELECT balance, equity FROM snapshots WHERE account_id=? ORDER BY time DESC LIMIT 1", (account_id,)).fetchone()
    out = {"source": "mt4-ea", "connected": True, "last_seen_ago": db.now() - h["time"]}
    if s:
        out.update({"balance": s["balance"], "equity": s["equity"]})
    return out


#: M1 bars kept per symbol (about two weeks of trading)
KEEP_CANDLES = 20_000


class CandleIn(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


class CandlesIn(BaseModel):
    login: str | None = None
    symbol: str = Field(default="XAUUSD", min_length=1, max_length=30)
    candles: list[CandleIn] = Field(max_length=5000)


def save_candles(account_id: int, b: CandlesIn) -> dict:
    """MT4 price feed for the dashboard chart (replaces the MT5 bridge)."""
    check_login(account_id, b.login)
    rows = [(b.symbol, iso(c.time), c.open, c.high, c.low, c.close, c.volume) for c in b.candles]
    with db.db() as con:
        _touch(con, account_id, "candles")
        con.executemany("INSERT OR REPLACE INTO robot_candles (symbol, time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?)", rows)
        con.execute("DELETE FROM robot_candles WHERE symbol=? AND time < (SELECT time FROM robot_candles WHERE symbol=? ORDER BY time DESC LIMIT 1 OFFSET ?)",
                    (b.symbol, b.symbol, KEEP_CANDLES))
    return {"ok": True, "saved": len(rows)}


def candles(symbol: str, count: int = 3000, since: int | None = None) -> list[dict]:
    """Newest `count` M1 bars, or only bars from `since` on (the chart's cheap incremental poll)."""
    count = max(10, min(count, KEEP_CANDLES))
    with db.db() as con:
        if since is not None:
            rows = con.execute("SELECT time, open, high, low, close, volume FROM robot_candles WHERE symbol=? AND time>=? ORDER BY time DESC LIMIT ?",
                               (symbol, since, count)).fetchall()
        else:
            rows = con.execute("SELECT time, open, high, low, close, volume FROM robot_candles WHERE symbol=? ORDER BY time DESC LIMIT ?",
                               (symbol, count)).fetchall()
    return [dict(r) for r in reversed(rows)]


# --- orders from the dashboard, executed by the EA in MT4 -------------------------------------------

#: an order the EA has not picked up within this many seconds is dropped, never executed late
ORDER_TTL = 15.0
ORDER_WAIT = 25.0


class OrderFailed(Exception):
    pass


def online(account_id: int, fresh: int = 90) -> bool:
    with db.db() as con:
        h = con.execute("SELECT time FROM robot_heartbeats WHERE account_id=?", (account_id,)).fetchone()
    return bool(h) and db.now() - h["time"] < fresh


def _run(account_id: int, row: dict, wait: float, sleep) -> dict:
    """Queues one instruction for the EA and waits for MT4's answer."""
    if not online(account_id):
        raise OrderFailed("RobotTradingEA is not running on this MT4 account — put it on a chart first.")
    with db.db() as con:
        oid = con.execute("INSERT INTO robot_orders (account_id, symbol, direction, volume, sl, tp, comment, target, entry, status, created_at) "
                          "VALUES (?,?,?,?,?,?,?,?,?,'pending',?)",
                          (account_id, row["symbol"], row["direction"], row.get("volume", 0), row.get("sl"), row.get("tp"),
                           row.get("comment"), row.get("target"), row.get("entry"), time.time())).lastrowid
    end = time.time() + wait
    while time.time() < end:
        sleep(0.5)
        with db.db() as con:
            r = con.execute("SELECT * FROM robot_orders WHERE id=?", (oid,)).fetchone()
        if r["status"] == "filled":
            return {"ticket": r["ticket"], "price": r["price"], "order_id": oid}
        if r["status"] in ("failed", "expired"):
            raise OrderFailed(r["error"] or "MT4 rejected the order.")
    with db.db() as con:  # still pending: make sure the EA can never pick it up later
        con.execute("UPDATE robot_orders SET status='expired', error='MT4 did not answer in time' WHERE id=? AND status='pending'", (oid,))
        r = con.execute("SELECT * FROM robot_orders WHERE id=?", (oid,)).fetchone()
    if r["status"] == "filled":
        return {"ticket": r["ticket"], "price": r["price"], "order_id": oid}
    raise OrderFailed("MT4 did not confirm in time — check the Trade tab in MT4 before trying again.")


def place(account_id: int, symbol: str, direction: str, volume: float, sl: float | None, tp: float | None,
          comment: str | None, wait: float = ORDER_WAIT, sleep=time.sleep, order_type: str = "market", price: float | None = None) -> dict:
    """Market, limit or stop order from the dashboard."""
    if direction not in ("buy", "sell") or not (0 < volume <= 100):
        raise OrderFailed("Invalid direction or volume.")
    if order_type not in ("market", "limit", "stop"):
        raise OrderFailed("Invalid order type.")
    if order_type != "market" and not (price and price > 0):
        raise OrderFailed("A limit/stop order needs its price.")
    kind = direction if order_type == "market" else f"{direction}_{order_type}"
    return _run(account_id, {"symbol": symbol, "direction": kind, "volume": volume, "sl": sl, "tp": tp, "comment": comment,
                             "entry": price if order_type != "market" else None}, wait, sleep)


def cancel(account_id: int, ticket: str, wait: float = ORDER_WAIT, sleep=time.sleep) -> dict:
    """Deletes a pending (limit/stop) order."""
    return _run(account_id, {"symbol": "", "direction": "cancel", "target": ticket}, wait, sleep)


def _symbol_of(account_id: int, ticket: str) -> str:
    with db.db() as con:
        r = con.execute("SELECT symbol FROM trades WHERE account_id=? AND ticket=?", (account_id, ticket)).fetchone()
    return r["symbol"] if r else ""


def modify(account_id: int, ticket: str, sl: float | None, tp: float | None, wait: float = ORDER_WAIT, sleep=time.sleep) -> dict:
    """Moves SL/TP of an open MT4 position (None or 0 removes it)."""
    out = _run(account_id, {"symbol": _symbol_of(account_id, ticket), "direction": "modify", "sl": sl or None, "tp": tp or None, "target": ticket}, wait, sleep)
    with db.db() as con:  # the journal shows the new levels at once; the EA's next sync confirms them
        con.execute("UPDATE trades SET sl=?, tp=? WHERE account_id=? AND ticket=?", (sl or None, tp or None, account_id, ticket))
    return out


def close(account_id: int, ticket: str, wait: float = ORDER_WAIT, sleep=time.sleep) -> dict:
    return _run(account_id, {"symbol": _symbol_of(account_id, ticket), "direction": "close", "target": ticket}, wait, sleep)


class PositionIn(BaseModel):
    ticket: str
    symbol: str
    direction: str
    volume: float
    open_price: float
    open_time: str | None = None
    sl: float | None = None
    tp: float | None = None
    price: float | None = None
    profit: float = 0
    swap: float = 0
    commission: float = 0


class PendingIn(BaseModel):
    ticket: str
    symbol: str
    type: str                                  # buy_limit | sell_limit | buy_stop | sell_stop
    volume: float
    price: float
    sl: float | None = None
    tp: float | None = None


class QuoteIn(BaseModel):
    symbol: str
    bid: float
    ask: float
    change: float | None = None                # % vs yesterday's close


class PositionsIn(BaseModel):
    login: str | None = None
    balance: float | None = None
    equity: float | None = None
    positions: list[PositionIn] = Field(default_factory=list, max_length=500)
    pending: list[PendingIn] = Field(default_factory=list, max_length=500)
    quotes: list[QuoteIn] = Field(default_factory=list, max_length=60)


def save_positions(account_id: int, b: PositionsIn) -> dict:
    """The EA's 2-second pulse: live open positions in, the next dashboard order out (one request)."""
    check_login(account_id, b.login)
    data = {"balance": b.balance, "equity": b.equity, "positions": [p.model_dump() for p in b.positions],
            "pending": [p.model_dump() for p in b.pending], "quotes": [q.model_dump() for q in b.quotes]}
    with db.db() as con:
        con.execute("INSERT INTO robot_positions (account_id, time, data) VALUES (?,?,?) "
                    "ON CONFLICT(account_id) DO UPDATE SET time=excluded.time, data=excluded.data",
                    (account_id, time.time(), json.dumps(data)))
    return {"ok": True, "order": next_order(account_id)}


def positions(account_id: int, fresh: float = 20) -> dict:
    with db.db() as con:
        r = con.execute("SELECT time, data FROM robot_positions WHERE account_id=?", (account_id,)).fetchone()
    if not r or time.time() - r["time"] > fresh:
        return {"live": False, "positions": [], "pending": [], "quotes": []}
    d = json.loads(r["data"])
    d["live"] = True
    d.setdefault("pending", [])
    d.setdefault("quotes", [])
    d["floating"] = round(sum(p["profit"] + p["swap"] + p["commission"] for p in d["positions"]), 2)
    d["age"] = round(time.time() - r["time"], 1)
    return d


def next_order(account_id: int) -> dict | None:
    """The EA's poll: oldest fresh pending order, marked taken so it runs once."""
    now = time.time()
    with db.db() as con:
        con.execute("UPDATE robot_orders SET status='expired', error='not picked up in time' WHERE account_id=? AND status='pending' AND created_at < ?",
                    (account_id, now - ORDER_TTL))
        r = con.execute("SELECT id, symbol, direction, volume, sl, tp, comment, target, entry FROM robot_orders WHERE account_id=? AND status='pending' ORDER BY id LIMIT 1",
                        (account_id,)).fetchone()
        if not r:
            return None
        con.execute("UPDATE robot_orders SET status='taken' WHERE id=?", (r["id"],))
    return dict(r)


class OrderResultIn(BaseModel):
    ok: bool
    ticket: str | None = None
    price: float | None = None
    error: str | None = Field(default=None, max_length=300)


def order_result(account_id: int, order_id: int, b: OrderResultIn) -> dict:
    with db.db() as con:
        con.execute("UPDATE robot_orders SET status=?, ticket=?, price=?, error=? WHERE id=? AND account_id=?",
                    ("filled" if b.ok else "failed", b.ticket, b.price, b.error, order_id, account_id))
    return {"ok": True}
