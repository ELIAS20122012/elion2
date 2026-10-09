"""Level Continuation robot: finds Elias's main setup on live MT4 M1 candles and SUGGESTS it.

Rules confirmed by Elias (2026-10-10): entry on M1, trend from M5, TP = 1:2, hidden MACD divergence required.
The detector is a line-by-line port of dashboard/src/lib/levelContinuation.ts, so the chart's backtest page
and this server agree:
  1. M5 trend: last two confirmed swing highs AND lows rising (buy) / falling (sell).
  2. Level: last confirmed swing high price then CLOSED above (buy) — old resistance → support.
  3. Pullback: the latest confirmed swing low within `tol` × ATR(14) of the level.
  4. Hidden divergence: that low is higher than the previous swing low while MACD is lower.
  5. Entry: MACD (12,26,9; signal = SMA 9) crosses its signal in trade direction within `crossWithin` bars.
  6. SL beyond the pullback swing + `slBuf` × ATR; TP = entry + rr × risk.
  7. Session 07:00–20:00 UTC (candle times are broker server time; the offset is measured from the live feed).

SUGGESTIONS ONLY: nothing here sends an order. A signal is stored, sent to Telegram and shown on the
dashboard; Elias decides and places the trade himself (a test checks this module never queues orders).
"""
from __future__ import annotations

import bisect
import json
import math
import os
import threading
import time

from pydantic import BaseModel

from . import db, notify

NAN = float("nan")
SCAN_BARS = 3000

DEFAULTS = {"rr": 2.0, "htfMin": 5, "swingN": 3, "tol": 0.5, "crossWithin": 10, "slBuf": 0.2,
            "hidden": 1, "session": 1, "buy": 1, "sell": 1}

SCHEMA = """
CREATE TABLE IF NOT EXISTS setup_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    params TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO setup_settings (id) VALUES (1);
CREATE TABLE IF NOT EXISTS setup_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,          -- buy | sell
    bar_time INTEGER NOT NULL,        -- M1 candle where MACD crossed (server time)
    entry REAL NOT NULL, sl REAL NOT NULL, tp REAL NOT NULL,
    level REAL, created_at REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',   -- new | taken | dismissed  (a record, never an order)
    UNIQUE(symbol, bar_time, direction)
);
"""


def init() -> None:
    with db.db() as con:
        con.executescript(SCHEMA)


# --- indicators (same maths as dashboard/src/lib/indicators.ts) ------------------------------------

fin = math.isfinite


def sma(a: list[float], n: int) -> list[float]:
    out, s, cnt = [NAN] * len(a), 0.0, 0
    for i, x in enumerate(a):
        if fin(x):
            s += x
            cnt += 1
        else:
            s, cnt = 0.0, 0
        if cnt > n:
            s -= a[i - n]
            cnt -= 1
        if cnt == n:
            out[i] = s / n
    return out


def ema(a: list[float], n: int) -> list[float]:
    out, k, prev, run, s = [NAN] * len(a), 2 / (n + 1), NAN, 0, 0.0
    for i, x in enumerate(a):
        if not fin(x):
            prev, run, s = NAN, 0, 0.0
            continue
        if fin(prev):
            prev = x * k + prev * (1 - k)
            out[i] = prev
            continue
        run += 1
        s += x
        if run == n:
            prev = s / n
            out[i] = prev
    return out


def atr(c: list[dict], n: int) -> list[float]:
    tr = [x["high"] - x["low"] if i == 0 else max(x["high"] - x["low"], abs(x["high"] - c[i - 1]["close"]), abs(x["low"] - c[i - 1]["close"]))
          for i, x in enumerate(c)]
    out, prev, run, s = [NAN] * len(tr), NAN, 0, 0.0
    for i, x in enumerate(tr):
        if fin(prev):
            prev = (prev * (n - 1) + x) / n
            out[i] = prev
            continue
        run += 1
        s += x
        if run == n:
            prev = s / n
            out[i] = prev
    return out


def swings(v: list[float], n: int) -> list[int]:
    return [i for i in range(n, len(v) - n) if all(v[i] > v[i - j] and v[i] > v[i + j] for j in range(1, n + 1))]


