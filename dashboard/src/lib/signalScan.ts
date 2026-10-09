/**
 * The robot's scan: run the SAME divergence detector the chart uses on real MT5 candles and turn each
 * recent finding into a signal for the queue (journal/signals.py). Pure functions, so they can be tested.
 */
import type { Candle } from "./data";
import { DEFAULT_DIV, MACD_DEFAULT, detectDivergences, type DivParams, type Divergence } from "./detectors/divergence";
import { divFeatures, divKey } from "./detectors/divergenceFeatures";
import { macd, sma } from "./indicators";
import type { SignalIn } from "./journalApi";
import type { Rule } from "./rules";

/** candles sent with a signal: this many before the formation candle, plus that candle (no later candles) */
export const SIGNAL_WINDOW = 150;
/** only findings that formed within the last N closed candles become new signals */
export const SCAN_LOOKBACK = 30;

export const toCandles = (rows: number[][]): Candle[] =>
  rows.map(([time, open, high, low, close, volume]) => ({ time: time as Candle["time"], open, high, low, close, volume }));

const num = (v: number) => (Number.isFinite(v) ? v : null);

export function toSignal(o: {
  closed: Candle[];
  d: Divergence;
  line: number[];
  sig: number[];
  tfSec: number;
  symbol: string;
  accountId: number | null;
  rule: Rule | undefined;
  params: DivParams;
}): SignalIn {
  const { closed, d, line, sig } = o;
  const start = Math.max(0, d.cross - (SIGNAL_WINDOW - 1));
  const win = closed.slice(start, d.cross + 1);
  const at = (i: number) => i - start;
  return {
    account_id: o.accountId,
    key: divKey(o.tfSec, closed, d),
    rule: "divergence",
    rule_def: o.rule ? { id: o.rule.id, title: o.rule.title, hint: o.rule.hint, status: o.rule.status } : null,
    symbol: o.symbol,
    tf_sec: o.tfSec,
    side: d.side,
    a: { i: at(d.a.i), time: closed[d.a.i].time, price: d.a.price, macd_i: d.a.mi >= start ? at(d.a.mi) : null, macd: num(d.a.macd) },
    b: { i: at(d.b.i), time: closed[d.b.i].time, price: d.b.price, macd_i: d.b.mi >= start ? at(d.b.mi) : null, macd: num(d.b.macd) },
    cross_i: at(d.cross),
    features: divFeatures(closed, d),
    params: { ...o.params, macd: MACD_DEFAULT },
    candles: win.map((c) => [c.time, c.open, c.high, c.low, c.close]),
    macd: line.slice(start, d.cross + 1).map(num),
    signal: sig.slice(start, d.cross + 1).map(num),
  };
}

/** Findings on closed candles that formed recently enough to be worth a signal. */
export function scanForSignals(o: {
  bars: Candle[]; // as loaded; the last (still forming) candle is dropped here
  tfSec: number;
  symbol: string;
  accountId: number | null;
  rule: Rule | undefined;
  params?: DivParams;
  lookback?: number;
}): SignalIn[] {
  const closed = o.bars.slice(0, -1);
  const params = o.params ?? DEFAULT_DIV;
  const found = detectDivergences(closed, params).divergences;
  if (!found.length) return [];
  const line = macd(closed.map((c) => c.close), MACD_DEFAULT.fast, MACD_DEFAULT.slow, MACD_DEFAULT.signal).line;
  const sig = sma(line, MACD_DEFAULT.signal); // MT5 signal line, as in the detector
  const last = closed.length - 1;
  return found
    .filter((d) => last - d.cross <= (o.lookback ?? SCAN_LOOKBACK))
    .map((d) => toSignal({ closed, d, line, sig, tfSec: o.tfSec, symbol: o.symbol, accountId: o.accountId, rule: o.rule, params }));
}
