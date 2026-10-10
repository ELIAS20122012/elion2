"use client";
import { useCallback, useEffect, useState } from "react";

export type Status = "queued" | "awaiting_approval" | "running" | "verifying" | "succeeded" | "failed" | "cancelled";
export interface Task {
  id: string; title: string; status: Status; provider: string; source: string;
  failureKind: string | null; error: string | null; result: string | null; updatedAt: string;
}
export interface Overview {
  stats: Partial<Record<Status, number>>;
  heartbeat: string | null;
  providers: { name: string; coolingUntil: string | null }[];
  approvals: { id: string; taskId: string; task: string; capability: string; reason?: string }[];
  tasks: Task[];
  schedules: { name: string; cron: string; enabled: boolean; nextRunAt: string | null }[];
  skills: { name: string; description: string; plugin: string }[];
  commands: { name: string; description: string; plugin: string }[];
  plugins: { name: string; source: string; description?: string; error?: string }[];
  events: { ts: string; level: string; type: string; message: string }[];
}
export interface Appointment { id: string; date: string; time: string | null; text: string; gcal?: string }
export interface Stat { runs: number; ok: number; ms: number; wins: number }
export interface Lab {
  models: { name: string; label: string; restingUntil: string | null }[];
  stats: Record<string, Stat>;
  categories: { name: string; label: string; best: string | null; models: Record<string, Stat> }[];
  routing: boolean;
}

/** GET a JSON endpoint and refresh it every `ms` (pauses while the tab is hidden). */
export function usePoll<T>(url: string, ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [down, setDown] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as T);
      setDown(false);
    } catch {
      setDown(true);
    }
  }, [url]);
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), ms);
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener(REFRESH, load);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener(REFRESH, load);
    };
  }, [load, ms]);
  return { data, down, reload: load };
}

const REFRESH = "eos-refresh";

/** POST to the daemon (writes need the X-Elias header), then refresh every panel. */
export async function post(url: string, body: Record<string, unknown> = {}): Promise<{ ok?: boolean; reply?: string; error?: string; id?: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-elias": "1" }, body: JSON.stringify(body) });
    const j = await r.json();
    window.dispatchEvent(new Event(REFRESH));
    return j;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export const command = (name: string, input = "") => post(`/api/commands/${encodeURIComponent(name)}/run`, { input });

export const ICON: Record<Status, string> = { queued: "⏳", awaiting_approval: "🔐", running: "⚙️", verifying: "🔎", succeeded: "✅", failed: "❌", cancelled: "🛑" };
export const FA: Record<Status, string> = { queued: "در صف", awaiting_approval: "منتظر تأیید", running: "در حال اجرا", verifying: "بررسی", succeeded: "موفق", failed: "شکست", cancelled: "لغو" };

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins >= 0 && mins < 1) return "همین الان";
  if (mins > 0 && mins < 60) return `${mins.toLocaleString("fa-IR")} دقیقه پیش`;
  return d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
}

export function faDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("fa-IR-u-ca-gregory", { weekday: "long", day: "numeric", month: "long" }) + ` · ${ymd.split("-").reverse().join(".")}`;
}

export function daysUntil(ymd: string): number {
  const t = new Date();
  const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round((Date.UTC(y!, m! - 1, d!) - today) / 86_400_000);
}
