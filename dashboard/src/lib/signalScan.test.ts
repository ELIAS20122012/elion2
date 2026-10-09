import { describe, expect, it } from "vitest";
import type { Candle } from "./data";
import { detectDivergences } from "./detectors/divergence";
import { SIGNAL_WINDOW, scanForSignals } from "./signalScan";
import sample from "../../public/data/xauusd_m1.json";

// real XAUUSD M1 history shipped with the dashboard (public/data), not invented data
const bars = sample as Candle[];
const rule = { id: "divergence", title: "Regular divergence", hint: "", status: "teaching" as const, ready: true };

describe("robot scan", () => {
  const all = scanForSignals({ bars, tfSec: 60, symbol: "XAUUSD", accountId: 3, rule, lookback: 10_000 });

  it("finds exactly what the chart's detector finds on closed candles", () => {
    expect(all.length).toBe(detectDivergences(bars.slice(0, -1)).divergences.length);
    expect(all.length).toBeGreaterThan(0);
  });

  it("sends candles only up to the formation candle - nothing from the future", () => {
    for (const s of all) {
      expect(s.cross_i).toBe(s.candles.length - 1);
      expect(s.candles.length).toBeLessThanOrEqual(SIGNAL_WINDOW);
      expect(s.macd.length).toBe(s.candles.length);
      expect(s.signal.length).toBe(s.candles.length);
      const formed = s.candles[s.cross_i][0];
      expect(s.b.time).toBeLessThanOrEqual(formed);
      expect(s.candles[s.b.i][0]).toBe(s.b.time); // indices are remapped into the window
      expect(s.candles[s.a.i][0]).toBe(s.a.time);
    }
  });

  it("carries the rule definition, account and a stable key", () => {
    const s = all[0];
    expect(s.rule_def?.id).toBe("divergence");
    expect(s.account_id).toBe(3);
    expect(s.key).toMatch(/^60:(high|low):\d+:\d+$/);
    expect(new Set(all.map((x) => x.key)).size).toBe(all.length);
  });

  it("only recent findings become new signals", () => {
    const recent = scanForSignals({ bars, tfSec: 60, symbol: "XAUUSD", accountId: 3, rule, lookback: 0 });
    const last = bars.length - 2; // last closed candle
    for (const s of recent) expect(s.candles[s.cross_i][0]).toBe(bars[last].time);
    expect(scanForSignals({ bars: bars.slice(0, 20), tfSec: 60, symbol: "XAUUSD", accountId: 3, rule })).toEqual([]);
  });
});
