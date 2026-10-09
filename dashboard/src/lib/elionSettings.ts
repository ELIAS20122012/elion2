import { useCallback, useEffect, useState } from "react";

export type Lang = "en" | "fa";

/** Every Settings-page option that really does something, persisted in localStorage. */
export interface ElionSettings {
  lang: Lang;
  tz: string; df: string; tf: string; font: string; landing: string;
  confirmExit: boolean; sounds: boolean;
  lot: string; slPts: string; tpPts: string; risk: string; riskU: "%" | "$";
  maxPos: string; hedge: boolean; rrBox: boolean; autoSize: boolean;
  /** Order buttons stay locked until every checklist item is ticked */
  checklistReq: boolean;
  showGrid: boolean;
  colorTheme: string; accent: number; anim: boolean;
  notify: boolean; nExec: boolean; nClose: boolean; nSess: boolean; nNews: boolean;
  autoBackup: boolean;
}

export const DEFAULT_SETTINGS: ElionSettings = {
  lang: "en",
  tz: "This device", df: "DD Mon YYYY", tf: "24-hour", font: "Medium", landing: "Home",
  confirmExit: false, sounds: true,
  lot: "0.05", slPts: "0", tpPts: "0", risk: "1.0", riskU: "%",
  maxPos: "Unlimited", hedge: true, rrBox: true, autoSize: false,
  checklistReq: true,
  showGrid: true,
  colorTheme: "ELION Dark", accent: 0, anim: true,
  notify: false, nExec: true, nClose: true, nSess: true, nNews: true,
  autoBackup: false,
};

export const ACCENTS = ["#e9d7b0", "#3ccfb2", "#3b8fe0", "#a46be0", "#f0932b", "#ef4444"];
export const TZ_OPTIONS: Record<string, string | undefined> = {
  "This device": undefined,
  "Vienna (CET)": "Europe/Vienna",
  "London": "Europe/London",
  "Tehran": "Asia/Tehran",
  "New York": "America/New_York",
  "UTC": "UTC",
};
export const LANDING_ROUTES: Record<string, string> = {
  Home: "/elion", Trade: "/chart", Journal: "/journal", Analytics: "/analysis", "AI Lab": "/ai-lab", Backtest: "/backtest",
};

const KEY = "rt.elion.settings";
const EVENT = "rt-prefs";

export function getSettings(): ElionSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function patchSettings(p: Partial<ElionSettings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), ...p }));
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSettings(): [ElionSettings, (p: Partial<ElionSettings>) => void] {
  const [s, setS] = useState<ElionSettings>(getSettings);
  useEffect(() => {
    const on = () => setS(getSettings());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [s, useCallback((p: Partial<ElionSettings>) => patchSettings(p), [])];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The header clock, in the chosen timezone / date format / 12-24h style. */
export function formatClock(now: Date, s: ElionSettings): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_OPTIONS[s.tz], hour12: false, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const pad = (v: string | number) => String(v).padStart(2, "0");
  const y = g("year"), mo = Number(g("month")), d = Number(g("day"));
  let h = Number(g("hour")) % 24;
  const date = s.df === "YYYY-MM-DD" ? `${y}-${pad(mo)}-${pad(d)}`
    : s.df === "DD/MM/YYYY" ? `${pad(d)}/${pad(mo)}/${y}`
    : s.df === "MM/DD/YYYY" ? `${pad(mo)}/${pad(d)}/${y}`
    : s.lang === "fa"
      ? `${new Intl.DateTimeFormat("fa-u-ca-gregory-nu-latn", { timeZone: TZ_OPTIONS[s.tz], weekday: "short" }).format(now)}، ${pad(d)} ${new Intl.DateTimeFormat("fa-u-ca-gregory-nu-latn", { timeZone: TZ_OPTIONS[s.tz], month: "long" }).format(now)} ${y}`
      : `${g("weekday") || WEEKDAYS[now.getDay()]}, ${pad(d)} ${MONTHS[mo - 1]} ${y}`;
  let time: string;
  if (s.tf === "12-hour") {
    const suf = s.lang === "fa" ? (h >= 12 ? "ب.ظ." : "ق.ظ.") : h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    time = `${h}:${pad(g("minute"))}:${pad(g("second"))} ${suf}`;
  } else time = `${pad(h)}:${pad(g("minute"))}:${pad(g("second"))}`;
  return `${date} | ${time}`;
}

/* ---------- sound + browser notifications ---------- */
let audio: AudioContext | null = null;
export function beep(ok = true): void {
  if (!getSettings().sounds) return;
  try {
    audio = audio ?? new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.06;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.3));
  } catch {
    /* audio blocked until the first user gesture */
  }
}

export function notifySupported(): boolean {
  return typeof Notification !== "undefined";
}

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!notifySupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/** A real OS notification (when the user allowed it) plus the optional sound. */
export function notifyUser(title: string, body: string): void {
  const s = getSettings();
  if (!s.notify) return;
  beep(true);
  if (notifySupported() && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      /* some browsers only allow it from a service worker */
    }
  }
}

