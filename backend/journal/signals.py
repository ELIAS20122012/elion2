"""Signal queue for the robot: detector finds -> AI reviews -> Elias decides -> the outcome is measured.

    POST /signals                  store a setup the detector found (idempotent per account + key)
    GET  /signals                  the queue, newest first
    GET  /signals/{id}/chart.png   the exact picture the AI reviewer saw
    POST /signals/{id}/review      (re)run the AI review with a provider
    POST /signals/{id}/decision    record approve / reject  -- records only, NO order is sent
    POST /signals/outcomes         measure what price did after each signal, from real candles
    GET  /signals/stats            how signals the AI called valid / invalid actually played out

Nothing here can trade: this module never touches the order-sending code (a test checks that).

The detector itself is the one in the dashboard (dashboard/src/lib/detectors/divergence.ts), so the
robot and the chart always agree; it posts what it found together with the candles and MACD it used.

ASSUMPTIONS (Elias has not defined entry / stop / target for the divergence rule yet, so no SL/TP is
invented): the outcome is measured as the move in the reversal direction the divergence implies
(high -> down, low -> up) over the next HORIZON closed candles, from the close of the candle where the
divergence formed: best move for the idea (MFE) and worst move against it (MAE), in price and in ATR(14).
A signal counts as "favorable" when MFE >= MAE. Change HORIZON / the definition once real exit rules exist.
"""
from __future__ import annotations

import base64
import json
import threading
from typing import Literal

from pydantic import BaseModel, Field

from . import ai, chartpng, db

HORIZON = 20      # ASSUMPTION: candles after formation used to measure the outcome
ATR_LEN = 14      # ATR as the simple average of high-low over the 14 candles up to formation (same as divFeatures)
MAX_CANDLES = 400

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    key TEXT NOT NULL,
    rule TEXT NOT NULL,
    symbol TEXT NOT NULL,
    tf_sec INTEGER NOT NULL,
    side TEXT NOT NULL,                 -- high | low
    formed_time INTEGER NOT NULL,       -- candle where the divergence counted as formed (MACD/signal cross)
    formed_price REAL NOT NULL,         -- that candle's close
    payload TEXT NOT NULL,              -- points, features, params, candles, macd the detector used (JSON)
    created_at INTEGER NOT NULL,
    ai_status TEXT NOT NULL DEFAULT 'none',   -- none | reviewing | done | error
    ai_provider TEXT, ai_model TEXT, ai_verdict TEXT, ai_review TEXT, ai_error TEXT, ai_at INTEGER,
    decision TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected  (a record, never an order)
    decided_at INTEGER,
    outcome TEXT, outcome_at INTEGER,         -- JSON, see measure()
    UNIQUE(account_id, key)
);
"""


def init() -> None:
    with db.db() as con:
        con.executescript(SCHEMA)


# ---------------------------------------------------------------------------------------------
# shapes
# ---------------------------------------------------------------------------------------------

class Point(BaseModel):
    i: int                  # index in `candles`
    time: int
    price: float
    macd_i: int | None = None
    macd: float | None = None


class RuleDef(BaseModel):
    id: str
    title: str
    hint: str = ""
    status: str = ""


class SignalIn(BaseModel):
    account_id: int | None = None
    key: str = Field(min_length=1, max_length=200)
    rule: str = Field(default="divergence", max_length=60)
    rule_def: RuleDef | None = None
    symbol: str = Field(min_length=1, max_length=20)
    tf_sec: int = Field(gt=0)
    side: Literal["high", "low"]
    a: Point
    b: Point
    cross_i: int
    features: dict[str, float] = Field(default_factory=dict)
    params: dict = Field(default_factory=dict)
    candles: list[list[float]] = Field(min_length=10, max_length=MAX_CANDLES)  # [time, o, h, l, c(, vol)] up to formation
    macd: list[float | None] = Field(default_factory=list)
    signal: list[float | None] = Field(default_factory=list)
    provider: str | None = None           # review right away with this provider


class ReviewIn(BaseModel):
    provider: str


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "pending"]


class OutcomesIn(BaseModel):
    account_id: int | None = None
    symbol: str
    tf_sec: int
    candles: list[list[float]] = Field(max_length=50000)


class Verdict(BaseModel):
    verdict: Literal["valid", "invalid", "unsure"]
    reasons: list[str] = Field(default_factory=list)
    rule_checks: list[ai.RuleCheck] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    data_gaps: list[str] = Field(default_factory=list)


VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["valid", "invalid", "unsure"]},
        "reasons": {"type": "array", "items": {"type": "string"}},
        "rule_checks": {"type": "array", "items": {"type": "object", "properties": {
            "rule": {"type": "string"}, "status": {"type": "string", "enum": ["met", "not_met", "unclear", "not_applicable"]},
            "evidence": {"type": "string"}}, "required": ["rule", "status", "evidence"]}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "data_gaps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "reasons", "rule_checks", "risks", "data_gaps"],
}

REVIEW_PROMPT = f"""You review setups that a trading robot's detector found, for one discretionary trader.
- Judge ONLY whether this finding really matches the trader's rule as defined in RULE, using the candles, MACD
  values and the attached chart image (drawn from exactly those candles; orange/green dots and line = the two
  extremes, dashed vertical line = the candle where it formed). Do not use outside knowledge of prices or news.
