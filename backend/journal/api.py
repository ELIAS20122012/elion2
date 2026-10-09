"""Journal API: accounts, trades, notes, imports. Local only.

    python -m uvicorn journal.api:app --port 8000
"""
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import ai, alerts, auth, bridge, db, engine, notify, parsers, robot, setups, signals

@asynccontextmanager
async def lifespan(_app):
    db.init()
    signals.init()
    robot.init()
    notify.init()
    alerts.init()
    setups.init()
    stop = threading.Event()
    if not os.environ.get("JOURNAL_NO_BRIDGE"):  # tests drive the watcher by hand
        engine.boot()  # MT engine starts OFF: no terminal is launched until Start is pressed on the Connection page
        bridge.start(stop)
    yield
    stop.set()


app = FastAPI(title="Robot Trading — Journal API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

#: reachable without a session - everything else needs one once the first user exists.
#: /auth/logout is here because it only ends the caller's own session, and a read-only account
#: would otherwise be unable to sign out of the app at all.
OPEN_PATHS = {"/health", "/auth/login", "/auth/logout", "/auth/me"}


def _token(request: Request) -> str | None:
    """The session cookie, or a bearer token for callers that cannot hold cookies."""
    cookie = request.cookies.get(auth.COOKIE)
    if cookie:
        return cookie
    header = request.headers.get("authorization", "")
    return header[7:] if header.lower().startswith("bearer ") else None


@app.middleware("http")
async def require_session(request: Request, call_next):
    """The gate. Authorisation lives here, in the server - not in the browser, where it would be decor."""
    if request.method == "OPTIONS":  # CORS preflight carries no credentials
        return await call_next(request)

    path = request.url.path
    if path.startswith("/events/"):  # the robot EA: authenticated by its own per-account API key, not a session
        request.state.robot_account = robot.account_for(request.headers.get("x-api-key"))
        if request.state.robot_account is None:
            return JSONResponse({"detail": "Invalid or missing X-API-Key."}, status_code=401)
        return await call_next(request)
    with db.db() as con:
        if auth.setup_mode(con):  # no accounts yet: refusing everyone would lock the owner out too
            request.state.user = None
            return await call_next(request)
        user = auth.session_user(con, _token(request))

    request.state.user = user
    if path in OPEN_PATHS:
        return await call_next(request)
    if user is None:
        return JSONResponse({"detail": "برای ادامه باید وارد شوید."}, status_code=401)
    if user["role"] != "admin" and (request.method != "GET" or path.endswith(("/order", "/modify", "/close", "/cancel"))):
        return JSONResponse({"detail": "این حساب فقط اجازه‌ی مشاهده دارد."}, status_code=403)
    return await call_next(request)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = True


class UserIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    role: Literal["admin", "viewer"] = "viewer"


class UserPatch(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=200)
    disabled: bool | None = None


def _admin(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(401, "برای ادامه باید وارد شوید.")
    if user["role"] != "admin":
        raise HTTPException(403, "فقط ادمین می‌تواند کاربرها را مدیریت کند.")
    return user


@app.post("/auth/login")
def auth_login(body: LoginIn, request: Request, response: Response):
    with db.db() as con:
        got = auth.login(con, body.username, body.password, body.remember)
    if got is None:
        raise HTTPException(401, "نام کاربری یا رمز درست نیست.")
    token, user, ttl = got
    # Secure only when the browser really is on https - the tunnel terminates TLS, so ask it.
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    # No max_age: a session cookie, so the browser forgets it on close and the next visit starts at the welcome screen.
    response.set_cookie(auth.COOKIE, token, httponly=True, samesite="lax", secure=https, path="/")
    return {"user": user, "token": token}


@app.post("/auth/logout")
def auth_logout(request: Request, response: Response):
    with db.db() as con:
        auth.logout(con, _token(request))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@app.get("/auth/me")
def auth_me(request: Request):
    """Who am I. `setup` means no account exists yet, so the API is still open."""
    with db.db() as con:
        return {"user": getattr(request.state, "user", None), "setup": auth.setup_mode(con)}


@app.get("/auth/users")
def auth_users(request: Request):
    _admin(request)
    with db.db() as con:
        return auth.list_users(con)


@app.post("/auth/users", status_code=201)
def auth_create_user(body: UserIn, request: Request):
    _admin(request)
    with db.db() as con:
        try:
            return auth.create_user(con, body.username, body.password, body.role)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None


@app.patch("/auth/users/{user_id}")
def auth_patch_user(user_id: int, body: UserPatch, request: Request):
    me = _admin(request)
    with db.db() as con:
        row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "کاربر پیدا نشد")
        try:
            if body.password is not None:
                auth.set_password(con, row["username"], body.password)
            if body.disabled is not None:
                if body.disabled and row["id"] == me["id"]:
                    raise HTTPException(400, "نمی‌توانید حساب خودتان را غیرفعال کنید.")
                auth.set_disabled(con, row["username"], body.disabled)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        return auth.user_dict(con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())


@app.delete("/auth/users/{user_id}", status_code=204)
def auth_delete_user(user_id: int, request: Request):
    me = _admin(request)
    if user_id == me["id"]:
        raise HTTPException(400, "نمی‌توانید حساب خودتان را حذف کنید.")
    with db.db() as con:
        if not con.execute("DELETE FROM users WHERE id=?", (user_id,)).rowcount:
            raise HTTPException(404, "کاربر پیدا نشد")


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
    enabled: bool = True


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
    enabled: bool | None = None


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


class OrderIn(BaseModel):
    symbol: str = Field(min_length=1)
    direction: Literal["buy", "sell"]
    order_type: Literal["market", "limit", "stop"] = "market"
    price: float | None = None
    volume: float
    sl: float | None = None
    tp: float | None = None
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
    d["enabled"] = bool(d["enabled"])
    agg = con.execute("SELECT COUNT(*) n, MAX(COALESCE(close_time, open_time)) last FROM trades WHERE account_id=?", (row["id"],)).fetchone()
    d["trade_count"], d["last_trade_time"] = agg["n"], agg["last"]
    return d


@app.get("/health")
def health():
    return {"ok": True}


_NEWS_URLS = ("https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json")
_NEWS_TTL = 600  # the free feed rate-limits, so never ask more than once per 10 minutes
_news_cache: dict = {"at": 0.0, "events": [], "error": None}
_news_lock = threading.Lock()


def _fetch_news() -> list[dict]:
    import json
    import time
    import urllib.request
    from datetime import datetime

    events: list[dict] = []
    ok = 0
    for url in _NEWS_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 robot-trading"})
            with urllib.request.urlopen(req, timeout=12) as r:
                rows = json.loads(r.read().decode("utf-8"))
            ok += 1
        except Exception:
            continue  # next week's file often doesn't exist until the weekend
        for e in rows:
            try:
                t = int(datetime.fromisoformat(e["date"]).timestamp())
            except Exception:
                continue
            events.append({"time": t, "title": e.get("title", ""), "country": e.get("country", ""), "impact": e.get("impact", ""),
                           "forecast": e.get("forecast") or None, "previous": e.get("previous") or None, "actual": e.get("actual") or None})
    if ok == 0:
        raise RuntimeError("economic calendar feed unreachable")
    events.sort(key=lambda x: x["time"])
    return events


@app.get("/news")
def news():
    """Economic calendar (Forex Factory public feed): this week + next week, cached for 10 minutes."""
    import time

    with _news_lock:
        if time.time() - _news_cache["at"] > _NEWS_TTL:
            try:
                _news_cache["events"] = _fetch_news()
                _news_cache["error"] = None
            except Exception as e:
                _news_cache["error"] = str(e)
            _news_cache["at"] = time.time()  # also after a failure: don't hammer a feed that just refused us
        if not _news_cache["events"]:
            raise HTTPException(502, "خبر اقتصادی در دسترس نیست: " + (_news_cache["error"] or "feed empty"))
        return {"events": _news_cache["events"], "fetched_at": int(_news_cache["at"]), "stale": _news_cache["error"] is not None}


@app.get("/accounts/{account_id}/candles")
def account_candles(account_id: int, tf: int = 300, count: int = 5000, symbol: str = "XAUUSD"):
    """Real broker history for backtesting, read from this MT5 account's terminal."""
    from . import mt5sync

    count = max(50, min(count, 50000))
    with db.db() as con:
        acc = _account(con, account_id)
    if acc["platform"] != "mt5":
        raise HTTPException(400, "تاریخچه‌ی کندل فقط از حساب‌های MT5 خوانده می‌شود.")
    if not acc["enabled"]:
        raise HTTPException(409, "این حساب Disconnect شده — اول از صفحه‌ی Connection وصلش کنید.")
    try:
        rows = mt5sync.fetch_candles(acc["login"], acc["terminal_path"], symbol, tf, count)
    except mt5sync.SyncError as e:
        raise HTTPException(409, str(e))
    return {"symbol": symbol, "tf": tf, "candles": rows}


@app.get("/engine")
def engine_status():
    return engine.status()


@app.post("/engine/{platform}/start")
def engine_start(platform: Literal["mt4", "mt5"]):
    return engine.start(platform)


@app.post("/engine/{platform}/stop")
def engine_stop(platform: Literal["mt4", "mt5"], close: bool = True):
    """Switch a platform off; close=true also closes its terminal windows (a normal close, never a force-kill)."""
    return engine.stop(platform, close)


@app.post("/backup")
def backup(daily: bool = False):
    """Copies journal.db into a backups/ folder next to it (SQLite online backup, safe while running).
    daily=true is idempotent per calendar day, so the dashboard can call it on every load."""
    import sqlite3
    from datetime import datetime

    folder = Path(db.DB_PATH).parent / "backups"
    folder.mkdir(exist_ok=True)
    now = datetime.now()
    target = folder / (f"journal-{now:%Y-%m-%d}.db" if daily else f"journal-{now:%Y-%m-%d_%H%M%S}.db")
    if daily and target.exists():
        return {"file": target.name, "size": target.stat().st_size, "skipped": True}
    src = sqlite3.connect(db.DB_PATH, timeout=15)
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    for old in sorted(folder.glob("journal-*.db"))[:-30]:  # keep the newest 30
        old.unlink(missing_ok=True)
    return {"file": target.name, "size": target.stat().st_size, "skipped": False}


@app.get("/accounts")
def list_accounts():
    with db.db() as con:
        return [_account_dict(con, r) for r in con.execute("SELECT * FROM accounts ORDER BY id")]


@app.post("/accounts", status_code=201)
def create_account(a: AccountIn):
    with db.db() as con:
        cur = con.execute(
            "INSERT INTO accounts (name, platform, kind, broker, login, currency, is_live, initial_balance, note, created_at, terminal_path, enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (a.name.strip(), a.platform, a.kind, a.broker, (a.login or "").strip() or None, a.currency, int(a.is_live), a.initial_balance, a.note, db.now(),
             (a.terminal_path or "").strip() or None, int(a.enabled)),
        )
        created = _account_dict(con, _account(con, cur.lastrowid))
    if a.platform == "mt5" and a.kind != "backtest":  # don't make the user wait for the next 10 s cycle
        threading.Thread(target=bridge.sync_mt5_once, kwargs={"wait": True}, name="journal-first-sync", daemon=True).start()
    return created


