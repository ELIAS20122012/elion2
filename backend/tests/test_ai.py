import base64
import json
import os
import tempfile

os.environ.setdefault("JOURNAL_DB", os.path.join(tempfile.mkdtemp(), "test.db"))
os.environ["JOURNAL_NO_BRIDGE"] = "1"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from journal import ai  # noqa: E402
from journal.api import app  # noqa: E402

FAKE_GEMINI_KEY = "AIzaTEST-not-a-real-key-000000000000"
FAKE_CLAUDE_KEY = "sk-ant-TEST-not-a-real-key-0000"

GOOD = {
    "summary": "No valid setup: price has not pulled back to a level.",
    "market_bias": "neutral",
    "rule_checks": [{"rule": "divergence", "status": "unclear", "evidence": "MACD values were not shared."}],
    "observations": ["Last 3 closed trades were losses."],
    "risks": ["News at 14:30."],
    "next_steps": ["Wait for a pullback."],
    "data_gaps": ["No chart image attached."],
}
PNG_1PX = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20).decode()


class Recorder:
    """Stands in for httpx: records what would have been sent, returns a canned response."""

    def __init__(self, status=200, body=None, exc=None):
        self.calls = []
        self.status, self.body, self.exc = status, body, exc

    def __call__(self, url, *, headers, json_body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json_body, "timeout": timeout})
        if self.exc:
            raise self.exc
        return httpx.Response(self.status, json=self.body, request=httpx.Request("POST", url))


def gemini_ok(payload=GOOD):
    return Recorder(body={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]})


def claude_ok(payload=GOOD):
    return Recorder(body={"content": [{"type": "text", "text": json.dumps(payload)}], "stop_reason": "end_turn"})


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", FAKE_GEMINI_KEY)
    monkeypatch.setenv("ANTHROPIC_API_KEY", FAKE_CLAUDE_KEY)


@pytest.fixture
def no_keys(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _account_with_trades(c):
    acc = c.post("/accounts", json={"name": "AI test", "platform": "other"}).json()
    c.post(f"/accounts/{acc['id']}/trades", json=[
        {"ticket": "1", "symbol": "XAUUSD", "direction": "buy", "volume": 0.1, "open_time": 1790000000, "open_price": 4300,
         "close_time": 1790000600, "close_price": 4310, "profit": 100, "commission": -1},
        {"ticket": "2", "symbol": "XAUUSD", "direction": "sell", "volume": 0.1, "open_time": 1790001000, "open_price": 4310,
         "close_time": 1790001600, "close_price": 4315, "profit": -50},
    ])
    return acc["id"]


# ---- missing key / provider selection ----------------------------------------------------------

def test_providers_report_missing_keys_without_leaking(client, no_keys):
    r = client.get("/ai/providers")
    assert r.status_code == 200
    by_id = {p["id"]: p for p in r.json()}
    assert set(by_id) == {"gemini", "claude"}
    assert by_id["gemini"]["available"] is False and "GEMINI_API_KEY" in by_id["gemini"]["reason"]
    assert by_id["claude"]["available"] is False and "ANTHROPIC_API_KEY" in by_id["claude"]["reason"]


def test_providers_available_with_key_and_key_never_returned(client, keys):
    r = client.get("/ai/providers")
    assert all(p["available"] for p in r.json())
    assert FAKE_GEMINI_KEY not in r.text and FAKE_CLAUDE_KEY not in r.text


def test_analyze_without_key_is_503_and_calls_nothing(client, no_keys, monkeypatch):
    rec = gemini_ok()
    monkeypatch.setattr(ai, "_post", rec)
    r = client.post("/ai/analyze", json={"provider": "gemini", "question": "hi"})
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]
    assert rec.calls == []


def test_unknown_provider_is_unavailable(client, keys):
    r = client.post("/ai/analyze", json={"provider": "gpt", "question": "hi"})
    assert r.status_code == 503


