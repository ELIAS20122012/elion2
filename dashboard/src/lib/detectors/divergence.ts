import type { Candle } from "../data";
import { macd } from "../indicators";

/**
 * RULE: regular divergence on the highs (definition given by Elias, 2026-09-21):
 *   "when the market makes two higher highs but the MACD makes two lower highs, that is a divergence".
 * Uses the default MT5 MACD (12, 26, 9).
 *
 * Everything below that Elias did NOT say is marked ASSUMPTION and can be changed in the UI.
 */

/** From Elias: default MT5 MACD. */
export const MACD_DEFAULT = { fast: 12, slow: 26, signal: 9 } as const;

export interface DivParams {
  /** ASSUMPTION: a "high" is a swing high — a candle whose High is higher than the `n` candles on each side. */
  n: number;
  /** ASSUMPTION: the two highs must be at most this many candles apart (otherwise they are unrelated). */
  maxGap: number;
}
export const DEFAULT_DIV: DivParams = { n: 2, maxGap: 100 };

export interface Swing {
  i: number;       // candle index of the price high
  price: number;   // the high
  macd: number;    // ASSUMPTION: the highest MACD value within n candles of the high (MACD often peaks a candle or two off)
  mi: number;      // candle index where that MACD value sits (used to draw the line on the MACD pane)
}

export interface Divergence {
  a: Swing;              // first high
  b: Swing;              // second high: price higher, MACD lower
  confirmedIndex: number; // the earliest candle at which this could have been known (no repainting)
}

/** Indices of swing highs. A swing is only known `n` candles after it happened, so the last `n` candles never qualify. */
export function swingHighs(c: Candle[], n: number): number[] {
  const out: number[] = [];
  for (let i = n; i < c.length - n; i++) {
    let ok = true;
    for (let j = 1; j <= n && ok; j++) if (c[i].high <= c[i - j].high || c[i].high <= c[i + j].high) ok = false;
    if (ok) out.push(i);
  }
  return out;
}

export function detectRegularBearish(c: Candle[], p: DivParams = DEFAULT_DIV): Divergence[] {
  if (c.length < 2 * p.n + 2) return [];
  const line = macd(c.map((x) => x.close), MACD_DEFAULT.fast, MACD_DEFAULT.slow, MACD_DEFAULT.signal).line;

  const swings: Swing[] = [];
  for (const i of swingHighs(c, p.n)) {
    let best = -Infinity;
    let mi = i;
    for (let k = i - p.n; k <= i + p.n; k++) if (Number.isFinite(line[k]) && line[k] > best) { best = line[k]; mi = k; }
    if (Number.isFinite(best)) swings.push({ i, price: c[i].high, macd: best, mi });
  }

  const out: Divergence[] = [];
  for (let k = 1; k < swings.length; k++) {
    const a = swings[k - 1];
    const b = swings[k];
    if (b.i - a.i <= p.maxGap && b.price > a.price && b.macd < a.macd) out.push({ a, b, confirmedIndex: b.i + p.n });
  }
  return out;
}
