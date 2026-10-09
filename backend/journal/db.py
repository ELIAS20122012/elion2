"""SQLite storage for accounts, trades, per-trade notes and equity snapshots.

Times are epoch seconds in *broker time treated as UTC* (same convention as the chart).
"""
import os
import sqlite3
import time
from contextlib import contextmanager

DB_PATH = os.environ.get("JOURNAL_DB", os.path.join(os.path.dirname(os.path.dirname(__file__)), "journal.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'mt5',      -- mt4 | mt5 | other
    kind TEXT NOT NULL DEFAULT 'manual',       -- manual | robot | backtest
    broker TEXT,
    login TEXT,
    currency TEXT DEFAULT 'USD',
    is_live INTEGER NOT NULL DEFAULT 0,
    initial_balance REAL,
    note TEXT,
    created_at INTEGER NOT NULL,
    terminal_path TEXT,                         -- MT5 only: terminal64.exe this account is read from (lets demo and live run side by side)
    enabled INTEGER NOT NULL DEFAULT 1          -- connect/disconnect: 0 pauses MT5/MT4 auto-sync and reports "not connected"
);
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ticket TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,                   -- buy | sell
    volume REAL NOT NULL,
    open_time INTEGER NOT NULL,
    open_price REAL NOT NULL,
    close_time INTEGER,
    close_price REAL,
    sl REAL,
    tp REAL,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    comment TEXT,
    source TEXT,                               -- mt5-sync | import | ea | backtest | manual
    mfe REAL,                                  -- best floating profit seen while the trade was open
    mae REAL,                                  -- worst floating profit seen while the trade was open
    UNIQUE(account_id, ticket)
);
CREATE INDEX IF NOT EXISTS idx_trades_account_time ON trades(account_id, open_time);
CREATE TABLE IF NOT EXISTS trade_notes (
    trade_id INTEGER PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
    setup_valid TEXT,                          -- yes | no | unsure
    setup_id TEXT,
    emotion TEXT,
    error TEXT,
    note TEXT,
    updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    time INTEGER NOT NULL,
    balance REAL,
    equity REAL,
    PRIMARY KEY (account_id, time)
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,               -- bcrypt; the plain password is never stored
    role TEXT NOT NULL DEFAULT 'viewer',       -- admin (everything) | viewer (read-only, no orders)
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,               -- sha256 of the cookie value, so the DB holds no usable token
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
-- Elias's verdicts on what a taught rule found ("ok" = a real one, "bad" = not one). The rules are tuned from these.
CREATE TABLE IF NOT EXISTS rule_labels (
    rule TEXT NOT NULL,
    key TEXT NOT NULL,                         -- identifies the finding: timeframe, side and the candle times
    label TEXT NOT NULL,                       -- ok | bad
    features TEXT,                             -- JSON with the measurements taken when it was labelled
    updated_at INTEGER,
    PRIMARY KEY (rule, key)
);
"""


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")  # the API, the file watcher and MT5 auto-sync write concurrently
    return con


@contextmanager
def db():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init():
    with db() as con:
        con.executescript(SCHEMA)
        cols = {r["name"] for r in con.execute("PRAGMA table_info(trades)")}
        for c in ("mfe", "mae"):  # databases created before excursion tracking
            if c not in cols:
                con.execute(f"ALTER TABLE trades ADD COLUMN {c} REAL")
        acols = {r["name"] for r in con.execute("PRAGMA table_info(accounts)")}
        if "terminal_path" not in acols:
            con.execute("ALTER TABLE accounts ADD COLUMN terminal_path TEXT")
        if "enabled" not in acols:
            con.execute("ALTER TABLE accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")


def track_floating(con: sqlite3.Connection, account_id: int, ticket: str, profit: float) -> None:
    """Remember the best/worst floating profit an open trade has shown."""
    con.execute(
        "UPDATE trades SET mfe = MAX(COALESCE(mfe, ?), ?), mae = MIN(COALESCE(mae, ?), ?) "
        "WHERE account_id=? AND ticket=? AND close_time IS NULL",
        (profit, profit, profit, profit, account_id, str(ticket)),
    )


def close_excursions(con: sqlite3.Connection, account_id: int, ticket: str) -> None:
    """When a tracked trade closes, its final result is also part of its range."""
    con.execute(
        "UPDATE trades SET mfe = MAX(mfe, profit), mae = MIN(mae, profit) "
        "WHERE account_id=? AND ticket=? AND close_time IS NOT NULL AND mfe IS NOT NULL",
        (account_id, str(ticket)),
    )


def now() -> int:
    return int(time.time())


TRADE_COLS = ("ticket", "symbol", "direction", "volume", "open_time", "open_price", "close_time", "close_price",
              "sl", "tp", "commission", "swap", "profit", "comment", "source")


def upsert_trades(con: sqlite3.Connection, account_id: int, trades: list[dict], source: str) -> tuple[int, int]:
    """Insert or update by (account, ticket). Returns (inserted, updated)."""
    inserted = updated = 0
    for t in trades:
        row = {c: t.get(c) for c in TRADE_COLS}
        row["ticket"] = str(row["ticket"])
        row["source"] = t.get("source") or source
        for c in ("commission", "swap", "profit"):
            row[c] = float(row[c] or 0)
        exists = con.execute("SELECT id FROM trades WHERE account_id=? AND ticket=?", (account_id, row["ticket"])).fetchone()
        if exists:
            sets = ", ".join(f"{c}=?" for c in TRADE_COLS if c != "ticket")
            con.execute(f"UPDATE trades SET {sets} WHERE id=?", [row[c] for c in TRADE_COLS if c != "ticket"] + [exists["id"]])
            updated += 1
        else:
            cols = ", ".join(("account_id",) + TRADE_COLS)
            marks = ", ".join("?" * (len(TRADE_COLS) + 1))
            con.execute(f"INSERT INTO trades ({cols}) VALUES ({marks})", [account_id] + [row[c] for c in TRADE_COLS])
            inserted += 1
    return inserted, updated
