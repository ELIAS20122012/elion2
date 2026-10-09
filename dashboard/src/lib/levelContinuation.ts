/**
 * "Level Continuation" — the main setup on the Rules page (Playbook / Checklist), turned into exact rules so it
 * can be backtested. Every number here is an ASSUMPTION exposed as a parameter until Elias fixes it.
 *
 *   1. Higher-timeframe trend (H1 by default): last two confirmed swing highs AND lows rising (buy) / falling (sell).
 *   2. Valid level: the last confirmed swing high that price then CLOSED above (buy) — old resistance → support.
 *   3. Pullback to level: a confirmed swing low after the break, within `tol` × ATR of the level.
 *   4. MACD confirmation (hidden divergence): that low is higher than the previous swing low while MACD is lower.
 *   5. Entry confirmation: MACD (12,26,9; signal = SMA 9 as in MT5) crosses its signal in trade direction within
 *      `crossWithin` candles of the pullback low. Entry = next candle's open.
 *   6. SL beyond the pullback swing (+ buffer × ATR); TP = R:R.
 *   7. Session filter: London/New York (07:00–20:00 UTC).
 * Sell side is the mirror image. Only closed candles up to the signal candle are used (no look-ahead).
 * Not testable from candles: "no major news" — not applied.
 */
import { aggregate, type Candle } from "./data";
import { swingIndices } from "./detectors/divergence";
import { atr, ema, sma } from "./indicators";

export interface LcSignal { index: number; direction: "buy" | "sell"; sl: number; tp: number }

type Trend = 1 | -1 | 0;

/** trend of the higher timeframe as known at the close of every entry-timeframe candle */
function htfTrend(c: Candle[], tfSec: number, htfSec: number, n: number): Trend[] {
  const h = htfSec > tfSec ? aggregate(c, htfSec) : c;
  const hs = htfSec > tfSec ? htfSec : tfSec;
  const highs = swingIndices(h.map((x) => x.high), n);
  const lows = swingIndices(h.map((x) => -x.low), n);
  // trend after HTF candle k closed, using only swings confirmed by then (swing at j is known at j + n)
  const tr: Trend[] = new Array(h.length).fill(0);
  let hi = 0, lo = 0;
  const H: number[] = [], L: number[] = [];
  for (let k = 0; k < h.length; k++) {
    while (hi < highs.length && highs[hi] + n <= k) H.push(h[highs[hi++]].high);
    while (lo < lows.length && lows[lo] + n <= k) L.push(h[lows[lo++]].low);
    if (H.length >= 2 && L.length >= 2) {
      const up = H[H.length - 1] > H[H.length - 2] && L[L.length - 1] > L[L.length - 2];
      const dn = H[H.length - 1] < H[H.length - 2] && L[L.length - 1] < L[L.length - 2];
      tr[k] = up ? 1 : dn ? -1 : 0;
    }
  }
  // map: entry candle i (closes at time+tfSec) sees the last HTF candle that closed by then
  const out: Trend[] = new Array(c.length).fill(0);
  let k = -1;
  for (let i = 0; i < c.length; i++) {
    const closeT = c[i].time + tfSec;
    while (k + 1 < h.length && h[k + 1].time + hs <= closeT) k++;
    out[i] = k >= 0 ? tr[k] : 0;
  }
  return out;
}

const inSession = (t: number) => {
  const hr = new Date(t * 1000).getUTCHours();
  return hr >= 7 && hr < 20;
};

/** candle spacing in seconds (most common gap) */
export function tfOf(c: Candle[]): number {
  const n: Record<number, number> = {};
  for (let i = 1; i < Math.min(c.length, 500); i++) {
    const d = c[i].time - c[i - 1].time;
    n[d] = (n[d] ?? 0) + 1;
  }
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : 60;
}

