import type { Candle } from "../data";
import { macd } from "../indicators";

/**
 * RULE: regular divergence with the default MT5 MACD (definition given by Elias, 2026-09-21).
 *
 *  - Highs (uptrend):   price makes two higher highs, the MACD makes two lower highs   -> divergence
 *  - Lows  (downtrend): price makes two lower lows,   the MACD makes two higher lows   -> divergence
 *  - The extremes must CORRESPOND: a price high only counts when the MACD really made a high at that moment
 *    (same for lows). A price extreme without a MACD extreme next to it is ignored.
 *
 * Everything below that Elias did NOT say is marked ASSUMPTION and can be changed in the UI.
 */

/** From Elias: default MT5 MACD. */
export const MACD_DEFAULT = { fast: 12, slow: 26, signal: 9 } as const;

/** ASSUMPTION: a MACD "high" is a bar whose value is higher than the bar on each side (a "low" is the mirror). */
export const MACD_WINDOW = 1;

export interface DivParams {
  /** ASSUMPTION: a price "high" is a swing high — higher than the `n` candles on each side (a "low" is the mirror). */
  n: number;
  /** ASSUMPTION: the MACD extreme must sit within this many candles of the price extreme to be its counterpart. */
  tol: number;
  /** ASSUMPTION: the two extremes must be at most this many candles apart. */
  maxGap: number;
  /** which directions to look for */
  high: boolean;
  low: boolean;
}
export const DEFAULT_DIV: DivParams = { n: 2, tol: 3, maxGap: 100, high: true, low: true };

export type Side = "high" | "low";

export interface Swing {
  i: number;      // candle index of the price extreme
  price: number;  // its High (for highs) or Low (for lows)
  mi: number;     // candle index of the MACD extreme that corresponds to it
  macd: number;   // the MACD value there
}

export interface Divergence {
  side: Side;
  a: Swing;                // first extreme
  b: Swing;                // second extreme: price beyond the first, MACD not confirming
  confirmedIndex: number;  // earliest candle at which this could have been known (no repainting)
}

export interface Analysis {
  divergences: Divergence[];
  /** price extremes found / how many had a MACD extreme next to them */
  counts: Record<Side, { priceSwings: number; matched: number }>;
}

/** Indices where v[i] is strictly greater than the `n` values on each side. The last `n` indices never qualify (not known yet). */
export function swingIndices(v: number[], n: number): number[] {
  const out: number[] = [];
  for (let i = n; i < v.length - n; i++) {
    let ok = true;
    for (let j = 1; j <= n && ok; j++) if (!(v[i] > v[i - j]) || !(v[i] > v[i + j])) ok = false; // NaN never passes
    if (ok) out.push(i);
  }
  return out;
}

export const swingHighs = (c: Candle[], n: number) => swingIndices(c.map((x) => x.high), n);

/** Pair every price index with the nearest unused MACD index within `tol` candles. Both lists are ascending. */
export function pairWithin(priceIdx: number[], macdIdx: number[], tol: number): { pi: number; mi: number }[] {
  const out: { pi: number; mi: number }[] = [];
  const used = new Set<number>();
  let start = 0;
  for (const pi of priceIdx) {
    while (start < macdIdx.length && macdIdx[start] < pi - tol) start++;
    let best = -1;
    let bestD = Infinity;
    for (let k = start; k < macdIdx.length && macdIdx[k] <= pi + tol; k++) {
      const d = Math.abs(macdIdx[k] - pi);
      if (!used.has(macdIdx[k]) && d < bestD) { best = macdIdx[k]; bestD = d; }
    }
    if (best >= 0) { used.add(best); out.push({ pi, mi: best }); }
  }
  return out;
}

function detectSide(c: Candle[], line: number[], p: DivParams, side: Side): { found: Divergence[]; priceSwings: number; matched: number } {
  // Work on a "highs" version of the data: for lows everything is mirrored (price and MACD negated), so one code path serves both.
  const sign = side === "high" ? 1 : -1;
  const price = c.map((x) => (side === "high" ? x.high : -x.low));
  const m = line.map((v) => sign * v);

  const priceIdx = swingIndices(price, p.n);
  const macdIdx = swingIndices(m, MACD_WINDOW);
  const pairs = pairWithin(priceIdx, macdIdx, p.tol);

  const found: Divergence[] = [];
  for (let k = 1; k < pairs.length; k++) {
    const A = pairs[k - 1];
    const B = pairs[k];
    if (B.pi - A.pi > p.maxGap) continue;
    if (price[B.pi] > price[A.pi] && m[B.mi] < m[A.mi]) {
      const mk = (x: { pi: number; mi: number }): Swing => ({ i: x.pi, price: side === "high" ? c[x.pi].high : c[x.pi].low, mi: x.mi, macd: line[x.mi] });
      found.push({ side, a: mk(A), b: mk(B), confirmedIndex: Math.max(B.pi + p.n, B.mi + MACD_WINDOW) });
    }
  }
  return { found, priceSwings: priceIdx.length, matched: pairs.length };
}

export function detectDivergences(c: Candle[], p: DivParams = DEFAULT_DIV): Analysis {
  const empty = { priceSwings: 0, matched: 0 };
  const res: Analysis = { divergences: [], counts: { high: empty, low: empty } };
  if (c.length < 2 * p.n + 2) return res;
  const line = macd(c.map((x) => x.close), MACD_DEFAULT.fast, MACD_DEFAULT.slow, MACD_DEFAULT.signal).line;

  for (const side of ["high", "low"] as const) {
    if (!p[side]) continue;
    const r = detectSide(c, line, p, side);
    res.divergences.push(...r.found);
    res.counts[side] = { priceSwings: r.priceSwings, matched: r.matched };
  }
  res.divergences.sort((x, y) => x.b.i - y.b.i);
  return res;
}
