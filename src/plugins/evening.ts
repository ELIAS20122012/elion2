// Evening review + smart memory.
//   22:00 evening review (/review): what happened today, what is open, tomorrow's appointments, 3 suggestions.
//   22:15 memory learning: reads today's chats, saves lasting facts Elias stated (marked «auto»), tells him what it
//         learned. /memory review lists them, /forget N removes one.
//   Sunday 21:00 memory cleanup: proposes a condensed list (duplicates merged, stale facts dropped); nothing changes
//         until Elias taps /memory apply (the old file is kept as memory.md.bak).
import fs from "node:fs";
import type { Kernel } from "../kernel/kernel.ts";
import type { TaskInput } from "../kernel/types.ts";
import type { Plugin } from "./types.ts";
import { memoryFile, readNotes, writeNotes } from "./memory.ts";

export const REVIEW_SCHEDULE = "evening-review";
export const LEARN_SCHEDULE = "memory-learn";
export const CLEANUP_SCHEDULE = "memory-cleanup";
export const LEARN_TITLE = "🧠 یادگیری از گفتگوها";
export const CLEANUP_TITLE = "🧹 مرتب کردن حافظه";
const AUTO = (day: string) => ` ⟨auto ${day}⟩`;
const AUTO_RE = / ⟨auto (\d{4}-\d{2}-\d{2})⟩$/;

const day = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });

/** today's chats (Telegram, typed or voice) — the input for the review and for learning */
export function chatDay(kernel: Kernel, hours = 24): string {
  const since = Date.now() - hours * 3_600_000;
  const rows = kernel
    .listTasks({ limit: 300 })
    .filter((t) => (t.source === "telegram" || t.source === "telegram-voice") && new Date(t.createdAt).getTime() > since)
    .reverse()
    .slice(-40);
  return rows.length ? rows.map((t) => `Elias: ${t.prompt.slice(0, 400)}\nElias OS: ${(t.result ?? t.error ?? "").slice(0, 300)}`).join("\n\n") : "No chats today.";
}

/** first JSON value in an AI answer (it may wrap it in prose or ```json fences) */
export function firstJson<T>(text: string): T | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1]! : text;
  const pairs = ([["[", "]"], ["{", "}"]] as const)
    .map(([o, c]) => ({ a: body.indexOf(o), b: body.lastIndexOf(c) }))
    .filter((x) => x.a >= 0 && x.b > x.a)
    .sort((x, y) => x.a - y.a); // the outermost value starts first
  for (const { a, b } of pairs) {
    try {
      return JSON.parse(body.slice(a, b + 1)) as T;
    } catch {
      /* try the other shape */
    }
  }
  return null;
}

const SECRETISH = /(password|passwort|رمز|pin\b|iban|card|کارت|\b\d{6,}\b|token|api key|کد تایید|verification)/i;

