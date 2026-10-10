// Appointments (ترمین / قرار / نوبت): kept by Elias OS itself, no AI needed to remember them.
//   "15.10.2026 با AMS ترمین دارم یک روز قبل یادم بنداز" → saved + reminders (day before 09:00, the day itself)
//   "کی ترمین دارم؟" → the list, straight from storage
//   /termin [date [time] text] · /termin del N
// Every chat task also gets the list (appointments:upcoming), today's date (time:now) and the last few
// messages (chat:recent), so the AI can answer follow-ups like "با AMS" without guessing.
import type { Kernel } from "../kernel/kernel.ts";
import type { Plugin } from "./types.ts";
import { normDigits, parseDate, REMINDER_TITLE } from "./reminders.ts";

const KV = "appointments";
const TZ = "Europe/Vienna";

export interface Appointment {
  id: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  text: string;
  reminders: string[]; // queued reminder task ids
  createdAt: string;
  /** Google Calendar copy, made by the PC agent in the browser */
  gcal?: "queued" | "removed";
}

const AGENT = "pc-agent";
const ymd = (date: string) => date.replace(/-/g, "");

/** Google Calendar "new event" link with everything filled in — the agent only has to press Save. */
export function gcalLink(a: Pick<Appointment, "date" | "time" | "text">, account = 0): string {
  let dates: string;
  if (a.time) {
    const [h, m] = a.time.split(":").map(Number);
    const end = `${pad(Math.min(23, h! + 1))}${pad(h! + 1 > 23 ? 59 : m!)}`;
    dates = `${ymd(a.date)}T${pad(h!)}${pad(m!)}00/${ymd(a.date)}T${end}00`;
  } else {
    const [y, mo, d] = a.date.split("-").map(Number);
    dates = `${ymd(a.date)}/${iso(new Date(y!, mo! - 1, d! + 1)).replace(/-/g, "")}`;
  }
  const q = new URLSearchParams({ text: a.text, dates, ctz: "Europe/Vienna", details: "Elias OS" });
  return `https://calendar.google.com/calendar/u/${account}/r/eventedit?${q.toString()}`;
}

const KEYWORDS = /(ترمین|termin|قرار|نوبت|وقت\s*(دکتر|دندان|سفارت)|appointment|meeting|مصاحبه|interview|جلسه|مراجعه|amt|behörde)/i;
const REMIND_WORDS = /(یادم\s*(بنداز|بیار|باشه)|یاد\s*آوری|یادآوری|یاداوری|بهم\s*بگو|خبرم\s*کن|remind)/i;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NUM: Record<string, number> = { یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, هفت: 7 };

export interface ParsedAppointment {
  date: Date;
  time: { h: number; m: number } | null;
  text: string;
  /** reminder offsets the message asked for ("یک روز قبل", "۲ ساعت قبل"); empty = defaults */
  before: { days?: number; hours?: number }[];
  wantsReminder: boolean;
}

