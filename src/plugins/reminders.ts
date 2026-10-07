// Reminders: /remind 18:30 متن · /remind فردا 9 متن · /remind 2h متن · /remind هر روز 8:15 متن
// One-shot reminders are queued tasks with notBefore; daily ones are kernel schedules. No AI involved.
import type { Kernel } from "../kernel/kernel.ts";
import type { ExecutionProvider } from "../providers/types.ts";
import type { Plugin } from "./types.ts";

export const REMINDER_TITLE = "⏰ یادآوری";
const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

export function normDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => String(FA.includes(d) ? FA.indexOf(d) : AR.indexOf(d)));
}

export type ParsedReminder = { at: Date; text: string; daily: false } | { daily: true; hour: number; minute: number; text: string };

function clock(tok: string): { h: number; m: number } | null {
  const m = tok.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

/** Parses the reminder syntax. `now` is injectable for tests. Returns null when no time is recognised. */
export function parseReminder(input: string, now = new Date()): ParsedReminder | null {
  const words = normDigits(input).trim().split(/\s+/);
  const rest = (n: number) => words.slice(n).join(" ").trim();
  if (!words.length) return null;

  // daily: "هر روز 8:15 …" / "daily 8:15 …"
  if ((words[0] === "هر" && words[1] === "روز") || words[0]?.toLowerCase() === "daily") {
    const i = words[0] === "هر" ? 2 : 1;
    const c = clock(words[i] ?? "");
    return c && rest(i + 1) ? { daily: true, hour: c.h, minute: c.m, text: rest(i + 1) } : null;
  }

  // relative: "2h", "30m", "1d", "۱۰ دقیقه", "2 ساعت", "3 روز"
  const rel = words[0]!.match(/^(\d+)(m|min|h|d)$/i);
  const unitFa: Record<string, number> = { دقیقه: 60_000, ساعت: 3_600_000, روز: 86_400_000 };
  if (rel) {
    const mult = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2]!.toLowerCase() as "m"]!;
    return rest(1) ? { daily: false, at: new Date(now.getTime() + Number(rel[1]) * mult), text: rest(1) } : null;
  }
  if (/^\d+$/.test(words[0]!) && unitFa[words[1] ?? ""]) {
    const text = rest(words[2] === "دیگه" || words[2] === "دیگر" || words[2] === "بعد" ? 3 : 2);
    return text ? { daily: false, at: new Date(now.getTime() + Number(words[0]) * unitFa[words[1]!]!), text } : null;
  }

  // absolute: "[فردا|tomorrow|YYYY-MM-DD] HH[:MM] …"
  let day = new Date(now);
  let i = 0;
  let explicitDay = false;
  if (words[0] === "فردا" || words[0]?.toLowerCase() === "tomorrow") {
    day.setDate(day.getDate() + 1);
    i = 1;
    explicitDay = true;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(words[0]!)) {
    const [y, mo, d] = words[0]!.split("-").map(Number);
    day = new Date(y!, mo! - 1, d!);
    i = 1;
    explicitDay = true;
  }
  if (words[i] === "ساعت") i++;
  const c = clock(words[i] ?? "");
  if (!c || !rest(i + 1)) return null;
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), c.h, c.m, 0, 0);
  if (!explicitDay && at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return { daily: false, at, text: rest(i + 1) };
}

function fmt(d: Date): string {
  return d.toLocaleString("fa-IR", { weekday: "long", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

const reminderTask = (text: string) => ({
  title: REMINDER_TITLE,
  prompt: text,
  provider: "reminder",
  source: "reminder",
  verify: { type: "non_empty" as const },
  maxAttempts: 1,
});

export const reminderProvider: ExecutionProvider = {
  name: "reminder",
  health: async () => ({ ok: true, detail: "built-in" }),
  execute: async (req) => ({ output: req.prompt.split("\n\n<data")[0]!.trim() }),
};

export function pendingReminders(k: Kernel) {
  return k.listTasks({ status: "queued", limit: 200 }).filter((t) => t.provider === "reminder");
}

export const remindersPlugin: Plugin = {
  name: "reminders",
  description: "Reminders without AI: /remind /reminders",
  setup({ kernel }) {
    kernel.registerProvider(reminderProvider);
    kernel.registerCommand({
      name: "remind",
      description: "یادآوری (/remind 18:30 متن · فردا 9 · 2h · هر روز 8:00)",
      plugin: "reminders",
      run(args) {
        const p = parseReminder(args);
        if (!p) return "استفاده:\n/remind 18:30 تماس با بروکر\n/remind فردا 9 جلسه با شاگرد\n/remind 2h چک کردن ترید\n/remind ۱۰ دقیقه چای\n/remind هر روز 8:00 مرور ژورنال";
        if (p.daily) {
          const name = `reminder-${Date.now().toString(36)}`;
          kernel.addSchedule(name, `${p.minute} ${p.hour} * * *`, reminderTask(p.text));
          return `🔁 هر روز ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}: ${p.text}\nحذف: /reminders`;
        }
        const t = kernel.createTask({ ...reminderTask(p.text), notBefore: p.at.toISOString() });
        return `⏰ ${fmt(p.at)}\n${p.text}\n(لغو: /cancel ${t.id})`;
      },
    });
    kernel.registerCommand({
      name: "reminders",
      description: "لیست یادآوری‌ها (/reminders off نام برای حذف روزانه)",
      plugin: "reminders",
      run(args) {
        const [cmd, name] = args.trim().split(/\s+/);
        if (cmd === "off" && name) {
          try {
            kernel.removeSchedule(name);
            return `🗑 حذف شد: ${name}`;
          } catch (e) {
            return `خطا: ${(e as Error).message}`;
          }
        }
        const once = pendingReminders(kernel).map((t) => `⏰ ${t.notBefore ? fmt(new Date(t.notBefore)) : "-"} — ${t.prompt}  (/cancel ${t.id})`);
        const daily = kernel.listSchedules().filter((s) => s.template.provider === "reminder").map((s) => `🔁 ${s.cron} — ${s.template.prompt}  (/reminders off ${s.name})`);
        return [...once, ...daily].join("\n") || "یادآوری‌ای نیست.";
      },
    });
  },
};
