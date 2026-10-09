"""A fabricated journal, for the public demo site.

    python -m journal.demo OUT_FILE

Writes a snapshot.json with exactly the shape journal.snapshot.build() produces, but filled with
invented trades on an invented account. Nothing here touches the real database, so the demo site
can be published without a login and still leak nothing: no account number, no balance, no trade
of yours. It is also a fuller journal than the real one - every setup, note and emotion is filled -
which is what makes the pages worth looking at.

Deterministic: the same seed always produces the same journal, so rebuilding does not churn.
"""
import json
import random
import sys
import time

SEED = 20260925
DAYS = 90
SYMBOLS = [("XAUUSD", 100, 4300.0, 9.0), ("EURUSD", 100_000, 1.0850, 0.004), ("GBPUSD", 100_000, 1.2720, 0.005)]
SETUPS = ["Level Continuation", "Liquidity Sweep", "Hidden Divergence", "Break & Retest", "Range Fade"]
EMOTIONS = ["calm", "confident", "hesitant", "fomo", "revenge"]
NOTES = [
    "Waited for the retest instead of chasing the first push.",
    "Entry was fine, but I moved the stop early and gave back most of it.",
    "Took this one because I was bored. It did not meet the rule.",
    "Textbook sweep into the level; held to target without touching it.",
    "Session was quiet, size was correct, result was the plan working.",
    "Cut it as soon as the reason for being in it disappeared.",
    "Added on the way down. That is the mistake, not the entry.",
]
ERRORS = [None, None, None, None, "moved stop", "oversized", "no setup", "revenge entry"]


def build(now: int | None = None) -> dict:
    rnd = random.Random(SEED)
    now = now or int(time.time())
    start = now - DAYS * 86_400
    account_id = 1
    balance = 5_000.0

    trades: list[dict] = []
    equity: list[dict] = []
    ticket = 500_100

    for day in range(DAYS):
        day_start = start + day * 86_400
        if time.gmtime(day_start).tm_wday >= 5:  # no weekend trading
            continue
        for _ in range(rnd.choices([0, 1, 2, 3], weights=[18, 34, 32, 16])[0]):
            symbol, contract, price, spread = SYMBOLS[rnd.choices([0, 1, 2], weights=[60, 25, 15])[0]]
            direction = rnd.choice(["buy", "sell"])
            sign = 1 if direction == "buy" else -1

            open_time = day_start + rnd.randint(7 * 3600, 20 * 3600)
            open_price = round(price * (1 + rnd.uniform(-0.012, 0.012)), 5 if contract > 1000 else 2)
            risk = spread * rnd.uniform(1.6, 3.4)
            # Size from the risk, not the other way round: about 1% of the balance on the stop.
            # It keeps the equity curve believable and models the habit the journal is meant to build.
            volume = max(0.01, round(balance * rnd.uniform(0.005, 0.013) / (risk * contract), 2))
            sl = round(open_price - sign * risk, 5 if contract > 1000 else 2)
            tp = round(open_price + sign * risk * rnd.uniform(1.6, 3.2), 5 if contract > 1000 else 2)

            # A modest, believable edge: slightly under half the trades win, but the winners are bigger.
            # Deliberately not spectacular - a demo that shows 300% a quarter reads as a fake track record.
            won = rnd.random() < 0.48
            r = rnd.uniform(0.7, 2.2) if won else -rnd.uniform(0.6, 1.05)
            close_price = round(open_price + sign * risk * r, 5 if contract > 1000 else 2)
            profit = round((close_price - open_price) * contract * volume * sign, 2)
            commission = -round(volume * (3.5 if contract > 1000 else 2.0), 2)
            swap = round(rnd.uniform(-0.6, 0.15) * volume, 2)
            close_time = open_time + rnd.randint(4, 260) * 60

            best = max(r, rnd.uniform(0.4, 2.2)) if not won else r * rnd.uniform(1.0, 1.25)
            worst = min(r, -rnd.uniform(0.15, 0.9))
            balance += profit + commission + swap
            ticket += rnd.randint(1, 9)

            trades.append({
                "id": len(trades) + 1, "account_id": account_id, "ticket": str(ticket), "symbol": symbol,
                "direction": direction, "volume": volume, "open_time": open_time, "open_price": open_price,
                "close_time": close_time, "close_price": close_price, "sl": sl, "tp": tp,
                "commission": commission, "swap": swap, "profit": profit, "comment": None, "source": "demo",
                "mfe": round(risk * best * contract * volume, 2), "mae": round(risk * worst * contract * volume, 2),
                "setup_valid": rnd.choices(["yes", "no", "unsure"], weights=[70, 20, 10])[0],
                "setup_id": rnd.choice(SETUPS), "emotion": rnd.choice(EMOTIONS),
                "error": rnd.choice(ERRORS), "note": rnd.choice(NOTES),
            })
            equity.append({"time": close_time, "balance": round(balance, 2), "equity": round(balance, 2)})

    equity.sort(key=lambda e: e["time"])
    data = {
        "version": 1,
        "accounts": [{
            "id": account_id, "name": "Demo Account", "platform": "mt5", "kind": "manual", "broker": "Demo Broker",
            "login": "00000000", "currency": "USD", "is_live": False, "initial_balance": 5_000.0,
            "note": "Sample data - not a real account.", "created_at": start, "terminal_path": None,
            "enabled": True, "trade_count": len(trades),
            "last_trade_time": max((t["close_time"] for t in trades), default=None),
        }],
        "trades": {str(account_id): trades},
        "snapshots": {str(account_id): equity},
        "rule_labels": {},
        "demo": True,
    }
    data["digest"] = "demo"
    data["generated_at"] = now
    return data


if __name__ == "__main__":
    out = sys.argv[1]
    data = build()
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    t = data["trades"]["1"]
    wins = [x for x in t if x["profit"] + x["commission"] + x["swap"] > 0]
    print(json.dumps({
        "path": out, "trades": len(t), "win_rate": f"{100 * len(wins) / len(t):.0f}%",
        "net": round(sum(x["profit"] + x["commission"] + x["swap"] for x in t), 2),
        "equity_points": len(data["snapshots"]["1"]),
    }, indent=2))
