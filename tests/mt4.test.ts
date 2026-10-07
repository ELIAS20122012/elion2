import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { riskAlerts, parseDraw, tradesToday, mt4Plugin, type Mt4Account } from "../src/plugins/mt4.ts";
import { reminderProvider } from "../src/plugins/reminders.ts";

const acc = (open: Mt4Account["open"], extra: Partial<Mt4Account> = {}): Mt4Account => ({
  login: 1, server: "s", company: "Broker", currency: "USD", balance: 10000, equity: 10000, margin: 0, free_margin: 10000,
  floating_pl: 0, today_closed_pl: 0, today_closed_count: 0, server_time: "2026.10.03 12:00:00", open, ...extra,
});
const order = (o: Partial<Mt4Account["open"][0]>) => ({ ticket: 1, symbol: "XAUUSD", type: 0, lots: 0.5, open_price: 4150, sl: 0, tp: 0, open_time: "", profit: 0, risk_money: -1, ...o });

test("risk rules: no stop, risk > limit, daily loss", () => {
  assert.match(riskAlerts(acc([order({})]), { maxRiskPct: 1, maxDailyLossPct: 3, requireStop: true })[0]!.msg, /بدون استاپ/);
  assert.match(riskAlerts(acc([order({ sl: 4140, risk_money: 250 })]), { maxRiskPct: 1, maxDailyLossPct: 3, requireStop: true })[0]!.msg, /ریسک 2\.50٪/);
  assert.equal(riskAlerts(acc([order({ sl: 4140, risk_money: 50 })]), { maxRiskPct: 1, maxDailyLossPct: 3, requireStop: true }).length, 0);
  assert.match(riskAlerts(acc([], { today_closed_pl: -350 }), { maxRiskPct: 1, maxDailyLossPct: 3, requireStop: true })[0]!.msg, /ضرر امروز 3\.50٪/);
});

test("parseDraw + tradesToday", () => {
  assert.deepEqual(parseDraw("4188 مقاومت | ۴۱۲۲ حمایت"), ["*|4188|res|مقاومت", "*|4122|sup|حمایت"]);
  assert.deepEqual(parseDraw("clear"), ["CLEAR"]);
  assert.equal(parseDraw("سلام"), null);
  const t = tradesToday([order({ profit: 120, close_time: "2026.10.03 10:00:00", close_price: 4160 }), order({ profit: -40, close_time: "2026.10.02 10:00:00" })], "2026.10.03");
  assert.match(t, /\(1\) · نتیجه \+120\.00 · برد 1\/1/);
});

test("plugin: /account from bridge files, risk watch alerts once, /draw writes UTF-16 file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-mt4-"));
  fs.writeFileSync(path.join(dir, "account.json"), JSON.stringify(acc([order({ ticket: 7 })])));
  fs.writeFileSync(path.join(dir, "history.json"), "[]");
  const k = new Kernel({ dbPath: ":memory:", providers: [reminderProvider], defaultProvider: "reminder", retryBaseMs: 0 });
  mt4Plugin.setup({ kernel: k, home: "", options: { dir } });
  assert.match(await k.getCommand("account")!.run(""), /بالانس: 10000\.00/);
  for (let i = 0; i < 2; i++) {
    k.createTask({ title: "risk", prompt: "risk", provider: "mt4", source: "internal" });
    await k.processNext();
  }
  const alerts = k.listTasks({ limit: 20 }).filter((t) => t.title === "📈 هشدار ترید");
  assert.equal(alerts.length, 1);
  await k.getCommand("draw")!.run("4188 مقاومت");
  const raw = fs.readFileSync(path.join(dir, "draw.txt"));
  assert.equal(raw[0], 0xff);
  assert.match(raw.toString("utf16le"), /\*\|4188\|res\|مقاومت/);
});