/** Finds a dated appointment in free text; null when there is no explicit date or no appointment word. */
export function parseAppointment(input: string, now = new Date()): ParsedAppointment | null {
  const text = normDigits(input).replace(/([A-Za-z])([؀-ۿ])/g, "$1 $2").replace(/([؀-ۿ])([A-Za-z])/g, "$1 $2");
  const words = text.split(/\s+/);
  let date: Date | null = null;
  let dateTok = "";
  for (const w of words) {
    const d = parseDate(w, now);
    if (d) {
      date = d;
      dateTok = w;
      break;
    }
  }
  if (!date) {
    const rel = text.match(/(^|\s)(پس\s*‌?\s*فردا|فردا)(\s|$)/);
    if (rel && KEYWORDS.test(text)) {
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (rel[2]!.startsWith("پس") ? 2 : 1));
      dateTok = rel[2]!;
    }
  }
  if (!date || !KEYWORDS.test(text)) return null;
  const tm = text.match(/(?:ساعت\s*)(\d{1,2})(?:[:.](\d{2}))?|(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/);
  const h = tm ? Number(tm[1] ?? tm[3]) : NaN;
  const mi = tm ? Number(tm[2] ?? tm[4] ?? 0) : 0;
  const time = Number.isFinite(h) && h < 24 && mi < 60 ? { h, m: mi } : null;

  const before: { days?: number; hours?: number }[] = [];
  for (const m of text.matchAll(/(\d+|یک|یه|دو|سه|چهار|پنج|هفت)\s*(روز|ساعت|day|hour)s?\s*(قبل|زودتر|پیش|before)/gi)) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUM[m[1]!] ?? 1;
    before.push(/روز|day/i.test(m[2]!) ? { days: n } : { hours: n });
  }
  let desc = text
    .replace(dateTok, " ")
    .replace(tm?.[0] ?? "\u0000", " ")
    .replace(/(\d+|یک|یه|دو|سه|چهار|پنج|هفت)\s*(روز|ساعت|day|hour)s?\s*(قبل|زودتر|پیش|before).*$/i, " ")
    .replace(REMIND_WORDS, " ")
    .replace(/\s(کن|بکن|لطفا|لطفاً|بهم|به من)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(که|من)\s+/, "");
  if (!desc) desc = "ترمین";
  return { date, time, text: desc, before, wantsReminder: REMIND_WORDS.test(text) || before.length > 0 };
}

/** When the reminders fire: asked offsets, else the day before at 09:00; plus the morning of the day
 *  (08:00, or 2 hours before a timed appointment). Past times are dropped. */
