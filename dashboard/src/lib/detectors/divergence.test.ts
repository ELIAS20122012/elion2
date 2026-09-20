import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../data";
import { macd } from "../indicators";
import { DEFAULT_DIV, MACD_DEFAULT, detectDivergences, pairWithin, swingHighs, swingIndices } from "./divergence";

/**
 * Build candles from a list of closes. Up candles get a 0.3 upper wick, down candles only 0.05 (and the mirror for the
 * lower wick), so the candle right after a peak is clearly lower and the peak is a genuine swing extreme.
 */
function candles(closes: number[]): Candle[] {
  return closes.map((cl, i) => {
    const op = i === 0 ? cl : closes[i - 1];
    const up = cl >= op;
    return {
      time: (1_000_000 + i * 60) as UTCTimestamp, open: op, close: cl,
      high: up ? cl + 0.3 : op + 0.05,
      low: up ? op - 0.05 : cl - 0.3,
    };
  });
}
/** Exact mirror image of a chart: highs become lows and vice versa. */
const mirror = (c: Candle[]): Candle[] => c.map((x) => ({ ...x, open: -x.open, close: -x.close, high: -x.low, low: -x.high }));
const ramp = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + step * (i + 1));

/** flat -> rally 1 -> pullback -> rally 2 -> drop (the drop confirms the last swing) */
function twoRallies(rally1Step: number, rally2Step: number, rally2Bars: number): number[] {
  const flat = Array(60).fill(100);
  const r1 = ramp(100, rally1Step, 8);
  const pull = ramp(r1[r1.length - 1], -1.5, 10);
  const r2 = ramp(pull[pull.length - 1], rally2Step, rally2Bars);
  const drop = ramp(r2[r2.length - 1], -1, 8);
  return [...flat, ...r1, ...pull, ...r2, ...drop];
}

const highsOnly = { ...DEFAULT_DIV, low: false };
const lowsOnly = { ...DEFAULT_DIV, high: false };

describe("swing detection", () => {
  it("finds a peak only when it is higher than n candles on both sides", () => {
    const c = candles([1, 2, 3, 2, 1, 2, 3, 4, 3, 2]);
    expect(swingHighs(c, 2)).toEqual([2, 7]);
    expect(swingHighs(c, 3)).toEqual([]);
    expect(swingHighs(candles([1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1]), 3)).toEqual([7]);
  });
  it("never reports the last n candles: a swing is not known yet", () => {
    expect(swingIndices([1, 2, 3, 4, 5, 6, 5], 2)).toEqual([]);
  });
  it("ignores NaN (MACD warm-up)", () => {
    expect(swingIndices([NaN, NaN, 5, NaN, 1], 1)).toEqual([]);
  });
});

describe("pairing a price extreme with the MACD extreme next to it", () => {
  it("pairs only within the tolerance and never uses one MACD extreme twice", () => {
    expect(pairWithin([10, 50], [11, 200], 3)).toEqual([{ pi: 10, mi: 11 }]); // 50 has no MACD extreme near it
    expect(pairWithin([10, 12], [11], 3)).toEqual([{ pi: 10, mi: 11 }]);        // one MACD peak cannot serve two price highs
    expect(pairWithin([10], [7, 9, 13], 3)).toEqual([{ pi: 10, mi: 9 }]);       // nearest wins
    expect(pairWithin([10], [6, 14], 3)).toEqual([]);
  });
});

describe("divergence on the highs (uptrend): price higher high, MACD lower high", () => {
  it("is found when the second rally is higher but slower", () => {
    const d = detectDivergences(candles(twoRallies(2.5, 0.6, 35)), highsOnly).divergences;
    expect(d.length).toBe(1);
    expect(d[0].side).toBe("high");
    expect(d[0].b.price).toBeGreaterThan(d[0].a.price);
    expect(d[0].b.macd).toBeLessThan(d[0].a.macd);
  });
  it("is NOT found when the second rally is higher and also stronger (MACD confirms)", () => {
    expect(detectDivergences(candles(twoRallies(1.0, 3.0, 12)), highsOnly).divergences).toEqual([]);
  });
  it("is NOT found when the second high is lower than the first", () => {
    const c = candles(twoRallies(2.5, 0.3, 20));
    const h = swingHighs(c, DEFAULT_DIV.n);
    expect(c[h[h.length - 1]].high).toBeLessThan(c[h[0]].high);
    expect(detectDivergences(c, highsOnly).divergences).toEqual([]);
  });
});

