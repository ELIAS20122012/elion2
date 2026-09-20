import type { UTCTimestamp } from "lightweight-charts";
import type { Candle, OverlayMarker } from "./data";

/* ---------- math helpers (NaN = "no value") ---------- */

const nan = () => NaN;
const series = (n: number) => Array.from({ length: n }, nan);
const fin = Number.isFinite;

export function sma(a: number[], n: number): number[] {
  const out = series(a.length);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < a.length; i++) {
    if (fin(a[i])) { sum += a[i]; cnt++; } else { sum = 0; cnt = 0; }
    if (cnt > n) { sum -= a[i - n]; cnt--; }
    if (cnt === n) out[i] = sum / n;
  }
  return out;
}

export function ema(a: number[], n: number): number[] {
  const out = series(a.length);
  const k = 2 / (n + 1);
  let prev = NaN;
  let run = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (!fin(a[i])) { prev = NaN; run = 0; sum = 0; continue; }
    if (fin(prev)) { prev = a[i] * k + prev * (1 - k); out[i] = prev; continue; }
    run++; sum += a[i];
    if (run === n) { prev = sum / n; out[i] = prev; }
  }
  return out;
}

/** Wilder's smoothing (RMA) */
function rma(a: number[], n: number): number[] {
  const out = series(a.length);
  let prev = NaN;
  let run = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (!fin(a[i])) continue;
    if (fin(prev)) { prev = (prev * (n - 1) + a[i]) / n; out[i] = prev; continue; }
    run++; sum += a[i];
    if (run === n) { prev = sum / n; out[i] = prev; }
  }
  return out;
}

export function wma(a: number[], n: number): number[] {
  const out = series(a.length);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < a.length; i++) {
    let s = 0;
    let ok = true;
    for (let j = 0; j < n; j++) {
      const v = a[i - n + 1 + j];
      if (!fin(v)) { ok = false; break; }
      s += v * (j + 1);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

function stdev(a: number[], n: number): number[] {
  const m = sma(a, n);
  const out = series(a.length);
  for (let i = n - 1; i < a.length; i++) {
    if (!fin(m[i])) continue;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (a[j] - m[i]) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

function highest(a: number[], n: number): number[] {
  const out = series(a.length);
  for (let i = n - 1; i < a.length; i++) out[i] = Math.max(...a.slice(i - n + 1, i + 1));
  return out;
}
function lowest(a: number[], n: number): number[] {
  const out = series(a.length);
  for (let i = n - 1; i < a.length; i++) out[i] = Math.min(...a.slice(i - n + 1, i + 1));
  return out;
}

function trueRange(c: Candle[]): number[] {
  return c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
}
export const atr = (c: Candle[], n: number) => rma(trueRange(c), n);

export function macd(closes: number[], fast: number, slow: number, signal: number) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, sig, hist };
}

function rsi(closes: number[], n: number): number[] {
  const gain = closes.map((v, i) => (i === 0 ? NaN : Math.max(v - closes[i - 1], 0)));
  const loss = closes.map((v, i) => (i === 0 ? NaN : Math.max(closes[i - 1] - v, 0)));
  const ag = rma(gain, n);
  const al = rma(loss, n);
  return closes.map((_, i) => (fin(ag[i]) && fin(al[i]) ? (al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])) : NaN));
}

/* ---------- output model ---------- */

export interface Pt { time: UTCTimestamp; value: number; color?: string }
export interface SeriesOut {
  name: string;
  kind: "line" | "hist" | "dots";
  color: string;
  width?: number;
  data: Pt[];
}
export interface IndicatorOutput {
  series: SeriesOut[];
  markers?: OverlayMarker[];
  levels?: { value: number; color?: string }[]; // horizontal guide lines in a pane
}

export interface ParamDef { key: string; label: string; def: number; step?: number; min?: number }
export interface IndicatorDef {
  id: string;
  name: string;
  group: "overlay" | "pane";
  desc: string;
  params: ParamDef[];
  compute: (c: Candle[], p: Record<string, number>, tfSec: number) => IndicatorOutput;
}

const P = (key: string, label: string, def: number, step = 1, min = 1): ParamDef => ({ key, label, def, step, min });

