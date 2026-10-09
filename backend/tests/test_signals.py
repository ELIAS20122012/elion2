import json
import os
import tempfile
import time

os.environ.setdefault("JOURNAL_DB", os.path.join(tempfile.mkdtemp(), "test.db"))
os.environ["JOURNAL_NO_BRIDGE"] = "1"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from journal import ai, chartpng, signals  # noqa: E402
from journal.api import app  # noqa: E402

T0 = 1790000000
TF = 300


def candles(n=60, start=4300.0, step=1.0):
    out, p = [], start
    for k in range(n):
        o, c = p, p + step
        out.append([T0 + k * TF, o, max(o, c) + 0.5, min(o, c) - 0.5, c, 10])
        p = c
    return out


def signal_body(key="300:high:a:b", provider=None, account_id=None, n=40):
    cs = candles(n)
    return {"account_id": account_id, "key": key, "symbol": "XAUUSD", "tf_sec": TF, "side": "high",
            "rule_def": {"id": "divergence", "title": "دایورجنس معمولی روی سقف‌ها", "hint": "", "status": "teaching"},
            "a": {"i": 10, "time": cs[10][0], "price": cs[10][2], "macd_i": 10, "macd": 2.0},
            "b": {"i": 30, "time": cs[30][0], "price": cs[30][2], "macd_i": 30, "macd": 1.5},
            "cross_i": n - 1, "features": {"gap": 20.0}, "params": {"n": 2},
            "candles": cs, "macd": [0.1 * k for k in range(n)], "signal": [None] * 5 + [0.09 * k for k in range(5, n)],
            **({"provider": provider} if provider else {})}


VERDICT = {"verdict": "valid", "reasons": ["Two higher highs with lower MACD highs."], "rule_checks": [
    {"rule": "divergence", "status": "met", "evidence": "a < b in price, macd falls"}], "risks": [], "data_gaps": []}


class Recorder:
    def __init__(self, status=200, body=None):
        self.calls, self.status, self.body = [], status, body

    def __call__(self, url, *, headers, json_body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json_body})
        return httpx.Response(self.status, json=self.body, request=httpx.Request("POST", url))


def gemini(payload):
    return Recorder(body={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]})


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaTEST-signals-000000000000000000")


def test_png_is_a_valid_image():
    png = chartpng.render(candles(50), [0.1] * 50, [None] * 50, {"a": 5, "b": 20, "cross": 30, "side": "low", "a_macd": 5, "b_macd": 20})
    assert png.startswith(b"\x89PNG\r\n\x1a\n") and b"IHDR" in png and png.endswith(b"IEND\xaeB`\x82")
    assert chartpng.render([]).startswith(b"\x89PNG")


def test_create_is_idempotent_and_listed(client):
    r1 = client.post("/signals", json=signal_body("k-idem")).json()
    r2 = client.post("/signals", json=signal_body("k-idem")).json()
    assert r1["created"] is True and r2["created"] is False and r1["signal"]["id"] == r2["signal"]["id"]
    s = r1["signal"]
    assert s["decision"] == "pending" and s["ai_status"] == "none" and s["formed_price"] == candles(40)[39][4]
    assert any(x["id"] == s["id"] for x in client.get("/signals").json())
    png = client.get(f"/signals/{s['id']}/chart.png")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"


def test_bad_indices_rejected(client):
    body = signal_body("k-bad")
    body["cross_i"] = 999
    assert client.post("/signals", json=body).status_code == 422


def test_review_without_key_is_503(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    s = client.post("/signals", json=signal_body("k-nokey")).json()["signal"]
    r = client.post(f"/signals/{s['id']}/review", json={"provider": "gemini"})
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]
    assert client.post("/signals", json=signal_body("k-nokey2", provider="gemini")).status_code == 503


def test_review_sends_image_and_candles_and_stores_verdict(client, key):
    s = client.post("/signals", json=signal_body("k-review")).json()["signal"]
    rec = gemini(VERDICT)
    out = signals.review(s["id"], "gemini", post=rec)
    assert out["ai_status"] == "done" and out["ai_verdict"] == "valid" and out["ai_review"]["reasons"]
    parts = rec.calls[0]["body"]["contents"][0]["parts"]
    assert parts[0]["inline_data"]["mime_type"] == "image/png"
    text = parts[-1]["text"]
    assert "دایورجنس" in text and '"macd"' in text and "ending at the formation candle" in text
    assert "cannot place, modify or close trades" in rec.calls[0]["body"]["systemInstruction"]["parts"][0]["text"]


def test_review_errors_are_stored_not_raised(client, key):
    s = client.post("/signals", json=signal_body("k-err")).json()["signal"]
    out = signals.review(s["id"], "gemini", post=Recorder(status=429, body={"error": {"message": "quota"}}))
    assert out["ai_status"] == "error" and "429" in out["ai_error"] and out["ai_verdict"] is None
    out = signals.review(s["id"], "gemini", post=gemini({"verdict": "maybe"}))
    assert out["ai_status"] == "error" and "structured" in out["ai_error"]


def test_background_review_finishes(client, key, monkeypatch):
    monkeypatch.setattr(ai, "_post", gemini(VERDICT))
    s = client.post("/signals", json=signal_body("k-bg", provider="gemini")).json()["signal"]
    for _ in range(50):
        cur = client.get("/signals").json()
        cur = next(x for x in cur if x["id"] == s["id"])
        if cur["ai_status"] != "reviewing":
            break
        time.sleep(0.05)
    assert cur["ai_status"] == "done" and cur["ai_verdict"] == "valid"


def test_decision_is_only_a_record(client):
    s = client.post("/signals", json=signal_body("k-dec")).json()["signal"]
    r = client.post(f"/signals/{s['id']}/decision", json={"decision": "approved"}).json()
    assert r["decision"] == "approved" and r["decided_at"]
    assert client.post("/signals/99999/decision", json={"decision": "rejected"}).status_code == 404
    assert client.post(f"/signals/{s['id']}/decision", json={"decision": "buy"}).status_code == 422


def test_measure_high_side():
    before = [[0, 10, 11, 9, 10]] * 14  # ATR 2
    after = [[1, 10, 10.5, 7, 8]] + [[2, 8, 9, 8, 8.5]] * 19
    m = signals.measure("high", 10.0, before, after, horizon=20)
    assert m["mfe"] == 3.0 and m["mae"] == 0.5 and m["favorable"] is True and m["mfe_atr"] == 1.5 and m["close_move"] == 1.5
    assert signals.measure("high", 10.0, before, after[:5], horizon=20) is None


def test_outcomes_and_stats_use_real_candles(client, key):
    body = signal_body("k-out", account_id=None, n=40)
    s = client.post("/signals", json=body).json()["signal"]
    signals.review(s["id"], "gemini", post=gemini(VERDICT))
    later = candles(80)  # the same series continued; uptrend -> a "high" signal is unfavorable
    r = client.post("/signals/outcomes", json={"account_id": None, "symbol": "XAUUSD", "tf_sec": TF, "candles": later}).json()
    assert r["measured"] >= 1
    got = next(x for x in client.get("/signals").json() if x["id"] == s["id"])
    assert got["outcome"]["favorable"] is False and got["outcome"]["horizon"] == signals.HORIZON
    st = client.get("/signals/stats").json()
    v = st["by_ai_verdict"]["valid"]
    assert v["measured"] >= 1 and v["favorable_rate"] is not None


def test_signals_module_cannot_trade():
    for mod in (signals, chartpng):
        src = open(mod.__file__, encoding="utf-8").read()
        assert "send_order" not in src and "mt5sync" not in src and "/order" not in src
