import { test } from "node:test";
import assert from "node:assert/strict";
import { Kernel } from "../src/kernel/kernel.ts";
import { parseReminder, remindersPlugin, pendingReminders } from "../src/plugins/reminders.ts";

const now = new Date(2026, 9, 3, 17, 0, 0);

test("parseReminder: clock, tomorrow, relative, Persian digits, daily", () => {
  const a = parseReminder("18:30 تماس با بروکر", now) as any;
  assert.equal(a.at.getHours(), 18);
  assert.equal(a.at.getDate(), 3);
  assert.equal(a.text, "تماس با بروکر");
  assert.equal((parseReminder("9 جلسه", now) as any).at.getDate(), 4); // passed → tomorrow
  const b = parseReminder("فردا ساعت ۹ جلسه با شاگرد", now) as any;
  assert.equal(b.at.getDate(), 4);
  assert.equal(b.at.getHours(), 9);
  assert.equal((parseReminder("2h چک ترید", now) as any).at.getTime(), now.getTime() + 2 * 3600_000);
  assert.equal((parseReminder("۱۰ دقیقه دیگه چای", now) as any).text, "چای");
  assert.deepEqual(parseReminder("هر روز 8:15 مرور ژورنال", now), { daily: true, hour: 8, minute: 15, text: "مرور ژورنال" });
  assert.equal(parseReminder("سلام", now), null);
  assert.equal(parseReminder("18:30", now), null);
});

test("/remind queues a delayed task that fires only after its time; daily makes a schedule", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "reminder", retryBaseMs: 0 });
  remindersPlugin.setup({ kernel: k, home: "", options: {} });
  await k.getCommand("remind")!.run("2h چک ترید");
  assert.equal(pendingReminders(k).length, 1);
  assert.equal(await k.processNext(), null); // not due yet
  const t = pendingReminders(k)[0]!;
  k.db.prepare("UPDATE tasks SET not_before=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), t.id);
  const done = await k.processNext();
  assert.equal(done?.status, "succeeded");
  assert.equal(done?.result, "چک ترید");
  await k.getCommand("remind")!.run("هر روز 8:00 مرور ژورنال");
  assert.match(await k.getCommand("reminders")!.run(""), /مرور ژورنال/);
});

test("telegram: 'یادم بنداز …' becomes a reminder, not an AI task", async () => {
  const { TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "reminder", retryBaseMs: 0 });
  remindersPlugin.setup({ kernel: k, home: "", options: {} });
  const tg = new TelegramInterface(k, async () => ({}));
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleOwnerText("یادم بنداز ۲ ساعت دیگه چک ترید");
  assert.equal(pendingReminders(k).length, 1);
  assert.equal(pendingReminders(k)[0]!.prompt, "چک ترید");
});

test("parseReminder: real dates (14.10.2026, 2026-10-14, 14/10), a date alone means 09:00", () => {
  const a = parseReminder("14.10.2026 09:00 فردا ترمین با AMS داری", now) as any;
  assert.equal(a.at.getDate(), 14);
  assert.equal(a.at.getMonth(), 9);
  assert.equal(a.at.getHours(), 9);
  assert.equal(a.text, "فردا ترمین با AMS داری");
  const b = parseReminder("۱۴.۱۰.۲۰۲۶ ترمین AMS", now) as any;
  assert.equal(b.at.getHours(), 9);
  assert.equal(b.text, "ترمین AMS");
  assert.equal((parseReminder("2026-10-14 ساعت 18:30 x", now) as any).at.getHours(), 18);
  assert.equal((parseReminder("14/10 10 x", now) as any).at.getDate(), 14);
  assert.equal((parseReminder("پس فردا 10 x", now) as any).at.getDate(), 5);
  assert.equal(parseReminder("31.02.2026 x", now), null);
  assert.equal((parseReminder("15.10 چای", now) as any).at.getHours(), 15); // DD.MM alone stays a clock time
});
