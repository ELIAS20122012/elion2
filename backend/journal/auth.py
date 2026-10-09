"""Accounts and sessions for the dashboard.

Real server-side authentication: passwords are bcrypt hashes, sessions are random tokens stored
only as hashes, and the API — not the browser — decides what a caller may do. A visitor who edits
localStorage gets nothing.

Two roles:

    admin   full access, and the only one who may create users or send an order
    viewer  read-only: every write is refused, including anything under /accounts/{id}/order

Until the first user exists the API stays open, so a fresh install is never locked out of itself.
Create that first user with:

    .venv\\Scripts\\python.exe -m journal.users add <name> --admin
"""
import hashlib
import secrets
import sqlite3
import time

import bcrypt

COOKIE = "elion_session"
DAY = 86_400
SESSION_TTL = DAY  # absolute cap on one sign-in
SHORT_TTL = DAY
#: A session only lives this long without a request. An open dashboard polls every few seconds (even a
#: throttled background tab checks in about once a minute), so it stays signed in; once the browser is
#: closed the polling stops and the session dies. This holds even when the browser restores its session
#: cookies on restart (Chrome's "continue where you left off"), which a plain session cookie cannot beat.
IDLE_TTL = 180

ROLES = ("admin", "viewer")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), stored.encode())
    except ValueError:
        return False  # a malformed hash must read as "wrong password", never as an exception


def _token_hash(token: str) -> str:
    """Sessions are stored hashed: a stolen database still cannot be used to log in."""
    return hashlib.sha256(token.encode()).hexdigest()


def count_users(con: sqlite3.Connection) -> int:
    return con.execute("SELECT COUNT(*) n FROM users").fetchone()["n"]


def setup_mode(con: sqlite3.Connection) -> bool:
    """No accounts yet, so the API cannot demand one."""
    return count_users(con) == 0


def create_user(con: sqlite3.Connection, username: str, password: str, role: str = "viewer") -> dict:
    username = username.strip()
    if not username:
        raise ValueError("نام کاربری خالی است")
    if len(password) < 8:
        raise ValueError("رمز باید حداقل ۸ نویسه باشد")
    if role not in ROLES:
        raise ValueError(f"نقش باید یکی از {ROLES} باشد")
    try:
        cur = con.execute(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)",
            (username, hash_password(password), role, int(time.time())),
        )
    except sqlite3.IntegrityError:
        raise ValueError(f"کاربر «{username}» از قبل هست") from None
    return user_dict(con.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone())


def set_password(con: sqlite3.Connection, username: str, password: str) -> None:
    if len(password) < 8:
        raise ValueError("رمز باید حداقل ۸ نویسه باشد")
    cur = con.execute(
        "UPDATE users SET password_hash=? WHERE username=? COLLATE NOCASE", (hash_password(password), username.strip())
    )
    if not cur.rowcount:
        raise ValueError(f"کاربر «{username}» پیدا نشد")
    con.execute(  # changing the password ends every open session for that user
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=? COLLATE NOCASE)",
        (username.strip(),),
    )


def set_disabled(con: sqlite3.Connection, username: str, disabled: bool) -> None:
    cur = con.execute("UPDATE users SET disabled=? WHERE username=? COLLATE NOCASE", (int(disabled), username.strip()))
    if not cur.rowcount:
        raise ValueError(f"کاربر «{username}» پیدا نشد")
    if disabled:
        con.execute(
            "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=? COLLATE NOCASE)",
            (username.strip(),),
        )


def user_dict(row: sqlite3.Row | None) -> dict:
    if row is None:
        return {}
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "disabled": bool(row["disabled"]),
        "created_at": row["created_at"],
        "last_login": row["last_login"],
    }


def list_users(con: sqlite3.Connection) -> list[dict]:
    return [user_dict(r) for r in con.execute("SELECT * FROM users ORDER BY id")]


def login(con: sqlite3.Connection, username: str, password: str, remember: bool = True) -> tuple[str, dict, int] | None:
    """Returns (token, user, ttl_seconds), or None when the name or password is wrong."""
    row = con.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username.strip(),)).fetchone()
    if row is None:
        # Spend the same time as a real check would, so a wrong name and a wrong password are
        # indistinguishable from the outside.
        verify_password(password, "$2b$12$" + "." * 53)
        return None
    if row["disabled"] or not verify_password(password, row["password_hash"]):
        return None

    token = secrets.token_urlsafe(32)
    now = int(time.time())
    ttl = SESSION_TTL if remember else SHORT_TTL
    con.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (_token_hash(token), row["id"], now, now + IDLE_TTL),
    )
    con.execute("UPDATE users SET last_login=? WHERE id=?", (now, row["id"]))
    con.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))  # tidy up as we go
    return token, user_dict(row), ttl


def session_user(con: sqlite3.Connection, token: str | None) -> dict | None:
    if not token:
        return None
    now = int(time.time())
    th = _token_hash(token)
    row = con.execute(
        """SELECT u.*, s.created_at AS s_created FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0""",
        (th, now),
    ).fetchone()
    if row is None:
        return None
    # slide the idle window forward, but never past the absolute cap
    con.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?", (min(now + IDLE_TTL, row["s_created"] + SESSION_TTL), th))
    return user_dict(row)


def logout(con: sqlite3.Connection, token: str | None) -> None:
    if token:
        con.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(token),))