def aggregate(c: list[dict], sec: int) -> list[dict]:
    out: list[dict] = []
    for x in c:
        t = x["time"] // sec * sec
        if out and out[-1]["time"] == t:
            o = out[-1]
            o["high"], o["low"], o["close"] = max(o["high"], x["high"]), min(o["low"], x["low"]), x["close"]
        else:
            out.append({"time": t, "open": x["open"], "high": x["high"], "low": x["low"], "close": x["close"]})
    return out


def tf_of(c: list[dict]) -> int:
    cnt: dict[int, int] = {}
    for i in range(1, min(len(c), 500)):
        d = c[i]["time"] - c[i - 1]["time"]
        cnt[d] = cnt.get(d, 0) + 1
    return max(cnt, key=cnt.get) if cnt else 60


def htf_trend(c: list[dict], tf: int, htf: int, n: int) -> list[int]:
    h = aggregate(c, htf) if htf > tf else c
    hs = max(htf, tf)
    highs, lows = swings([x["high"] for x in h], n), swings([-x["low"] for x in h], n)
    tr, H, L, hi, lo = [0] * len(h), [], [], 0, 0
    for k in range(len(h)):
        while hi < len(highs) and highs[hi] + n <= k:
            H.append(h[highs[hi]]["high"]); hi += 1
        while lo < len(lows) and lows[lo] + n <= k:
            L.append(h[lows[lo]]["low"]); lo += 1
        if len(H) >= 2 and len(L) >= 2:
            up = H[-1] > H[-2] and L[-1] > L[-2]
            dn = H[-1] < H[-2] and L[-1] < L[-2]
            tr[k] = 1 if up else -1 if dn else 0
    out, k = [0] * len(c), -1
    for i in range(len(c)):
        close_t = c[i]["time"] + tf
        while k + 1 < len(h) and h[k + 1]["time"] + hs <= close_t:
            k += 1
        out[i] = tr[k] if k >= 0 else 0
    return out


def detect(c: list[dict], p: dict, utc_shift: int = 0) -> list[dict]:
    """Level Continuation signals on closed candles (the last candle is treated as still forming).
    utc_shift: seconds to subtract from candle time to get UTC (broker server offset)."""
    p = {**DEFAULTS, **p}
    if len(c) < 60:
        return []
    tf = tf_of(c)
    n = max(1, round(p["swingN"]))
    trend = htf_trend(c, tf, int(p["htfMin"] * 60), 2) if p["htfMin"] > 0 else [1] * len(c)
    a = atr(c, 14)
    closes = [x["close"] for x in c]
    e26 = ema(closes, 26)
    line = [v - e26[i] for i, v in enumerate(ema(closes, 12))]
    sig = sma(line, 9)
    highs, lows = swings([x["high"] for x in c], n), swings([-x["low"] for x in c], n)

    def macd_at(j: int, side: int) -> float:
        v = line[j]
        for d in range(-2, 3):
            if 0 <= j + d < len(line):
                x = line[j + d]
                if fin(x) and (x < v if side == 1 else x > v):
                    v = x
        return v

    out, used = [], set()
    for d in (1, -1):
        if not (p["buy"] if d == 1 else p["sell"]):
            continue
        lvl_sw, pb_sw = (highs, lows) if d == 1 else (lows, highs)
        pb_conf = [j + n for j in pb_sw]  # bar where each pullback swing is confirmed (ascending)

        def px(j: int, lvl: bool) -> float:
            if d == 1:
                return c[j]["high"] if lvl else c[j]["low"]
            return c[j]["low"] if lvl else c[j]["high"]

        for i in range(30, len(c) - 1):
            l0, l1, s0, s1 = line[i - 1], line[i], sig[i - 1], sig[i]
            if not all(fin(x) for x in (l0, l1, s0, s1)):
                continue
            crossed = (l0 <= s0 and l1 > s1) if d == 1 else (l0 >= s0 and l1 < s1)
            if not crossed or not fin(a[i]) or trend[i] != d:
                continue
            if p["session"]:
                hr = time.gmtime(c[i]["time"] - utc_shift).tm_hour
                if not 7 <= hr < 20:
                    continue
            m = bisect.bisect_right(pb_conf, i)
            if m < 2:
                continue
            L, P = pb_sw[m - 1], pb_sw[m - 2]
            if i - L > p["crossWithin"]:
                continue
            level = NAN
            for j in reversed(lvl_sw):
                if j >= L or j + n > L:
                    continue
                lv = px(j, True)
                if any((c[k]["close"] > lv) if d == 1 else (c[k]["close"] < lv) for k in range(j + 1, L)):
                    level = lv
                    break
            if not fin(level):
                continue
            pb = px(L, False)
            if abs(pb - level) > p["tol"] * a[L]:
                continue
            if p["hidden"]:
                price_ok = pb > px(P, False) if d == 1 else pb < px(P, False)
                mL, mP = macd_at(L, d), macd_at(P, d)
                if not (price_ok and (mL < mP if d == 1 else mL > mP)):
                    continue
            if (d, L) in used:
                continue
            used.add((d, L))
            sl = pb - p["slBuf"] * a[i] if d == 1 else pb + p["slBuf"] * a[i]
            entry = c[i]["close"]
            risk = entry - sl if d == 1 else sl - entry
            if not risk > 0:
                continue
            out.append({"index": i, "time": c[i]["time"], "direction": "buy" if d == 1 else "sell",
                        "entry": entry, "sl": sl, "tp": entry + d * risk * p["rr"], "level": level})
    return sorted(out, key=lambda s: s["index"])