@app.patch("/accounts/{account_id}")
def patch_account(account_id: int, p: AccountPatch):
    with db.db() as con:
        before = _account(con, account_id)
        data = {k: v for k, v in p.model_dump(exclude_unset=True).items()}
        if "is_live" in data:
            data["is_live"] = int(data["is_live"])
        reconnecting = data.get("enabled") is True and not before["enabled"]
        if "enabled" in data:
            data["enabled"] = int(data["enabled"])
        if data:
            con.execute(f"UPDATE accounts SET {', '.join(f'{k}=?' for k in data)} WHERE id=?", [*data.values(), account_id])
        updated = _account_dict(con, _account(con, account_id))
    if reconnecting and updated["platform"] == "mt5" and updated["kind"] != "backtest":  # reconnect feels instant, not "wait up to 10s"
        threading.Thread(target=bridge.sync_mt5_once, kwargs={"wait": True}, name="journal-reconnect-sync", daemon=True).start()
    return updated


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


@app.post("/accounts/{account_id}/order")
def place_order(account_id: int, o: OrderIn):
    """Sends a real market order to this account's MT5 terminal. Not read-only, no confirmation step,
    no size/SL limit here - the Trade page's Place Order button calls this directly."""
    with db.db() as con:
        acc = _account(con, account_id)
        if not acc["enabled"]:
            raise HTTPException(409, "این حساب Disconnect شده — اول از صفحه‌ی Connection وصلش کنید.")
        if acc["platform"] == "mt4":  # executed by RobotTradingEA in MT4
            try:
                return robot.place(account_id, o.symbol, o.direction, o.volume, o.sl, o.tp, o.comment, order_type=o.order_type, price=o.price)
            except robot.OrderFailed as e:
                raise HTTPException(409, str(e))
        if acc["platform"] != "mt5":
            raise HTTPException(400, "ارسال سفارش فقط برای حساب‌های MT4 و MT5 در دسترس است.")
        if o.order_type != "market":
            raise HTTPException(400, "Limit/Stop orders are only available on MT4 accounts.")
        from . import mt5sync
        try:
            result = mt5sync.send_order(acc["login"], acc["terminal_path"], o.symbol, o.direction, o.volume, o.sl, o.tp, o.comment)
        except mt5sync.OrderError as e:
            raise HTTPException(409, str(e))
    # pull the new position into the journal right away instead of waiting for the next ~10s auto-sync
    threading.Thread(target=bridge.sync_mt5_once, kwargs={"wait": True}, name="journal-order-sync", daemon=True).start()
    return result


