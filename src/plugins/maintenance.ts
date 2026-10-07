// Housekeeping without AI: nightly backup (03:30) and a weekly report in Telegram (Sunday 19:00).
// /backup and /report run them on demand. Secrets and Google tokens are never copied into backups.
import fs from "node:fs";
import path from "node:path";
import type { Kernel } from "../kernel/kernel.ts";
import type { ExecutionProvider } from "../providers/types.ts";
import type { Plugin } from "./types.ts";

export const BACKUP_SCHEDULE = "nightly-backup";
export const REPORT_SCHEDULE = "weekly-report";

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Consistent SQLite snapshot (VACUUM INTO) + memory/skills/templates/config. Keeps the newest `keep` backups. */
export function backup(k: Kernel, home: string, dir: string, keep = 14): { folder: string; bytes: number; removed: number } {
  k.setKv("maintenance.last_backup_attempt", new Date().toISOString());
  const folder = path.join(dir, stamp());
  fs.mkdirSync(folder, { recursive: true });
  const db = path.join(folder, "elias.db");
  k.db.exec(`VACUUM INTO '${db.replace(/'/g, "''")}'`);
  const copy = (rel: string) => {
    const src = path.join(home, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(folder, rel), { recursive: true });
  };
  for (const rel of ["data/knowledge", "skills", "content/templates", "content/shorts/prompts.txt", "config/elias.config.json", "data/workspace/PERSONA.local.md"]) copy(rel);
  const size = (p: string): number => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((s, f) => s + size(path.join(p, f)), 0) : fs.statSync(p).size);
  const all = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(f)).sort();
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const f of old) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  k.setKv("maintenance.last_backup", new Date().toISOString());
  return { folder, bytes: size(folder), removed: old.length };
}

/** Plain-numbers weekly summary from the task table and event log. */
export function weeklyReport(k: Kernel, days = 7): string {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = k.db.prepare("SELECT title, status, provider, source, result, failure_kind FROM tasks WHERE updated_at >= ?").all(since) as Array<Record<string, string | null>>;
  const count = (f: (r: Record<string, string | null>) => boolean) => rows.filter(f).length;
  const ok = count((r) => r.status === "succeeded" && r.source !== "internal");
  const failed = rows.filter((r) => r.status === "failed");
  const videos = rows.filter((r) => r.provider === "youtube" && r.status === "succeeded").map((r) => (r.result ?? "").match(/https:\/\/youtu\.be\/\S+/)?.[0]).filter(Boolean);
  const reminders = count((r) => r.provider === "reminder" && r.status === "succeeded");
  const chats = count((r) => (r.source === "telegram" || r.source === "telegram-voice") && r.status === "succeeded");
  const ev = k.db.prepare("SELECT data FROM events WHERE type='task.succeeded' AND ts >= ?").all(since) as Array<{ data: string | null }>;
  const byProvider: Record<string, number> = {};
  for (const e of ev) {
    const p = (e.data ? (JSON.parse(e.data) as { provider?: string }).provider : undefined) ?? "?";
    byProvider[p] = (byProvider[p] ?? 0) + 1;
  }
  const fallbacks = (k.db.prepare("SELECT COUNT(*) n FROM events WHERE type='provider.fallback' AND ts >= ?").get(since) as { n: number }).n;
  return [
    `📊 گزارش ${days} روز گذشته`,
    `✅ کار موفق: ${ok} · ❌ شکست: ${failed.length}`,
    `💬 جواب در چت: ${chats} · ⏰ یادآوری: ${reminders}`,
    `🎬 ویدیوی منتشرشده: ${videos.length}${videos.length ? "\n" + videos.join("\n") : ""}`,
    `🤖 مدل‌ها: ${Object.entries(byProvider).filter(([p]) => p !== "?").map(([p, n]) => `${p} ${n}`).join("، ") || "-"}${fallbacks ? ` · جابه‌جایی به مدل جایگزین: ${fallbacks}` : ""}`,
    ...(failed.length ? ["", "❌ شکست‌ها:", ...failed.slice(0, 8).map((r) => `- ${r.title} (${r.failure_kind ?? "?"})`), "دوباره: /retry"] : []),
  ].join("\n");
}

export const maintenancePlugin: Plugin = {
  name: "maintenance",
  description: "Nightly backup + weekly report (/backup /report)",
  setup({ kernel, home, options }) {
    const dir = path.resolve(home, String(options.backupDir ?? path.join("data", "backups")));
    const keep = Number(options.keep ?? 14);
    const provider: ExecutionProvider = {
      name: "maintenance",
      health: async () => ({ ok: true, detail: `backups → ${dir}` }),
      execute: async (req) => {
        const job = req.prompt.trim().split(/\s/)[0];
        if (job === "backup") {
          // housekeeping: background jobs (risk watch, renders…) older than 14 days are not worth keeping
          const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
          kernel.db.prepare("DELETE FROM runs WHERE task_id IN (SELECT id FROM tasks WHERE source='internal' AND status IN ('succeeded','cancelled') AND updated_at < ?)").run(cutoff);
          kernel.db.prepare("DELETE FROM tasks WHERE source='internal' AND status IN ('succeeded','cancelled') AND updated_at < ? AND id NOT IN (SELECT task_id FROM approvals) AND id NOT IN (SELECT task_id FROM runs)").run(cutoff);
          const r = backup(kernel, home, dir, keep);
          return { output: `💾 پشتیبان: ${r.folder} (${(r.bytes / 1024 / 1024).toFixed(1)} MB)${r.removed ? ` · ${r.removed} قدیمی حذف شد` : ""}` };
        }
        if (job === "report") return { output: weeklyReport(kernel) };
        throw new Error(`unknown maintenance job "${job}"`);
      },
    };
    kernel.registerProvider(provider);
    const job = (title: string, prompt: string, source: string) => ({ title, prompt, provider: "maintenance", source, verify: { type: "non_empty" as const }, maxAttempts: 2 });
    if (!kernel.getSchedule(BACKUP_SCHEDULE)) kernel.addSchedule(BACKUP_SCHEDULE, "30 3 * * *", job("💾 پشتیبان شبانه", "backup", "internal"));
    if (!kernel.getSchedule(REPORT_SCHEDULE)) kernel.addSchedule(REPORT_SCHEDULE, "0 19 * * 0", job("📊 گزارش هفتگی", "report", "report"));
    kernel.registerCommand({
      name: "backup",
      description: "پشتیبان‌گیری همین الان",
      plugin: "maintenance",
      run() {
        const r = backup(kernel, home, dir, keep);
        return `💾 پشتیبان گرفته شد (${(r.bytes / 1024 / 1024).toFixed(1)} MB)\n${r.folder}`;
      },
    });
    kernel.registerCommand({ name: "report", description: "گزارش ۷ روز گذشته", plugin: "maintenance", run: () => weeklyReport(kernel) });
  },
};
