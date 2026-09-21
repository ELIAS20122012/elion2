import type { Candle } from "../data";
import type { Divergence } from "./divergence";

/**
 * Measurements of one divergence. They are stored next to Elias's verdict (✓ real / ✗ not real), so that the
 * thresholds of the rule can be taken from his verdicts instead of being guessed.
 * Everything is normalised so that a positive number means "more of the good thing", for highs and for lows alike.
 */
export const FEATURES: { id: string; label: string; hint: string }[] = [
  { id: "gap", label: "فاصله‌ی دو نقطه (کندل)", hint: "چند کندل بین سقف/کف اول و دوم" },
  { id: "priceMoveAtr", label: "حرکت قیمت (ATR)", hint: "سقف/کف دوم چقدر جلوتر از اولی رفته، به واحد میانگین دامنه‌ی کندل" },
  { id: "depthAtr", label: "عمق برگشت میانی (ATR)", hint: "بین دو نقطه، قیمت چقدر برگشته؛ کم یعنی دو نقطه‌ی بی‌اهمیت" },
  { id: "macdDiff", label: "اختلاف مکدی (٪)", hint: "مکدی دوم نسبت به اولی؛ منفی یعنی ضعیف‌تر (دایورجنس واضح‌تر)" },
  { id: "macdSize", label: "اندازه‌ی مکدی (ATR)", hint: "بزرگی مکدی اول نسبت به ATR؛ مکدی نزدیک صفر یعنی نویز" },
  { id: "crossDelay", label: "تأخیر کراس (کندل)", hint: "چند کندل بعد از نقطه‌ی دوم مکدی، کراس شد" },
  { id: "priceCut", label: "بریدن خط قیمت (ATR)", hint: "بیشترین فاصله‌ای که قیمت میان دو نقطه خط را بریده؛ ۰ یعنی نبریده" },
];

export function divFeatures(c: Candle[], d: Divergence): Record<string, number> {
  const s = d.side === "high" ? 1 : -1;
  const from = Math.max(0, d.b.i - 14);
  let atr = 0;
  for (let i = from; i <= d.b.i; i++) atr += c[i].high - c[i].low;
  atr = atr / (d.b.i - from + 1) || 1e-9;

  // price between the two points: how far it went back, and whether it crossed the line joining them
  let back = 0;
  let priceCut = 0;
  for (let i = d.a.i + 1; i < d.b.i; i++) {
    const t = (i - d.a.i) / (d.b.i - d.a.i);
    const line = d.a.price + (d.b.price - d.a.price) * t;
    const extreme = s === 1 ? c[i].high : c[i].low;
    priceCut = Math.max(priceCut, s * (extreme - line));
    back = Math.max(back, s * (d.a.price - (s === 1 ? c[i].low : c[i].high)));
  }
  return {
    gap: d.b.i - d.a.i,
    priceMoveAtr: (s * (d.b.price - d.a.price)) / atr,
    depthAtr: back / atr,
    macdDiff: (s * (d.b.macd - d.a.macd) * 100) / Math.max(Math.abs(d.a.macd), 1e-9),
    macdSize: Math.abs(d.a.macd) / atr,
    crossDelay: d.cross - d.b.mi,
    priceCut: priceCut / atr,
  };
}

/** Stable identity of a finding, the same on every device and after a reload. */
export const divKey = (tfSec: number, c: Candle[], d: Divergence) => `${tfSec}:${d.side}:${c[d.a.i].time}:${c[d.b.i].time}`;

export interface FeatureReport {
  id: string;
  okMedian: number;
  badMedian: number;
  /** best single cut: "value >= threshold" (or "<=") separates real from not-real with this share of correct calls */
  threshold: number;
  dir: ">=" | "<=";
  accuracy: number;
}

const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** For every measurement: how do the ✓ and the ✗ differ, and where is the best single cut. Needs a few of each to mean anything. */
export function analyseLabels(rows: { label: "ok" | "bad"; features: Record<string, number> | null }[]): FeatureReport[] {
  const use = rows.filter((r) => r.features);
  const out: FeatureReport[] = [];
  for (const f of FEATURES) {
    const pts = use.map((r) => ({ v: r.features![f.id], ok: r.label === "ok" })).filter((p) => Number.isFinite(p.v));
    if (pts.length < 2) continue;
    let best = { threshold: 0, dir: ">=" as ">=" | "<=", accuracy: 0 };
    for (const p of pts) {
      for (const dir of [">=", "<="] as const) {
        const correct = pts.filter((q) => ((dir === ">=" ? q.v >= p.v : q.v <= p.v) ? q.ok : !q.ok)).length / pts.length;
        if (correct > best.accuracy) best = { threshold: p.v, dir, accuracy: correct };
      }
    }
    out.push({
      id: f.id,
      okMedian: median(pts.filter((p) => p.ok).map((p) => p.v)),
      badMedian: median(pts.filter((p) => !p.ok).map((p) => p.v)),
      ...best,
    });
  }
  return out.sort((a, b) => b.accuracy - a.accuracy);
}