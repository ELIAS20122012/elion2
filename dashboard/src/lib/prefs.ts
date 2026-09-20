import { useCallback, useEffect, useState } from "react";

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
