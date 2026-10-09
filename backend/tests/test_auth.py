"""The gate: who may read, who may write, and who may send an order."""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

os.environ["JOURNAL_NO_BRIDGE"] = "1"  # no MT terminal, no file watcher, in tests


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


def add_user(client, name, password, role):
    from journal import auth, db

    with db.db() as con:
        return auth.create_user(con, name, password, role)


def test_api_is_open_until_the_first_account_exists(client):
    """A fresh install must not lock its owner out before they can create an account."""
    assert client.get("/accounts").status_code == 200
    assert client.get("/auth/me").json() == {"user": None, "setup": True}


def test_once_a_user_exists_the_api_refuses_anonymous_callers(client):
    add_user(client, "elias", "a-good-password", "admin")
    assert client.get("/accounts").status_code == 401
    assert client.get("/health").status_code == 200  # still reachable, so uptime checks keep working
    assert client.get("/auth/me").json()["setup"] is False


def test_sign_in_then_read(client):
    add_user(client, "elias", "a-good-password", "admin")
    bad = client.post("/auth/login", json={"username": "elias", "password": "wrong"})
    assert bad.status_code == 401

    ok = client.post("/auth/login", json={"username": "ELIAS", "password": "a-good-password"})
    assert ok.status_code == 200
    assert ok.json()["user"]["role"] == "admin"
    assert client.get("/accounts").status_code == 200

    client.post("/auth/logout")
    assert client.get("/accounts").status_code == 401


def test_a_viewer_may_read_but_never_write(client):
    add_user(client, "student", "a-good-password", "viewer")
    client.post("/auth/login", json={"username": "student", "password": "a-good-password"})

    assert client.get("/accounts").status_code == 200
    assert client.post("/accounts", json={"name": "mine", "platform": "mt5"}).status_code == 403
    assert client.get("/auth/users").status_code == 403


def test_a_viewer_can_never_place_an_order(client):
    """The one refusal that costs money if it ever stops working."""
    add_user(client, "admin", "a-good-password", "admin")
    client.post("/auth/login", json={"username": "admin", "password": "a-good-password"})
    made = client.post("/accounts", json={"name": "acct", "platform": "mt5", "login": "1"})
    account_id = made.json()["id"]
    client.post("/auth/logout")

    add_user(client, "student", "a-good-password", "viewer")
    client.post("/auth/login", json={"username": "student", "password": "a-good-password"})
    order = client.post(f"/accounts/{account_id}/order", json={"symbol": "XAUUSD", "side": "buy", "volume": 0.01})
    assert order.status_code == 403

    client.post("/auth/logout")
    assert client.post(f"/accounts/{account_id}/order",
                       json={"symbol": "XAUUSD", "side": "buy", "volume": 0.01}).status_code == 401


def test_a_disabled_account_cannot_sign_in_and_loses_its_session(client):
    from journal import auth, db

    add_user(client, "gone", "a-good-password", "viewer")
    client.post("/auth/login", json={"username": "gone", "password": "a-good-password"})
    assert client.get("/accounts").status_code == 200

    with db.db() as con:
        auth.set_disabled(con, "gone", True)
    assert client.get("/accounts").status_code == 401
    assert client.post("/auth/login", json={"username": "gone", "password": "a-good-password"}).status_code == 401


def test_changing_a_password_ends_open_sessions(client):
    from journal import auth, db

    add_user(client, "elias", "a-good-password", "admin")
    client.post("/auth/login", json={"username": "elias", "password": "a-good-password"})
    assert client.get("/accounts").status_code == 200

    with db.db() as con:
        auth.set_password(con, "elias", "a-different-password")
    assert client.get("/accounts").status_code == 401


def test_the_database_never_holds_a_usable_password_or_token(client):
    from journal import db

    add_user(client, "elias", "a-good-password", "admin")
    token = client.post("/auth/login", json={"username": "elias", "password": "a-good-password"}).json()["token"]
    with db.db() as con:
        stored = con.execute("SELECT password_hash FROM users WHERE username='elias'").fetchone()["password_hash"]
        rows = [r["token_hash"] for r in con.execute("SELECT token_hash FROM sessions")]
    assert "a-good-password" not in stored and stored.startswith("$2")
    assert token not in rows
