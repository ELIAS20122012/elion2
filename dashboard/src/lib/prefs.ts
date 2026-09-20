import { useCallback, useEffect, useState } from "react";
import { DEFAULT_DIV, type DivParams } from "./detectors/divergence";

/* ---------- theme ---------- */
export type Theme = "neon" | "classic";
const K_THEME = "rt.theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(K_THEME) === "classic" ? "classic" : "neon";
  } catch {
    return "neon";
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
    if (o && Number.isFinite(o.n) && o.n >= 1 && Number.isFinite(o.maxGap) && o.maxGap >= 3) {
      const tol = Number.isFinite(o.tol) && o.tol >= 0 ? Math.round(o.tol) : DEFAULT_DIV.tol;
      return { n: Math.round(o.n), tol, maxGap: Math.round(o.maxGap), high: o.high !== false, low: o.low !== false };
    }
  } catch {
    /* fall back to the defaults */
  }
  return DEFAULT_DIV;
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

export function useDivParams(): [DivParams, (p: DivParams) => void] {
  // getDivParams returns a fresh object each call; compare by content so React does not loop
  const [v, setV] = useState<DivParams>(getDivParams);
  useEffect(() => {
    const on = () => setV((cur) => { const n = getDivParams(); return JSON.stringify(n) === JSON.stringify(cur) ? cur : n; });
    window.addEventListener("rt-prefs", on);
    return () => window.removeEventListener("rt-prefs", on);
  }, []);
  return [v, setDivParams];
}
