// Self-monitoring without AI: every 15 min checks Google, AI models, remote tunnel, backups, disk and
// failure bursts. Telegram gets one alert when something breaks and one "✅ fixed" when it recovers. /health = full report.
import fs from "node:fs";
import path from "node:path";
import type { Kernel } from "../kernel/kernel.ts";
import type { ExecutionProvider } from "../providers/types.ts";
import { GoogleAuth } from "../connectors/google.ts";
import type { Plugin } from "./types.ts";
import { withTimeout } from "../kernel/timeout.ts";

export interface CheckResult {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

const AI = ["claude-code", "codex", "antigravity", "gemini-vertex", "gemini", "ollama"];
const ago = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Infinity);

export async function runChecks(k: Kernel, home: string, o: { google?: GoogleAuth | null; minFreeGb?: number } = {}): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  // Google (briefing, YouTube, AI video)
  const g = o.google;
  if (g?.isAuthorized()) {
    try {
      await g.accessToken(AbortSignal.timeout(20_000));
      out.push({ key: "google", label: "گوگل", ok: true, detail: "متصل" });
    } catch (e) {
      out.push({ key: "google", label: "گوگل", ok: false, detail: (e as Error).message.slice(0, 160), fix: "setup/google-setup.cmd را یک بار اجرا کن" });
    }
  } else if (g) {
    out.push({ key: "google", label: "گوگل", ok: false, detail: "وصل نیست", fix: "setup/google-setup.cmd را اجرا کن" });
  }

  // AI models: health + usage-limit cooldowns
  const now = Date.now();
  const models: string[] = [];
  let usable = 0;
  for (const p of k.listProviders().filter((x) => AI.includes(x.name))) {
    const until = Number(k.getKv(`provider.cooldown.${p.name}`) ?? 0);
    let ok = true;
    let note = "";
    if (until > now) {
      ok = false;
      note = `محدود تا ${new Date(until).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`;
    } else {
      try {
        const h = await withTimeout<{ ok: boolean; detail: string }>(p.health(), 20_000, { ok: false, detail: "timeout" });
        ok = h.ok;
        if (!ok) note = h.detail.slice(0, 60);
      } catch (e) {
        ok = false;
        note = (e as Error).message.slice(0, 60);
      }
    }
    if (ok) usable++;
    models.push(`${ok ? "✅" : "⚠️"} ${p.name}${note ? ` (${note})` : ""}`);
  }
  const claudeDown = models.some((m) => m.startsWith("⚠️ claude-code"));
  out.push({
    key: "ai",
    label: "مدل‌های AI",
    ok: usable > 0 && !claudeDown,
    detail: models.join(" · ") || "—",
    ...(usable === 0 ? { fix: "هیچ مدلی در دسترس نیست — تسک‌ها منتظر می‌مانند" } : claudeDown ? { fix: "کارها با مدل جایگزین انجام می‌شوند" } : {}),
  });

  // Remote panel tunnel (only if it has ever run)
  const ts = k.getKv("tunnel.state");
  if (ts) {
    const t = JSON.parse(ts) as { up: boolean; at: string };
    const down = !t.up && ago(t.at) > 5 / 60;
    out.push({ key: "tunnel", label: "پنل از راه دور", ok: !down, detail: down ? "تونل Cloudflare قطع است" : "متصل", ...(down ? { fix: "/restart یا data/tunnel.log را چک کن" } : {}) });
  }

  // Backups
  const last = k.getKv("maintenance.last_backup");
  const attempt = k.getKv("maintenance.last_backup_attempt");
  if (last || attempt) {
    const h = ago(last);
    out.push({
      key: "backup",
      label: "پشتیبان",
      ok: h < 26,
      detail: last ? `آخرین: ${Math.round(h)} ساعت پیش` : "هنوز موفق نشده",
      ...(h >= 26 ? { fix: "/backup را بزن؛ اگر خطا داد مسیر OneDrive را چک کن" } : {}),
    });
  }

  // Disk space where Elias OS lives
  try {
    const st = fs.statfsSync(home);
    const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
    const min = o.minFreeGb ?? 5;
    out.push({ key: "disk", label: "فضای دیسک", ok: freeGb >= min, detail: `${freeGb.toFixed(1)} GB آزاد`, ...(freeGb < min ? { fix: "ویدیوهای قدیمی content/ و data/backups را پاک کن" } : {}) });
  } catch {
    /* statfs not available */
  }

  // Failure burst: 3+ user-facing failures in the last hour
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const fails = k.db.prepare("SELECT title FROM tasks WHERE status='failed' AND source != 'internal' AND updated_at >= ?").all(since) as Array<{ title: string }>;
  out.push({
    key: "failures",
    label: "شکست تسک‌ها",
    ok: fails.length < 3,
    detail: fails.length ? `${fails.length} شکست در یک ساعت اخیر` : "بدون شکست اخیر",
    ...(fails.length >= 3 ? { fix: `${fails.slice(0, 3).map((f) => f.title).join("، ")} — /retry` } : {}),
  });

  return out;
}

export function healthReport(results: CheckResult[]): string {
  const bad = results.filter((r) => !r.ok).length;
  return [
    bad ? `🩺 ${bad} مورد نیاز به توجه دارد` : "🩺 همه چیز سالم است",
    "",
    ...results.map((r) => `${r.ok ? "✅" : "⚠️"} ${r.label}: ${r.detail}${!r.ok && r.fix ? `\n   👉 ${r.fix}` : ""}`),
  ].join("\n");
}

/** Compares with the last stored state and returns only transitions (broke / recovered). */
export function transitions(k: Kernel, results: CheckResult[]): string[] {
  const msgs: string[] = [];
  for (const r of results) {
    const key = `health.state.${r.key}`;
    const prev = k.getKv(key);
    const cur = r.ok ? "ok" : "bad";
    if (prev === cur) continue;
    k.setKv(key, cur);
    if (cur === "bad") msgs.push(`⚠️ ${r.label}: ${r.detail}${r.fix ? `\n👉 ${r.fix}` : ""}`);
    else if (prev === "bad") msgs.push(`✅ ${r.label} دوباره سالم است (${r.detail})`);
  }
  return msgs;
}

export const healthPlugin: Plugin = {
  name: "health",
  description: "Self-monitoring: alerts on breakage + recovery, /health",
  setup({ kernel, home, options }) {
    const google = fs.existsSync(path.join(home, "config", "google-client.json")) ? new GoogleAuth(path.join(home, "config")) : null;
    const opts = { google, minFreeGb: Number(options.minFreeGb ?? 5) };
    const provider: ExecutionProvider = {
      name: "health",
      health: async () => ({ ok: true, detail: "built-in" }),
      execute: async () => {
        const msgs = transitions(kernel, await runChecks(kernel, home, opts));
        if (msgs.length) {
          kernel.createTask({ title: "🩺 سلامت سیستم", prompt: msgs.join("\n\n"), provider: "reminder", source: "reminder", verify: { type: "non_empty" }, maxAttempts: 1 });
        }
        return { output: msgs.length ? `alerts: ${msgs.length}` : "ok" };
      },
    };
    kernel.registerProvider(provider);
    if (!kernel.getSchedule("health-watch")) {
      kernel.addSchedule("health-watch", "*/15 * * * *", { title: "🩺 پایش سلامت", prompt: "check", provider: "health", source: "internal", verify: { type: "non_empty" }, maxAttempts: 1 });
    }
    kernel.registerCommand({
      name: "health",
      description: "وضعیت سلامت همه‌ی بخش‌ها",
      plugin: "health",
      run: async () => healthReport(await runChecks(kernel, home, opts)),
    });
  },
};