@app.get("/detected")
def detected():
    """MT4 accounts reported by the indicator that are not in the journal yet (so the UI can offer to add them)."""
    return bridge.detected()


@app.get("/accounts/{account_id}/live")
def account_live(account_id: int):
    with db.db() as con:
        acc = _account(con, account_id)
        if not acc["enabled"]:
            return {"source": None, "connected": False, "disabled": True}
        st = bridge.live_status(acc["platform"], acc["login"])
        if not st.get("connected"):  # the robot EA reports on its own, even with the MT4 switch off
            st = robot.live(account_id) or st
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


# ---- AI Lab (read-only analysis; see journal/ai.py) ----

@app.get("/ai/providers")
def ai_providers():
    """Which AI providers exist and whether their key is set on this PC. Never returns a key."""
    return ai.providers_status()


@app.post("/ai/analyze")
def ai_analyze(b: ai.AnalyzeIn):
    """Analyse only the data the user shared in AI Lab. Cannot place, modify or close trades."""
    try:
        return ai.analyze(b)
    except ai.AIError as e:
        raise HTTPException(e.status, ai.scrub(e.message))


# ---- robot signal queue (detector -> AI review -> human decision -> measured outcome; never trades) ----

def _signal_or_404(signal_id: int) -> dict:
    s = signals.get(signal_id)
    if not s:
        raise HTTPException(404, "Signal not found")
    return s