- "valid": clearly matches the rule. "invalid": does not match. "unsure": the data cannot settle it.
- Never invent prices, levels, statistics or scores, and give no numeric confidence.
- You cannot place, modify or close trades and must not suggest you did. The trader decides.
- Answer in Persian if RULE is written in Persian, otherwise in English.
- Reply with ONE JSON object only, matching this JSON schema: {json.dumps(VERDICT_SCHEMA)}"""


# ---------------------------------------------------------------------------------------------
# storage helpers
# ---------------------------------------------------------------------------------------------

def _row(r, full: bool = False) -> dict:
    p = json.loads(r["payload"])
    out = {k: r[k] for k in ("id", "account_id", "key", "rule", "symbol", "tf_sec", "side", "formed_time", "formed_price",
                             "created_at", "ai_status", "ai_provider", "ai_model", "ai_verdict", "ai_error", "ai_at",
                             "decision", "decided_at", "outcome_at")}
    out["ai_review"] = json.loads(r["ai_review"]) if r["ai_review"] else None
    out["outcome"] = json.loads(r["outcome"]) if r["outcome"] else None
    out["features"] = p.get("features", {})
    out["a"], out["b"] = p["a"], p["b"]
    if full:
        out["payload"] = p
    return out


def get(signal_id: int, full: bool = False) -> dict | None:
    with db.db() as con:
        r = con.execute("SELECT * FROM signals WHERE id=?", (signal_id,)).fetchone()
        return _row(r, full) if r else None


def create(s: SignalIn) -> tuple[dict, bool]:
    """Returns (signal, created). A key already stored for the account is returned unchanged."""
    if not (0 <= s.cross_i < len(s.candles)) or not (0 <= s.a.i < len(s.candles)) or not (0 <= s.b.i < len(s.candles)):
        raise ai.BadRequest("Signal indices are outside the candles sent with it.")
    formed = s.candles[s.cross_i]
    payload = s.model_dump(exclude={"provider", "account_id", "key", "rule", "symbol", "tf_sec", "side"})
    with db.db() as con:
        prev = con.execute("SELECT id FROM signals WHERE account_id IS ? AND key=?", (s.account_id, s.key)).fetchone()
        if prev:
            return _row(con.execute("SELECT * FROM signals WHERE id=?", (prev["id"],)).fetchone()), False
        cur = con.execute(
            """INSERT INTO signals (account_id, key, rule, symbol, tf_sec, side, formed_time, formed_price, payload, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (s.account_id, s.key, s.rule, s.symbol, s.tf_sec, s.side, int(formed[0]), float(formed[4]), json.dumps(payload), db.now()))
        return _row(con.execute("SELECT * FROM signals WHERE id=?", (cur.lastrowid,)).fetchone()), True


def listing(account_id: int | None, limit: int = 100) -> list[dict]:
    with db.db() as con:
        rows = con.execute("SELECT * FROM signals WHERE account_id IS ? ORDER BY formed_time DESC, id DESC LIMIT ?",
                           (account_id, max(1, min(limit, 500)))).fetchall()
        return [_row(r) for r in rows]


