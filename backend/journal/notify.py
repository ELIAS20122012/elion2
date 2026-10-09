"""Telegram alerts for MT4 trading events, sent through the Elias OS bot.

The bot token and the owner's chat id are read at send time from Elias OS itself
(config/secrets.json → telegram.botToken, data/elias.db → kv 'telegram.owner_chat_id'),
so nothing secret is copied into this project. No token or no paired chat = silently off.
Messages go out on a background thread: a slow Telegram never delays the EA's request.
"""
import json
import os
import sqlite3
import threading
import urllib.parse
import urllib.request

from . import db

ELIAS_HOME = os.environ.get("ELIAS_HOME", r"C:\Elion\elias-os")

SCHEMA = """
CREATE TABLE IF NOT EXISTS notify_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    opens INTEGER NOT NULL DEFAULT 1,       -- new position (dashboard, MT4 or a pending order that filled)
    closes INTEGER NOT NULL DEFAULT 1,      -- position closed, with SL/TP hit and P&L
    orders INTEGER NOT NULL DEFAULT 1       -- dashboard orders: SL/TP changes, pending placed/cancelled, failures
);
INSERT OR IGNORE INTO notify_settings (id) VALUES (1);
"""

KINDS = ("enabled", "opens", "closes", "orders")


def init() -> None:
    with db.db() as con:
        con.executescript(SCHEMA)


def settings() -> dict:
    with db.db() as con:
        r = con.execute("SELECT enabled, opens, closes, orders FROM notify_settings WHERE id=1").fetchone()
    return {k: bool(r[k]) for k in KINDS} if r else {k: True for k in KINDS}


def save_settings(patch: dict) -> dict:
    sets = {k: int(bool(v)) for k, v in patch.items() if k in KINDS}
    if sets:
        with db.db() as con:
            con.execute(f"UPDATE notify_settings SET {', '.join(f'{k}=?' for k in sets)} WHERE id=1", list(sets.values()))
    return settings()


def _credentials() -> tuple[str, str] | None:
    token = os.environ.get("ELIAS_TELEGRAM_TOKEN", "").strip()
    try:
        if not token:
            with open(os.path.join(ELIAS_HOME, "config", "secrets.json"), encoding="utf-8") as f:
                token = (json.load(f).get("telegram") or {}).get("botToken", "").strip()
        con = sqlite3.connect(f"file:{os.path.join(ELIAS_HOME, 'data', 'elias.db')}?mode=ro", uri=True, timeout=2)
        try:
            r = con.execute("SELECT value FROM kv WHERE key='telegram.owner_chat_id'").fetchone()
        finally:
            con.close()
    except (OSError, ValueError, sqlite3.Error):
        return None
    return (token, r[0]) if token and r and r[0] else None


def status() -> dict:
    return {"configured": _credentials() is not None, **settings()}


def _post(text: str) -> bool:
    cred = _credentials()
    if not cred:
        return False
    token, chat = cred
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=10) as r:
            return r.status == 200
    except OSError:
        return False


def send(kind: str, text: str) -> None:
    """Fire-and-forget; respects the on/off switches. Disabled in tests (JOURNAL_NO_NOTIFY=1)."""
    if os.environ.get("JOURNAL_NO_NOTIFY") == "1":
        return
    s = settings()
    if not s["enabled"] or not s.get(kind, True):
        return
    threading.Thread(target=_post, args=(text,), name="journal-notify", daemon=True).start()


def test() -> bool:
    return _post("🔔 ELION: Telegram alerts are connected.")


def _acc(account_id: int) -> str:
    with db.db() as con:
        r = con.execute("SELECT name, login FROM accounts WHERE id=?", (account_id,)).fetchone()
    return f"{r['name']} ({r['login']})" if r and r["login"] else (r["name"] if r else f"#{account_id}")


def _p(v) -> str:
    return "—" if v is None else f"{float(v):.2f}"


def position_opened(account_id: int, t: dict) -> None:
    side = "🟢 BUY" if t["direction"] == "buy" else "🔴 SELL"
    send("opens", f"{side} {t['volume']:.2f} {t['symbol']} @ {_p(t['open_price'])}\n"
                  f"SL {_p(t.get('sl'))} · TP {_p(t.get('tp'))}\n#{t['ticket']} · {_acc(account_id)}")


def position_closed(account_id: int, t: dict) -> None:
    net = float(t.get("profit") or 0) + float(t.get("commission") or 0) + float(t.get("swap") or 0)
    cp, price = t.get("close_price"), float(t.get("open_price") or 0)
    tol = max(0.05, price * 0.0002)
    why = "Closed"
    if cp is not None and t.get("sl") and abs(cp - t["sl"]) <= tol:
        why = "🛑 Stop Loss hit"
    elif cp is not None and t.get("tp") and abs(cp - t["tp"]) <= tol:
        why = "🎯 Take Profit hit"
    send("closes", f"{why} — {t['direction'].upper()} {t['volume']:.2f} {t['symbol']}\n"
                   f"{_p(t['open_price'])} → {_p(cp)} · {'+' if net >= 0 else ''}{net:.2f}\n#{t['ticket']} · {_acc(account_id)}")


def order_done(account_id: int, o: dict, ok: bool, ticket: str | None, price: float | None, error: str | None) -> None:
    d = o["direction"]
    if not ok:
        send("orders", f"❌ {d.replace('_', ' ').upper()} {o['symbol']} failed in MT4: {error or 'rejected'}\n{_acc(account_id)}")
        return
    if d in ("buy", "sell", "close"):
        return  # the position open/close alert carries these, with prices and P&L
    if d == "modify":
        send("orders", f"✏️ #{o['target']} SL {_p(o['sl'])} · TP {_p(o['tp'])} set in MT4")
    elif d == "cancel":
        send("orders", f"🗑 Pending order #{o['target']} cancelled")
    else:
        send("orders", f"⏳ {d.replace('_', ' ').upper()} {o['volume']:.2f} {o['symbol']} @ {_p(o['entry'])} placed\n"
                       f"SL {_p(o['sl'])} · TP {_p(o['tp'])} · #{ticket}")
