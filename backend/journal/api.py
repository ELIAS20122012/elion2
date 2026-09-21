"""Journal API: accounts, trades, notes, imports. Local only.

    python -m uvicorn journal.api:app --port 8000
"""
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import bridge, db, parsers

@asynccontextmanager
async def lifespan(_app):
    db.init()
    stop = threading.Event()
    if not os.environ.get("JOURNAL_NO_BRIDGE"):  # tests drive the watcher by hand
        bridge.start(stop)
    yield
    stop.set()


app = FastAPI(title="Robot Trading — Journal API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    platform: Literal["mt4", "mt5", "other"] = "mt5"
    kind: Literal["manual", "robot", "backtest"] = "manual"
    broker: str | None = None
    login: str | None = None
    currency: str = "USD"
    is_live: bool = False
    initial_balance: float | None = None
    note: str | None = None
    terminal_path: str | None = None


class AccountPatch(BaseModel):
    terminal_path: str | None = None
    name: str | None = None
    platform: Literal["mt4", "mt5", "other"] | None = None
    kind: Literal["manual", "robot", "backtest"] | None = None
    broker: str | None = None
    login: str | None = None
    currency: str | None = None
    is_live: bool | None = None
    initial_balance: float | None = None
    note: str | None = None


class TradeIn(BaseModel):
    ticket: str
    symbol: str
    direction: Literal["buy", "sell"]
    volume: float
    open_time: int
    open_price: float
    close_time: int | None = None
    close_price: float | None = None
    sl: float | None = None
    tp: float | None = None
    commission: float = 0
    swap: float = 0
    profit: float = 0
    comment: str | None = None


class NotesIn(BaseModel):
    setup_valid: Literal["yes", "no", "unsure"] | None = None
    setup_id: str | None = None
    emotion: str | None = None
    error: str | None = None
    note: str | None = None


def _account(con, account_id: int):
    row = con.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(404, "حساب پیدا نشد")
    return row


def _account_dict(con, row) -> dict:
    d = dict(row)
    d["is_live"] = bool(d["is_live"])
    agg = con.execute("SELECT COUNT(*) n, MAX(COALESCE(close_time, open_time)) last FROM trades WHERE account_id=?", (row["id"],)).fetchone()
    d["trade_count"], d["last_trade_time"] = agg["n"], agg["last"]
    return d


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/accounts")
def list_accounts():
    with db.db() as con:
        return [_account_dict(con, r) for r in con.execute("SELECT * FROM accounts ORDER BY id")]


@app.post("/accounts", status_code=201)
def create_account(a: AccountIn):
    with db.db() as con:
        cur = con.execute(
            "INSERT INTO accounts (name, platform, kind, broker, login, currency, is_live, initial_balance, note, created_at, terminal_path) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (a.name.strip(), a.platform, a.kind, a.broker, (a.login or "").strip() or None, a.currency, int(a.is_live), a.initial_balance, a.note, db.now(),
             (a.terminal_path or "").strip() or None),
        )
        created = _account_dict(con, _account(con, cur.lastrowid))
    if a.platform == "mt5" and a.kind != "backtest":  # don't make the user wait for the next 10 s cycle
        threading.Thread(target=bridge.sync_mt5_once, kwargs={"wait": True}, name="journal-first-sync", daemon=True).start()
    return created


@app.patch("/accounts/{account_id}")
def patch_account(account_id: int, p: AccountPatch):
    with db.db() as con:
        _account(con, account_id)
        data = {k: v for k, v in p.model_dump(exclude_unset=True).items()}
        if "is_live" in data:
            data["is_live"] = int(data["is_live"])
        if data:
            con.execute(f"UPDATE accounts SET {', '.join(f'{k}=?' for k in data)} WHERE id=?", [*data.values(), account_id])
        return _account_dict(con, _account(con, account_id))


@app.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int):
    with db.db() as con:
        _account(con, account_id)
        con.execute("DELETE FROM accounts WHERE id=?", (account_id,))


