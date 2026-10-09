"""Price alerts: a line on the chart; when the bid crosses it, Telegram says so (once).

Checked on every EA pulse (/events/positions, every 2 s) against the quotes of all Market Watch symbols,
so they fire with no browser open.
"""
import time

from pydantic import BaseModel, Field

from . import db, notify

SCHEMA = """
CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    direction TEXT NOT NULL,                  -- above: fires when bid >= price · below: when bid <= price
    note TEXT,
    created_at REAL NOT NULL,
    triggered_at REAL,
    triggered_price REAL
);
"""


def init() -> None:
    with db.db() as con:
        con.executescript(SCHEMA)


class AlertIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)
    price: float = Field(gt=0)
    current: float | None = Field(default=None, gt=0)   # the price when it was set → decides above/below
    note: str | None = Field(default=None, max_length=200)


class AlertMove(BaseModel):
    price: float = Field(gt=0)
    current: float | None = Field(default=None, gt=0)


def _direction(price: float, current: float | None) -> str:
    return "below" if current is not None and price < current else "above"


def create(a: AlertIn) -> dict:
    with db.db() as con:
        aid = con.execute("INSERT INTO price_alerts (symbol, price, direction, note, created_at) VALUES (?,?,?,?,?)",
                          (a.symbol, a.price, _direction(a.price, a.current), a.note, time.time())).lastrowid
    return get(aid)


def get(aid: int) -> dict | None:
    with db.db() as con:
        r = con.execute("SELECT * FROM price_alerts WHERE id=?", (aid,)).fetchone()
    return dict(r) if r else None


def move(aid: int, m: AlertMove) -> dict | None:
    """Dragging an alert re-arms it."""
    with db.db() as con:
        con.execute("UPDATE price_alerts SET price=?, direction=?, triggered_at=NULL, triggered_price=NULL WHERE id=?",
                    (m.price, _direction(m.price, m.current), aid))
    return get(aid)


def delete(aid: int) -> None:
    with db.db() as con:
        con.execute("DELETE FROM price_alerts WHERE id=?", (aid,))


def listing(symbol: str | None = None) -> list[dict]:
    """Active alerts plus those that fired in the last 24 h."""
    q = "SELECT * FROM price_alerts WHERE (triggered_at IS NULL OR triggered_at > ?)"
    args: list = [time.time() - 86400]
    if symbol:
        q += " AND symbol=?"
        args.append(symbol)
    with db.db() as con:
        return [dict(r) for r in con.execute(q + " ORDER BY triggered_at IS NOT NULL, price DESC", args)]


def check(quotes: list) -> list[int]:
    """Fires every armed alert the bids have reached. Returns the ids that fired."""
    bids = {q.symbol: q.bid for q in quotes}
    if not bids:
        return []
    fired = []
    with db.db() as con:
        rows = con.execute(f"SELECT * FROM price_alerts WHERE triggered_at IS NULL AND symbol IN ({','.join('?' * len(bids))})",
                           list(bids)).fetchall()
        for r in rows:
            bid = bids[r["symbol"]]
            if (r["direction"] == "above" and bid >= r["price"]) or (r["direction"] == "below" and bid <= r["price"]):
                con.execute("UPDATE price_alerts SET triggered_at=?, triggered_price=? WHERE id=? AND triggered_at IS NULL",
                            (time.time(), bid, r["id"]))
                fired.append(dict(r) | {"bid": bid})
    for r in fired:
        arrow = "⬆️" if r["direction"] == "above" else "⬇️"
        note = f"\n{r['note']}" if r.get("note") else ""
        notify.send("alerts", f"🔔 {r['symbol']} {arrow} {r['price']:g}\nPrice now {r['bid']:g}{note}")
    return [r["id"] for r in fired]
