import { test } from "node:test";
import assert from "node:assert/strict";
import { Kernel } from "../src/kernel/kernel.ts";
import { labPlugin } from "../src/plugins/lab.ts";
import { isSafeAction } from "../src/interfaces/actions.ts";

const prov = (name: string, ok = true, out?: string) => ({
  name,
  health: async () => ({ ok, detail: "" }),
  execute: async (r: { prompt: string }) => {
    if (!out) throw new Error("boom");
    return { output: `${out}: ${r.prompt}` };
  },
});

test("compare: asks every working model, reports once all answered, stats and wins", async () => {
  const k = new Kernel({
    dbPath: ":memory:",
    providers: [prov("claude-code", true, "C"), prov("codex", true, "X"), prov("ollama", true), prov("gemini", false, "G"), prov("reminder", true, "r")],
    defaultProvider: "claude-code",
    retryBaseMs: 0,
  });
  labPlugin.setup({ kernel: k, home: "", options: {} });
  const msg = await k.getCommand("compare")!.run("اسم کانال");
  assert.match(msg, /3 مدل/); // gemini is unhealthy, reminder is not a model
  for (let i = 0; i < 6; i++) await k.processNext();
  const rep = k.listTasks({ limit: 20 }).find((t) => t.title === "🧪 نتیجه‌ی مقایسه")!;
  assert.ok(rep, "one report");
  assert.match(rep.prompt, /1\. Claude .*\nC: اسم کانال/);
  assert.match(rep.prompt, /2\. ChatGPT/);
  assert.match(rep.prompt, /✗ Ollama/);
  assert.equal(k.listTasks({ limit: 30 }).filter((t) => t.title === "🧪 نتیجه‌ی مقایسه").length, 1);
  assert.match(await k.getCommand("lab")!.run("best 2"), /ChatGPT/);
  const stats = await k.getCommand("lab")!.run("stats");
  assert.match(stats, /ChatGPT \(Codex\): 1 برد · 1\/1 موفق/);
  assert.match(stats, /Ollama \(local\): 0 برد · 0\/1 موفق/);
  assert.ok(isSafeAction("/compare x") && isSafeAction("/lab stats"));
});

test("compare needs at least two working models", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [prov("claude-code", true, "C")], defaultProvider: "claude-code", retryBaseMs: 0 });
  labPlugin.setup({ kernel: k, home: "", options: {} });
  assert.match(await k.getCommand("compare")!.run("سلام دنیا"), /حداقل دو مدل/);
});

test("an answer that fell back to another model does not count for the model asked", async () => {
  const { report } = await import("../src/plugins/lab.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [prov("claude-code", true, "C")], defaultProvider: "claude-code", retryBaseMs: 0 });
  const t = k.createTask({ title: "🧪 lab:x:gemini", prompt: "q", provider: "claude-code", source: "internal" });
  k.db.prepare("UPDATE tasks SET status='succeeded', result='C: q' WHERE id=?").run(t.id);
  const r = report(k, { id: "x", prompt: "q", providers: ["gemini"], tasks: { gemini: t.id }, created: "" });
  assert.deepEqual(r.order, []);
  assert.match(r.text, /✗ Gemini API · در دسترس نبود/);
});
