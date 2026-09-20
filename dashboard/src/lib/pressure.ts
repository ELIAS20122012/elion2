import { isClosed, net } from "./analytics";
import type { JTrade } from "./journalApi";

export interface PressurePart { label: string; points: number; max: number; note: string }
export interface Pressure {
  score: number;                       // 0..100
  level: "calm" | "watch" | "high";
  parts: PressurePart[];
  tradesToday: number;
  cap: number;
  netToday: number;
  peakToday: number;
  givebackToday: number;
  lossStreak: number;
}

export const LEVEL_LABEL = { calm: "آرام", watch: "نیاز به توجه", high: "فشار بالا" } as const;

const day = (t: number) => Math.floor(t / 86400);

/**
 * "Day pressure": a transparent 0-100 reading of how today is going, from three things only:
 *  - trades opened today compared with the daily cap        (max 40)
 *  - share of today's best realised profit that was given back (max 30)
 *  - current run of consecutive losing trades                 (max 30)
 * It is an OBSERVATION to look at, not a trading rule; the cap is Elias's own setting.
 */
export function dayPressure(trades: JTrade[], today: number, cap: number): Pressure {
  const openedToday = trades.filter((t) => day(t.open_time) === today).length;
  const closedToday = trades
    .filter((t) => isClosed(t) && day(t.close_time as number) === today)
    .sort((a, b) => (a.close_time as number) - (b.close_time as number));

  let cum = 0;
  let peak = 0;
  for (const t of closedToday) {
    cum += net(t);
    peak = Math.max(peak, cum);
  }
  const giveback = peak > 0 ? Math.max(0, peak - cum) : 0;

  let streak = 0;
  for (let i = closedToday.length - 1; i >= 0 && net(closedToday[i]) < 0; i--) streak++;

  const p1 = Math.min(1, openedToday / Math.max(1, cap)) * 40;
  const p2 = peak > 0 ? Math.min(1, giveback / peak) * 30 : 0;
  const p3 = Math.min(1, streak / 3) * 30;
  const score = Math.round(p1 + p2 + p3);

  return {
    score,
    level: score < 34 ? "calm" : score < 67 ? "watch" : "high",
    parts: [
      { label: "معاملات امروز نسبت به سقف", points: Math.round(p1), max: 40, note: `${openedToday} از ${cap}` },
      { label: "سود پس‌داده‌شده از اوج روز", points: Math.round(p2), max: 30, note: peak > 0 ? `${giveback.toFixed(2)}$ از ${peak.toFixed(2)}$` : "سودی نبوده" },
      { label: "باخت پیاپی فعلی", points: Math.round(p3), max: 30, note: `${streak} معامله` },
    ],
    tradesToday: openedToday,
    cap,
    netToday: cum,
    peakToday: peak,
    givebackToday: giveback,
    lossStreak: streak,
  };
}
