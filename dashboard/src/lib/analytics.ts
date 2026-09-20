import type { JTrade } from "./journalApi";

export const net = (t: JTrade) => t.profit + t.commission + t.swap;
export const isClosed = (t: JTrade) => t.close_time != null;
export const durationSec = (t: JTrade) => (t.close_time != null ? Math.max(0, t.close_time - t.open_time) : 0);

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  net: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  payoff: number | null;
  expectancy: number;
  bestTrade: number;
  worstTrade: number;
  maxWinStreak: number;
  maxLossStreak: number;
  avgDurationSec: number;
  maxDrawdown: number;
  commission: number;
}

export interface EquityPoint { time: number; equity: number; drawdown: number }

export function summarize(trades: JTrade[]): Summary {
  const closed = trades.filter(isClosed).sort((a, b) => (a.close_time as number) - (b.close_time as number));
  const nets = closed.map(net);
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n < 0);
  const grossWin = wins.reduce((s, n) => s + n, 0);
  const grossLoss = Math.abs(losses.reduce((s, n) => s + n, 0));
  let ws = 0, ls = 0, mw = 0, ml = 0;
  for (const n of nets) {
    if (n > 0) { ws++; ls = 0; } else if (n < 0) { ls++; ws = 0; } else { ws = 0; ls = 0; }
    mw = Math.max(mw, ws);
    ml = Math.max(ml, ls);
  }
  let peak = 0, cum = 0, dd = 0;
  for (const n of nets) {
    cum += n;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  const total = nets.reduce((s, n) => s + n, 0);
  return {
    count: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    net: total,
    grossWin,
    grossLoss,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    payoff: wins.length && losses.length ? grossWin / wins.length / (grossLoss / losses.length) : null,
    expectancy: closed.length ? total / closed.length : 0,
    bestTrade: nets.length ? Math.max(...nets) : 0,
    worstTrade: nets.length ? Math.min(...nets) : 0,
    maxWinStreak: mw,
    maxLossStreak: ml,
    avgDurationSec: closed.length ? closed.reduce((s, t) => s + durationSec(t), 0) / closed.length : 0,
    maxDrawdown: dd,
    commission: closed.reduce((s, t) => s + t.commission + t.swap, 0),
  };
}

export function equityCurve(trades: JTrade[], initial = 0): EquityPoint[] {
  const closed = trades.filter(isClosed).sort((a, b) => (a.close_time as number) - (b.close_time as number));
  let eq = initial;
  let peak = initial;
  return closed.map((t) => {
    eq += net(t);
    peak = Math.max(peak, eq);
    return { time: t.close_time as number, equity: +eq.toFixed(2), drawdown: +(eq - peak).toFixed(2) };
  });
}

export interface Bucket { key: string; label: string; count: number; net: number; winRate: number }

