import type { Candle } from "./data";
import { detectDivergences } from "./detectors/divergence";
import { atr, ema } from "./indicators";
import { getDivParams } from "./prefs";
import { levelContinuation } from "./levelContinuation";
import type { JTrade, NewTrade } from "./journalApi";

export interface ParamDef { key: string; label: string; def: number; step?: number; min?: number }

/** A signal is decided on the close of bar `index`; the trade enters at the open of the next bar (no look-ahead). */
export interface Signal { index: number; direction: "buy" | "sell"; sl: number; tp: number }

export interface Strategy {
  id: string;
  name: string;
  description: string;
  ready: boolean;
  params: ParamDef[];
  signals: (c: Candle[], p: Record<string, number>) => Signal[];
}

/**
 * Registry of strategies. When a rule set is taught and approved, add it here — it then shows up in the
 * backtest page and its results flow through the same journal and analysis as any account.
 */
export const STRATEGIES: Strategy[] = [
  {
    // Main setup from the Rules page (Playbook + Checklist); exact rules and assumptions in levelContinuation.ts
    id: "level-continuation",
    name: "Level Continuation — ستاپ اصلی",
    description: "روند تایم بالا + لول از ساختار قبلی + پولبک به لول + دایورجنس مخفی مکدی + کراس مکدی برای ورود. حد ضرر پشت آخرین سوینگ، حد سود با R:R.",
    ready: true,
    params: [
      { key: "rr", label: "R:R", def: 2, step: 0.5, min: 0.5 },
      { key: "htfMin", label: "تایم روند (دقیقه، 0 = خاموش)", def: 60, step: 15, min: 0 },
      { key: "swingN", label: "سوینگ: کندل هر طرف", def: 3, min: 1 },
      { key: "tol", label: "فاصله‌ی پولبک تا لول (×ATR)", def: 0.5, step: 0.1, min: 0 },
      { key: "crossWithin", label: "کراس تا چند کندل بعد از پولبک", def: 10, min: 1 },
      { key: "slBuf", label: "فاصله‌ی حد ضرر از سوینگ (×ATR)", def: 0.2, step: 0.1, min: 0 },
      { key: "hidden", label: "دایورجنس مخفی لازم (1/0)", def: 1, min: 0 },
      { key: "session", label: "فقط لندن/نیویورک (1/0)", def: 1, min: 0 },
      { key: "buy", label: "خرید (1/0)", def: 1, min: 0 },
      { key: "sell", label: "فروش (1/0)", def: 1, min: 0 },
    ],
    signals: (c, p) => levelContinuation(c, p),
  },
  {
    // Elias's saved rule (rules/divergence-regular-high.md), detected exactly as the chart does.
    // Entry/SL/TP are NOT in the rule yet; the ones below are assumptions he can change on the page.
    id: "elias-divergence",
    name: "سیستم الیاس — دایورجنس مکدی",
    description: "دایورجنس معمولی (قانون ذخیره‌شده) + کراس مکدی. ورود: کندل بعد از کراس. حد ضرر: پشت سقف/کف دوم. حد سود: R:R.",
    ready: true,
    params: [
      { key: "rr", label: "نسبت سود به ضرر (R:R)", def: 2, step: 0.5, min: 0.5 },
      { key: "slBuf", label: "فاصله‌ی حد ضرر از سقف/کف (×ATR)", def: 0.2, step: 0.1, min: 0 },
      { key: "atrN", label: "دوره‌ی ATR", def: 14 },
      { key: "buy", label: "خرید روی دایورجنس کف (1/0)", def: 1, min: 0 },
      { key: "sell", label: "فروش روی دایورجنس سقف (1/0)", def: 1, min: 0 },
    ],
    signals: (c, p) => {
      const a = atr(c, p.atrN);
      const out: Signal[] = [];
      for (const d of detectDivergences(c, getDivParams()).divergences) {
        const i = Math.max(d.cross, d.confirmedIndex); // decided on this candle's close; entry is the next open
        if (i >= c.length - 1 || !Number.isFinite(a[i])) continue;
        const buy = d.side === "low";
        if (buy ? !p.buy : !p.sell) continue;
        const sl = buy ? d.b.price - a[i] * p.slBuf : d.b.price + a[i] * p.slBuf;
        const risk = buy ? c[i].close - sl : sl - c[i].close;
        if (!(risk > 0)) continue; // price already beyond the stop: no valid trade
        out.push({ index: i, direction: buy ? "buy" : "sell", sl, tp: buy ? c[i].close + risk * p.rr : c[i].close - risk * p.rr });
      }
      return out.sort((x, y) => x.index - y.index);
    },
  },
  {
    id: "ema-cross",
    name: "تقاطع EMA — نمونه‌ی فنی",
    description: "فقط برای آزمودن خط لوله‌ی بک‌تست. این قانون شما نیست و نتیجه‌اش هیچ ارزش معاملاتی ندارد.",
    ready: true,
    params: [
      { key: "fast", label: "EMA سریع", def: 9 },
      { key: "slow", label: "EMA کند", def: 21 },
      { key: "atrN", label: "دوره‌ی ATR", def: 14 },
      { key: "atrK", label: "ضریب ATR برای حد ضرر", def: 1.5, step: 0.1 },
      { key: "rr", label: "نسبت سود به ضرر (R:R)", def: 2, step: 0.1 },
    ],
    signals: (c, p) => {
      const cl = c.map((x) => x.close);
      const f = ema(cl, p.fast);
      const s = ema(cl, p.slow);
      const a = atr(c, p.atrN);
      const out: Signal[] = [];
      for (let i = 1; i < c.length - 1; i++) {
        if (![f[i], s[i], f[i - 1], s[i - 1], a[i]].every(Number.isFinite)) continue;
        const up = f[i - 1] <= s[i - 1] && f[i] > s[i];
        const down = f[i - 1] >= s[i - 1] && f[i] < s[i];
        if (!up && !down) continue;
        const risk = a[i] * p.atrK;
        out.push(up
          ? { index: i, direction: "buy", sl: c[i].close - risk, tp: c[i].close + risk * p.rr }
          : { index: i, direction: "sell", sl: c[i].close + risk, tp: c[i].close - risk * p.rr });
      }
      return out;
    },
  },
];

