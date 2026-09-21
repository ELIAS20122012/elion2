import type { Candle } from "../data";
import { macd, sma } from "../indicators";

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
  /** ASSUMPTION: how close (as a fraction, 0.05 = 5%) the second MACD extreme may be to the first and still count as "not confirming". */
  macdTol: number;
  /** ASSUMPTION: the signal/MACD cross must happen within this many candles after the second MACD extreme. */
  crossWithin: number;
  /** which directions to look for */
  high: boolean;
  low: boolean;
}
export const DEFAULT_DIV: DivParams = { n: 2, tol: 3, maxGap: 100, crossWithin: 10, macdTol: 0.05, high: true, low: true };

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
  cross: number;           // candle where the signal line and the MACD crossed: the divergence counts as formed here
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

function detectSide(c: Candle[], line: number[], hist: number[], p: DivParams, side: Side): { found: Divergence[]; priceSwings: number; matched: number } {
  // Work on a "highs" version of the data: for lows everything is mirrored (price and MACD negated), so one code path serves both.
  const sign = side === "high" ? 1 : -1;
  const price = c.map((x) => (side === "high" ? x.high : -x.low));
  const m = line.map((v) => sign * v);

  const priceIdx = swingIndices(price, p.n);
  const macdIdx = swingIndices(m, MACD_WINDOW);
  const pairs = pairWithin(priceIdx, macdIdx, p.tol);

  const found: Divergence[] = [];
  const mk = (x: { pi: number; mi: number }): Swing => ({ i: x.pi, price: side === "high" ? c[x.pi].high : c[x.pi].low, mi: x.mi, macd: line[x.mi] });
  for (let k = 1; k < pairs.length; k++) {
    const B = pairs[k];
    // ASSUMPTION: the first extreme is either the previous one, or the "main" one — the one where the MACD went furthest
    // in the last `maxGap` candles (a person skips the small wiggles in between and joins the big extremes).
    const cands = new Set<number>([k - 1]);
    let main = -1;
    for (let j = k - 1; j >= 0 && B.pi - pairs[j].pi <= p.maxGap; j--) if (main < 0 || m[pairs[j].mi] > m[pairs[main].mi]) main = j;
    if (main >= 0) cands.add(main);
    for (const j of cands) {
      const A = pairs[j];
      if (B.pi - A.pi > p.maxGap) continue;
      // ASSUMPTION: "MACD not confirming" also accepts a second MACD extreme that is about level with the first
      // (within macdTol of it): both examples Elias drew on MT5 had nearly equal MACD extremes.
      if (price[B.pi] > price[A.pi] && m[B.mi] < m[A.mi] + p.macdTol * Math.abs(m[A.mi])) {
        // From Elias: it only counts as formed when the signal line and the MACD cross after the second extreme.
        // Lows: MACD crosses up through the signal (hist - to +). Highs: crosses down (hist + to -).
        let cross = -1;
        for (let k = B.mi + 1; k < line.length && k <= B.mi + p.crossWithin; k++) {
          if (side === "high" ? hist[k - 1] > 0 && hist[k] <= 0 : hist[k - 1] < 0 && hist[k] >= 0) { cross = k; break; }
        }
        if (cross < 0) continue;
        found.push({ side, a: mk(A), b: mk(B), cross, confirmedIndex: Math.max(B.pi + p.n, cross) });
      }
    }
  }
  return { found, priceSwings: priceIdx.length, matched: pairs.length };
}

export function detectDivergences(c: Candle[], p: DivParams = DEFAULT_DIV): Analysis {
  const empty = { priceSwings: 0, matched: 0 };
  const res: Analysis = { divergences: [], counts: { high: empty, low: empty } };
  if (c.length < 2 * p.n + 2) return res;
  const line = macd(c.map((x) => x.close), MACD_DEFAULT.fast, MACD_DEFAULT.slow, MACD_DEFAULT.signal).line;
  const sig = sma(line, MACD_DEFAULT.signal); // MT5 signal line = simple average of the MACD line
  const hist = line.map((v, i) => v - sig[i]);

  for (const side of ["high", "low"] as const) {
    if (!p[side]) continue;
    const r = detectSide(c, line, hist, p, side);
    res.divergences.push(...r.found);
    res.counts[side] = { priceSwings: r.priceSwings, matched: r.matched };
  }
  res.divergences.sort((x, y) => x.b.i - y.b.i);
  return res;
}
