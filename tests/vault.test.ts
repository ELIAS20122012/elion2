import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { searchVault, vaultPlugin, dailyNotePath } from "../src/plugins/vault.ts";

function vault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-vault-"));
  fs.mkdirSync(path.join(dir, "04 Knowledge"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".obsidian"));
  fs.writeFileSync(path.join(dir, "04 Knowledge", "مدیریت ریسک.md"), "حداکثر ریسک ۱ درصد. استاپ همیشه.");
  fs.writeFileSync(path.join(dir, "04 Knowledge", "MT4 EA.md"), "EA for lot size and risk.");
  fs.writeFileSync(path.join(dir, ".obsidian", "x.md"), "ریسک");
  return dir;
}

test("searchVault ranks title hits, skips .obsidian", () => {
  const dir = vault();
  const hits = searchVault(dir, "ریسک");
  assert.equal(hits[0]!.title, "مدیریت ریسک");
  assert.ok(!hits.some((h) => h.rel.startsWith(".obsidian")));
  assert.equal(searchVault(dir, "x").length, 0); // 1-char terms ignored
});

test("/vault creates an AI task with note blocks; /note appends to today's daily note", async () => {
  const dir = vault();
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo" });
  vaultPlugin.setup({ kernel: k, home: "", options: { dir } });
  assert.match(await k.getCommand("find")!.run("risk"), /MT4 EA/);
  assert.match(await k.getCommand("vault")!.run("قانون ریسک من چیه"), /مدیریت ریسک/);
  assert.match(k.listTasks({ limit: 1 })[0]!.prompt, /<note path="04 Knowledge[\\/]مدیریت ریسک\.md">/);
  await k.getCommand("note")!.run("ترید طلا بستم +2R");
  await k.getCommand("note")!.run("دومی");
  const daily = fs.readFileSync(dailyNotePath(dir, "07 Daily Notes"), "utf8");
  assert.match(daily, /^# \d{4}-\d{2}-\d{2}\n\n- \d\d:\d\d ترید طلا بستم \+2R\n- \d\d:\d\d دومی\n$/);
});
