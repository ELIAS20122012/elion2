import { test } from "node:test";
import assert from "node:assert/strict";
import { Kernel } from "../src/kernel/kernel.ts";
import { remindersPlugin, pendingReminders } from "../src/plugins/reminders.ts";
import { Appointments, appointmentsPlugin, isAppointmentQuestion, parseAppointment, reminderTimes } from "../src/plugins/appointments.ts";

const now = new Date(2026, 9, 8, 20, 31); // 08.10.2026, when Elias first sent it

test("parseAppointment: Elias's real message (date first, Latin glued to Persian, typo'd 'یاداوری')", () => {
  const p = parseAppointment("15.10.2026 با amsترمین دارم یک روز قبل بهم یاداوری کن", now)!;
  assert.ok(p);
  assert.equal(p.date.getDate(), 15);
  assert.equal(p.date.getMonth(), 9);
  assert.equal(p.time, null);
  assert.deepEqual(p.before, [{ days: 1 }]);
  assert.match(p.text, /ams/);
  assert.match(p.text, /ترمین/);
  assert.doesNotMatch(p.text, /یاداوری|روز قبل|15/);
  const r = reminderTimes(p, now);
  assert.deepEqual(r.map((d) => [d.getDate(), d.getHours()]), [[14, 9], [15, 8]]);
});

test("parseAppointment: time, other date forms, no false positives", () => {
  const p = parseAppointment("ترمین دکتر ۲۰/۱۰/۲۰۲۶ ساعت ۱۰:۳۰", now)!;
  assert.equal(p.date.getDate(), 20);
  assert.deepEqual(p.time, { h: 10, m: 30 });
  assert.deepEqual(reminderTimes(p, now).map((d) => [d.getDate(), d.getHours(), d.getMinutes()]), [[19, 9, 0], [20, 8, 30]]);
  assert.equal(parseAppointment("فردا ساعت 10 جلسه با شاگرد دارم", now)!.date.getDate(), 9);
  assert.equal(parseAppointment("قیمت طلا 15.10.2026 چی میشه", now), null); // a date but no appointment
  assert.equal(parseAppointment("ترمین خوبی بود", now), null); // appointment word but no date
});

test("questions about appointments are recognised", () => {
  assert.ok(isAppointmentQuestion("من کی ترمین دارم"));
  assert.ok(isAppointmentQuestion("ترمین‌هام چیه؟"));
  assert.ok(isAppointmentQuestion("قرارم کیه"));
  assert.ok(!isAppointmentQuestion("15.10.2026 ترمین دارم کی یادم میندازی"));
  assert.ok(!isAppointmentQuestion("سلام"));
});

test("saving an appointment queues its reminders; duplicates and delete", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "reminder", retryBaseMs: 0 });
  remindersPlugin.setup({ kernel: k, home: "", options: {} });
  appointmentsPlugin.setup({ kernel: k, home: "", options: {} });
  const store = new Appointments(k, () => now);
  const r = store.add(parseAppointment("15.10.2026 با ams ترمین دارم یک روز قبل یادم بنداز", now)!);
  assert.equal(r.reminders.length, 2);
  assert.equal(pendingReminders(k).length, 2);
  assert.match(pendingReminders(k).map((t) => t.prompt).join("|"), /فردا: .*ams/);
  assert.ok(store.add(parseAppointment("15.10.2026 با ams ترمین دارم یک روز قبل یادم بنداز", now)!).duplicate);
  assert.match(store.listText(), /ams/);
  const ctx = k.listContextSources().find((c) => c.name === "appointments:upcoming")!;
  assert.match(await ctx.fetch(new AbortController().signal), /2026-10-15: .*ams/);
  assert.match(await k.getCommand("termin")!.run("del 1"), /حذف شد/);
  assert.equal(pendingReminders(k).length, 0);
});

test("telegram: the appointment is saved without the AI; the question is answered from storage; chat gets date + history", async () => {
  const { TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "reminder", retryBaseMs: 0 });
  remindersPlugin.setup({ kernel: k, home: "", options: {} });
  appointmentsPlugin.setup({ kernel: k, home: "", options: {} });
  const sent: string[] = [];
  const tg = new TelegramInterface(k, async (method: string, body: any) => { if (method === "sendMessage") sent.push(String(body.text)); return {}; });
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleOwnerText("15.10.2030 با amsترمین دارم یک روز قبل بهم یاداوری کن");
  assert.equal(pendingReminders(k).length, 2);
  assert.match(sent.join("\n"), /ترمین ثبت شد/);
  await (tg as any).handleOwnerText("من کی ترمین دارم");
  assert.match(sent.at(-1)!, /ams/);
  assert.equal(k.listTasks({ limit: 20 }).filter((t) => t.source === "telegram").length, 0); // no AI task for either
  await (tg as any).handleOwnerText("سلام چطوری");
  const chat = k.listTasks({ limit: 5 }).find((t) => t.source === "telegram")!;
  assert.deepEqual(chat.context, ["time:now", "appointments:upcoming", "chat:recent"]);
});

test("an AI answer's /remind action runs by itself instead of waiting for a button", async () => {
  const { TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "reminder", retryBaseMs: 0 });
  remindersPlugin.setup({ kernel: k, home: "", options: {} });
  const tg = new TelegramInterface(k, async () => ({}));
  k.setKv("telegram.owner_chat_id", "42");
  const task = k.createTask({ title: "x", prompt: "x", provider: "reminder", source: "telegram", verify: { type: "non_empty" } });
  k.db.prepare("UPDATE tasks SET status='succeeded', result=? WHERE id=?").run("باشه.\n\n>>> /remind 14.10.2030 09:00 فردا ترمین با AMS", task.id);
  tg.notify({ type: "task.succeeded", taskId: task.id, message: "", data: null, level: "info", ts: new Date().toISOString() } as any);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pendingReminders(k).length, 1);
  assert.equal(pendingReminders(k)[0]!.prompt, "فردا ترمین با AMS");
});

test("with the PC agent, an appointment is copied to Google Calendar (prefilled link) and removed with it", async () => {
  const { gcalLink } = await import("../src/plugins/appointments.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [{ name: "pc-agent", health: async () => ({ ok: true, detail: "" }), execute: async () => ({ output: "ok" }) }], defaultProvider: "reminder", retryBaseMs: 0 });
  remindersPlugin.setup({ kernel: k, home: "", options: {} });
  appointmentsPlugin.setup({ kernel: k, home: "", options: {} });
  const store = new Appointments(k, () => now);
  const r = store.add(parseAppointment("15.10.2026 ساعت 10:30 ترمین با AMS", now)!);
  assert.equal(r.appt.gcal, "queued");
  assert.match(store.confirmText(r), /Google Calendar/);
  const cal = k.listTasks({ limit: 10 }).find((t) => t.provider === "pc-agent")!;
  assert.match(cal.prompt, /APPROVED adding ONE event/);
  assert.match(cal.prompt, /dates=20261015T103000%2F20261015T113000/);
  assert.match(gcalLink({ date: "2026-10-15", time: null, text: "x" }), /dates=20261015%2F20261016/);
  assert.match(gcalLink({ date: "2026-10-31", time: null, text: "x" }), /dates=20261031%2F20261101/);
  await k.getCommand("termin")!.run("del 1");
  assert.ok(k.listTasks({ limit: 10 }).some((t) => t.provider === "pc-agent" && /APPROVED removing ONE/.test(t.prompt)));
  assert.match(await k.getCommand("termin")!.run("sync"), /همه‌ی ترمین‌ها/);
});
