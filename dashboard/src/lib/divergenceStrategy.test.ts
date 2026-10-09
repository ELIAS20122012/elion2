import { describe, expect, it } from "vitest";
import type { Candle } from "./data";
import { aggregate } from "./data";
import { DEFAULT_SIM, STRATEGIES, asJournalTrades, runBacktest } from "./backtest";
import { summarize } from "./analytics";
import sample from "../../public/data/xauusd_m1.json";

const bars = sample as Candle[];
const s = STRATEGIES.find((x) => x.id === "elias-divergence")!;
const params = Object.fromEntries(s.params.map((p) => [p.key, p.def]));

describe("Elias divergence backtest", () => {
  it("enters only after the divergence formed, with SL behind the 2nd extreme", () => {
    const sig = s.signals(bars, params);
    expect(sig.length).toBeGreaterThan(0);
    for (const g of sig) {
      const c = bars[g.index].close;
      if (g.direction === "buy") { expect(g.sl).toBeLessThan(c); expect(g.tp).toBeGreaterThan(c); }
      else { expect(g.sl).toBeGreaterThan(c); expect(g.tp).toBeLessThan(c); }
      expect(Math.abs(g.tp - c) / Math.abs(c - g.sl)).toBeCloseTo(params.rr, 6);
    }
  });
  it("prints results per timeframe", () => {
    for (const [lbl, sec] of [["M1", 60], ["M5", 300], ["M15", 900]] as const) {
      const c = sec === 60 ? bars : aggregate(bars, sec);
      const r = runBacktest(c, s, params, DEFAULT_SIM);
      const sum = summarize(asJournalTrades(r.trades));
      console.log(lbl, c.length, "bars", "signals", r.signals, "trades", sum.count, "win", (sum.winRate * 100).toFixed(1) + "%", "PF", sum.profitFactor?.toFixed(2), "net", sum.net.toFixed(2));
    }
  });
});
