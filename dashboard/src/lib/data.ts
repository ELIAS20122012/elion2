import type { UTCTimestamp } from "lightweight-charts";

export interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Trade {
  ticket: string;
  symbol: string;
  direction: "buy" | "sell";
  volume: number;
  open_time: number;
  open_price: number;
  close_time: number | null;
  close_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  profit: number | null;
  status: string;
}

/** A drawing produced by a rule (trend line, divergence line, ...). */
export interface OverlayLine {
  id: string;
  points: { time: UTCTimestamp; value: number }[];
  color: string;
  width?: number;
  dashed?: boolean;
  /** where to draw it: on the candles (default) or inside the MACD pane */
  pane?: "price" | "macd";
}

export interface OverlayMarker {
  time: UTCTimestamp;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text?: string;
}

export interface Overlay {
  lines: OverlayLine[];
  markers: OverlayMarker[];
}

export const TIMEFRAMES = [
  { label: "M1", sec: 60 },
  { label: "M5", sec: 300 },
  { label: "M15", sec: 900 },
  { label: "M30", sec: 1800 },
  { label: "H1", sec: 3600 },
  { label: "H4", sec: 14400 },
] as const;

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

export function aggregate(m1: Candle[], tfSec: number): Candle[] {
  if (tfSec === 60) return m1;
  const out: Candle[] = [];
  for (const c of m1) {
    const t = (Math.floor(c.time / tfSec) * tfSec) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      if (c.volume != null) last.volume = (last.volume ?? 0) + c.volume;
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

export function fmtPrice(n: number | null | undefined): string {
  return n == null ? "—" : n.toFixed(2);
}

export function fmtTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function fmtDateTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
