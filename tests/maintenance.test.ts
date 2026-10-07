import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { backup, weeklyReport, maintenancePlugin, BACKUP_SCHEDULE, REPORT_SCHEDULE } from "../src/plugins/maintenance.ts";

test("backup: consistent DB snapshot + knowledge, no secrets, rotation", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "elias-bk-"));
  fs.mkdirSync(path.join(home, "data", "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(home, "config"));
  fs.writeFileSync(path.join(home, "data", "knowledge", "memory.md"), "- note");
  fs.writeFileSync(path.join(home, "config", "secrets.json"), "{}");
  fs.writeFileSync(path.join(home, "config", "elias.config.json"), "{}");
  const k = new Kernel({ dbPath: path.join(home, "data", "elias.db"), providers: [new EchoProvider()], defaultProvider: "echo" });
  k.createTask({ title: "t", prompt: "p" });
  const dir = path.join(home, "backups");
  for (const old of ["2020-01-01_0000", "2020-01-02_0000"]) fs.mkdirSync(path.join(dir, old), { recursive: true });
  const r = backup(k, home, dir, 2);
  assert.equal(r.removed, 1);
  const snap = new DatabaseSync(path.join(r.folder, "elias.db"));
  assert.equal((snap.prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n, 1);
  snap.close();
  assert.ok(fs.existsSync(path.join(r.folder, "data", "knowledge", "memory.md")));
  assert.ok(!fs.existsSync(path.join(r.folder, "config", "secrets.json")));
  k.close();
});

test("weekly report counts work, videos and failures; schedules installed once", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", retryBaseMs: 0 });
  maintenancePlugin.setup({ kernel: k, home: os.tmpdir(), options: {} });
  maintenancePlugin.setup({ kernel: k, home: os.tmpdir(), options: {} });
  assert.ok(k.getSchedule(BACKUP_SCHEDULE) && k.getSchedule(REPORT_SCHEDULE));
  k.createTask({ title: "chat", prompt: "hi", source: "telegram" });
  await k.processNext();
  const v = k.createTask({ title: "yt", prompt: "x", source: "youtube" });
  k.db.prepare("UPDATE tasks SET status='succeeded', provider='youtube', result='✅ https://youtu.be/abc123' WHERE id=?").run(v.id);
  const f = k.createTask({ title: "broken", prompt: "x" });
  k.db.prepare("UPDATE tasks SET status='failed', failure_kind='timeout' WHERE id=?").run(f.id);
  const r = weeklyReport(k);
  assert.match(r, /youtu\.be\/abc123/);
  assert.match(r, /broken \(timeout\)/);
  assert.match(r, /جواب در چت: 1/);
});