def test_provider_selection_routes_to_the_chosen_api(client, keys, monkeypatch):
    rec = gemini_ok()
    monkeypatch.setattr(ai, "_post", rec)
    assert client.post("/ai/analyze", json={"provider": "gemini", "question": "q"}).json()["provider"] == "gemini"
    assert "generativelanguage.googleapis.com" in rec.calls[-1]["url"]

    rec2 = claude_ok()
    monkeypatch.setattr(ai, "_post", rec2)
    assert client.post("/ai/analyze", json={"provider": "claude", "question": "q"}).json()["provider"] == "claude"
    assert rec2.calls[-1]["url"] == "https://api.anthropic.com/v1/messages"


# ---- Gemini service ----------------------------------------------------------------------------

def test_gemini_request_shape_and_key_only_in_header(keys, monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-model")
    rec = gemini_ok()
    out = ai.analyze(ai.AnalyzeIn(provider="gemini", question="Is this valid?",
                                  images=[ai.ImageIn(mime="image/png", data=PNG_1PX)]), post=rec)
    call = rec.calls[0]
    assert call["url"].endswith("/gemini-test-model:generateContent")
    assert FAKE_GEMINI_KEY not in call["url"] and call["headers"]["x-goog-api-key"] == FAKE_GEMINI_KEY
    body = call["body"]
    assert FAKE_GEMINI_KEY not in json.dumps(body)
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert "cannot place, modify, close" in body["systemInstruction"]["parts"][0]["text"]
    assert body["contents"][0]["parts"][0] == {"inline_data": {"mime_type": "image/png", "data": PNG_1PX}}
    assert out["analysis"]["summary"] == GOOD["summary"] and out["context_used"]["images"] == 1
    assert out["model"] == "gemini-test-model"


def test_gemini_accepts_fenced_json(keys):
    rec = Recorder(body={"candidates": [{"content": {"parts": [{"text": "```json\n" + json.dumps(GOOD) + "\n```"}]}}]})
    assert ai.analyze(ai.AnalyzeIn(provider="gemini", question="q"), post=rec)["analysis"]["market_bias"] == "neutral"


def test_gemini_unstructured_answer_is_bad_response(client, keys, monkeypatch):
    monkeypatch.setattr(ai, "_post", Recorder(body={"candidates": [{"content": {"parts": [{"text": "Buy now, 95% sure!"}]}}]}))
    r = client.post("/ai/analyze", json={"provider": "gemini", "question": "q"})
    assert r.status_code == 502 and "structured" in r.json()["detail"]


def test_gemini_blocked_prompt(keys):
    rec = Recorder(body={"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}})
    with pytest.raises(ai.ProviderFailed, match="SAFETY"):
        ai.analyze(ai.AnalyzeIn(provider="gemini", question="q"), post=rec)


def test_timeout_is_504(client, keys, monkeypatch):
    monkeypatch.setattr(ai, "_post", Recorder(exc=httpx.ReadTimeout("slow")))
    r = client.post("/ai/analyze", json={"provider": "gemini", "question": "q"})
    assert r.status_code == 504 and "did not answer" in r.json()["detail"]


def test_upstream_error_is_502_and_key_is_scrubbed(client, keys, monkeypatch):
    monkeypatch.setattr(ai, "_post", Recorder(status=400, body={"error": {"message": f"API key {FAKE_GEMINI_KEY} not valid"}}))
    r = client.post("/ai/analyze", json={"provider": "gemini", "question": "q"})
    assert r.status_code == 502
    assert FAKE_GEMINI_KEY not in r.text and "***" in r.json()["detail"]


def test_network_error_is_502(client, keys, monkeypatch):
    monkeypatch.setattr(ai, "_post", Recorder(exc=httpx.ConnectError("dns")))
    assert client.post("/ai/analyze", json={"provider": "gemini", "question": "q"}).status_code == 502


def test_claude_request_shape(keys):
    rec = claude_ok()
    ai.analyze(ai.AnalyzeIn(provider="claude", question="q", images=[ai.ImageIn(mime="image/png", data=PNG_1PX)]), post=rec)
    call = rec.calls[0]
    assert call["headers"]["x-api-key"] == FAKE_CLAUDE_KEY and call["headers"]["anthropic-version"]
    assert call["body"]["messages"][0]["content"][0]["source"]["media_type"] == "image/png"
    assert FAKE_CLAUDE_KEY not in json.dumps(call["body"])


# ---- context: only shared, only real ----------------------------------------------------------

def test_nothing_shared_sends_no_trades(client, keys, monkeypatch):
    acc = _account_with_trades(client)
    rec = gemini_ok()
    monkeypatch.setattr(ai, "_post", rec)
    out = client.post("/ai/analyze", json={"provider": "gemini", "question": "q", "account_id": acc}).json()
    prompt = rec.calls[0]["body"]["contents"][0]["parts"][-1]["text"]
    assert '"journal"' not in prompt and "4310" not in prompt
    assert out["context_used"]["trades"] == 0
    assert any("general" in n for n in out["notes"])


def test_shared_trades_and_rules_are_the_real_rows(client, keys, monkeypatch):
    acc = _account_with_trades(client)
    rec = gemini_ok()
    monkeypatch.setattr(ai, "_post", rec)
    out = client.post("/ai/analyze", json={
        "provider": "gemini", "question": "review", "account_id": acc,
        "share": {"rules": True, "trades": True},
        "rules": [{"id": "divergence", "title": "Regular divergence at highs", "hint": "", "status": "teaching"}],
    }).json()
    ctx = json.loads(rec.calls[0]["body"]["contents"][0]["parts"][-1]["text"].split("CONTEXT (JSON, the only data you may use):\n")[1].split("\n\nNOTES")[0])
    assert [t["ticket"] for t in ctx["journal"]["trades"]] == ["2", "1"]
    assert ctx["journal"]["totals_over_included_closed_trades"] == {"count": 2, "wins": 1, "losses": 1, "net_profit": 49.0}
    assert ctx["rules"][0]["id"] == "divergence"
    assert out["context_used"]["trades"] == 2 and out["context_used"]["rules"] == 1


def test_mt5_not_connected_is_a_note_not_fake_numbers(client, keys, monkeypatch):
    acc = _account_with_trades(client)
    rec = gemini_ok()
    monkeypatch.setattr(ai, "_post", rec)
    out = client.post("/ai/analyze", json={"provider": "gemini", "question": "q", "account_id": acc,
                                           "share": {"mt5_account": True, "market": True}}).json()
    assert out["context_used"]["mt5_account"] is False and out["context_used"]["market_candles"] == 0
    assert any("not connected" in n for n in out["notes"]) and any("not an MT5 account" in n for n in out["notes"])


def test_market_candles_come_from_mt5_reader(client, keys):
    acc = client.post("/accounts", json={"name": "mt5 acct", "platform": "other", "login": "1"}).json()
    from journal import db
    with db.db() as con:
        con.execute("UPDATE accounts SET platform='mt5' WHERE id=?", (acc["id"],))
    seen = {}

    def candles(login, path, symbol, tf, count):
        seen.update(symbol=symbol, tf=tf, count=count)
        return [[1790000000, 4300.0, 4301.0, 4299.0, 4300.5, 10]]

    out = ai.analyze(ai.AnalyzeIn(provider="gemini", question="q", account_id=acc["id"], share=ai.ShareIn(market=True),
                                  timeframe="M5", candles=50), post=gemini_ok(), candles_fn=candles)
    assert seen == {"symbol": "XAUUSD", "tf": 300, "count": 50} and out["context_used"]["market_candles"] == 1

    def broken(*a):
        raise RuntimeError("MT5 engine is off")

    out = ai.analyze(ai.AnalyzeIn(provider="gemini", question="q", account_id=acc["id"], share=ai.ShareIn(market=True)),
                     post=gemini_ok(), candles_fn=broken)
    assert out["context_used"]["market_candles"] == 0 and any("engine is off" in n for n in out["notes"])


def test_image_validation(client, keys, monkeypatch):
    monkeypatch.setattr(ai, "_post", gemini_ok())
    bad_type = client.post("/ai/analyze", json={"provider": "gemini", "question": "q", "images": [{"mime": "image/gif", "data": PNG_1PX}]})
    assert bad_type.status_code == 422
    too_many = client.post("/ai/analyze", json={"provider": "gemini", "question": "q", "images": [{"mime": "image/png", "data": PNG_1PX}] * 5})
    assert too_many.status_code == 422
    not_b64 = client.post("/ai/analyze", json={"provider": "gemini", "question": "q", "images": [{"mime": "image/png", "data": "@@@"}]})
    assert not_b64.status_code == 422


def test_ai_module_cannot_trade():
    src = open(ai.__file__, encoding="utf-8").read()
    assert "send_order" not in src and "/order" not in src
    assert "mt5sync.fetch_candles" in src  # the only MT5 call: a read of broker history


def test_key_is_read_from_saved_windows_variable_when_process_env_is_stale(client, no_keys, monkeypatch):
    # the services were started before the key was saved: their environment has no key,
    # but the saved user variable does - it must work without a restart or sign-out
    monkeypatch.setattr(ai, "_user_env_windows", lambda name: FAKE_GEMINI_KEY if name == "GEMINI_API_KEY" else None)
    by_id = {p["id"]: p for p in client.get("/ai/providers").json()}
    assert by_id["gemini"]["available"] is True and by_id["claude"]["available"] is False
    rec = gemini_ok()
    monkeypatch.setattr(ai, "_post", rec)
    assert client.post("/ai/analyze", json={"provider": "gemini", "question": "q"}).status_code == 200
    assert rec.calls[0]["headers"]["x-goog-api-key"] == FAKE_GEMINI_KEY


def test_saved_windows_variable_lookup_is_harmless_elsewhere():
    assert ai._user_env_windows("GEMINI_API_KEY") is None  # not Windows here: no registry, no error


class Sequence:
    """Answers with the given (status, body) pairs in order, repeating the last one."""

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def __call__(self, url, *, headers, json_body, timeout):
        self.calls.append(url)
        st, body = self.answers[min(len(self.calls) - 1, len(self.answers) - 1)]
        return httpx.Response(st, json=body, request=httpx.Request("POST", url))


BUSY = (503, {"error": {"message": "This model is currently experiencing high demand."}})
OK = (200, {"candidates": [{"content": {"parts": [{"text": json.dumps(GOOD)}]}}]})


@pytest.fixture
def no_wait(monkeypatch):
    monkeypatch.setattr(ai, "_sleep", lambda s: None)


def test_busy_answer_is_retried(keys, no_wait, monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-main")
    seq = Sequence(BUSY, BUSY, OK)
    out = ai.analyze(ai.AnalyzeIn(provider="gemini", question="q"), post=seq)
    assert len(seq.calls) == 3 and all("gemini-main" in u for u in seq.calls)
    assert out["model"] == "gemini-main"


def test_still_busy_falls_back_to_second_model(keys, no_wait, monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-main")
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "gemini-backup")
    seq = Sequence(BUSY, BUSY, BUSY, OK)
    out = ai.analyze(ai.AnalyzeIn(provider="gemini", question="q"), post=seq)
    assert "gemini-backup" in seq.calls[-1] and out["model"] == "gemini-backup"


def test_both_models_busy_reports_the_original_error(client, keys, no_wait, monkeypatch):
    monkeypatch.setattr(ai, "_post", Sequence(BUSY))
    r = client.post("/ai/analyze", json={"provider": "gemini", "question": "q"})
    assert r.status_code == 502 and "503" in r.json()["detail"] and "high demand" in r.json()["detail"]


def test_fallback_can_be_switched_off_and_is_not_used_for_real_errors(keys, no_wait, monkeypatch):
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "")
    seq = Sequence(BUSY)
    with pytest.raises(ai.ProviderBusy):
        ai.analyze(ai.AnalyzeIn(provider="gemini", question="q"), post=seq)
    assert len(seq.calls) == 3  # retries only, no second model
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "gemini-backup")
    seq = Sequence((401, {"error": {"message": "API key not valid"}}))
    with pytest.raises(ai.ProviderFailed):
        ai.analyze(ai.AnalyzeIn(provider="gemini", question="q"), post=seq)
    assert len(seq.calls) == 1  # a bad key is not retried and not sent to another model