describe("divergence on the lows (downtrend): price lower low, MACD higher low", () => {
  it("is found when the second decline is lower but slower", () => {
    const d = detectDivergences(mirror(candles(twoRallies(2.5, 0.6, 35))), lowsOnly).divergences;
    expect(d.length).toBe(1);
    expect(d[0].side).toBe("low");
    expect(d[0].b.price).toBeLessThan(d[0].a.price);   // lower low
    expect(d[0].b.macd).toBeGreaterThan(d[0].a.macd);  // MACD low is higher
  });
  it("is NOT found when the second decline is lower and also stronger", () => {
    expect(detectDivergences(mirror(candles(twoRallies(1.0, 3.0, 12))), lowsOnly).divergences).toEqual([]);
  });
  it("uptrend data produces nothing on the lows and downtrend data nothing on the highs", () => {
    const up = candles(twoRallies(2.5, 0.6, 35));
    expect(detectDivergences(up, lowsOnly).divergences.every((x) => x.side === "low")).toBe(true);
    expect(detectDivergences(mirror(up), highsOnly).divergences.every((x) => x.side === "high")).toBe(true);
  });
});

describe("symmetry", () => {
  it("a mirrored chart gives exactly the mirrored answer (same candle indices)", () => {
    const c = candles(twoRallies(2.5, 0.6, 35));
    const asHighs = detectDivergences(c, highsOnly).divergences.map((d) => [d.a.i, d.b.i]);
    const asLows = detectDivergences(mirror(c), lowsOnly).divergences.map((d) => [d.a.i, d.b.i]);
    expect(asLows).toEqual(asHighs);
    expect(asHighs.length).toBeGreaterThan(0);
  });
});

describe("invariants on 4000 candles of a random walk (both sides)", () => {
  // deterministic pseudo random numbers, no dependency
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
  const closes: number[] = [];
  let px = 1000;
  for (let i = 0; i < 4000; i++) closes.push((px += rnd() * 4 + Math.sin(i / 60)));
  const c = candles(closes);
  const line = macd(closes, MACD_DEFAULT.fast, MACD_DEFAULT.slow, MACD_DEFAULT.signal).line;
  const { divergences } = detectDivergences(c, DEFAULT_DIV);

  it("finds a reasonable number, on both sides", () => {
    expect(divergences.length).toBeGreaterThan(5);
    expect(divergences.some((d) => d.side === "high")).toBe(true);
    expect(divergences.some((d) => d.side === "low")).toBe(true);
  });

  it("every reported extreme has a real MACD extreme right next to it, and the divergence condition holds", () => {
    for (const d of divergences) {
      const s = d.side === "high" ? 1 : -1;
      for (const w of [d.a, d.b]) {
        expect(Math.abs(w.mi - w.i)).toBeLessThanOrEqual(DEFAULT_DIV.tol);
        expect(s * line[w.mi]).toBeGreaterThan(s * line[w.mi - 1]); // a genuine local MACD extreme
        expect(s * line[w.mi]).toBeGreaterThan(s * line[w.mi + 1]);
      }
      if (d.side === "high") { expect(d.b.price).toBeGreaterThan(d.a.price); expect(d.b.macd).toBeLessThan(d.a.macd); }
      else { expect(d.b.price).toBeLessThan(d.a.price); expect(d.b.macd).toBeGreaterThan(d.a.macd); }
      expect(d.b.i - d.a.i).toBeLessThanOrEqual(DEFAULT_DIV.maxGap);
    }
  });

  it("does not repaint: cutting the data at the confirmation candle gives the same result up to there", () => {
    for (const d of divergences.slice(0, 25)) {
      const cut = d.confirmedIndex + 1;
      const partial = detectDivergences(c.slice(0, cut), DEFAULT_DIV).divergences;
      expect(partial.some((x) => x.side === d.side && x.a.i === d.a.i && x.b.i === d.b.i)).toBe(true);
      const early = detectDivergences(c.slice(0, d.confirmedIndex), DEFAULT_DIV).divergences;
      expect(early.some((x) => x.side === d.side && x.a.i === d.a.i && x.b.i === d.b.i)).toBe(false); // not knowable one candle earlier
    }
  });
});

describe("edge cases", () => {
  it("ignores extremes that are too far apart", () => {
    expect(detectDivergences(candles(twoRallies(2.5, 0.6, 35)), { ...highsOnly, maxGap: 5 }).divergences).toEqual([]);
  });
  it("returns nothing for too little data or a flat market", () => {
    expect(detectDivergences(candles([1, 2, 3]), DEFAULT_DIV).divergences).toEqual([]);
    expect(detectDivergences(candles(Array(200).fill(100)), DEFAULT_DIV).divergences).toEqual([]);
  });
});