/** Learned facts: short, new, no secrets. */
export function cleanFacts(facts: unknown, existing: string[]): string[] {
  if (!Array.isArray(facts)) return [];
  const have = new Set(existing.map((n) => n.replace(AUTO_RE, "").trim().toLowerCase()));
  const out: string[] = [];
  for (const f of facts) {
    const s = String(f ?? "").replace(/\s+/g, " ").trim();
    if (s.length < 6 || s.length > 200 || SECRETISH.test(s) || have.has(s.toLowerCase())) continue;
    have.add(s.toLowerCase());
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

const notify = (kernel: Kernel, title: string, prompt: string) =>
  kernel.createTask({ title, prompt, provider: "reminder", source: "memory", verify: { type: "non_empty" }, maxAttempts: 1 });

function reviewTask(): TaskInput {
  return {
    title: "🌙 مرور امروز",
    source: "review",
    capabilities: ["read:memory"],
    context: ["time:now", "chat:day", "appointments:upcoming", "memory:notes"],
    verify: { type: "non_empty" },
    maxAttempts: 2,
    timeoutMs: 5 * 60_000,
    prompt: `Write Elias's evening review in Persian for Telegram, using ONLY the DATA below. Short lines, under 180 words:
✅ **امروز** — what got done today (from the chats; group small things).
⏳ **باز مانده** — things he started or asked for that are not finished.
📅 **فردا** — tomorrow's appointments (from appointments:upcoming), or "ترمینی نداری".
🎯 **پیشنهاد برای فردا** — 3 short, concrete suggestions.
If there were no chats today, say so in one line and only show 📅 and 🎯. No action lines (>>>).`,
  };
}

function learnTask(): TaskInput {
  return {
    title: LEARN_TITLE,
    capabilities: ["read:memory"],
    context: ["chat:day", "memory:notes"],
    source: "internal",
    verify: { type: "non_empty" },
    maxAttempts: 2,
    timeoutMs: 5 * 60_000,
    prompt: `From Elias's chats today (chat:day DATA), list the LASTING facts he stated about himself, his work, his projects,
the people in his life or his preferences that are NOT already in memory:notes. Use only what Elias himself said —
not guesses, not what Elias OS said, not one-off tasks or today's plans. Never include passwords, codes, account or
card numbers, or health details. Write each fact short, in Persian (keep names/emails as written).
Answer ONLY a JSON array of strings, e.g. ["حساب اصلی ترید: RoboForex"] — or [] if there is nothing new.`,
  };
}

function cleanupTask(): TaskInput {
  return {
    title: CLEANUP_TITLE,
    capabilities: ["read:memory"],
    context: ["memory:notes"],
    source: "internal",
    verify: { type: "non_empty" },
    maxAttempts: 2,
    timeoutMs: 5 * 60_000,
    prompt: `Here is Elias's long-term memory (memory:notes DATA). Make it tidy: merge duplicates, keep the newer fact when two
contradict, drop nothing that is still useful, keep each line short, keep the language of each line. Keep any
« ⟨auto YYYY-MM-DD⟩» marker on lines you keep unchanged. Answer ONLY JSON: {"notes": [...], "changes": "one Persian line
saying what you merged or dropped"}. If nothing needs changing answer {"notes": [], "changes": ""}.`,
  };
}

export const eveningPlugin: Plugin = {
  name: "evening",
  description: "Evening review (22:00), smart memory learning (22:15) and weekly memory cleanup (/review /memory)",
  setup({ kernel, home }) {
    const file = memoryFile(home);
    kernel.registerContextSource({
      name: "chat:day",
      capability: "read:memory",
      description: "Elias's Telegram chats of the last 24 hours",
      fetch: async () => chatDay(kernel),
    });
    const ensure = (name: string, cron: string, t: TaskInput) => {
      if (!kernel.getSchedule(name)) kernel.addSchedule(name, cron, t);
    };
    ensure(REVIEW_SCHEDULE, "0 22 * * *", reviewTask());
    ensure(LEARN_SCHEDULE, "15 22 * * *", learnTask());
    ensure(CLEANUP_SCHEDULE, "0 21 * * 0", cleanupTask());

    kernel.addEventSink((e) => {
      if (e.type !== "task.succeeded" || !e.taskId) return;
      const t = kernel.getTask(e.taskId);
      if (!t || t.provider === "reminder") return;
      if (t.title === LEARN_TITLE) {
        const notes = readNotes(file);
        const facts = cleanFacts(firstJson<string[]>(t.result ?? ""), notes);
        if (!facts.length) return;
        writeNotes(file, [...notes, ...facts.map((f) => f + AUTO(day()))]);
        kernel.log("memory.learned", `${facts.length} facts`);
        notify(kernel, "🧠 از گفتگوهای امروز یاد گرفتم", `${facts.map((f) => `• ${f}`).join("\n")}\n\nاگر چیزی اشتباه است: /memory review`);
      } else if (t.title === CLEANUP_TITLE) {
        const p = firstJson<{ notes?: unknown; changes?: string }>(t.result ?? "");
        const notes = Array.isArray(p?.notes) ? (p!.notes as unknown[]).map((x) => String(x).trim()).filter(Boolean) : [];
        const before = readNotes(file);
        if (!notes.length || notes.length > before.length + 2) return; // nothing to do, or a suspicious answer
        kernel.setKv("memory.proposal", JSON.stringify(notes));
        notify(kernel, CLEANUP_TITLE, `پیشنهاد مرتب کردن حافظه: ${before.length} → ${notes.length} مورد.\n${p?.changes ?? ""}\n\nدیدن همه: /memory proposal\n>>> /memory apply`);
      }
    });

    kernel.registerCommand({
      name: "review",
      description: "مرور امروز (هر شب ۲۲:۰۰ هم خودکار)",
      plugin: "evening",
      run() {
        kernel.createTask({ ...reviewTask(), source: "telegram" });
        return "🌙 مرور امروز را آماده می‌کنم…";
      },
    });
    kernel.registerCommand({
      name: "memory",
      description: "حافظه (/memory · review · learn · proposal · apply)",
      plugin: "evening",
      run(args) {
        const a = args.trim().toLowerCase();
        const notes = readNotes(file);
        if (a === "learn") {
          kernel.createTask(learnTask());
          return "🧠 گفتگوهای امروز را برای یادگیری می‌خوانم…";
        }
        if (a === "review") {
          const auto = notes.map((n, i) => ({ n, i })).filter((x) => AUTO_RE.test(x.n));
          return auto.length
            ? `🧠 چیزهایی که خودم یاد گرفتم:\n${auto.map((x) => `${x.i + 1}. ${x.n.replace(AUTO_RE, "")} (${x.n.match(AUTO_RE)![1]})`).join("\n")}\n\nحذف یکی: /forget شماره`
            : "هنوز چیزی خودکار یاد نگرفته‌ام.";
        }
        if (a === "proposal") {
          const p = kernel.getKv("memory.proposal");
          return p ? `پیشنهاد جدید حافظه:\n${(JSON.parse(p) as string[]).map((x, i) => `${i + 1}. ${x}`).join("\n")}\n>>> /memory apply` : "پیشنهادی نیست.";
        }
        if (a === "apply") {
          const p = kernel.getKv("memory.proposal");
          if (!p) return "پیشنهادی برای اعمال نیست.";
          if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
          const next = JSON.parse(p) as string[];
          writeNotes(file, next);
          kernel.db.prepare("DELETE FROM kv WHERE key='memory.proposal'").run();
          kernel.log("memory.cleaned", `${notes.length} → ${next.length}`);
          return `✅ حافظه مرتب شد: ${notes.length} → ${next.length} مورد (نسخه‌ی قبلی: memory.md.bak)`;
        }
        return notes.length ? notes.map((x, i) => `${i + 1}. ${x.replace(AUTO_RE, " 🤖")}`).join("\n") : "حافظه خالی است.";
      },
    });
  },
};