def decide(signal_id: int, decision: str) -> dict | None:
    with db.db() as con:
        con.execute("UPDATE signals SET decision=?, decided_at=? WHERE id=?", (decision, db.now() if decision != "pending" else None, signal_id))
    return get(signal_id)


# ---------------------------------------------------------------------------------------------
# chart + AI review
# ---------------------------------------------------------------------------------------------

def chart_png(signal_id: int) -> bytes | None:
    s = get(signal_id, full=True)
    if not s:
        return None
    p = s["payload"]
    return chartpng.render(p["candles"], p.get("macd") or None, p.get("signal") or None, {
        "a": p["a"]["i"], "b": p["b"]["i"], "a_macd": p["a"].get("macd_i"), "b_macd": p["b"].get("macd_i"),
        "cross": p["cross_i"], "side": s["side"]})


def _review_text(s: dict) -> str:
    p = s["payload"]
    n = len(p["candles"])
    take = min(n, 120)  # the most recent candles as numbers; the image shows the whole window
    rows = [[ai._iso(c[0]), *[round(v, 5) for v in c[1:5]],
             None if not p.get("macd") or p["macd"][n - take + k] is None else round(p["macd"][n - take + k], 5),
             None if not p.get("signal") or p["signal"][n - take + k] is None else round(p["signal"][n - take + k], 5)]
            for k, c in enumerate(p["candles"][n - take:])]
    ctx = {
        "RULE": p.get("rule_def") or {"id": s["rule"]},
        "detector_parameters": p.get("params", {}),
        "finding": {
            "side": s["side"], "meaning": "divergence at highs (price higher high, MACD lower high)" if s["side"] == "high"
            else "divergence at lows (price lower low, MACD higher low)",
            "first_extreme": {"time_utc": ai._iso(p["a"]["time"]), "price": p["a"]["price"], "macd": p["a"].get("macd")},
            "second_extreme": {"time_utc": ai._iso(p["b"]["time"]), "price": p["b"]["price"], "macd": p["b"].get("macd")},
            "formed_at_utc": ai._iso(s["formed_time"]), "formed_close": s["formed_price"],
            "measured_features": p.get("features", {}),
        },
        "symbol": s["symbol"], "timeframe_seconds": s["tf_sec"],
        "candles": {"columns": ["time_utc", "open", "high", "low", "close", "macd", "signal"], "rows": rows,
                    "note": f"last {take} of {n} candles, ending at the formation candle (nothing after it)"},
    }
    return f"Review this detector finding.\n\nCONTEXT (JSON):\n{json.dumps(ctx, ensure_ascii=False)}"


def review(signal_id: int, provider_id: str, post=None) -> dict:
    """Runs the AI review synchronously and stores the result (or the error). Returns the signal."""
    s = get(signal_id, full=True)
    if not s:
        raise ai.BadRequest("Signal not found.")
    prov = ai.get_provider(provider_id, post)
    prov._require_key()
    with db.db() as con:
        con.execute("UPDATE signals SET ai_status='reviewing', ai_provider=?, ai_model=?, ai_error=NULL WHERE id=?",
                    (prov.id, prov.model, signal_id))
    try:
        img = base64.b64encode(chart_png(signal_id) or b"").decode()
        v = prov.structured(ai.Prompt(REVIEW_PROMPT, _review_text(s), [("image/png", img)]), Verdict)
        with db.db() as con:
            con.execute("UPDATE signals SET ai_status='done', ai_model=?, ai_verdict=?, ai_review=?, ai_at=? WHERE id=?",
                        (prov.used_model or prov.model, v.verdict, v.model_dump_json(), db.now(), signal_id))
    except ai.AIError as e:
        with db.db() as con:
            con.execute("UPDATE signals SET ai_status='error', ai_error=?, ai_at=? WHERE id=?", (ai.scrub(e.message)[:500], db.now(), signal_id))
    return get(signal_id)


def review_in_background(signal_id: int, provider_id: str) -> None:
    """Checks the provider is usable now (so the caller gets a clear error), then reviews on a thread."""
    ai.get_provider(provider_id)._require_key()
    with db.db() as con:
        con.execute("UPDATE signals SET ai_status='reviewing', ai_error=NULL WHERE id=?", (signal_id,))

    def run():
        try:
            review(signal_id, provider_id)
        except Exception as e:  # never leave a signal stuck in "reviewing"
            with db.db() as con:
                con.execute("UPDATE signals SET ai_status='error', ai_error=? WHERE id=?", (ai.scrub(str(e))[:500], signal_id))

    threading.Thread(target=run, name=f"signal-review-{signal_id}", daemon=True).start()