# --- settings ---------------------------------------------------------------------------------------

def settings() -> dict:
    with db.db() as con:
        r = con.execute("SELECT enabled, params FROM setup_settings WHERE id=1").fetchone()
    params = {**DEFAULTS, **(json.loads(r["params"]) if r else {})}
    return {"enabled": bool(r["enabled"]) if r else True, "params": params}


class SettingsIn(BaseModel):
    enabled: bool | None = None
    params: dict[str, float] | None = None


def save_settings(b: SettingsIn) -> dict:
    with db.db() as con:
        if b.enabled is not None:
            con.execute("UPDATE setup_settings SET enabled=? WHERE id=1", (int(b.enabled),))
        if b.params is not None:
            clean = {k: float(v) for k, v in b.params.items() if k in DEFAULTS and math.isfinite(v)}
            con.execute("UPDATE setup_settings SET params=? WHERE id=1", (json.dumps(clean),))
    return settings()


# --- live scan ------------------------------------------------------------------------------------

_last: dict[str, int] = {}   # symbol → last closed bar already scanned
_lock = threading.Lock()


def _load(symbol: str, count: int) -> list[dict]:
    with db.db() as con:
        rows = con.execute("SELECT time, open, high, low, close FROM robot_candles WHERE symbol=? ORDER BY time DESC LIMIT ?",
                           (symbol, count)).fetchall()
    return [dict(r) for r in reversed(rows)]


def utc_shift(c: list[dict], now: float | None = None) -> int:
    """Broker server time − UTC, in whole hours, read from a live feed (0 when the feed is stale)."""
    if not c:
        return 0
    d = c[-1]["time"] - (now or time.time())
    return round(d / 3600) * 3600 if abs(d) < 15 * 3600 else 0


def _digits(x: float) -> str:
    return f"{x:.5f}".rstrip("0").rstrip(".") if abs(x) < 50 else f"{x:.2f}"


