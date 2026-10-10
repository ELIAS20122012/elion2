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

test("categories, best model per kind, and the auto provider tries it first", async () => {
  const { categorize, bestFor } = await import("../src/plugins/lab.ts");
  const { FallbackProvider } = await import("../src/providers/fallback.ts");
  assert.equal(categorize("یک اسکریپت python برای مرتب کردن فایل‌ها بنویس"), "code");
  assert.equal(categorize("کدام بهتره؟ مقایسه کن"), "analysis");
  assert.equal(categorize("این متن رو به آلمانی ترجمه کن"), "translate");
  assert.equal(categorize("یک ایده برای ویدیو"), "ideas");
  assert.equal(categorize("یک ایمیل برای صاحبخانه بنویس"), "writing");
  assert.equal(categorize("سلام"), "general");
  const S = (wins: number) => ({ runs: wins, ok: wins, ms: 0, wins });
  assert.equal(bestFor({ ideas: { codex: S(2), "claude-code": S(1) } }, "ideas"), "codex");
  assert.equal(bestFor({ ideas: { codex: S(1) } }, "ideas"), null); // not enough evidence
  assert.equal(bestFor({ ideas: { codex: S(2), "claude-code": S(2) } }, "ideas"), null); // no clear winner

  const used: string[] = [];
  const mk = (name: string) => ({ name, health: async () => ({ ok: true, detail: "" }), execute: async () => (used.push(name), { output: name }) });
  const auto = new FallbackProvider([mk("claude-code"), mk("codex")] as any, { get: () => null, set: () => {} });
  const k = new Kernel({ dbPath: ":memory:", providers: [auto as any, mk("claude-code") as any, mk("codex") as any], defaultProvider: "auto", retryBaseMs: 0 });
  labPlugin.setup({ kernel: k, home: "", options: {} });
  k.setKv("lab.cats", JSON.stringify({ ideas: { codex: S(3) } }));
  const sig = new AbortController().signal;
  await auto.execute({ taskId: "t", runId: "r", attempt: 1, prompt: "یک ایده برای اسم کانال", signal: sig });
  await auto.execute({ taskId: "t", runId: "r", attempt: 1, prompt: "سلام", signal: sig });
  assert.deepEqual(used, ["codex", "claude-code"]);
  k.setKv("lab.routing", "off");
  await auto.execute({ taskId: "t", runId: "r", attempt: 1, prompt: "یک ایده", signal: sig });
  assert.equal(used.at(-1), "claude-code");
  assert.match(await k.getCommand("lab")!.run("auto on"), /روشن/);
});

test("a model that failed is left out of the next comparison", async () => {
  const { workingModels } = await import("../src/plugins/lab.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [prov("claude-code", true, "C"), prov("codex", true, "X")], defaultProvider: "claude-code", retryBaseMs: 0 });
  k.setKv("lab.skip.codex", String(Date.now() + 60_000));
  assert.deepEqual(await workingModels(k), ["claude-code"]);
});
