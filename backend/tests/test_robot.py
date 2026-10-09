"""Robot EA endpoints: per-account key, heartbeat, snapshot, trade upsert, and never a signal."""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

os.environ["JOURNAL_NO_BRIDGE"] = "1"
os.environ["JOURNAL_NO_NOTIFY"] = "1"


@pytest.fixture()
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["JOURNAL_DB"] = path
    from journal import api, db

    db.DB_PATH = path
    db.init()
    with TestClient(api.app) as c:
        yield c
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except OSError:
            pass


def _account(client):
    r = client.post("/accounts", json={"name": "Robot demo", "platform": "mt4", "kind": "robot"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_events_need_a_valid_key(client):
    assert client.post("/events/heartbeat", json={}).status_code == 401
    assert client.post("/events/heartbeat", json={}, headers={"X-API-Key": "rk_wrong"}).status_code == 401


def test_full_robot_flow(client):
    acc = _account(client)
    key = client.post(f"/accounts/{acc}/robot-key").json()["api_key"]
    h = {"X-API-Key": key}

    assert client.post("/events/heartbeat", json={"ea_version": "1.0-mt4", "terminal_info": "RoboForex"}, headers=h).json() == {"ok": True}
    snap = {"timestamp": "2026-10-08T12:00:00Z", "balance": 1000, "equity": 990.5, "margin": 10, "free_margin": 980, "margin_level": 9905}
    assert client.post("/events/snapshot", json=snap, headers=h).status_code == 200

    open_t = {"ticket": "123", "symbol": "XAUUSD", "direction": "buy", "volume": 0.1, "open_time": "2026-10-08T12:00:00Z",
              "open_price": 4100.5, "close_time": None, "close_price": None, "stop_loss": 4090, "take_profit": None,
              "profit": -5, "commission": 0, "swap": 0, "status": "open"}
    assert client.post("/events/trade", json=open_t, headers=h).json()["created"] is True
    closed = {**open_t, "close_time": "2026-10-08T13:00:00Z", "close_price": 4110, "profit": 95, "status": "closed"}
    assert client.post("/events/trade", json=closed, headers=h).json()["created"] is False

    trades = client.get(f"/accounts/{acc}/trades").json()
    rows = trades if isinstance(trades, list) else trades.get("trades", trades)
    t = rows[0]
    assert t["ticket"] == "123" and t["profit"] == 95 and t["close_price"] == 4110 and t["source"] == "ea"

    sig = client.post("/events/signal-evaluate", json={"candles": [{"time": "2026-10-08T12:00:00Z", "open": 1, "high": 1, "low": 1, "close": 1}]}, headers=h)
    assert sig.json()["signal"] is None  # execution disabled

    live = client.get(f"/accounts/{acc}/live").json()
    assert live["connected"] is True and live["source"] == "mt4-ea" and live["equity"] == 990.5

    st = client.get("/robot/status").json()
    assert st[0]["id"] == acc and st[0]["online"] is True and st[0]["ea_version"] == "1.0-mt4"

    # a new key replaces the old one
    key2 = client.post(f"/accounts/{acc}/robot-key").json()["api_key"]
    assert client.post("/events/heartbeat", json={}, headers=h).status_code == 401
    assert client.post("/events/heartbeat", json={}, headers={"X-API-Key": key2}).status_code == 200


def test_bad_direction_is_rejected(client):
    acc = _account(client)
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    bad = {"ticket": "1", "symbol": "X", "direction": "hold", "volume": 1, "open_time": "2026-10-08T12:00:00Z", "open_price": 1}
    assert client.post("/events/trade", json=bad, headers=h).status_code == 422


def test_key_is_bound_to_the_account_login(client):
    r = client.post("/accounts", json={"name": "Real", "platform": "mt4", "kind": "manual", "login": "46163494"})
    acc = r.json()["id"]
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    assert client.post("/events/heartbeat", json={"login": "46163494"}, headers=h).status_code == 200
    assert client.post("/events/heartbeat", json={"login": "999"}, headers=h).status_code == 409


def test_mt4_candle_feed(client):
    acc = _account(client)
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    bars = [{"time": f"2026-10-08T12:0{i}:00Z", "open": 1 + i, "high": 2 + i, "low": i, "close": 1.5 + i} for i in range(3)]
    assert client.post("/events/candles", json={"symbol": "XAUUSD", "candles": bars}, headers=h).json()["saved"] == 3
    bars[2]["close"] = 9
    client.post("/events/candles", json={"symbol": "XAUUSD", "candles": bars[2:]}, headers=h)
    got = client.get("/robot/candles?symbol=XAUUSD").json()["candles"]
    assert len(got) == 3 and got[-1]["close"] == 9 and got[0]["time"] < got[1]["time"]
    newer = client.get(f"/robot/candles?symbol=XAUUSD&since={got[1]['time']}").json()["candles"]
    assert [c["time"] for c in newer] == [got[1]["time"], got[2]["time"]]


def test_mt4_order_roundtrip(client, monkeypatch):
    import threading
    from journal import robot
    r = client.post("/accounts", json={"name": "MT4", "platform": "mt4", "kind": "manual", "login": "111"})
    acc = r.json()["id"]
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    # EA offline -> refused
    assert client.post(f"/accounts/{acc}/order", json={"symbol": "XAUUSD", "direction": "buy", "volume": 0.01}).status_code == 409
    client.post("/events/heartbeat", json={"login": "111"}, headers=h)

    def ea():
        import time
        for _ in range(40):
            o = client.post("/events/orders/next", headers=h).json()["order"]
            if o:
                assert o["direction"] == "buy" and o["volume"] == 0.01
                client.post(f"/events/orders/{o['id']}/result", json={"ok": True, "ticket": "9001", "price": 4133.5}, headers=h)
                return
            time.sleep(0.2)
    th = threading.Thread(target=ea); th.start()
    got = client.post(f"/accounts/{acc}/order", json={"symbol": "XAUUSD", "direction": "buy", "volume": 0.01, "sl": 4120})
    th.join()
    assert got.status_code == 200 and got.json()["ticket"] == "9001" and got.json()["price"] == 4133.5
    # nothing left for the EA
    assert client.post("/events/orders/next", headers=h).json()["order"] is None


def test_positions_modify_and_close(client):
    import threading, time
    r = client.post("/accounts", json={"name": "MT4", "platform": "mt4", "kind": "manual", "login": "222"})
    acc = r.json()["id"]
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    client.post("/events/heartbeat", json={"login": "222"}, headers=h)
    pos = {"login": "222", "balance": 1000, "equity": 1012, "positions": [
        {"ticket": "77", "symbol": "XAUUSD", "direction": "sell", "volume": 0.1, "open_price": 4135, "price": 4133.8, "profit": 12, "swap": -0.5, "sl": 4140, "tp": 4128}]}
    assert client.post("/events/positions", json=pos, headers=h).json()["order"] is None
    got = client.get(f"/accounts/{acc}/positions").json()
    assert got["live"] and got["floating"] == 11.5 and got["positions"][0]["ticket"] == "77"

    seen = []
    def ea():
        for _ in range(60):
            o = client.post("/events/positions", json=pos, headers=h).json()["order"]
            if o:
                seen.append(o)
                client.post(f"/events/orders/{o['id']}/result", json={"ok": True, "ticket": o["target"]}, headers=h)
                if len(seen) == 2:
                    return
            time.sleep(0.1)
    th = threading.Thread(target=ea); th.start()
    assert client.post(f"/accounts/{acc}/positions/77/modify", json={"sl": 4138, "tp": 4120}).status_code == 200
    assert client.post(f"/accounts/{acc}/positions/77/close").status_code == 200
    th.join()
    assert seen[0]["direction"] == "modify" and seen[0]["sl"] == 4138 and seen[0]["target"] == "77"
    assert seen[1]["direction"] == "close" and seen[1]["target"] == "77"


def test_pending_orders_and_quotes(client):
    import threading, time
    r = client.post("/accounts", json={"name": "MT4", "platform": "mt4", "kind": "manual", "login": "333"})
    acc = r.json()["id"]
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    client.post("/events/heartbeat", json={"login": "333"}, headers=h)
    pulse = {"login": "333", "positions": [], "pending": [{"ticket": "88", "symbol": "XAUUSD", "type": "buy_limit", "volume": 0.1, "price": 4150}],
             "quotes": [{"symbol": "XAUUSD", "bid": 4186.4, "ask": 4186.5, "change": 1.2}]}
    assert client.post("/events/positions", json=pulse, headers=h).status_code == 200
    got = client.get(f"/accounts/{acc}/positions").json()
    assert got["pending"][0]["type"] == "buy_limit" and got["quotes"][0]["ask"] == 4186.5
    # a limit without a price is refused before it reaches MT4
    assert client.post(f"/accounts/{acc}/order", json={"symbol": "XAUUSD", "direction": "buy", "volume": 0.1, "order_type": "limit"}).status_code == 409
    seen = []
    def ea():
        for _ in range(60):
            o = client.post("/events/positions", json=pulse, headers=h).json()["order"]
            if o:
                seen.append(o)
                client.post(f"/events/orders/{o['id']}/result", json={"ok": True, "ticket": o["target"] or "99"}, headers=h)
                if len(seen) == 2:
                    return
            time.sleep(0.1)
    th = threading.Thread(target=ea); th.start()
    assert client.post(f"/accounts/{acc}/order", json={"symbol": "XAUUSD", "direction": "sell", "volume": 0.1, "order_type": "stop", "price": 4170}).status_code == 200
    assert client.post(f"/accounts/{acc}/positions/88/cancel").status_code == 200
    th.join()
    assert seen[0]["direction"] == "sell_stop" and seen[0]["entry"] == 4170
    assert seen[1]["direction"] == "cancel" and seen[1]["target"] == "88"


def test_alerts_fire_once_on_open_and_close(client, monkeypatch):
    import time
    from datetime import datetime, timezone
    from journal import notify
    sent = []
    monkeypatch.setattr(notify, "send", lambda kind, text: sent.append((kind, text)))
    acc = _account(client)
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    t = {"ticket": "501", "symbol": "XAUUSD", "direction": "sell", "volume": 0.1, "open_time": now, "open_price": 4190,
         "stop_loss": 4195, "take_profit": 4180, "profit": 3, "status": "open"}
    client.post("/events/trade", json=t, headers=h)
    client.post("/events/trade", json=t, headers=h)  # periodic re-sync: no second alert
    closed = {**t, "status": "closed", "close_time": now, "close_price": 4180, "profit": 100}
    client.post("/events/trade", json=closed, headers=h)
    client.post("/events/trade", json=closed, headers=h)
    assert [k for k, _ in sent] == ["opens", "closes"]
    assert "Take Profit hit" in sent[1][1] and "+100.00" in sent[1][1]
    # old history backfilled by the EA stays silent
    old = {**closed, "ticket": "400", "open_time": "2020-01-01T00:00:00Z", "close_time": "2020-01-01T01:00:00Z"}
    client.post("/events/trade", json=old, headers=h)
    assert len(sent) == 2


def test_notify_settings_roundtrip(client):
    assert client.put("/notify/settings", json={"opens": False}).json()["opens"] is False
    s = client.get("/notify/settings").json()
    assert s["opens"] is False and s["closes"] is True and "configured" in s