@app.post("/signals")
def create_signal(b: signals.SignalIn):
    """Stores a setup the dashboard's detector found. With `provider`, the AI review starts in the background."""
    try:
        s, created = signals.create(b)
        if created and b.provider:
            signals.review_in_background(s["id"], b.provider)
            s = signals.get(s["id"])
    except ai.AIError as e:
        raise HTTPException(e.status, ai.scrub(e.message))
    return {"signal": s, "created": created}


@app.get("/signals")
def list_signals(account_id: int | None = None, limit: int = 100):
    return signals.listing(account_id, limit)


@app.get("/signals/stats")
def signal_stats(account_id: int | None = None):
    return signals.stats(account_id)


@app.get("/signals/{signal_id}/chart.png")
def signal_chart(signal_id: int):
    from fastapi import Response

    png = signals.chart_png(signal_id)
    if png is None:
        raise HTTPException(404, "Signal not found")
    return Response(png, media_type="image/png")


@app.post("/signals/{signal_id}/review")
def review_signal(signal_id: int, b: signals.ReviewIn):
    _signal_or_404(signal_id)
    try:
        signals.review_in_background(signal_id, b.provider)
    except ai.AIError as e:
        raise HTTPException(e.status, ai.scrub(e.message))
    return signals.get(signal_id)


