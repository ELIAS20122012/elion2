"""Pretends to be the MT4 JournalBridge indicator, for testing the journal without MT4.

    python tools/simulate_mt4.py open  <login> <floating_profit> [ticket]
    python tools/simulate_mt4.py close <login> <final_profit> [ticket]
    python tools/simulate_mt4.py clean <login>

Writes the same files the real indicator writes into MetaQuotes\\Terminal\\Common\\Files.
"""
import os
import sys
import time

COMMON = os.environ.get("MT_COMMON_DIR") or os.path.join(os.environ["APPDATA"], "MetaQuotes", "Terminal", "Common", "Files")
NOW = int(time.time())


def path(kind: str, login: str) -> str:
    return os.path.join(COMMON, f"journal_{kind}_{login}.csv")


def write(kind: str, login: str, body: str) -> None:
    with open(path(kind, login), "w", encoding="utf-8") as f:
        f.write("#v1\n" + body)


def account(login: str, equity: float) -> str:
    return f"A;{login};RoboForex-Pro (SIMULATED);RoboForex Ltd;1000.00;{equity:.2f};0.00;USD;{NOW}\n"


def open_row(ticket: str, profit: float) -> str:
    return f"O;{ticket};XAUUSD;buy;0.10;{NOW - 90};4380.10000000;0.00000000;0.00000000;{profit:.2f};0.00;-0.70;sim\n"


def hist_row(ticket: str, profit: float) -> str:
    return f"H;{ticket};XAUUSD;buy;0.10;{NOW - 90};4380.10000000;{NOW};4381.20000000;0.00000000;0.00000000;{profit:.2f};0.00;-0.70;sim\n"


if __name__ == "__main__":
    cmd, login = sys.argv[1], sys.argv[2]
    if cmd == "open":
        p = float(sys.argv[3])
        write("open", login, account(login, 1000 + p) + open_row(sys.argv[4] if len(sys.argv) > 4 else "8001", p))
    elif cmd == "close":
        p = float(sys.argv[3])
        t = sys.argv[4] if len(sys.argv) > 4 else "8001"
        write("hist", login, hist_row(t, p))
        write("open", login, account(login, 1000 + p))
    elif cmd == "clean":
        for k in ("open", "hist"):
            if os.path.exists(path(k, login)):
                os.remove(path(k, login))
    print("ok", cmd)
