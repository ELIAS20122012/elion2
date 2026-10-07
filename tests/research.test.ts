import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { researchPlugin, researchTask, section, links, saveReport, telegramSummary, RESEARCH_PROVIDER } from "../src/plugins/research.ts";
import { markdownToHtml } from "../src/interfaces/telegram.ts";

const REPORT = `## خلاصه\n- نکته‌ی اول [1]\n- نکته‌ی دوم\n## جزئیات\nمتن\n## منابع\n1. [Reuters](https://reuters.com/a)\n2. [BBC](https://bbc.com/b)\n3. [Reuters again](https://reuters.com/a)`;

test("report parsing: sections, unique links, telegram summary", () => {
  assert.match(section(REPORT, "خلاصه"), /نکته‌ی دوم/);
  assert.doesNotMatch(section(REPORT, "خلاصه"), /جزئیات/);
  assert.deepEqual(links(REPORT).map((l) => l.url), ["https://reuters.com/a", "https://bbc.com/b"]);
  const t = telegramSummary("طلا", REPORT, "/v/04 Knowledge/Research - طلا - 2026-10-03.md");
  assert.match(t, /Research - طلا - 2026-10-03/);
  assert.match(markdownToHtml(t), /<a href="https:\/\/bbc.com\/b">BBC<\/a>/);
  assert.equal(researchTask("x").provider, RESEARCH_PROVIDER);
});

test("saveReport writes to 04 Knowledge without overwriting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  const d = new Date(2026, 9, 3);
  const a = saveReport(dir, "04 Knowledge", "قیمت طلا: ۲۰۲۶?", REPORT, d);
  const b = saveReport(dir, "04 Knowledge", "قیمت طلا: ۲۰۲۶?", REPORT, d);
  assert.notEqual(a, b);
  assert.match(fs.readFileSync(a, "utf8"), /^---\ntopic:/);
  assert.equal(fs.readdirSync(path.join(dir, "04 Knowledge")).length, 2);
});

test("plugin: command queues task; success saves note and sends summary; weekly schedule", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
  const k = new Kernel({ dbPath: ":memory:", providers: [] });
  await researchPlugin.setup({ kernel: k, home, options: { dir } });
  k.registerProvider({ name: RESEARCH_PROVIDER, health: async () => ({ ok: true, detail: "" }), execute: async () => ({ output: REPORT }) });
  k.registerProvider({ name: "reminder", health: async () => ({ ok: true, detail: "" }), execute: async (r) => ({ output: r.prompt }) });
  assert.match(await k.getCommand("research")!.run("طلا"), /تحقیق/);
  while (await k.processNext()) {}
  assert.equal(fs.readdirSync(path.join(dir, "04 Knowledge")).length, 1);
  const msg = k.listTasks({ limit: 10 }).find((t) => t.provider === "reminder");
  assert.match(msg?.result ?? "", /reuters/);
  assert.match(await k.getCommand("research")!.run("weekly بیت کوین"), /هر شنبه/);
  assert.match(await k.getCommand("research")!.run("list"), /بیت کوین/);
  assert.match(await k.getCommand("research")!.run("off بیت کوین"), /خاموش/);
});
