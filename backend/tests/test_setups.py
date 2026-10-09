"""Level Continuation robot: same signals as the dashboard detector, suggestions only, never an order."""
import json
import os
import pathlib
import tempfile
import time

import pytest
from fastapi.testclient import TestClient

os.environ["JOURNAL_NO_BRIDGE"] = "1"
os.environ["JOURNAL_NO_NOTIFY"] = "1"
os.environ["JOURNAL_SCAN_SYNC"] = "1"

from journal import setups  # noqa: E402

BASE = {"rr": 2, "htfMin": 5, "swingN": 3, "tol": 0.5, "crossWithin": 10, "slBuf": 0.2, "hidden": 1, "session": 1, "buy": 1, "sell": 1}


def synth(n=8000, seed=7, t0=1_700_000_000):
    """Same generator as dashboard/src/lib/levelContinuation.test.ts (Park–Miller RNG)."""
    import math
    r, px, out = seed, 2000.0, []

    def rnd():
        nonlocal r
        r = (r * 16807) % 2147483647
        return r / 2147483647
    for i in range(n):
        drift = math.sin(i / 3000) * 0.08
        o = px
        px = o + drift + (rnd() - 0.5) * 2
        out.append({"time": t0 + i * 60, "open": o, "high": max(o, px) + rnd() * 0.5, "low": min(o, px) - rnd() * 0.5, "close": px})
    return out


def test_matches_the_dashboard_detector():
    ts = json.loads((pathlib.Path(__file__).parent / "fixtures" / "level_continuation_ts.json").read_text(encoding="utf-8"))
    d = synth()
    for name, p in (("strict", BASE), ("loose", {**BASE, "hidden": 0, "session": 0})):
        py = setups.detect(d, p)
        assert len(py) == len(ts[name]) > 0, name
        for a, b in zip(py, ts[name]):
            assert a["index"] == b["index"] and a["direction"] == b["direction"]
            assert abs(a["sl"] - b["sl"]) < 1e-6 and abs(a["tp"] - b["tp"]) < 1e-6


def test_no_future_candles():
    d = synth()
    p = {**BASE, "hidden": 0, "session": 0}
    for g in setups.detect(d, p)[:15]:
        cut = setups.detect(d[: g["index"] + 2], p)
        assert any(x["index"] == g["index"] and abs(x["sl"] - g["sl"]) < 1e-9 for x in cut)


@pytest.fixture()
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["JOURNAL_DB"] = path
    from journal import api, db

    db.DB_PATH = path
    db.init()
    setups._last.clear()
    with TestClient(api.app) as c:
        yield c
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except OSError:
            pass


def _feed(client, h, bars):
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731
    for k in range(0, len(bars), 5000):
        chunk = [{**b, "time": iso(b["time"]), "volume": 1} for b in bars[k:k + 5000]]
        assert client.post("/events/candles", json={"symbol": "SYN", "candles": chunk}, headers=h).status_code == 200


def test_live_scan_suggests_but_never_orders(client):
    acc = client.post("/accounts", json={"name": "R", "platform": "mt4", "kind": "robot"}).json()["id"]
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    client.put("/setups/settings", json={"params": {"hidden": 0, "session": 0}})
    d = synth()
    p = {**BASE, "hidden": 0, "session": 0}
    target = setups.detect(d, p)[5]
    i = target["index"]
    _feed(client, h, d[: i])           # history up to just before the signal bar: primes the scanner, no replay
    assert client.get("/setups").json() == []
    _feed(client, h, d[i: i + 2])      # signal bar closes (next bar is forming)
    got = client.get("/setups?symbol=SYN").json()
    assert len(got) == 1 and got[0]["direction"] == target["direction"] and abs(got[0]["sl"] - target["sl"]) < 1e-9
    _feed(client, h, d[i: i + 2])      # same bar again: no duplicate
    assert len(client.get("/setups").json()) == 1
    from journal import db
    with db.db() as con:
        assert con.execute("SELECT COUNT(*) FROM robot_orders").fetchone()[0] == 0
    assert client.post(f"/setups/{got[0]['id']}/status", json={"status": "taken"}).json()["status"] == "taken"
    assert client.post(f"/setups/{got[0]['id']}/status", json={"status": "buy"}).status_code == 422
    bt = client.get("/setups/backtest?symbol=SYN").json()
    assert bt["closed"] > 0 and bt["bars"] == i + 2


def test_settings_and_disable(client):
    s = client.put("/setups/settings", json={"enabled": False, "params": {"rr": 3, "bogus": 1}}).json()
    assert s["enabled"] is False and s["params"]["rr"] == 3 and "bogus" not in s["params"]
    assert client.get("/notify/settings").json().get("setups") is True


def test_module_cannot_trade():
    src = pathlib.Path(setups.__file__).read_text(encoding="utf-8")
    assert "robot_orders" not in src and "place(" not in src


def test_server_offset_is_remembered_for_weekend_backtests(client):
    now = 1_791_590_000.0
    live = [{"time": int(now) + 3 * 3600 - 30, "open": 1, "high": 1, "low": 1, "close": 1}]
    assert setups.utc_shift(live, now) == 3 * 3600          # live feed: learned
    stale = [{"time": int(now) - 50 * 3600, "open": 1, "high": 1, "low": 1, "close": 1}]
    assert setups.utc_shift(stale, now) == 3 * 3600         # weekend: remembered, not guessed


def test_backtest_pays_the_spread(client):
    acc = client.post("/accounts", json={"name": "R", "platform": "mt4", "kind": "robot"}).json()["id"]
    h = {"X-API-Key": client.post(f"/accounts/{acc}/robot-key").json()["api_key"]}
    client.put("/setups/settings", json={"params": {"hidden": 0, "session": 0}})
    _feed(client, h, synth())
    free = setups.backtest("SYN", spread=0.0)
    paid = setups.backtest("SYN", spread=0.3)
    assert free["closed"] > 0 and paid["total_r"] < free["total_r"]
    assert all(t["spread_r"] > 0 for t in paid["trades"])
    pulse = {"balance": 1, "equity": 1, "positions": [], "quotes": [{"symbol": "SYN", "bid": 100.0, "ask": 100.25}]}
    assert client.post("/events/positions", json=pulse, headers=h).status_code == 200
    assert abs(setups.spread_of("SYN") - 0.25) < 1e-9
