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