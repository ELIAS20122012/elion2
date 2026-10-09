import type { Candle } from "./data";

export type ToolId =
  | "cursor" | "eraser"
  | "trend" | "ray" | "extended" | "infoline" | "angle" | "hline" | "hray" | "vline" | "crossline" | "arrow"
  | "channel" | "fib" | "fibext"
  | "abcd" | "xabcd" | "hs" | "elliott5" | "elliott3"
  | "long" | "short" | "measure" | "pricerange" | "daterange"
  | "rect" | "circle" | "ellipse" | "triangle"
  | "text" | "callout" | "pricelabel" | "arrowup" | "arrowdown" | "flag";

export interface DPoint { time: number; price: number }

export interface Drawing {
  id: string;
  type: Exclude<ToolId, "cursor" | "eraser">;
  points: DPoint[];
  color: string;
  text?: string;
  width?: number;
  dashed?: boolean;
}

export const TOOLS: { id: ToolId; label: string; icon: string; points: number }[] = [
  { id: "cursor", label: "Cursor", icon: "cursor", points: 0 },
  { id: "eraser", label: "Eraser", icon: "x", points: 0 },
  { id: "trend", label: "Trend Line", icon: "trend", points: 2 },
  { id: "ray", label: "Ray", icon: "ray", points: 2 },
  { id: "extended", label: "Extended Line", icon: "trend", points: 2 },
  { id: "infoline", label: "Info Line", icon: "trend", points: 2 },
  { id: "angle", label: "Trend Angle", icon: "trend", points: 2 },
  { id: "hline", label: "Horizontal Line", icon: "hline", points: 1 },
  { id: "hray", label: "Horizontal Ray", icon: "hray", points: 1 },
  { id: "vline", label: "Vertical Line", icon: "vline", points: 1 },
  { id: "crossline", label: "Cross Line", icon: "hline", points: 1 },
  { id: "arrow", label: "Arrow", icon: "ray", points: 2 },
  { id: "channel", label: "Parallel Channel", icon: "channel", points: 3 },
  { id: "fib", label: "Fib Retracement", icon: "fib", points: 2 },
  { id: "fibext", label: "Trend-Based Fib Extension", icon: "fib", points: 3 },
  { id: "abcd", label: "ABCD Pattern", icon: "trend", points: 4 },
  { id: "xabcd", label: "XABCD Pattern", icon: "trend", points: 5 },
  { id: "hs", label: "Head and Shoulders", icon: "trend", points: 7 },
  { id: "elliott5", label: "Elliott Impulse Wave (12345)", icon: "trend", points: 6 },
  { id: "elliott3", label: "Elliott Correction Wave (ABC)", icon: "trend", points: 4 },
  { id: "long", label: "Long Position", icon: "measure", points: 1 },
  { id: "short", label: "Short Position", icon: "measure", points: 1 },
  { id: "measure", label: "Date and Price Range", icon: "measure", points: 2 },
  { id: "pricerange", label: "Price Range", icon: "measure", points: 2 },
  { id: "daterange", label: "Date Range", icon: "measure", points: 2 },
  { id: "rect", label: "Rectangle", icon: "rect", points: 2 },
  { id: "circle", label: "Circle", icon: "rect", points: 2 },
  { id: "ellipse", label: "Ellipse", icon: "rect", points: 2 },
  { id: "triangle", label: "Triangle", icon: "rect", points: 3 },
  { id: "text", label: "Text", icon: "text", points: 1 },
  { id: "callout", label: "Callout", icon: "text", points: 2 },
  { id: "pricelabel", label: "Price Label", icon: "tag", points: 1 },
  { id: "arrowup", label: "Arrow Mark Up", icon: "trend", points: 1 },
  { id: "arrowdown", label: "Arrow Mark Down", icon: "trend", points: 1 },
  { id: "flag", label: "Flag Mark", icon: "tag", points: 1 },
];

/** Drawing-mode switches shared by the toolbar and the chart (TradingView's bottom-of-toolbar toggles). */
export type CursorStyle = "cross" | "dot" | "arrow";
export const drawState = {
  stay: false,      // keep the tool after finishing a drawing
  locked: false,    // drawings can't be moved
  hidden: false,    // drawings not painted
  cursor: "cross" as CursorStyle,
  subs: new Set<() => void>(),
  set(patch: Partial<{ stay: boolean; locked: boolean; hidden: boolean; cursor: CursorStyle }>) {
    Object.assign(drawState, patch);
    drawState.subs.forEach((f) => f());
  },
};

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT_LEVELS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];

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
