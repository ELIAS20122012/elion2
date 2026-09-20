import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../data";
import { detectRegularBearish, swingHighs, DEFAULT_DIV } from "./divergence";

/**
 * Build candles from a list of closes. Up candles get a 0.3 upper wick, down candles only 0.05, so the candle right after
 * a peak has a clearly lower high (as in real charts) and the peak is a genuine swing high.
 */
function candles(closes: number[]): Candle[] {
  return closes.map((cl, i) => {
    const op = i === 0 ? cl : closes[i - 1];
    const up = cl >= op;
    return { time: (1_000_000 + i * 60) as UTCTimestamp, open: op, close: cl, high: up ? cl + 0.3 : op + 0.05, low: Math.min(op, cl) - 0.3 };
  });
}
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

describe("swingHighs", () => {
  it("finds a peak only when it is higher than n candles on both sides", () => {
    const c = candles([1, 2, 3, 2, 1, 2, 3, 4, 3, 2]);
    expect(swingHighs(c, 2)).toEqual([2, 7]);       // the peaks 3 (index 2) and 4 (index 7), each higher than 2 candles per side
    expect(swingHighs(c, 3)).toEqual([]);           // with 3 per side neither is known yet: index 7 still lacks a 3rd candle after it
    expect(swingHighs(candles([1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1]), 3)).toEqual([7]); // one more candle and the bigger peak is confirmed
  });
  it("never reports the last n candles: a swing is not known yet", () => {
    expect(swingHighs(candles([1, 2, 3, 4, 5, 6, 5]), 2)).toEqual([]);
  });
});

describe("regular bearish divergence (price higher high, MACD lower high)", () => {
  it("is found when the second rally is higher but slower", () => {
    const c = candles(twoRallies(2.5, 0.6, 35)); // rally 1: +20, rally 2: +21 but at a quarter of the speed
    const d = detectRegularBearish(c, DEFAULT_DIV);
    expect(d.length).toBe(1);
    expect(d[0].b.price).toBeGreaterThan(d[0].a.price);
    expect(d[0].b.macd).toBeLessThan(d[0].a.macd);
    expect(d[0].b.i).toBeGreaterThan(d[0].a.i);
  });

  it("is NOT found when the second rally is higher and also stronger (MACD confirms)", () => {
    const c = candles(twoRallies(1.0, 3.0, 12));
    expect(detectRegularBearish(c, DEFAULT_DIV)).toEqual([]);
  });

  it("is NOT found when the second high is lower than the first", () => {
    const c = candles(twoRallies(2.5, 0.3, 20)); // second rally tops out below the first high
    const highs = swingHighs(c, DEFAULT_DIV.n);
    expect(c[highs[highs.length - 1]].high).toBeLessThan(c[highs[0]].high);
    expect(detectRegularBearish(c, DEFAULT_DIV)).toEqual([]);
  });

  it("does not repaint: the answer for the first part of the data does not change when more candles arrive", () => {
    const all = candles(twoRallies(2.5, 0.6, 35));
    const full = detectRegularBearish(all, DEFAULT_DIV);
    const cut = full[0].confirmedIndex + 1;            // exactly enough candles to know it
    const partial = detectRegularBearish(all.slice(0, cut), DEFAULT_DIV);
    expect(partial.map((x) => [x.a.i, x.b.i])).toEqual(full.map((x) => [x.a.i, x.b.i]));
    const tooEarly = detectRegularBearish(all.slice(0, full[0].confirmedIndex), DEFAULT_DIV);
    expect(tooEarly).toEqual([]);                      // one candle earlier it was not knowable
  });

  it("ignores two highs that are too far apart", () => {
    const c = candles(twoRallies(2.5, 0.6, 35));
    expect(detectRegularBearish(c, { ...DEFAULT_DIV, maxGap: 5 })).toEqual([]);
  });

  it("returns nothing for too little data or a flat market", () => {
    expect(detectRegularBearish(candles([1, 2, 3]), DEFAULT_DIV)).toEqual([]);
    expect(detectRegularBearish(candles(Array(200).fill(100)), DEFAULT_DIV)).toEqual([]);
  });
});