@app.post("/signals/{signal_id}/decision")
def decide_signal(signal_id: int, b: signals.DecisionIn):
    """Records Elias's decision on a signal. Only a record: no order is sent from here."""
    _signal_or_404(signal_id)
    return signals.decide(signal_id, b.decision)


@app.post("/signals/outcomes")
def signal_outcomes(b: signals.OutcomesIn):
    return signals.update_outcomes(b)


# --- Robot EA (RobotTradingEA MT4/MT5) ---------------------------------------------------------

@app.post("/accounts/{account_id}/robot-key")
def robot_key(account_id: int):
    """New API key for the EA on this account (shown once; the old key stops working). Admin-only via the gate."""
    with db.db() as con:
        if not con.execute("SELECT 1 FROM accounts WHERE id=?", (account_id,)).fetchone():
            raise HTTPException(404, "Account not found.")
    return {"api_key": robot.new_key(account_id)}


@app.get("/robot/status")
def robot_status():
    return robot.status()


@app.exception_handler(robot.WrongAccount)
async def _wrong_account(_request: Request, exc: robot.WrongAccount):
    return JSONResponse({"detail": str(exc)}, status_code=409)


@app.post("/events/heartbeat")
def ev_heartbeat(body: robot.HeartbeatIn, request: Request):
    return robot.heartbeat(request.state.robot_account, body)


@app.post("/events/snapshot")
def ev_snapshot(body: robot.SnapshotIn, request: Request):
    return robot.snapshot(request.state.robot_account, body)


@app.post("/events/trade")
def ev_trade(body: robot.TradeIn, request: Request):
    try:
        return robot.trade(request.state.robot_account, body)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/events/orders/next")
def ev_order_next(request: Request):
    return {"order": robot.next_order(request.state.robot_account)}


@app.post("/events/orders/{order_id}/result")
def ev_order_result(order_id: int, body: robot.OrderResultIn, request: Request):
    return robot.order_result(request.state.robot_account, order_id, body)


class ModifyIn(BaseModel):
    sl: float | None = None
    tp: float | None = None


def _mt4(account_id: int) -> None:
    with db.db() as con:
        acc = _account(con, account_id)
    if acc["platform"] != "mt4" or not acc["enabled"]:
        raise HTTPException(400, "Only for connected MT4 accounts.")


@app.get("/accounts/{account_id}/positions")
def account_positions(account_id: int):
    """Open positions with live profit, refreshed by the EA every 2 seconds."""
    return robot.positions(account_id)


@app.post("/accounts/{account_id}/positions/{ticket}/modify")
def modify_position(account_id: int, ticket: str, b: ModifyIn):
    _mt4(account_id)
    try:
        return robot.modify(account_id, ticket, b.sl, b.tp)
    except robot.OrderFailed as e:
        raise HTTPException(409, str(e))


