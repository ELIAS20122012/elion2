import type { Candle } from "./data";

export type ToolId = "cursor" | "trend" | "ray" | "hline" | "hray" | "vline" | "channel" | "rect" | "fib" | "measure" | "text";

export interface DPoint { time: number; price: number }

export interface Drawing {
  id: string;
  type: Exclude<ToolId, "cursor">;
  points: DPoint[];
  color: string;
  text?: string;
  width?: number;
  dashed?: boolean;
}

export const TOOLS: { id: ToolId; label: string; icon: string; points: number }[] = [
  { id: "cursor", label: "نشانگر / انتخاب", icon: "cursor", points: 0 },
  { id: "trend", label: "خط روند", icon: "trend", points: 2 },
  { id: "ray", label: "نیم‌خط", icon: "ray", points: 2 },
  { id: "hline", label: "خط افقی", icon: "hline", points: 1 },
  { id: "hray", label: "نیم‌خط افقی", icon: "hray", points: 1 },
  { id: "channel", label: "کانال موازی (۳ نقطه)", icon: "channel", points: 3 },
  { id: "vline", label: "خط عمودی", icon: "vline", points: 1 },
  { id: "rect", label: "مستطیل", icon: "rect", points: 2 },
  { id: "fib", label: "فیبوناچی اصلاحی", icon: "fib", points: 2 },
  { id: "measure", label: "اندازه‌گیر", icon: "measure", points: 2 },
  { id: "text", label: "متن", icon: "text", points: 1 },
];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Maps between time and the chart's logical (bar index) axis, extrapolating past both ends. */
export class TimeMap {
  constructor(private bars: Candle[], private tfSec: number) {}

  timeToLogical(t: number): number {
    const b = this.bars;
    const n = b.length;
    if (n === 0) return 0;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / this.tfSec;
    if (t <= b[0].time) return (t - b[0].time) / this.tfSec;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid].time <= t) lo = mid; else hi = mid;
    }
    return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
  }

  logicalToTime(l: number): number {
    const b = this.bars;
    const n = b.length;
    if (n === 0) return 0;
    if (l >= n - 1) return b[n - 1].time + (l - (n - 1)) * this.tfSec;
    if (l <= 0) return b[0].time + l * this.tfSec;
    const i = Math.floor(l);
    return b[i].time + (l - i) * (b[i + 1].time - b[i].time);
  }

  bar(l: number): Candle | undefined {
    return this.bars[Math.max(0, Math.min(this.bars.length - 1, Math.round(l)))];
  }
}

const KEY = "rt.drawings.v1";

export function loadDrawings(symbol: string): Drawing[] {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}.${symbol}`) ?? "[]");
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, d: Drawing[]) {
  try {
    localStorage.setItem(`${KEY}.${symbol}`, JSON.stringify(d));
  } catch {
    /* storage unavailable: drawings just won't persist */
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10);