export interface SimConfig {
  symbol: string;
  initialBalance: number;
  riskPct: number;
  contractSize: number; // units per 1.00 lot (XAUUSD: 100 oz)
  spread: number; // price units, paid on entry
  commissionPerLot: number;
}

export const DEFAULT_SIM: SimConfig = { symbol: "XAUUSD", initialBalance: 1000, riskPct: 1, contractSize: 100, spread: 0.3, commissionPerLot: 7 };

export interface BacktestResult { trades: NewTrade[]; signals: number; skipped: number; endBalance: number }

export function runBacktest(c: Candle[], strat: Strategy, params: Record<string, number>, cfg: SimConfig): BacktestResult {
  const sigs = strat.signals(c, params);
  const trades: NewTrade[] = [];
  let balance = cfg.initialBalance;
  let busyUntil = 0;
  let skipped = 0;

  for (const sg of sigs) {
    const start = sg.index + 1;
    if (start < busyUntil || start >= c.length) { skipped++; continue; }
    const buy = sg.direction === "buy";
    const entry = c[start].open + (buy ? cfg.spread : 0);
    const risk = Math.abs(entry - sg.sl);
    if (!(risk > 0)) { skipped++; continue; }
    const lots = Math.min(100, Math.max(0.01, Math.floor(((balance * cfg.riskPct) / 100 / (risk * cfg.contractSize)) * 100) / 100));

    let exitIdx = c.length - 1;
    let exit = c[exitIdx].close;
    for (let i = start; i < c.length; i++) {
      const hitSl = buy ? c[i].low <= sg.sl : c[i].high >= sg.sl;
      const hitTp = buy ? c[i].high >= sg.tp : c[i].low <= sg.tp;
      if (hitSl || hitTp) {
        exitIdx = i;
        exit = hitSl ? sg.sl : sg.tp; // if both fall in one bar, assume the stop was hit first (conservative)
        break;
      }
    }
    const gross = (buy ? exit - entry : entry - exit) * lots * cfg.contractSize;
    const commission = -cfg.commissionPerLot * lots;
    balance += gross + commission;
    busyUntil = exitIdx + 1;
    trades.push({
      ticket: `bt-${trades.length + 1}`, symbol: cfg.symbol, direction: sg.direction, volume: lots,
      open_time: c[start].time, open_price: +entry.toFixed(2), close_time: c[exitIdx].time, close_price: +exit.toFixed(2),
      sl: +sg.sl.toFixed(2), tp: +sg.tp.toFixed(2), commission: +commission.toFixed(2), swap: 0, profit: +gross.toFixed(2), comment: "backtest",
    });
  }
  return { trades, signals: sigs.length, skipped, endBalance: balance };
}

/** Wrap simulated trades so the shared analytics can read them. */
export const asJournalTrades = (t: NewTrade[]): JTrade[] =>
  t.map((x, i) => ({ ...x, id: i, account_id: 0, source: "backtest", mfe: null, mae: null, setup_valid: null, setup_id: null, emotion: null, error: null, note: null }));
