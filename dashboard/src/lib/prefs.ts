import { useCallback, useEffect, useState } from "react";
import { DEFAULT_DIV, type DivParams } from "./detectors/divergence";

/* ---------- theme: Cherish palette, light or dark, one switch (Elias, 2026-09-22) ---------- */
export type Theme = "light" | "dark";
const K_THEME = "rt.theme";

export function getTheme(): Theme {
  try {
    // any older/unknown stored value (the previous "neon"/"classic" themes, or none yet) falls back to dark
    return localStorage.getItem(K_THEME) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(K_THEME, t);
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event("rt-prefs"));
}

/* ---------- daily trade cap (used by Analysis and the risk gauge) ---------- */
const K_MAX = "rt.maxPerDay";
const DEFAULT_MAX = 3; // the experiment Elias defined in his own notes: at most 3 trades a day

export function getMaxPerDay(): number {
  try {
    const n = Number(localStorage.getItem(K_MAX));
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX;
  } catch {
    return DEFAULT_MAX;
  }
}

export function setMaxPerDay(n: number): void {
  try {
    localStorage.setItem(K_MAX, String(Math.max(1, Math.round(n))));
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event("rt-prefs"));
}

/* ---------- divergence rule parameters (the two that are assumptions, so they can be changed) ---------- */
const K_DIV = "rt.rule.divergence";

export function getDivParams(): DivParams {
  try {
    const o = JSON.parse(localStorage.getItem(K_DIV) ?? "null");
    // a stored gap under 10 candles finds almost nothing (a stale value from a box that snapped to its minimum): use the default
    if (o && Number.isFinite(o.n) && o.n >= 1 && Number.isFinite(o.maxGap) && o.maxGap >= 10) {
      const tol = Number.isFinite(o.tol) && o.tol >= 0 ? Math.round(o.tol) : DEFAULT_DIV.tol;
      const crossWithin = Number.isFinite(o.crossWithin) && o.crossWithin >= 1 ? Math.round(o.crossWithin) : DEFAULT_DIV.crossWithin;
      const macdTol = Number.isFinite(o.macdTol) && o.macdTol >= 0 ? o.macdTol : DEFAULT_DIV.macdTol;
      const method: DivParams["method"] = o.method === "price" ? "price" : "macd"; // the clean, MACD-anchored method unless Elias chose the other
      return { n: Math.round(o.n), tol, maxGap: Math.round(o.maxGap), crossWithin, macdTol, method, high: o.high !== false, low: o.low !== false };
    }
  } catch {
    /* fall back to the defaults */
  }
  return { ...DEFAULT_DIV, method: "macd" };
}

export function setDivParams(p: DivParams): void {
  try {
    localStorage.setItem(K_DIV, JSON.stringify(p));
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event("rt-prefs"));
}

/** Re-renders when a preference changes anywhere in the app. */
function usePrefValue<T>(read: () => T): T {
  const [v, setV] = useState<T>(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener("rt-prefs", on);
    return () => window.removeEventListener("rt-prefs", on);
  }, [read]);
  return v;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  return [usePrefValue(getTheme), useCallback((t: Theme) => applyTheme(t), [])];
}

export function useMaxPerDay(): [number, (n: number) => void] {
  return [usePrefValue(getMaxPerDay), setMaxPerDay];
}

/* ---------- default timeframe + replay speed (used by Settings -> Chart/Backtest cards) ---------- */
const K_TF = "rt.defaultTf";
const VALID_TF = [60, 300, 900, 1800, 3600, 14400, 86400];

export function getDefaultTf(): number {
  try {
    const n = Number(localStorage.getItem(K_TF));
    return VALID_TF.includes(n) ? n : 60;
  } catch {
    return 60;
  }
}

export function setDefaultTf(sec: number): void {
  try {
    localStorage.setItem(K_TF, String(sec));
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event("rt-prefs"));
}

const K_SPEED = "rt.defaultReplaySpeed";
const VALID_SPEED = [1, 2, 5, 10, 30];

export function getDefaultReplaySpeed(): number {
  try {
    const n = Number(localStorage.getItem(K_SPEED));
    return VALID_SPEED.includes(n) ? n : 5;
  } catch {
    return 5;
  }
}

export function setDefaultReplaySpeed(n: number): void {
  try {
    localStorage.setItem(K_SPEED, String(n));
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event("rt-prefs"));
}

/* ---------- chart shift: like "Chart shift" in MT5 — a single on/off, the last candle sits 20% in from the right edge ---------- */
const K_SHIFT = "rt.chart.shiftOn";

export function getChartShift(): boolean {
  try {
    return localStorage.getItem(K_SHIFT) !== "0"; // on by default, as in MT5
  } catch {
    return true;
  }
}

export function setChartShift(on: boolean): void {
  try {
    localStorage.setItem(K_SHIFT, on ? "1" : "0");
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event("rt-prefs"));
}

export function useChartShift(): [boolean, (on: boolean) => void] {
  return [usePrefValue(getChartShift), setChartShift];
}

export function useDivParams():[DivParams, (p: DivParams) => void] {
  // getDivParams returns a fresh object each call; compare by content so React does not loop
  const [v, setV] = useState<DivParams>(getDivParams);
  useEffect(() => {
    const on = () => setV((cur) => { const n = getDivParams(); return JSON.stringify(n) === JSON.stringify(cur) ? cur : n; });
    window.addEventListener("rt-prefs", on);
    return () => window.removeEventListener("rt-prefs", on);
  }, []);
  return [v, setDivParams];
}