def scan(symbol: str, now: float | None = None) -> list[dict]:
    """Run after new candles arrive. Stores and announces signals on the newest closed bar only."""
    s = settings()
    if not s["enabled"]:
        return []
    with _lock:
        c = _load(symbol, SCAN_BARS)
        if len(c) < 60:
            return []
        closed = c[-2]["time"]
        prev = _last.get(symbol)
        if prev is not None and closed <= prev:
            return []
        _last[symbol] = closed
        if prev is None:  # first look after a restart: start from here, don't replay history
            prev = closed - 60
        new = [x for x in detect(c, s["params"], utc_shift(c, now)) if x["time"] > prev]
        saved = []
        with db.db() as con:
            for x in new:
                cur = con.execute("INSERT OR IGNORE INTO setup_signals (symbol, direction, bar_time, entry, sl, tp, level, created_at) "
                                  "VALUES (?,?,?,?,?,?,?,?)",
                                  (symbol, x["direction"], x["time"], x["entry"], x["sl"], x["tp"], x["level"], time.time()))
                if cur.rowcount:
                    saved.append({**x, "id": cur.lastrowid, "symbol": symbol})
        for x in saved:
            side = "🟢 BUY" if x["direction"] == "buy" else "🔴 SELL"
            rr = s["params"]["rr"]
            notify.send("setups", f"📐 Level Continuation — {side} {symbol}\n"
                                  f"Entry ≈ {_digits(x['entry'])} · SL {_digits(x['sl'])} · TP {_digits(x['tp'])} (1:{rr:g})\n"
                                  f"Level {_digits(x['level'])} · M1 entry · M5 trend\nSuggestion only — you decide.")
        return saved


def scan_in_background(symbol: str) -> None:
    if os.environ.get("JOURNAL_SCAN_SYNC") == "1":  # tests: deterministic
        scan(symbol)
        return
    threading.Thread(target=scan, args=(symbol,), name="setup-scan", daemon=True).start()


def listing(symbol: str | None = None, limit: int = 50) -> list[dict]:
    q, args = "SELECT * FROM setup_signals", []
    if symbol:
        q += " WHERE symbol=?"
        args.append(symbol)
    with db.db() as con:
        rows = con.execute(q + " ORDER BY bar_time DESC, id DESC LIMIT ?", (*args, max(1, min(limit, 500)))).fetchall()
    return [dict(r) for r in rows]


def set_status(sid: int, status: str) -> dict | None:
    with db.db() as con:
        con.execute("UPDATE setup_signals SET status=? WHERE id=?", (status, sid))
        r = con.execute("SELECT * FROM setup_signals WHERE id=?", (sid,)).fetchone()
    return dict(r) if r else None


# --- backtest on stored MT4 history -------------------------------------------------------------------

def backtest(symbol: str, params: dict | None = None, count: int = 20_000) -> dict:
    """Every signal in the stored history, one trade at a time: entry = next bar open, exit at SL or TP
    (both inside one bar counts as SL — the pessimistic reading). Result in R (risk units)."""
    p = {**settings()["params"], **(params or {})}
    c = _load(symbol, count)
    sigs = detect(c, p, utc_shift(c))
    trades, busy_until = [], -1
    for s in sigs:
        i = s["index"]
        if i <= busy_until or i + 1 >= len(c):
            continue
        d = 1 if s["direction"] == "buy" else -1
        entry = c[i + 1]["open"]
        risk = (entry - s["sl"]) * d
        if risk <= 0:
            continue
        res, exit_i = None, len(c) - 1
        for k in range(i + 1, len(c)):
            b = c[k]
            hit_sl = b["low"] <= s["sl"] if d == 1 else b["high"] >= s["sl"]
            hit_tp = b["high"] >= s["tp"] if d == 1 else b["low"] <= s["tp"]
            if hit_sl or hit_tp:
                exit_p = s["sl"] if hit_sl else s["tp"]
                res, exit_i = round((exit_p - entry) * d / risk, 2), k
                break
        busy_until = exit_i
        trades.append({"time": s["time"], "direction": s["direction"], "entry": entry, "sl": s["sl"], "tp": s["tp"],
                       "r": res, "bars": exit_i - i})
    done = [t["r"] for t in trades if t["r"] is not None]
    wins = sum(1 for r in done if r > 0)
    return {"symbol": symbol, "bars": len(c), "from": c[0]["time"] if c else None, "to": c[-1]["time"] if c else None,
            "params": p, "trades": trades, "closed": len(done), "wins": wins,
            "winrate": round(wins / len(done) * 100, 1) if done else None,
            "total_r": round(sum(done), 2), "open": len(trades) - len(done)}