export function reminderTimes(p: ParsedAppointment, now = new Date()): Date[] {
  const at = new Date(p.date.getFullYear(), p.date.getMonth(), p.date.getDate(), p.time?.h ?? 9, p.time?.m ?? 0);
  const out: Date[] = [];
  const offs = p.before.length ? p.before : [{ days: 1 }];
  for (const o of offs) {
    if (o.days) out.push(new Date(at.getFullYear(), at.getMonth(), at.getDate() - o.days, 9, 0));
    if (o.hours) out.push(new Date(at.getTime() - o.hours * 3_600_000));
  }
  out.push(p.time ? new Date(at.getTime() - 2 * 3_600_000) : new Date(at.getFullYear(), at.getMonth(), at.getDate(), 8, 0));
  const seen = new Set<number>();
  return out.filter((d) => d.getTime() > now.getTime() && !seen.has(d.getTime()) && seen.add(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
}

export function isAppointmentQuestion(text: string): boolean {
  const t = normDigits(text);
  return (
    /(کی|چه\s*(روزی|وقتی|تاریخی|ساعتی)|چند\s*شنبه|when|wann)/i.test(t) && /(ترمین|termin|قرار|نوبت|appointment)/i.test(t) && !/\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(t)
  ) || /^\s*(ترمین|قرار|نوبت)\s*(ها|‌ها)?(م|ی?\s*من)?\s*(چیه|چی|کی)?\s*[?؟]?\s*$/i.test(t);
}

const faDate = (a: Appointment) => {
  const [y, mo, d] = a.date.split("-").map(Number);
  const dt = new Date(y!, mo! - 1, d!);
  return `${dt.toLocaleDateString("fa-IR", { weekday: "long", day: "numeric", month: "long" })} (${pad(d!)}.${pad(mo!)}.${y})${a.time ? ` ساعت ${a.time}` : ""}`;
};

export class Appointments {
  private kernel: Kernel;
  private now: () => Date;
  /** which signed-in Google account's calendar gets the copy (mail/u/N order in the agent profile) */
  static calendarAccount = 0;
  constructor(kernel: Kernel, now: () => Date = () => new Date()) {
    this.kernel = kernel;
    this.now = now;
  }

  private hasAgent(): boolean {
    return this.kernel.listProviders().some((p) => p.name === AGENT);
  }

  /** Elias asked for this appointment, so adding (or removing) this ONE event is already approved. */
  private calendarTask(a: Appointment, remove = false): void {
    const when = `${a.date}${a.time ? ` ${a.time}` : " (all day)"}`;
    this.kernel.createTask({
      title: remove ? `📅 حذف از Google Calendar: ${a.text}`.slice(0, 60) : `📅 Google Calendar: ${a.text}`.slice(0, 60),
      prompt: remove
        ? `Elias APPROVED removing ONE Google Calendar event (account u/${Appointments.calendarAccount}): "${a.text}" on ${when}, created by Elias OS. Open https://calendar.google.com/calendar/u/${Appointments.calendarAccount}/r/day/${a.date.replace(/-/g, "/")}, delete only that event (if it is not there, do nothing). Answer in one short Persian line.`
        : `Elias APPROVED adding ONE event to his Google Calendar (account u/${Appointments.calendarAccount}): "${a.text}" on ${when}.\nOpen this prefilled link and press Save: ${gcalLink(a, Appointments.calendarAccount)}\nIf the same event already exists that day, do not add it again. No guests, no invitations, change nothing else. Answer in one short Persian line (e.g. «📅 در Google Calendar ثبت شد»).`,
      provider: AGENT,
      source: "telegram",
      capabilities: ["pc:agent"],
      verify: { type: "non_empty" },
      maxAttempts: 1,
      timeoutMs: 10 * 60_000,
    });
  }

  /** Copies upcoming appointments that have no Google Calendar event yet. */
  syncCalendar(): number {
    if (!this.hasAgent()) return 0;
    const list = this.all();
    const today = iso(this.now());
    let n = 0;
    for (const a of list) {
      if (a.date >= today && !a.gcal) {
        this.calendarTask(a);
        a.gcal = "queued";
        n++;
      }
    }
    if (n) this.save(list);
    return n;
  }

  all(): Appointment[] {
    try {
      return JSON.parse(this.kernel.getKv(KV) ?? "[]") as Appointment[];
    } catch {
      return [];
    }
  }

  private save(list: Appointment[]): void {
    this.kernel.setKv(KV, JSON.stringify(list.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))));
  }

  upcoming(): Appointment[] {
    const today = iso(this.now());
    return this.all().filter((a) => a.date >= today);
  }

  add(p: ParsedAppointment): { appt: Appointment; reminders: Date[]; duplicate: boolean } {
    const date = iso(p.date);
    const time = p.time ? `${pad(p.time.h)}:${pad(p.time.m)}` : null;
    const list = this.all();
    const dup = list.find((a) => a.date === date && a.time === time && a.text.toLowerCase() === p.text.toLowerCase());
    if (dup) return { appt: dup, reminders: [], duplicate: true };
    const times = reminderTimes(p, this.now());
    const appt: Appointment = { id: Date.now().toString(36), date, time, text: p.text, reminders: [], createdAt: this.now().toISOString() };
    for (const t of times) {
      const days = Math.round((new Date(p.date).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
      const when = days === 0 ? (time ? `امروز ساعت ${time}` : "امروز") : days === 1 ? `فردا${time ? ` ساعت ${time}` : ""}` : `${days} روز دیگر`;
      const task = this.kernel.createTask({
        title: REMINDER_TITLE,
        prompt: `📅 ${when}: ${p.text}`,
        provider: "reminder",
        source: "reminder",
        verify: { type: "non_empty" },
        maxAttempts: 1,
        notBefore: t.toISOString(),
      });
      appt.reminders.push(task.id);
    }
    if (this.hasAgent()) {
      this.calendarTask(appt);
      appt.gcal = "queued";
    }
    this.save([...list, appt]);
    this.kernel.log("appointment.added", `${date} ${time ?? ""} ${p.text}`.slice(0, 120));
    return { appt, reminders: times, duplicate: false };
  }

  remove(n: number): Appointment | null {
    const up = this.upcoming();
    const a = up[n - 1];
    if (!a) return null;
    for (const id of a.reminders) {
      try {
        this.kernel.cancelTask(id);
      } catch {
        /* already fired */
      }
    }
    if (a.gcal === "queued" && this.hasAgent()) this.calendarTask(a, true);
    this.save(this.all().filter((x) => x.id !== a.id));
    return a;
  }

  listText(): string {
    const up = this.upcoming();
    return up.length ? up.map((a, i) => `${i + 1}. 📅 ${faDate(a)} — ${a.text}`).join("\n") : "ترمینی ثبت نشده.";
  }

  confirmText(r: { appt: Appointment; reminders: Date[]; duplicate: boolean }): string {
    if (r.duplicate) return `این ترمین قبلاً ثبت شده:\n📅 ${faDate(r.appt)} — ${r.appt.text}`;
    const rem = r.reminders.map((d) => `⏰ ${d.toLocaleString("fa-IR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`);
    return [`✅ ترمین ثبت شد:\n📅 ${faDate(r.appt)} — ${r.appt.text}`, rem.length ? `یادآوری:\n${rem.join("\n")}` : "", r.appt.gcal === "queued" ? "📅 در Google Calendar هم ثبت می‌شود." : "", "لیست: /termin · حذف: /termin del شماره"]
      .filter(Boolean)
      .join("\n\n");
  }
}

export const appointmentsPlugin: Plugin = {
  name: "appointments",
  description: "Appointments with automatic reminders: /termin, appointments:upcoming, time:now, chat:recent",
  setup({ kernel, options }) {
    Appointments.calendarAccount = Number(options?.calendarAccount ?? 0) || 0;
    const store = new Appointments(kernel);
    kernel.registerCommand({
      name: "termin",
      description: "ترمین‌ها (/termin 15.10.2026 10:00 AMS · /termin del 1)",
      plugin: "appointments",
      run(args) {
        const a = args.trim();
        const del = a.match(/^(del|delete|حذف)\s+(\d+)$/i);
        if (del) {
          const gone = store.remove(Number(del[2]));
          return gone ? `🗑 حذف شد (با یادآوری‌هایش): ${gone.date} ${gone.text}` : "شماره پیدا نشد. /termin";
        }
        if (!a) return store.listText();
        if (/^(sync|calendar|تقویم)$/i.test(a)) {
          const n = store.syncCalendar();
          return n ? `📅 ${n} ترمین به Google Calendar فرستاده شد.` : "همه‌ی ترمین‌ها در Google Calendar هستند (یا ایجنت در دسترس نیست).";
        }
        const p = parseAppointment(/(ترمین|termin|قرار|نوبت|appointment)/i.test(a) ? a : `${a} ترمین`);
        return p ? store.confirmText(store.add(p)) : "استفاده: /termin 15.10.2026 10:30 ترمین با AMS";
      },
    });
    kernel.registerContextSource({
      name: "appointments:upcoming",
      capability: "read:memory",
      description: "Elias's saved upcoming appointments",
      fetch: async () => {
        const up = store.upcoming();
        return up.length ? up.map((a) => `- ${a.date}${a.time ? ` ${a.time}` : ""}: ${a.text}`).join("\n") : "No saved appointments.";
      },
    });
    kernel.registerContextSource({
      name: "time:now",
      capability: "read:memory",
      description: "Current date and time for Elias (Vienna)",
      fetch: async () => {
        const n = new Date();
        const en = n.toLocaleString("en-GB", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return `Now: ${en} (${TZ}). Elias writes dates as DD.MM.YYYY.`;
      },
    });
    kernel.registerContextSource({
      name: "chat:recent",
      capability: "read:memory",
      description: "Elias's last few chat messages and the answers (last 3 hours)",
      fetch: async () => {
        const since = Date.now() - 3 * 3_600_000;
        const recent = kernel
          .listTasks({ limit: 60 })
          .filter((t) => (t.source === "telegram" || t.source === "telegram-voice") && t.status === "succeeded" && new Date(t.createdAt).getTime() > since)
          .slice(0, 4)
          .reverse();
        return recent.length
          ? recent.map((t) => `Elias: ${t.prompt.slice(0, 300)}\nElias OS: ${(t.result ?? "").slice(0, 400)}`).join("\n\n")
          : "No earlier messages in the last 3 hours.";
      },
    });
  },
};
