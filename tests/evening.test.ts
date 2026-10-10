import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { memoryPlugin, readNotes, memoryFile } from "../src/plugins/memory.ts";
import { cleanFacts, eveningPlugin, firstJson, LEARN_TITLE, CLEANUP_TITLE } from "../src/plugins/evening.ts";
import { isSafeAction } from "../src/interfaces/actions.ts";

function mk() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eve-"));
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "x", retryBaseMs: 0 });
  memoryPlugin.setup({ kernel: k, home, options: {} });
  eveningPlugin.setup({ kernel: k, home, options: {} });
  return { k, file: memoryFile(home) };
}
const finish = (k: Kernel, title: string, result: string) => {
  const t = k.createTask({ title, prompt: "x", provider: "x", source: "internal" });
  k.db.prepare("UPDATE tasks SET status='succeeded', result=? WHERE id=?").run(result, t.id);
  (k as any).emit?.({ type: "task.succeeded", taskId: t.id, message: "" });
  return t;
};

test("schedules: evening review 22:00, learning 22:15, cleanup Sunday", () => {
  const { k } = mk();
  assert.equal(k.getSchedule("evening-review")!.cron, "0 22 * * *");
  assert.equal(k.getSchedule("evening-review")!.template.source, "review");
  assert.equal(k.getSchedule("memory-learn")!.cron, "15 22 * * *");
  assert.equal(k.getSchedule("memory-cleanup")!.cron, "0 21 * * 0");
});

test("learned facts: JSON in prose, no duplicates, no secrets", () => {
  assert.deepEqual(firstJson('بفرما:\n```json\n["a b c d e f"]\n```'), ["a b c d e f"]);
  const f = cleanFacts(["حساب اصلی ترید RoboForex است", "حساب اصلی ترید RoboForex است", "رمز جیمیل 123456", "کوتاه", "خواهرش سارا نام دارد"], ["خواهرش سارا نام دارد ⟨auto 2026-10-01⟩"]);
  assert.deepEqual(f, ["حساب اصلی ترید RoboForex است"]);
});

test("learning saves new facts marked auto and tells Elias; review lists them; apply needs a tap", async () => {
  const { k, file } = mk();
  const sinks: any[] = (k as any).sinks ?? (k as any).eventSinks ?? [];
  const fire = (id: string) => { for (const s of sinks) s({ type: "task.succeeded", taskId: id, message: "" }); };
  const t = finish(k, LEARN_TITLE, '["مطب دکتر در خیابان X است", "کارت 1234567890"]');
  fire(t.id);
  const notes = readNotes(file);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /⟨auto \d{4}-\d{2}-\d{2}⟩$/);
  assert.ok(k.listTasks({ limit: 5 }).some((x) => x.provider === "reminder" && /یاد گرفتم/.test(x.title)));
  assert.match(await k.getCommand("memory")!.run("review"), /1\. مطب دکتر/);
  const c = finish(k, CLEANUP_TITLE, '{"notes": ["مطب دکتر در خیابان X است"], "changes": "-"}');
  fire(c.id);
  assert.match(await k.getCommand("memory")!.run("proposal"), />>> \/memory apply/);
  assert.ok(!isSafeAction("/memory apply") && isSafeAction("/memory review") && isSafeAction("/review"));
  assert.match(await k.getCommand("memory")!.run("apply"), /مرتب شد/);
  assert.ok(fs.existsSync(file + ".bak"));
});
