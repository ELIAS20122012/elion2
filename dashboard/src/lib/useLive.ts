import { useEffect, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "./data";
import { API_BASE } from "./journalApi";

export interface AccountInfo {
  login: number | null;
  server: string | null;
  demo: boolean;
  balance: number | null;
  equity: number | null;
  connected: boolean;
  symbol: string;
}

export type LiveStatus = "off" | "connecting" | "live" | "down";

/** How often the chart asks the journal server for the newest MT4 bars. */
const POLL_MS = 5_000;
/** No new bar for this long (seconds of wall time) = the EA has stopped feeding. */
const STALE_MS = 3 * 60_000;
/** Bars fetched on the first load (the server keeps 20,000 M1 bars per symbol). */
const FULL_COUNT = 20_000;

/**
 * Live M1 candles from MT4: RobotTradingEA posts them to the journal server (/events/candles),
 * the chart polls /robot/candles. Replaces the old MT5 WebSocket bridge. Only runs while `enabled`.
 */
export function useLive(enabled: boolean, symbol = "XAUUSD") {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<LiveStatus>("off");
  const [account] = useState<AccountInfo | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    let dead = false;
    let lastChange = Date.now();
    let lastKey = "";
    let have: Candle[] = [];
    let polls = 0;
    setStatus("connecting");
    const poll = async () => {
      try {
        // first load: the full history (~2 weeks of M1); afterwards only the last few minutes, merged in
        const last = have[have.length - 1];
        const q = last ? `since=${last.time - 300}&count=1000` : `count=${FULL_COUNT}`;
        const r = await fetch(`${API_BASE}/robot/candles?symbol=${encodeURIComponent(symbol)}&${q}`, { credentials: "same-origin" });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { candles: Candle[] };
        if (dead) return;
        const fresh = body.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp }));
        let list: Candle[];
        if (!last) list = fresh;
        else {
          const from = fresh.length ? fresh[0].time : Infinity;
          list = [...have.filter((c) => c.time < from), ...fresh];
        }
        // a backfill from the EA (older bars arriving later) needs a full reload now and then
        if (last && ++polls % 60 === 0) { have = []; lastKey = ""; return poll(); }
        have = list;
        const tail = list[list.length - 1];
        const key = tail ? `${tail.time}:${tail.close}` : "";
        if (key !== lastKey) {
          lastKey = key;
          lastChange = Date.now();
          setCandles(list);
        }
        setStatus(list.length && Date.now() - lastChange < STALE_MS ? "live" : "down");
      } catch {
        if (!dead) setStatus("down");
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [enabled, symbol]);

  return { candles, account, status };
}
