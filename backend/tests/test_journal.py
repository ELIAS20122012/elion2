import os
import tempfile

os.environ["JOURNAL_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["JOURNAL_NO_BRIDGE"] = "1"  # tests drive the file watcher by hand

from fastapi.testclient import TestClient  # noqa: E402

from journal import parsers  # noqa: E402
from journal.api import app  # noqa: E402

MT4_HTML = b"""<html><body><table>
<tr><td colspan=14><b>Closed Transactions:</b></td></tr>
<tr><td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
<tr align=right><td>52345678</td><td class=msdate nowrap>2026.09.18 13:59:58</td><td>buy</td><td class=mspt>0.10</td><td>xauusd</td><td class=mspt>4380.49</td><td class=mspt>4370.00</td><td class=mspt>0.00</td><td class=msdate nowrap>2026.09.18 14:03:11</td><td class=mspt>4381.50</td><td class=mspt>-0.70</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>10.10</td></tr>
<tr align=right><td>52345690</td><td>2026.09.18 14:10:00</td><td>sell</td><td>1.00</td><td>xauusd</td><td>4390.00</td><td>0.00</td><td>0.00</td><td>2026.09.18 14:12:30</td><td>4391.20</td><td>-7.00</td><td>0.00</td><td>0.00</td><td>-1 200.50</td></tr>
<tr align=right><td>52345699</td><td>2026.09.18 14:15:00</td><td>balance</td><td colspan=11>Deposit</td></tr>
</table></body></html>"""

MT5_HTML = b"""<table>
<tr><td>2026.09.19 10:00:01</td><td>600002046650</td><td>XAUUSD</td><td>sell</td><td>1.00 / 1.00</td><td>4380.49</td><td>4390.00</td><td>4370.00</td><td>2026.09.19 10:01:00</td><td>4380.91</td><td>-3.00</td><td>0.00</td><td>-42.00</td></tr>
</table>"""

CSV = b"Ticket,Open Time,Type,Volume,Symbol,Open Price,Close Time,Close Price,Profit\n7,2026.09.18 09:00:00,buy,0.5,XAUUSD,4300.10,2026.09.18 09:05:00,4302.10,100\n"


def test_mt4_html():
    t = parsers.parse_statement(MT4_HTML, "s.htm")
    assert len(t) == 2  # the balance row is skipped
    a, b = t
    assert a["ticket"] == "52345678" and a["direction"] == "buy" and a["symbol"] == "XAUUSD"
    assert a["volume"] == 0.10 and a["open_price"] == 4380.49 and a["close_price"] == 4381.50
    assert a["sl"] == 4370.0 and a["tp"] is None
    assert (a["commission"], a["swap"], a["profit"]) == (-0.70, 0.0, 10.10)
    assert b["profit"] == -1200.50  # thousands separator
    assert a["close_time"] - a["open_time"] == 193


def test_mt5_html():
    (t,) = parsers.parse_statement(MT5_HTML, "r.html")
    assert t["ticket"] == "600002046650" and t["direction"] == "sell" and t["volume"] == 1.0
    assert (t["commission"], t["swap"], t["profit"]) == (-3.0, 0.0, -42.0)


def test_csv():
    (t,) = parsers.parse_statement(CSV, "x.csv")
    assert t["ticket"] == "7" and t["profit"] == 100 and t["close_price"] == 4302.10


def test_garbage_is_rejected():
    try:
        parsers.parse_statement(b"hello", "x.txt")
    except Exception as e:
        assert "پیدا نشد" in str(e) or "ستون" in str(e)
    else:
        raise AssertionError("expected an error")


def test_api_flow():
    with TestClient(app) as c:
        acc = c.post("/accounts", json={"name": "لایو MT4", "platform": "mt4", "kind": "manual", "is_live": True, "login": "46162031"}).json()
        assert acc["is_live"] is True and acc["trade_count"] == 0
        r = c.post(f"/accounts/{acc['id']}/import", files={"file": ("s.htm", MT4_HTML)})
        assert r.status_code == 200 and r.json()["inserted"] == 2
        # importing again must not duplicate
        assert c.post(f"/accounts/{acc['id']}/import", files={"file": ("s.htm", MT4_HTML)}).json()["inserted"] == 0
        trades = c.get(f"/accounts/{acc['id']}/trades").json()
        assert len(trades) == 2
        assert c.put(f"/trades/{trades[0]['id']}/notes", json={"setup_valid": "no", "emotion": "angry", "error": "E-1"}).status_code == 200
        assert c.get(f"/accounts/{acc['id']}/trades").json()[0]["emotion"] == "angry"

        # accounts are isolated from each other
        other = c.post("/accounts", json={"name": "ربات", "platform": "mt5", "kind": "robot"}).json()
        assert c.get(f"/accounts/{other['id']}/trades").json() == []
        assert c.post(f"/accounts/{other['id']}/sync-mt5").status_code in (200, 409)  # 409 when MT5 is closed
        assert c.post(f"/accounts/{acc['id']}/sync-mt5").status_code == 400  # MT4 can't be synced directly

        # each MT5 account can point at its own terminal; a wrong path must fail cleanly, not crash
        live = c.post("/accounts", json={"name": "لایو MT5", "platform": "mt5", "kind": "manual", "login": "1", "terminal_path": "C:\\nope\\terminal64.exe"}).json()
        assert live["terminal_path"] == "C:\\nope\\terminal64.exe"
        assert c.post(f"/accounts/{live['id']}/sync-mt5").status_code == 409
        assert c.patch(f"/accounts/{live['id']}", json={"terminal_path": None}).json()["terminal_path"] is None
        assert isinstance(c.get("/mt5/terminals").json(), list)

        assert c.delete(f"/accounts/{acc['id']}").status_code == 204
        assert c.get(f"/accounts/{acc['id']}/trades").status_code == 404


def test_connect_disconnect():
    """The Connection page's real toggle: disabling an account must report 'not connected' right away,
    without touching MT5/the bridge, and re-enabling must flip it back - all without deleting anything."""
    with TestClient(app) as c:
        acc = c.post("/accounts", json={"name": "x", "platform": "mt4", "login": "999", "is_live": True}).json()
        assert acc["enabled"] is True

        live = c.get(f"/accounts/{acc['id']}/live").json()
        assert live["connected"] is False and live.get("disabled") is not True  # just never seen the indicator yet

        patched = c.patch(f"/accounts/{acc['id']}", json={"enabled": False}).json()
        assert patched["enabled"] is False
        live = c.get(f"/accounts/{acc['id']}/live").json()
        assert live == {"source": None, "connected": False, "disabled": True}

        # the account and its (would-be) trades are untouched by disconnecting - only re-fetched by GET /accounts
        assert c.get("/accounts").json()[-1]["id"] == acc["id"]

        patched = c.patch(f"/accounts/{acc['id']}", json={"enabled": True}).json()
        assert patched["enabled"] is True
        live = c.get(f"/accounts/{acc['id']}/live").json()
        assert live.get("disabled") is not True


def test_place_order_guards():
    """Place Order has no size/confirmation limit by design, but it must still refuse the cases where
    there is no sane terminal to send to: an MT4 account (no execution path) or a disconnected one."""
    with TestClient(app) as c:
        order = {"symbol": "XAUUSD", "direction": "buy", "volume": 0.01}

        mt4 = c.post("/accounts", json={"name": "m4", "platform": "mt4", "login": "1"}).json()
        r = c.post(f"/accounts/{mt4['id']}/order", json=order)
        assert r.status_code == 409  # MT4 orders go through RobotTradingEA, which is not running here

        mt5acc = c.post("/accounts", json={"name": "m5", "platform": "mt5", "login": "2", "enabled": False}).json()
        r = c.post(f"/accounts/{mt5acc['id']}/order", json=order)
        assert r.status_code == 409


def test_news_cached_and_error(monkeypatch):
    from journal import api

    calls = {"n": 0}

    def fake():
        calls["n"] += 1
        return [{"time": 1, "title": "CPI", "country": "USD", "impact": "High", "forecast": None, "previous": None, "actual": None}]

    monkeypatch.setattr(api, "_fetch_news", fake)
    api._news_cache.update({"at": 0.0, "events": [], "error": None})
    with TestClient(app) as c:
        r = c.get("/news").json()
        assert r["events"][0]["title"] == "CPI" and r["stale"] is False
        c.get("/news")
        assert calls["n"] == 1  # second call served from the cache

        def boom():
            raise RuntimeError("down")

        monkeypatch.setattr(api, "_fetch_news", boom)
        api._news_cache["at"] = 0.0
        r = c.get("/news").json()  # feed dies: keep serving the last good list, flagged stale
        assert r["stale"] is True and r["events"]
        api._news_cache.update({"at": 0.0, "events": [], "error": None})
        assert c.get("/news").status_code == 502


def test_candles_guards():
    with TestClient(app) as c:
        m4 = c.post("/accounts", json={"name": "c4", "platform": "mt4", "login": "3"}).json()
        assert c.get(f"/accounts/{m4['id']}/candles").status_code == 400
        off = c.post("/accounts", json={"name": "c5", "platform": "mt5", "login": "4", "enabled": False}).json()
        assert c.get(f"/accounts/{off['id']}/candles").status_code == 409
        assert c.get("/accounts/99999/candles").status_code == 404


def test_engine_gate(monkeypatch):
    """Switches off (the default): MT5 is never contacted (mt5.initialize() would launch a terminal) and MT4 files are ignored."""
    from journal import bridge, engine, mt5sync

    monkeypatch.setattr(engine, "start_bridge", lambda: None)
    monkeypatch.setattr(engine, "stop_bridge", lambda: None)
    monkeypatch.setattr(engine, "bridge_running", lambda: False)
    monkeypatch.setattr(engine, "terminals_running", lambda: [])
    monkeypatch.setattr(engine, "launch_mt4", lambda: [])  # never open a real MT4 terminal from a test
    monkeypatch.setattr(engine, "close_terminals", lambda platform: None)  # nor close a real one
    monkeypatch.setattr(bridge, "sync_mt5_once", lambda wait=False: None)  # never let a test launch a real terminal
    engine._mt5.clear()
    engine._mt4.clear()

    for call in (lambda: mt5sync.fetch("1", 5, None), lambda: mt5sync.fetch_candles("1", None, "XAUUSD", 300, 100)):
        try:
            call()
        except mt5sync.SyncError as e:
            assert "MetaTrader 5" in str(e)
        else:
            raise AssertionError("MT5 was contacted while its switch was off")
    try:
        mt5sync.send_order("1", None, "XAUUSD", "buy", 0.01, None, None, None)
    except mt5sync.OrderError:
        pass
    else:
        raise AssertionError("order sent while the MT5 switch was off")
    assert bridge.live_status("mt5", "1")["engine_off"] is True
    assert bridge.live_status("mt4", "1")["engine_off"] is True
    assert bridge.detected() == []

    with TestClient(app) as c:
        s = c.get("/engine").json()
        assert s["mt5"]["on"] is False and s["mt4"]["on"] is False
        assert c.post("/engine/mt5/start").json()["mt5"]["on"] is True
        s = c.get("/engine").json()
        assert s["mt5"]["on"] is True and s["mt4"]["on"] is False  # independent switches
        assert c.post("/engine/mt4/start").json()["mt4"]["on"] is True
        assert bridge.live_status("mt4", "1").get("engine_off") is None
        assert c.post("/engine/mt5/stop").json()["mt5"]["on"] is False
        assert c.get("/engine").json()["mt4"]["on"] is True  # stopping MT5 leaves MT4 alone
        assert c.post("/engine/mt4/stop?close=false").json()["mt4"]["on"] is False
        assert c.post("/engine/mt6/start").status_code == 422


def test_backup():
    with TestClient(app) as c:
        r = c.post("/backup").json()
        assert r["size"] > 0 and r["skipped"] is False
        d1 = c.post("/backup?daily=true").json()
        d2 = c.post("/backup?daily=true").json()
        assert d1["file"] == d2["file"] and d2["skipped"] is True


def test_rule_labels_roundtrip():
    with TestClient(app) as c:
        key = "60:low:1000:1600"
        assert c.get("/rule-labels/divergence").json() == []
        assert c.post("/rule-labels", json={"rule": "divergence", "key": key, "label": "ok", "features": {"gap": 10.0}}).json() == {"ok": True}
        # a second verdict on the same finding replaces the first
        c.post("/rule-labels", json={"rule": "divergence", "key": key, "label": "bad", "features": {"gap": 10.0}})
        rows = c.get("/rule-labels/divergence").json()
        assert len(rows) == 1 and rows[0]["label"] == "bad" and rows[0]["features"] == {"gap": 10.0}
        assert c.post("/rule-labels", json={"rule": "divergence", "key": key, "label": "maybe"}).status_code == 422
        assert c.get("/rule-labels/other-rule").json() == []
        assert c.delete(f"/rule-labels/divergence?key={key}").status_code == 204
        assert c.get("/rule-labels/divergence").json() == []

def test_mt5_history_window_reaches_past_now():
    """MT5 stamps deals with the broker's clock (ahead of UTC); the history window must not end at real 'now'."""
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from journal import mt5sync

    seen = {}

    class FakeMt5:
        DEAL_TYPE_BUY, DEAL_TYPE_SELL, DEAL_ENTRY_IN, DEAL_ENTRY_OUT, DEAL_ENTRY_OUT_BY = 0, 1, 0, 1, 3
        POSITION_TYPE_BUY = 0

        def initialize(self, path=None): return True
        def shutdown(self): pass
        def account_info(self): return SimpleNamespace(login=1, balance=1.0, equity=1.0, currency="USD", server="S")
        def positions_get(self): return []

        def history_deals_get(self, start, end):
            seen["end"] = end
            return []

    real = mt5sync.mt5
    mt5sync.mt5 = FakeMt5()
    try:
        mt5sync._fetch("1", 30, None)
    finally:
        mt5sync.mt5 = real
    hours_ahead = (seen["end"] - datetime.now(timezone.utc)).total_seconds() / 3600
    assert hours_ahead >= 12  # far enough past 'now' to cover any broker offset
