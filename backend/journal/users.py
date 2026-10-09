"""Manage who may sign in to the dashboard.

    .venv\\Scripts\\python.exe -m journal.users add elias --admin
    .venv\\Scripts\\python.exe -m journal.users list
    .venv\\Scripts\\python.exe -m journal.users passwd elias
    .venv\\Scripts\\python.exe -m journal.users disable someone
    .venv\\Scripts\\python.exe -m journal.users enable someone

The password is typed here and never appears on screen, in your shell history, or anywhere in this
repository - only its bcrypt hash reaches the database. Until the first account exists the API
answers everyone, so create yours before opening the site to anyone else.
"""
import argparse
import getpass
import sys
import time

from . import auth, db


def _utf8_console() -> None:
    """A Windows console defaults to a legacy codepage and raises on the first Persian character."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass  # already UTF-8, or a pipe that cannot be reconfigured


def _ask_password(prompt: str = "Password: ") -> str:
    first = getpass.getpass(prompt)
    if getpass.getpass("Repeat: ") != first:
        sys.exit("رمزها یکی نیستند.")
    if len(first) < 8:
        sys.exit("رمز باید حداقل ۸ نویسه باشد.")
    return first


def _when(ts: int | None) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)) if ts else "—"


def main() -> int:
    p = argparse.ArgumentParser(prog="journal.users", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="create an account")
    a.add_argument("username")
    a.add_argument("--admin", action="store_true", help="full access, including placing orders")

    sub.add_parser("list", help="show the accounts")

    for name, help_text in (("passwd", "change a password"), ("disable", "block sign-in"), ("enable", "allow sign-in")):
        q = sub.add_parser(name, help=help_text)
        q.add_argument("username")

    args = p.parse_args()
    _utf8_console()
    db.init()

    with db.db() as con:
        if args.cmd == "list":
            users = auth.list_users(con)
            if not users:
                print("هیچ کاربری ساخته نشده — API هنوز باز است.")
                return 0
            print(f"{'id':>3}  {'username':<20} {'role':<7} {'state':<9} {'last login':<16}")
            for u in users:
                print(f"{u['id']:>3}  {u['username']:<20} {u['role']:<7} "
                      f"{'disabled' if u['disabled'] else 'active':<9} {_when(u['last_login']):<16}")
            return 0

        try:
            if args.cmd == "add":
                first = auth.setup_mode(con)
                role = "admin" if args.admin or first else "viewer"
                if first and not args.admin:
                    print("این اولین حساب است، پس ادمین ساخته می‌شود.")
                user = auth.create_user(con, args.username, _ask_password(), role)
                print(f"ساخته شد: {user['username']} ({user['role']})")
            elif args.cmd == "passwd":
                auth.set_password(con, args.username, _ask_password("New password: "))
                print(f"رمز {args.username} عوض شد؛ نشست‌های بازش بسته شدند.")
            else:
                auth.set_disabled(con, args.username, args.cmd == "disable")
                print(f"{args.username} {'غیرفعال' if args.cmd == 'disable' else 'فعال'} شد.")
        except ValueError as e:
            sys.exit(str(e))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