export function levelContinuation(c: Candle[], p: Record<string, number>): LcSignal[] {
  if (c.length < 60) return [];
  const tfSec = tfOf(c);
  const n = Math.max(1, Math.round(p.swingN));
  const trend = p.htfMin > 0 ? htfTrend(c, tfSec, p.htfMin * 60, 2) : new Array<Trend>(c.length).fill(1);
  const a = atr(c, 14);
  const closes = c.map((x) => x.close);
  const e26 = ema(closes, 26);
  const line = ema(closes, 12).map((v, i) => v - e26[i]);
  const sig = sma(line, 9);
  const highs = swingIndices(c.map((x) => x.high), n);
  const lows = swingIndices(c.map((x) => -x.low), n);
  const macdAt = (j: number, side: 1 | -1) => {
    // MACD extreme within ±2 candles of the price swing (the swing in MACD rarely lands on the same candle)
    let v = line[j];
    for (let d = -2; d <= 2; d++) {
      const x = line[j + d];
      if (Number.isFinite(x) && (side === 1 ? x < v : x > v)) v = x;
    }
    return v;
  };

  const out: LcSignal[] = [];
  const used = new Set<string>();

  for (const dir of [1, -1] as const) {
    if (dir === 1 ? !p.buy : !p.sell) continue;
    const lvlSw = dir === 1 ? highs : lows; // swings that form the level
    const pbSw = dir === 1 ? lows : highs; // pullback swings
    const px = (j: number, lvl: boolean) => (dir === 1 ? (lvl ? c[j].high : c[j].low) : lvl ? c[j].low : c[j].high);

    for (let i = 30; i < c.length - 1; i++) {
      // 5. entry trigger on candle i: MACD crosses signal in trade direction
      const crossed = dir === 1 ? line[i - 1] <= sig[i - 1] && line[i] > sig[i] : line[i - 1] >= sig[i - 1] && line[i] < sig[i];
      if (!crossed || !Number.isFinite(a[i])) continue;
      if (trend[i] !== dir) continue; // 1. trend
      if (p.session && !inSession(c[i].time)) continue; // 7. session
      // 3. most recent pullback swing confirmed by i, close enough to the cross
      const pbs = pbSw.filter((j) => j + n <= i);
      if (pbs.length < 2) continue;
      const L = pbs[pbs.length - 1];
      if (i - L > p.crossWithin) continue;
      const P = pbs[pbs.length - 2];
      // 2. level: last swing (confirmed before the pullback) that price closed beyond, before the pullback
      let level = NaN;
      for (let s = lvlSw.length - 1; s >= 0; s--) {
        const j = lvlSw[s];
        if (j >= L || j + n > L) continue;
        const lv = px(j, true);
        let broke = -1;
        for (let k = j + 1; k < L; k++) if (dir === 1 ? c[k].close > lv : c[k].close < lv) { broke = k; break; }
        if (broke >= 0) { level = lv; break; }
      }
      if (!Number.isFinite(level)) continue;
      const pb = px(L, false);
      if (Math.abs(pb - level) > p.tol * a[L]) continue; // pullback must reach the level zone
      // 4. hidden divergence: price higher low (buy) but MACD lower low
      if (p.hidden) {
        const priceOk = dir === 1 ? pb > px(P, false) : pb < px(P, false);
        const mL = macdAt(L, dir), mP = macdAt(P, dir);
        const macdOk = dir === 1 ? mL < mP : mL > mP;
        if (!priceOk || !macdOk) continue;
      }
      const key = `${dir}:${L}`;
      if (used.has(key)) continue;
      used.add(key);
      // 6. stop beyond the pullback swing, target by R:R
      const sl = dir === 1 ? pb - p.slBuf * a[i] : pb + p.slBuf * a[i];
      const risk = dir === 1 ? c[i].close - sl : sl - c[i].close;
      if (!(risk > 0)) continue;
      out.push({ index: i, direction: dir === 1 ? "buy" : "sell", sl, tp: c[i].close + dir * risk * p.rr });
    }
  }
  return out.sort((x, y) => x.index - y.index);
}