@app.post("/accounts/{account_id}/positions/{ticket}/close")
def close_position(account_id: int, ticket: str):
    _mt4(account_id)
    try:
        return robot.close(account_id, ticket)
    except robot.OrderFailed as e:
        raise HTTPException(409, str(e))


@app.post("/accounts/{account_id}/positions/{ticket}/cancel")
def cancel_order(account_id: int, ticket: str):
    _mt4(account_id)
    try:
        return robot.cancel(account_id, ticket)
    except robot.OrderFailed as e:
        raise HTTPException(409, str(e))


@app.get("/alerts")
def alerts_list(symbol: str | None = None):
    return alerts.listing(symbol)


@app.post("/alerts", status_code=201)
def alerts_create(a: alerts.AlertIn):
    return alerts.create(a)


@app.put("/alerts/{aid}")
def alerts_move(aid: int, m: alerts.AlertMove):
    r = alerts.move(aid, m)
    if not r:
        raise HTTPException(404, "No such alert.")
    return r


@app.get("/setups")
def setups_list(symbol: str | None = None, limit: int = 50):
    """Level Continuation suggestions the robot found (never orders)."""
    return setups.listing(symbol, limit)


@app.get("/setups/settings")
def setups_settings():
    return setups.settings()


@app.put("/setups/settings")
def setups_save(b: setups.SettingsIn):
    return setups.save_settings(b)


class SetupStatusIn(BaseModel):
    status: str = Field(pattern="^(new|taken|dismissed)$")


@app.post("/setups/{sid}/status")
def setups_status(sid: int, b: SetupStatusIn):
    r = setups.set_status(sid, b.status)
    if not r:
        raise HTTPException(404, "No such setup.")
    return r


@app.get("/setups/backtest")
def setups_backtest(symbol: str = "XAUUSD", count: int = 20000):
    return setups.backtest(symbol, None, max(500, min(count, 20000)))


@app.delete("/alerts/{aid}", status_code=204)
def alerts_delete(aid: int):
    alerts.delete(aid)


class NotifyIn(BaseModel):
    alerts: bool | None = None
    enabled: bool | None = None
    opens: bool | None = None
    closes: bool | None = None
    orders: bool | None = None
    setups: bool | None = None


@app.get("/notify/settings")
def notify_settings():
    """Telegram trade alerts (sent through the Elias OS bot): on/off switches + whether the bot is reachable."""
    return notify.status()


@app.put("/notify/settings")
def notify_save(b: NotifyIn):
    notify.save_settings({k: v for k, v in b.model_dump().items() if v is not None})
    return notify.status()


@app.post("/notify/test")
def notify_test():
    if not notify.test():
        raise HTTPException(409, "Telegram is not reachable — is the Elias OS bot set up and paired (/start in Telegram)?")
    return {"ok": True}


@app.post("/events/positions")
def ev_positions(body: robot.PositionsIn, request: Request):
    return robot.save_positions(request.state.robot_account, body)


@app.post("/events/candles")
def ev_candles(body: robot.CandlesIn, request: Request):
    return robot.save_candles(request.state.robot_account, body)


@app.get("/robot/candles")
def robot_candles(symbol: str = "XAUUSD", count: int = 3000, since: int | None = None):
    """M1 bars from the MT4 robot EA, for the dashboard chart."""
    robot.want(symbol)  # the EA starts streaming this symbol's bars if it isn't its own chart symbol
    return {"symbol": symbol, "candles": robot.candles(symbol, count, since)}


@app.post("/events/signal-evaluate")
def ev_signal(request: Request):
    """Order execution is disabled until the rules are rebuilt and confirmed: never a signal."""
    with db.db() as con:
        robot._touch(con, request.state.robot_account, "signal-evaluate")
    return robot.NO_SIGNAL
