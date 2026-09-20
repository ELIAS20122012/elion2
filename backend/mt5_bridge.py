"""Read-only bridge: MT5 terminal -> WebSocket -> dashboard.

Never sends orders. Streams M1 candles of one symbol (history on connect, then live updates).

    python mt5_bridge.py [SYMBOL] [PORT] [TERMINAL_PATH]

TERMINAL_PATH (optional) picks which MT5 terminal the prices come from when several are installed.
"""
import asyncio
import json
import sys

import MetaTrader5 as mt5
from websockets.asyncio.server import serve

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "XAUUSD"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
TERMINAL_PATH = sys.argv[3] if len(sys.argv) > 3 else None
HISTORY = 10000  # M1 candles sent on connect (about a week of XAUUSD)
POLL_SECONDS = 0.25

clients = set()


def candle(r):
    return {"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
            "low": float(r["low"]), "close": float(r["close"]), "volume": int(r["tick_volume"])}


def account_msg():
    a = mt5.account_info()
    t = mt5.terminal_info()
    return {
        "type": "account",
        "login": a.login if a else None,
        "server": a.server if a else None,
        "demo": bool(a) and a.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO,
        "balance": a.balance if a else None,
        "equity": a.equity if a else None,
        "connected": bool(t and t.connected),
        "symbol": SYMBOL,
    }


def history_msg():
    rates = mt5.copy_rates_from_pos(SYMBOL, mt5.TIMEFRAME_M1, 0, HISTORY)
    return {"type": "history", "symbol": SYMBOL, "candles": [candle(r) for r in (rates if rates is not None else [])]}


async def handler(ws):
    clients.add(ws)
    try:
        await ws.send(json.dumps(account_msg()))
        await ws.send(json.dumps(history_msg()))
        await ws.wait_closed()
    finally:
        clients.discard(ws)


async def poll():
    last = None
    ticks = 0
    while True:
        await asyncio.sleep(POLL_SECONDS)
        if not clients:
            continue
        rates = mt5.copy_rates_from_pos(SYMBOL, mt5.TIMEFRAME_M1, 0, 1)
        if rates is not None and len(rates):
            c = candle(rates[0])
            if c != last:
                last = c
                msg = json.dumps({"type": "candle", "candle": c})
                for ws in list(clients):
                    asyncio.create_task(ws.send(msg))
        ticks += 1
        if ticks % 20 == 0:  # ~ every 5 s
            msg = json.dumps(account_msg())
            for ws in list(clients):
                asyncio.create_task(ws.send(msg))


async def main():
    if not (mt5.initialize(path=TERMINAL_PATH) if TERMINAL_PATH else mt5.initialize()):
        sys.exit(f"MT5 initialize failed: {mt5.last_error()}")
    if not mt5.symbol_select(SYMBOL, True):
        sys.exit(f"Symbol {SYMBOL} not available: {mt5.last_error()}")
    a = mt5.account_info()
    print(f"MT5 connected: account {a.login} on {a.server} (demo={a.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO})")
    print(f"Streaming {SYMBOL} M1 on ws://localhost:{PORT}  (read-only, no orders)")
    async with serve(handler, "localhost", PORT):
        await poll()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        mt5.shutdown()