function toPts(c: Candle[], vals: number[], colorFn?: (i: number) => string | undefined): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < c.length; i++) if (fin(vals[i])) out.push({ time: c[i].time, value: vals[i], color: colorFn?.(i) });
  return out;
}
const line = (name: string, color: string, data: Pt[], width = 2): SeriesOut => ({ name, kind: "line", color, data, width });
const closes = (c: Candle[]) => c.map((x) => x.close);

/** time of bar i, extrapolating past the last bar (used for shifted Ichimoku lines) */
function timeAt(c: Candle[], i: number, tfSec: number): UTCTimestamp {
  if (i < c.length) return c[Math.max(i, 0)].time;
  return (c[c.length - 1].time + (i - (c.length - 1)) * tfSec) as UTCTimestamp;
}

/* ---------- registry ---------- */

export const INDICATORS: IndicatorDef[] = [
  {
    id: "sma", name: "SMA", group: "overlay", desc: "میانگین متحرک ساده", params: [P("n", "دوره", 20)],
    compute: (c, p) => ({ series: [line(`SMA ${p.n}`, "#f5c542", toPts(c, sma(closes(c), p.n)))] }),
  },
  {
    id: "ema", name: "EMA", group: "overlay", desc: "میانگین متحرک نمایی", params: [P("n", "دوره", 20)],
    compute: (c, p) => ({ series: [line(`EMA ${p.n}`, "#4da3ff", toPts(c, ema(closes(c), p.n)))] }),
  },
  {
    id: "wma", name: "WMA", group: "overlay", desc: "میانگین متحرک وزنی", params: [P("n", "دوره", 20)],
    compute: (c, p) => ({ series: [line(`WMA ${p.n}`, "#c084fc", toPts(c, wma(closes(c), p.n)))] }),
  },
  {
    id: "hma", name: "HMA", group: "overlay", desc: "میانگین متحرک هال", params: [P("n", "دوره", 21)],
    compute: (c, p) => {
      const cl = closes(c);
      const half = wma(cl, Math.max(1, Math.floor(p.n / 2)));
      const full = wma(cl, p.n);
      const raw = cl.map((_, i) => 2 * half[i] - full[i]);
      return { series: [line(`HMA ${p.n}`, "#34d399", toPts(c, wma(raw, Math.max(1, Math.round(Math.sqrt(p.n))))))] };
    },
  },
  {
    id: "bb", name: "Bollinger Bands", group: "overlay", desc: "باندهای بولینگر", params: [P("n", "دوره", 20), P("k", "ضریب", 2, 0.1, 0.1)],
    compute: (c, p) => {
      const m = sma(closes(c), p.n);
      const sd = stdev(closes(c), p.n);
      return {
        series: [
          line("BB بالا", "#60a5fa", toPts(c, m.map((v, i) => v + p.k * sd[i])), 1),
          line("BB میانه", "#f59e0b", toPts(c, m), 1),
          line("BB پایین", "#60a5fa", toPts(c, m.map((v, i) => v - p.k * sd[i])), 1),
        ],
      };
    },
  },
  {
    id: "keltner", name: "Keltner Channels", group: "overlay", desc: "کانال کلتنر", params: [P("n", "دوره", 20), P("k", "ضریب ATR", 2, 0.1, 0.1)],
    compute: (c, p) => {
      const m = ema(closes(c), p.n);
      const a = atr(c, 10);
      return {
        series: [
          line("KC بالا", "#a78bfa", toPts(c, m.map((v, i) => v + p.k * a[i])), 1),
          line("KC میانه", "#a78bfa", toPts(c, m), 1),
          line("KC پایین", "#a78bfa", toPts(c, m.map((v, i) => v - p.k * a[i])), 1),
        ],
      };
    },
  },
  {
    id: "donchian", name: "Donchian Channels", group: "overlay", desc: "کانال دونچیان", params: [P("n", "دوره", 20)],
    compute: (c, p) => {
      const hi = highest(c.map((x) => x.high), p.n);
      const lo = lowest(c.map((x) => x.low), p.n);
      return {
        series: [
          line("DC بالا", "#38bdf8", toPts(c, hi), 1),
          line("DC میانه", "#94a3b8", toPts(c, hi.map((v, i) => (v + lo[i]) / 2)), 1),
          line("DC پایین", "#38bdf8", toPts(c, lo), 1),
        ],
      };
    },
  },
  {
    id: "supertrend", name: "Supertrend", group: "overlay", desc: "سوپرترند", params: [P("n", "دوره ATR", 10), P("k", "ضریب", 3, 0.1, 0.1)],
    compute: (c, p) => {
      const a = atr(c, p.n);
      const st = series(c.length);
      const up = c.map(() => true);
      let fu = NaN;
      let fl = NaN;
      for (let i = 0; i < c.length; i++) {
        if (!fin(a[i])) continue;
        const mid = (c[i].high + c[i].low) / 2;
        const bu = mid + p.k * a[i];
        const bl = mid - p.k * a[i];
        const pu = fu;
        const pl = fl;
        fu = !fin(pu) || bu < pu || c[i - 1].close > pu ? bu : pu;
        fl = !fin(pl) || bl > pl || c[i - 1].close < pl ? bl : pl;
        up[i] = i === 0 || !fin(st[i - 1]) ? true : up[i - 1] ? c[i].close >= fl : c[i].close > fu;
        st[i] = up[i] ? fl : fu;
      }
      return { series: [line(`Supertrend`, "#26a69a", toPts(c, st, (i) => (up[i] ? "#26a69a" : "#ef5350")), 2)] };
    },
  },
  {
    id: "psar", name: "Parabolic SAR", group: "overlay", desc: "پارابولیک سار", params: [P("step", "گام", 0.02, 0.01, 0.001), P("max", "سقف", 0.2, 0.01, 0.01)],
    compute: (c, p) => {
      const out = series(c.length);
      if (c.length < 3) return { series: [] };
      let long = c[1].close >= c[0].close;
      let sar = long ? c[0].low : c[0].high;
      let ep = long ? c[1].high : c[1].low;
      let af = p.step;
      out[1] = sar;
      for (let i = 2; i < c.length; i++) {
        sar = sar + af * (ep - sar);
        if (long) {
          sar = Math.min(sar, c[i - 1].low, c[i - 2].low);
          if (c[i].low < sar) { long = false; sar = ep; ep = c[i].low; af = p.step; }
          else if (c[i].high > ep) { ep = c[i].high; af = Math.min(af + p.step, p.max); }
        } else {
          sar = Math.max(sar, c[i - 1].high, c[i - 2].high);
          if (c[i].high > sar) { long = true; sar = ep; ep = c[i].high; af = p.step; }
          else if (c[i].low < ep) { ep = c[i].low; af = Math.min(af + p.step, p.max); }
        }
        out[i] = sar;
      }
      return { series: [{ name: "SAR", kind: "dots", color: "#fbbf24", data: toPts(c, out) }] };
    },
  },
  {
    id: "ichimoku", name: "Ichimoku", group: "overlay", desc: "ابر ایچیموکو (بدون رنگ‌آمیزی ابر)", params: [P("t", "تنکان", 9), P("k", "کیجون", 26), P("s", "سنکو B", 52)],
    compute: (c, p, tf) => {
      const hl = (n: number) => {
        const h = highest(c.map((x) => x.high), n);
        const l = lowest(c.map((x) => x.low), n);
        return h.map((v, i) => (v + l[i]) / 2);
      };
      const tenkan = hl(p.t);
      const kijun = hl(p.k);
      const spanA = tenkan.map((v, i) => (v + kijun[i]) / 2);
      const spanB = hl(p.s);
      const shifted = (vals: number[], by: number, color: string, name: string): SeriesOut => {
        const data: Pt[] = [];
        for (let i = 0; i < vals.length; i++) if (fin(vals[i])) data.push({ time: timeAt(c, i + by, tf), value: vals[i] });
        return line(name, color, data, 1);
      };
      const chikou: Pt[] = [];
      for (let i = p.k; i < c.length; i++) chikou.push({ time: c[i - p.k].time, value: c[i].close });
      return {
        series: [
          line("Tenkan", "#38bdf8", toPts(c, tenkan), 1),
          line("Kijun", "#ef4444", toPts(c, kijun), 1),
          shifted(spanA, p.k, "#22c55e", "Span A"),
          shifted(spanB, p.k, "#f97316", "Span B"),
          line("Chikou", "#a78bfa", chikou, 1),
        ],
      };
    },
  },
  {
    id: "fractals", name: "Williams Fractals", group: "overlay", desc: "فرکتال‌ها (قله و دره)", params: [P("n", "کندل دو طرف", 2, 1, 1)],
    compute: (c, p) => {
      const markers: OverlayMarker[] = [];
      for (let i = p.n; i < c.length - p.n; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = 1; j <= p.n; j++) {
          if (c[i].high <= c[i - j].high || c[i].high <= c[i + j].high) isHigh = false;
          if (c[i].low >= c[i - j].low || c[i].low >= c[i + j].low) isLow = false;
        }
        if (isHigh) markers.push({ time: c[i].time, position: "aboveBar", shape: "circle", color: "#f59e0b" });
        if (isLow) markers.push({ time: c[i].time, position: "belowBar", shape: "circle", color: "#38bdf8" });
      }
      return { series: [], markers };
    },
  },

  /* ----- separate panes ----- */
  {
    id: "macd", name: "MACD", group: "pane", desc: "مکدی کلاسیک MT5: هیستوگرام نقره‌ای + سیگنال SMA قرمز (اصلی ۱۲/۲۶/۹ — کوچک ۳/۶/۲)", params: [P("fast", "EMA سریع", 12), P("slow", "EMA کند", 26), P("sig", "SMA سیگنال", 9)],
    compute: (c, p) => {
      const cl = closes(c);
      const ef = ema(cl, p.fast);
      const es = ema(cl, p.slow);
      const main = cl.map((_, i) => ef[i] - es[i]);
      const signal = sma(main, p.sig); // MT5 uses a simple MA for the signal line
      return {
        series: [
          { name: "MACD", kind: "hist", color: "#c0c0c0", data: toPts(c, main, () => "#c0c0c0") },
          line("Signal", "#ff0000", toPts(c, signal), 1),
        ],
        levels: [{ value: 0 }],
      };
    },
  },
  {
    id: "macd_tv", name: "MACD (TradingView)", group: "pane", desc: "مکدی به سبک TradingView: خط MACD + سیگنال EMA + هیستوگرام", params: [P("fast", "سریع", 12), P("slow", "کند", 26), P("sig", "سیگنال", 9)],
    compute: (c, p) => {
      const m = macd(closes(c), p.fast, p.slow, p.sig);
      return {
        series: [
          { name: "Hist", kind: "hist", color: "#26a69a", data: toPts(c, m.hist, (i) => (m.hist[i] >= 0 ? "#26a69a" : "#ef5350")) },
          line("MACD", "#4da3ff", toPts(c, m.line), 1),
          line("Signal", "#f59e0b", toPts(c, m.sig), 1),
        ],
        levels: [{ value: 0 }],
      };
    },
  },
  {
    id: "rsi", name: "RSI", group: "pane", desc: "شاخص قدرت نسبی", params: [P("n", "دوره", 14)],
    compute: (c, p) => ({ series: [line(`RSI ${p.n}`, "#c084fc", toPts(c, rsi(closes(c), p.n)), 1)], levels: [{ value: 70, color: "#ef5350" }, { value: 50 }, { value: 30, color: "#26a69a" }] }),
  },
  {
    id: "stoch", name: "Stochastic", group: "pane", desc: "استوکاستیک", params: [P("k", "%K", 14), P("d", "%D", 3), P("s", "هموارسازی", 3)],
    compute: (c, p) => {
      const hh = highest(c.map((x) => x.high), p.k);
      const ll = lowest(c.map((x) => x.low), p.k);
      const raw = c.map((x, i) => (hh[i] === ll[i] ? NaN : (100 * (x.close - ll[i])) / (hh[i] - ll[i])));
      const k = sma(raw, p.s);
      return { series: [line("%K", "#4da3ff", toPts(c, k), 1), line("%D", "#f59e0b", toPts(c, sma(k, p.d)), 1)], levels: [{ value: 80, color: "#ef5350" }, { value: 20, color: "#26a69a" }] };
    },
  },
  {
    id: "cci", name: "CCI", group: "pane", desc: "شاخص کانال کالا", params: [P("n", "دوره", 20)],
    compute: (c, p) => {
      const tp = c.map((x) => (x.high + x.low + x.close) / 3);
      const m = sma(tp, p.n);
      const out = series(c.length);
      for (let i = p.n - 1; i < c.length; i++) {
        let dev = 0;
        for (let j = i - p.n + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]);
        dev /= p.n;
        out[i] = dev === 0 ? 0 : (tp[i] - m[i]) / (0.015 * dev);
      }
      return { series: [line(`CCI ${p.n}`, "#22d3ee", toPts(c, out), 1)], levels: [{ value: 100, color: "#ef5350" }, { value: 0 }, { value: -100, color: "#26a69a" }] };
    },
  },
  {
    id: "atr", name: "ATR", group: "pane", desc: "میانگین دامنه‌ی واقعی (نوسان)", params: [P("n", "دوره", 14)],
    compute: (c, p) => ({ series: [line(`ATR ${p.n}`, "#fb923c", toPts(c, atr(c, p.n)), 1)] }),
  },
  {
    id: "adx", name: "ADX", group: "pane", desc: "قدرت روند با DI+ و DI-", params: [P("n", "دوره", 14)],
    compute: (c, p) => {
      const pdm = c.map((x, i) => (i === 0 ? NaN : x.high - c[i - 1].high > c[i - 1].low - x.low ? Math.max(x.high - c[i - 1].high, 0) : 0));
      const mdm = c.map((x, i) => (i === 0 ? NaN : c[i - 1].low - x.low > x.high - c[i - 1].high ? Math.max(c[i - 1].low - x.low, 0) : 0));
      const tr = rma(trueRange(c), p.n);
      const pdi = rma(pdm, p.n).map((v, i) => (100 * v) / tr[i]);
      const mdi = rma(mdm, p.n).map((v, i) => (100 * v) / tr[i]);
      const dx = pdi.map((v, i) => (100 * Math.abs(v - mdi[i])) / (v + mdi[i]));
      return { series: [line("ADX", "#f8fafc", toPts(c, rma(dx, p.n)), 2), line("+DI", "#26a69a", toPts(c, pdi), 1), line("-DI", "#ef5350", toPts(c, mdi), 1)], levels: [{ value: 25 }] };
    },
  },
  {
    id: "willr", name: "Williams %R", group: "pane", desc: "ویلیامز %R", params: [P("n", "دوره", 14)],
    compute: (c, p) => {
      const hh = highest(c.map((x) => x.high), p.n);
      const ll = lowest(c.map((x) => x.low), p.n);
      return { series: [line(`%R ${p.n}`, "#e879f9", toPts(c, c.map((x, i) => (hh[i] === ll[i] ? NaN : (-100 * (hh[i] - x.close)) / (hh[i] - ll[i])))), 1)], levels: [{ value: -20, color: "#ef5350" }, { value: -80, color: "#26a69a" }] };
    },
  },
  {
    id: "mom", name: "Momentum", group: "pane", desc: "مومنتوم", params: [P("n", "دوره", 10)],
    compute: (c, p) => ({ series: [line(`MOM ${p.n}`, "#84cc16", toPts(c, c.map((x, i) => (i >= p.n ? x.close - c[i - p.n].close : NaN))), 1)], levels: [{ value: 0 }] }),
  },
  {
    id: "ao", name: "Awesome Oscillator", group: "pane", desc: "نوسان‌نمای شگفت‌انگیز", params: [P("f", "سریع", 5), P("s", "کند", 34)],
    compute: (c, p) => {
      const med = c.map((x) => (x.high + x.low) / 2);
      const f = sma(med, p.f);
      const s = sma(med, p.s);
      const v = med.map((_, i) => f[i] - s[i]);
      return { series: [{ name: "AO", kind: "hist", color: "#26a69a", data: toPts(c, v, (i) => (i > 0 && v[i] >= v[i - 1] ? "#26a69a" : "#ef5350")) }], levels: [{ value: 0 }] };
    },
  },
];

export const INDICATOR_BY_ID = Object.fromEntries(INDICATORS.map((d) => [d.id, d]));

export interface IndicatorInstance {
  uid: string;
  id: string;
  params: Record<string, number>;
  visible: boolean;
}

export function defaultParams(def: IndicatorDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.def]));
}

export function instanceLabel(inst: IndicatorInstance): string {
  const def = INDICATOR_BY_ID[inst.id];
  return `${def.name} (${def.params.map((p) => inst.params[p.key]).join(", ")})`;
}
