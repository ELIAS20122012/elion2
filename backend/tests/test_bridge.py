"""Automatic MT4 capture, driven by fake indicator files (MT4 itself is not needed for these tests)."""
import os
import tempfile
import time

os.environ["JOURNAL_DB"] = os.path.join(tempfile.mkdtemp(), "bridge.db")
os.environ["JOURNAL_NO_BRIDGE"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from journal import bridge  # noqa: E402
from journal.api import app  # noqa: E402

LOGIN = "46162031"


def acct_line(balance=1000.0, equity=1000.0, t=1789800000):
    return f"A;{LOGIN};RoboForex-Pro;RoboForex Ltd;{balance};{equity};0.00;USD;{t}\n"


def open_row(profit, ticket="9001"):
    return f"O;{ticket};XAUUSD;buy;0.10;1789799000;4380.10000000;0.00000000;0.00000000;{profit};0.00;-0.70;manual\n"


def hist_row(profit, ticket="9001"):
    return f"H;{ticket};XAUUSD;buy;0.10;1789799000;4380.10000000;1789799400;4381.20000000;0.00000000;0.00000000;{profit};0.00;-0.70;manual\n"


class Files:
    def __init__(self, folder):
        self.dir, self.n = folder, 0

    def write(self, kind, body):
        p = os.path.join(self.dir, f"journal_{kind}_{LOGIN}.csv")
        with open(p, "w", encoding="utf-8") as f:
            f.write("#v1\n" + body)
        self.n += 1
        t = time.time() + self.n  # every rewrite gets a distinct mtime
        os.utime(p, (t, t))

    def poll(self):
        bridge.poll_once(self.dir)


def test_full_lifecycle():
    files = Files(tempfile.mkdtemp())
    with TestClient(app) as c:
        # 1. the indicator starts reporting before the account exists in the journal -> it is offered, nothing is stored yet
        files.write("open", acct_line() + open_row("2.50"))
        files.poll()
        det = [d for d in c.get("/detected").json() if d["login"] == LOGIN]
        assert det and det[0]["platform"] == "mt4" and det[0]["open_count"] == 1 and det[0]["connected"] is True

        # 2. the user adds the account (one click in the UI) -> the very next poll imports the open trade
        acc = c.post("/accounts", json={"name": "لایو MT4", "platform": "mt4", "kind": "manual", "login": LOGIN, "is_live": True}).json()
        files.poll()
        assert [d for d in c.get("/detected").json() if d["login"] == LOGIN] == []
        trades = c.get(f"/accounts/{acc['id']}/trades").json()
        assert len(trades) == 1 and trades[0]["close_time"] is None and trades[0]["profit"] == 2.5

        # 3. the floating profit moves: best and worst values are remembered
        for p in ("9.00", "-4.00", "1.00"):
            files.write("open", acct_line() + open_row(p))
            files.poll()
        t = c.get(f"/accounts/{acc['id']}/trades").json()[0]
        assert (t["mfe"], t["mae"], t["profit"]) == (9.0, -4.0, 1.0)

        live = c.get(f"/accounts/{acc['id']}/live").json()
        assert live["connected"] is True and live["open_count"] == 1 and live["floating"] == 1.0 and live["source"] == "mt4-indicator"

        # 4. the trade is closed: it leaves the open list and appears in history with its final result
        files.write("hist", hist_row("6.00"))
        files.write("open", acct_line(balance=1005.3, equity=1005.3))
        files.poll()
        t = c.get(f"/accounts/{acc['id']}/trades").json()[0]
        assert t["close_time"] == 1789799400 and t["close_price"] == 4381.2 and t["profit"] == 6.0
        assert (t["mfe"], t["mae"]) == (9.0, -4.0)  # the range seen while open is kept

        # 5. a stale open snapshot must not reopen a closed trade
        files.write("open", acct_line() + open_row("3.00"))
        files.poll()
        t = c.get(f"/accounts/{acc['id']}/trades").json()[0]
        assert t["close_time"] == 1789799400 and t["profit"] == 6.0

        # 6. a trade opened and closed between two polls is still journaled from history, without excursion data
        files.write("hist", hist_row("6.00") + hist_row("-3.10", ticket="9002"))
        files.poll()
        by = {x["ticket"]: x for x in c.get(f"/accounts/{acc['id']}/trades").json()}
        assert by["9002"]["profit"] == -3.1 and by["9002"]["mfe"] is None

        # 7. equity is recorded for the curve
        assert c.get(f"/accounts/{acc['id']}/snapshots").json()

        # 8. another account with the same login on a different platform is not touched
        other = c.post("/accounts", json={"name": "MT5 غیرمرتبط", "platform": "mt5", "login": LOGIN}).json()
        assert c.get(f"/accounts/{other['id']}/trades").json() == []


def test_disconnected_when_file_goes_stale():
    files = Files(tempfile.mkdtemp())
    with TestClient(app) as c:
        files.write("open", acct_line() + open_row("1.00"))
        files.poll()
        acc = c.post("/accounts", json={"name": "x", "platform": "mt4", "login": LOGIN}).json()
        files.poll()
        p = os.path.join(files.dir, f"journal_open_{LOGIN}.csv")
        old = time.time() - 60
        os.utime(p, (old, old))
        files.poll()
        assert c.get(f"/accounts/{acc['id']}/live").json()["connected"] is False


def test_partial_or_garbage_files_do_not_crash():
    d = tempfile.mkdtemp()
    with open(os.path.join(d, f"journal_open_{LOGIN}.csv"), "w") as f:
        f.write("#v1\nA;broken\nO;1;2\nH;x\n\n")
    bridge.poll_once(d)  # must simply ignore the bad lines
