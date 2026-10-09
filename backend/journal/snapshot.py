"""Read-only mirror of the journal, so the dashboard stays viewable when this PC is off.

    python -m journal.snapshot [OUT_FILE]

Builds one JSON file with everything the dashboard needs in order to *display* the
journal: accounts, trades (with their notes), equity snapshots and rule labels.
Anything inherently tied to this PC — live prices, candle history read out of the MT5
terminal, the engine switches — is deliberately left out, so the site reports those as
offline rather than showing a stale number as if it were live.

The payload is hashed over the journal itself — accounts, trades, notes, rule labels —
and deliberately *not* over the equity series, which the bridge appends to every few
seconds while a terminal is connected. A publisher that hashed that too would see every
snapshot as "changed" and republish all day for nothing. The equity series rides along
with whatever publish the real content triggers, thinned to one point per EQUITY_STEP
seconds so the file does not grow without bound.
"""
import hashlib
import json
import os
import sys
import time

from . import db

VERSION = 1
EQUITY_STEP = 300  # keep at most one equity point per 5 minutes; a year of them is then ~100k rows
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "snapshot.json")


def _accounts(con) -> list[dict]:
    """Same shape as GET /accounts, including the trade_count/last_trade_time the cards show."""
    out = []
    for row in con.execute("SELECT * FROM accounts ORDER BY id"):
        d = dict(row)
        d["is_live"] = bool(d["is_live"])
        d["enabled"] = bool(d["enabled"])
        agg = con.execute(
            "SELECT COUNT(*) n, MAX(COALESCE(close_time, open_time)) last FROM trades WHERE account_id=?",
            (row["id"],),
        ).fetchone()
        d["trade_count"], d["last_trade_time"] = agg["n"], agg["last"]
        out.append(d)
    return out


def _trades(con, account_id: int) -> list[dict]:
    """Same shape as GET /accounts/{id}/trades — the trade joined with its note row."""
    rows = con.execute(
        """SELECT t.*, n.setup_valid, n.setup_id, n.emotion, n.error, n.note
           FROM trades t LEFT JOIN trade_notes n ON n.trade_id = t.id
           WHERE t.account_id=? ORDER BY t.open_time""",
        (account_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _snapshots(con, account_id: int, step: int = EQUITY_STEP) -> list[dict]:
    """The equity series, thinned to one point per `step` seconds. First and last are always kept."""
    rows = [dict(r) for r in con.execute(
        "SELECT time, balance, equity FROM snapshots WHERE account_id=? ORDER BY time", (account_id,)
    )]
    if len(rows) < 3:
        return rows
    kept, last_t = [rows[0]], rows[0]["time"]
    for r in rows[1:-1]:
        if r["time"] - last_t >= step:
            kept.append(r)
            last_t = r["time"]
    kept.append(rows[-1])
    return kept


def _rule_labels(con) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in con.execute("SELECT rule, key, label, features, updated_at FROM rule_labels ORDER BY rule, key"):
        out.setdefault(r["rule"], []).append(dict(r))
    return out


def build() -> dict:
    """The whole readable journal as one plain dict."""
    with db.db() as con:
        accounts = _accounts(con)
        data = {
            "version": VERSION,
            "accounts": accounts,
            "trades": {str(a["id"]): _trades(con, a["id"]) for a in accounts},
            "snapshots": {str(a["id"]): _snapshots(con, a["id"]) for a in accounts},
            "rule_labels": _rule_labels(con),
        }
    data["digest"] = digest(data)
    data["generated_at"] = int(time.time())
    return data


#: hashed to decide whether a republish is worth it — see the module docstring for why
#: the equity series is not among them.
DIGESTED = ("version", "accounts", "trades", "rule_labels")


def digest(data: dict) -> str:
    """Hash of the journal content: an unchanged journal hashes the same however often you export it."""
    body = {k: data[k] for k in DIGESTED if k in data}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write(out: str = DEFAULT_OUT) -> dict:
    """Write the snapshot; report whether it differs from the one already there."""
    data = build()
    was = None
    if os.path.exists(out):
        try:
            with open(out, encoding="utf-8") as f:
                was = json.load(f).get("digest")
        except (OSError, ValueError):
            pass  # unreadable or half-written: treat it as "no previous snapshot"
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)  # atomic: a publisher never reads a half-written file
    return {
        "path": out,
        "bytes": os.path.getsize(out),
        "digest": data["digest"],
        "changed": was != data["digest"],
        "accounts": len(data["accounts"]),
        "trades": sum(len(v) for v in data["trades"].values()),
        "equity_points": sum(len(v) for v in data["snapshots"].values()),
    }


if __name__ == "__main__":
    print(json.dumps(write(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT), indent=2))
