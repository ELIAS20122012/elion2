import { describe, expect, it } from "vitest";
import type { Candle } from "./data";
import { STRATEGIES, DEFAULT_SIM, runBacktest, asJournalTrades } from "./backtest";
import { summarize } from "./analytics";
import { levelContinuation } from "./levelContinuation";
import sample from "../../public/data/xauusd_m1.json";

const bars = sample as Candle[];
const s = STRATEGIES.find((x) => x.id === "level-continuation")!;
const base = Object.fromEntries(s.params.map((p) => [p.key, p.def]));

// synthetic up-trend with pullbacks so every rule can fire
function synth(n = 30000, seed = 7): Candle[] {
  let r = seed; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = []; let px = 2000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 3000) * 0.08;
    const o = px; px = o + drift + (rnd() - 0.5) * 2;
    out.push({ time: (1_700_000_000 + i * 60) as Candle["time"], open: o, high: Math.max(o, px) + rnd() * 0.5, low: Math.min(o, px) - rnd() * 0.5, close: px });
  }
  return out;
}

describe("Level Continuation", () => {
  const data = synth();
  const loose = { ...base, hidden: 0, session: 0 };
  it("finds trades and every stop/target is on the right side", () => {
    const sig = levelContinuation(data, loose);
    expect(sig.length).toBeGreaterThan(0);
    for (const g of sig) {
      const c = data[g.index].close;
      if (g.direction === "buy") { expect(g.sl).toBeLessThan(c); expect(g.tp).toBeGreaterThan(c); }
      else { expect(g.sl).toBeGreaterThan(c); expect(g.tp).toBeLessThan(c); }
    }
  });
  it("uses no future candles: the same signal appears when the data ends on the signal candle", () => {
    const sig = levelContinuation(data, loose).slice(0, 25);
    for (const g of sig) {
      const cut = levelContinuation(data.slice(0, g.index + 2), loose); // +1 so the entry candle exists
      expect(cut.some((x) => x.index === g.index && x.direction === g.direction && Math.abs(x.sl - g.sl) < 1e-9)).toBe(true);
    }
  });
  it("report", () => {
    for (const [name, d, p] of [["synthetic", data, loose], ["synthetic strict", data, base], ["XAUUSD sample", bars, base], ["XAUUSD sample loose", bars, { ...base, hidden: 0, session: 0, htfMin: 15 }]] as const) {
      const r = runBacktest(d as Candle[], s, p as Record<string, number>, DEFAULT_SIM);
      const sum = summarize(asJournalTrades(r.trades));
      console.log(name, "signals", r.signals, "trades", sum.count, "win", (sum.winRate * 100).toFixed(1) + "%", "PF", sum.profitFactor?.toFixed(2));
    }
  });
});