def _trade_rows(con, account_id: int) -> list[dict]:
    rows = con.execute(
        """SELECT t.*, n.setup_valid, n.setup_id, n.emotion, n.error, n.note
           FROM trades t LEFT JOIN trade_notes n ON n.trade_id = t.id
           WHERE t.account_id=? ORDER BY t.open_time""",
        (account_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/accounts/{account_id}/trades")
def list_trades(account_id: int):
    with db.db() as con:
        _account(con, account_id)
        return _trade_rows(con, account_id)


@app.post("/accounts/{account_id}/trades")
def add_trades(account_id: int, trades: list[TradeIn], replace_source: str | None = None):
    """Bulk upsert by ticket (used by an EA, and by backtests). `replace_source` first clears that source's trades."""
    with db.db() as con:
        _account(con, account_id)
        if replace_source:
            con.execute("DELETE FROM trades WHERE account_id=? AND source=?", (account_id, replace_source))
        ins, upd = db.upsert_trades(con, account_id, [t.model_dump() for t in trades], "ea")
        return {"inserted": ins, "updated": upd}


@app.post("/accounts/{account_id}/import")
async def import_statement(account_id: int, file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > 30 * 1024 * 1024:
        raise HTTPException(413, "فایل خیلی بزرگ است")
    try:
        trades = parsers.parse_statement(raw, file.filename or "")
    except parsers.ImportError_ as e:
        raise HTTPException(422, str(e))
    with db.db() as con:
        _account(con, account_id)
        ins, upd = db.upsert_trades(con, account_id, trades, "import")
        return {"parsed": len(trades), "inserted": ins, "updated": upd}


@app.post("/accounts/{account_id}/sync-mt5")
def sync_mt5(account_id: int, days: int = 365):
    from . import mt5sync  # imported lazily so the API still runs without MetaTrader5 installed

    with db.db() as con:
        acc = _account(con, account_id)
        if acc["platform"] != "mt5":
            raise HTTPException(400, "همگام‌سازی مستقیم فقط برای MT5 است. برای MT4 فایل Statement را وارد کنید.")
        try:
            trades, _info = mt5sync.fetch(acc["login"], days, acc["terminal_path"])
        except mt5sync.SyncError as e:
            raise HTTPException(409, str(e))
        ins, upd = db.upsert_trades(con, account_id, trades, "mt5-sync")
        return {"fetched": len(trades), "inserted": ins, "updated": upd}


@app.get("/detected")
def detected():
    """MT4 accounts reported by the indicator that are not in the journal yet (so the UI can offer to add them)."""
    return bridge.detected()


@app.get("/accounts/{account_id}/live")
def account_live(account_id: int):
    with db.db() as con:
        acc = _account(con, account_id)
        st = bridge.live_status(acc["platform"], acc["login"])
        if "floating" not in st or st.get("floating") is None:
            row = con.execute("SELECT COUNT(*) n, COALESCE(SUM(profit), 0) p FROM trades WHERE account_id=? AND close_time IS NULL", (account_id,)).fetchone()
            st.update({"floating": round(row["p"], 2), "open_count": row["n"]})
        return st


@app.get("/mt5/terminals")
def mt5_terminals():
    """MT5 installations on this PC, so the user can pick which terminal an account is read from."""
    from . import mt5sync

    return mt5sync.find_terminals()


@app.get("/bridge/info")
def bridge_info():
    files = sorted(n for n in os.listdir(bridge.COMMON_DIR) if bridge.FILE_RE.match(n)) if os.path.isdir(bridge.COMMON_DIR) else []
    indicator = Path(__file__).resolve().parents[2] / "mt4" / "JournalBridge.mq4"
    return {"common_dir": bridge.COMMON_DIR, "exists": os.path.isdir(bridge.COMMON_DIR), "files": files,
            "indicator_path": str(indicator), "indicator_exists": indicator.exists()}


@app.put("/trades/{trade_id}/notes")
def put_notes(trade_id: int, n: NotesIn):
    with db.db() as con:
        if not con.execute("SELECT 1 FROM trades WHERE id=?", (trade_id,)).fetchone():
            raise HTTPException(404, "معامله پیدا نشد")
        con.execute(
            """INSERT INTO trade_notes (trade_id, setup_valid, setup_id, emotion, error, note, updated_at) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(trade_id) DO UPDATE SET setup_valid=excluded.setup_valid, setup_id=excluded.setup_id,
               emotion=excluded.emotion, error=excluded.error, note=excluded.note, updated_at=excluded.updated_at""",
            (trade_id, n.setup_valid, n.setup_id, n.emotion, n.error, n.note, db.now()),
        )
        return {"ok": True}


class RuleLabelIn(BaseModel):
    rule: str = Field(min_length=1, max_length=60)
    key: str = Field(min_length=1, max_length=200)
    label: Literal["ok", "bad"]
    features: dict | None = None


@app.get("/rule-labels/{rule}")
def list_rule_labels(rule: str):
    import json
    with db.db() as con:
        rows = con.execute("SELECT key, label, features, updated_at FROM rule_labels WHERE rule=? ORDER BY updated_at", (rule,)).fetchall()
        return [{"key": r["key"], "label": r["label"], "features": json.loads(r["features"]) if r["features"] else None, "updated_at": r["updated_at"]} for r in rows]


@app.post("/rule-labels")
def put_rule_label(b: RuleLabelIn):
    import json
    with db.db() as con:
        con.execute(
            """INSERT INTO rule_labels (rule, key, label, features, updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(rule, key) DO UPDATE SET label=excluded.label, features=excluded.features, updated_at=excluded.updated_at""",
            (b.rule, b.key, b.label, json.dumps(b.features) if b.features is not None else None, db.now()),
        )
        return {"ok": True}


@app.delete("/rule-labels/{rule}", status_code=204)
def delete_rule_label(rule: str, key: str):
    with db.db() as con:
        con.execute("DELETE FROM rule_labels WHERE rule=? AND key=?", (rule, key))


@app.delete("/accounts/{account_id}/trades", status_code=204)
def clear_trades(account_id: int, source: str | None = None):
    with db.db() as con:
        _account(con, account_id)
        if source:
            con.execute("DELETE FROM trades WHERE account_id=? AND source=?", (account_id, source))
        else:
            con.execute("DELETE FROM trades WHERE account_id=?", (account_id,))


class SnapshotIn(BaseModel):
    time: int
    balance: float | None = None
    equity: float | None = None


@app.post("/accounts/{account_id}/snapshots")
def add_snapshots(account_id: int, snaps: list[SnapshotIn]):
    with db.db() as con:
        _account(con, account_id)
        con.executemany(
            "INSERT OR REPLACE INTO snapshots (account_id, time, balance, equity) VALUES (?,?,?,?)",
            [(account_id, s.time, s.balance, s.equity) for s in snaps],
        )
        return {"stored": len(snaps)}


@app.get("/accounts/{account_id}/snapshots")
def get_snapshots(account_id: int):
    with db.db() as con:
        _account(con, account_id)
        return [dict(r) for r in con.execute("SELECT time, balance, equity FROM snapshots WHERE account_id=? ORDER BY time", (account_id,))]