function bucketize(trades: JTrade[], keyOf: (t: JTrade) => string, labels: Record<string, string>, order: string[]): Bucket[] {
  const m = new Map<string, JTrade[]>();
  for (const t of trades.filter(isClosed)) {
    const k = keyOf(t);
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return order.map((k) => {
    const list = m.get(k) ?? [];
    const nets = list.map(net);
    return { key: k, label: labels[k] ?? k, count: list.length, net: +nets.reduce((s, n) => s + n, 0).toFixed(2), winRate: list.length ? nets.filter((n) => n > 0).length / list.length : 0 };
  });
}

export const byHour = (t: JTrade[]) => {
  const order = Array.from({ length: 24 }, (_, i) => String(i));
  return bucketize(t, (x) => String(new Date(x.open_time * 1000).getUTCHours()), Object.fromEntries(order.map((h) => [h, `${h.padStart(2, "0")}:00`])), order);
};

const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
export const byWeekday = (t: JTrade[]) => {
  const order = ["1", "2", "3", "4", "5", "6", "0"]; // Monday first
  return bucketize(t, (x) => String(new Date(x.open_time * 1000).getUTCDay()), Object.fromEntries(WEEKDAYS.map((n, i) => [String(i), n])), order).filter(
    (b) => b.count > 0 || !["6", "0"].includes(b.key),
  );
};

const DUR: [string, string, number][] = [["<1", "کمتر از ۱ دقیقه", 60], ["1-3", "۱ تا ۳ دقیقه", 180], ["3-10", "۳ تا ۱۰ دقیقه", 600], ["10-30", "۱۰ تا ۳۰ دقیقه", 1800], [">30", "بیش از ۳۰ دقیقه", Infinity]];
export const byDuration = (t: JTrade[]) =>
  bucketize(t, (x) => DUR.find(([, , max]) => durationSec(x) < max)![0], Object.fromEntries(DUR.map(([k, l]) => [k, l])), DUR.map(([k]) => k));

export interface DayRow {
  day: string;
  count: number;
  net: number;
  peak: number;
  giveback: number;
  maxPerHour: number;
  over: boolean;
  wins: number;
}

/** Daily view. `peak` = best running realised P/L during the day, `giveback` = peak - final (realised only). */
export function byDay(trades: JTrade[], maxPerDay: number): DayRow[] {
  const days = new Map<string, JTrade[]>();
  for (const t of trades.filter(isClosed)) {
    const d = new Date((t.close_time as number) * 1000).toISOString().slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), t]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => {
      list.sort((a, b) => (a.close_time as number) - (b.close_time as number));
      let cum = 0, peak = 0;
      for (const t of list) {
        cum += net(t);
        peak = Math.max(peak, cum);
      }
      const perHour = new Map<number, number>();
      for (const t of list) {
        const h = Math.floor(t.open_time / 3600);
        perHour.set(h, (perHour.get(h) ?? 0) + 1);
      }
      return {
        day, count: list.length, net: +cum.toFixed(2), peak: +peak.toFixed(2), giveback: +Math.max(0, peak - cum).toFixed(2),
        maxPerHour: Math.max(...perHour.values()), over: list.length > maxPerDay, wins: list.filter((t) => net(t) > 0).length,
      };
    });
}

export interface TagRow { tag: string; count: number; net: number; winRate: number }

export function byTag(trades: JTrade[], pick: (t: JTrade) => string | null): TagRow[] {
  const m = new Map<string, JTrade[]>();
  for (const t of trades.filter(isClosed)) {
    const k = pick(t);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return [...m.entries()]
    .map(([tag, list]) => {
      const nets = list.map(net);
      return { tag, count: list.length, net: +nets.reduce((s, n) => s + n, 0).toFixed(2), winRate: nets.filter((n) => n > 0).length / list.length };
    })
    .sort((a, b) => b.count - a.count);
}

export interface Excursion { tracked: number; avgMfe: number; avgMae: number; avgGiveback: number; captured: number | null; peakThenLoss: number }

/** Inside-the-trade view; only trades that were watched while open have MFE/MAE. */
export function excursions(trades: JTrade[]): Excursion | null {
  const t = trades.filter((x) => isClosed(x) && x.mfe != null && x.mae != null);
  if (t.length === 0) return null;
  const mfe = t.map((x) => x.mfe as number);
  const win = t.filter((x) => x.profit > 0 && (x.mfe as number) > 0);
  return {
    tracked: t.length,
    avgMfe: mfe.reduce((s, v) => s + v, 0) / t.length,
    avgMae: t.reduce((s, x) => s + (x.mae as number), 0) / t.length,
    avgGiveback: t.reduce((s, x) => s + Math.max(0, (x.mfe as number) - x.profit), 0) / t.length,
    captured: win.length ? win.reduce((s, x) => s + x.profit / (x.mfe as number), 0) / win.length : null,
    peakThenLoss: t.filter((x) => (x.mfe as number) > 0 && x.profit < 0).length,
  };
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} ثانیه`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)} دقیقه`;
  return `${(sec / 3600).toFixed(1)} ساعت`;
}

export const money = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}$`;