# ---------------------------------------------------------------------------------------------
# outcomes + stats
# ---------------------------------------------------------------------------------------------

def measure(side: str, formed_price: float, before: list[list[float]], after: list[list[float]], horizon: int = HORIZON) -> dict | None:
    """Move in the reversal direction over the next `horizon` candles. None until that many candles exist."""
    if len(after) < horizon:
        return None
    win = after[:horizon]
    down = side == "high"  # divergence at highs -> the idea is a move down
    mfe = (formed_price - min(c[3] for c in win)) if down else (max(c[2] for c in win) - formed_price)
    mae = (max(c[2] for c in win) - formed_price) if down else (formed_price - min(c[3] for c in win))
    ref = before[-ATR_LEN:]
    atr = (sum(c[2] - c[3] for c in ref) / len(ref)) if ref else 0.0
    close_move = (formed_price - win[-1][4]) if down else (win[-1][4] - formed_price)
    r = lambda v: round(v, 5)  # noqa: E731
    return {"horizon": horizon, "definition": "reversal-direction move over the next candles (ASSUMPTION, no SL/TP defined)",
            "mfe": r(max(mfe, 0.0)), "mae": r(max(mae, 0.0)), "close_move": r(close_move), "atr": r(atr),
            "mfe_atr": r(max(mfe, 0.0) / atr) if atr else None, "mae_atr": r(max(mae, 0.0) / atr) if atr else None,
            "favorable": max(mfe, 0.0) >= max(mae, 0.0)}


def update_outcomes(b: OutcomesIn, horizon: int = HORIZON) -> dict:
    candles = sorted(b.candles, key=lambda c: c[0])
    index = {int(c[0]): i for i, c in enumerate(candles)}
    measured = 0
    with db.db() as con:
        rows = con.execute("SELECT id, side, formed_time, formed_price FROM signals WHERE account_id IS ? AND symbol=? AND tf_sec=? AND outcome IS NULL",
                           (b.account_id, b.symbol, b.tf_sec)).fetchall()
        for r in rows:
            i = index.get(int(r["formed_time"]))
            if i is None:
                continue
            m = measure(r["side"], r["formed_price"], candles[max(0, i - ATR_LEN + 1):i + 1], candles[i + 1:], horizon)
            if m:
                con.execute("UPDATE signals SET outcome=?, outcome_at=? WHERE id=?", (json.dumps(m), db.now(), r["id"]))
                measured += 1
    return {"measured": measured, "waiting": len(rows) - measured}


def _group(rows: list[dict], key) -> dict:
    out: dict = {}
    for s in rows:
        g = out.setdefault(key(s), {"signals": 0, "measured": 0, "favorable": 0, "mfe_atr": [], "mae_atr": []})
        g["signals"] += 1
        o = s["outcome"]
        if o:
            g["measured"] += 1
            g["favorable"] += 1 if o["favorable"] else 0
            if o.get("mfe_atr") is not None:
                g["mfe_atr"].append(o["mfe_atr"])
                g["mae_atr"].append(o["mae_atr"])
    for g in out.values():
        g["favorable_rate"] = round(g["favorable"] / g["measured"], 3) if g["measured"] else None
        g["avg_mfe_atr"] = round(sum(g["mfe_atr"]) / len(g["mfe_atr"]), 3) if g["mfe_atr"] else None
        g["avg_mae_atr"] = round(sum(g["mae_atr"]) / len(g["mae_atr"]), 3) if g["mae_atr"] else None
        del g["mfe_atr"], g["mae_atr"]
    return out


def stats(account_id: int | None) -> dict:
    rows = listing(account_id, 500)
    return {"horizon": HORIZON, "total": len(rows),
            "by_ai_verdict": _group(rows, lambda s: s["ai_verdict"] or "not_reviewed"),
            "by_decision": _group(rows, lambda s: s["decision"]),
            "all": _group(rows, lambda s: "all").get("all")}
