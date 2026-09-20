import { useEffect, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "./data";

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

/** Live M1 candles from the local MT5 bridge (backend/mt5_bridge.py). Only connects while `enabled`. */
export function useLive(enabled: boolean, url = "ws://localhost:8765") {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [status, setStatus] = useState<LiveStatus>("off");

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(url);
      ws.onopen = () => setStatus("live");
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "history") {
          setCandles(m.candles.map((c: Candle) => ({ ...c, time: c.time as UTCTimestamp })));
        } else if (m.type === "candle") {
          const c = { ...m.candle, time: m.candle.time as UTCTimestamp } as Candle;
          setCandles((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.time === c.time) return [...prev.slice(0, -1), c];
            if (last && c.time < last.time) return prev;
            return [...prev, c];
          });
        } else if (m.type === "account") {
          setAccount(m);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("down");
        timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, url]);

  return { candles, account, status };
}
