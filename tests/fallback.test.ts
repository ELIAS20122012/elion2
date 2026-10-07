import { test } from "node:test";
import assert from "node:assert/strict";
import { Kernel } from "../src/kernel/kernel.ts";
import { FallbackProvider } from "../src/providers/fallback.ts";
import { LimitError, ProviderUnavailableError, limitOrError, type ExecutionProvider } from "../src/providers/types.ts";

function fake(name: string, behave: () => string): ExecutionProvider & { calls: number } {
  const p = { name, calls: 0, health: async () => ({ ok: true, detail: name }), execute: async () => ((p.calls++, { output: behave() })) };
  return p;
}
const store = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
};

test("limit on Claude → ChatGPT answers; Claude is skipped until its cooldown ends", async () => {
  let now = 1_000_000;
  const claude = fake("claude-code", () => { throw new LimitError("usage limit reached"); });
  const codex = fake("codex", () => "from codex");
  const skips: string[] = [];
  const f = new FallbackProvider([claude, codex], store(), { onSkip: (n, r) => skips.push(`${n}:${r}`) }, { now: () => now });
  const req = { taskId: "t", runId: "r", attempt: 1, prompt: "hi", signal: new AbortController().signal };
  const r1 = await f.execute(req);
  assert.equal(r1.output, "from codex");
  assert.equal(r1.meta?.provider, "codex");
  await f.execute(req);
  assert.equal(claude.calls, 1); // cooling down, not retried
  now += 61 * 60_000;
  await f.execute(req).catch(() => {});
  assert.equal(claude.calls, 2); // cooldown over
  assert.deepEqual(skips[0], "claude-code:limit");
});

test("unavailable CLI is skipped; a real task error is NOT masked by fallback", async () => {
  const missing = fake("gemini", () => { throw new ProviderUnavailableError("not installed"); });
  const broken = fake("codex", () => { throw new Error("bad prompt"); });
  const f = new FallbackProvider([missing, broken], store());
  await assert.rejects(f.execute({ taskId: "t", runId: "r", attempt: 1, prompt: "x", signal: new AbortController().signal }), /bad prompt/);
});

test("all limited → task waits (rate_limited) without burning attempts, then succeeds", async () => {
  let limited = true;
  const only = fake("claude-code", () => { if (limited) throw new LimitError("quota"); return "done"; });
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "auto", rateLimitWaitMs: 0, retryBaseMs: 0 });
  k.registerProvider(new FallbackProvider([only], { get: (x) => k.getKv(x), set: (x, v) => k.setKv(x, v) }, {}, { limitCooldownMs: 0 }));
  const t = k.createTask({ title: "x", prompt: "y", maxAttempts: 1 });
  await k.processNext();
  assert.equal(k.getTask(t.id)!.status, "queued");
  assert.equal(k.getTask(t.id)!.failureKind, "rate_limited");
  assert.equal(k.getTask(t.id)!.attempts, 0);
  limited = false;
  assert.equal((await k.processNext())!.status, "succeeded");
});

test("limit messages from Claude, ChatGPT and Gemini are recognised", () => {
  assert.ok(limitOrError("Claude AI usage limit reached|1759500000") instanceof LimitError);
  assert.equal((limitOrError("Claude AI usage limit reached|1759500000") as LimitError).resetAt, 1759500000000);
  assert.ok(limitOrError("You've hit your usage limit. Upgrade to Pro") instanceof LimitError);
  assert.ok(limitOrError("429 RESOURCE_EXHAUSTED: Quota exceeded") instanceof LimitError);
  assert.ok(!(limitOrError("SyntaxError in prompt") instanceof LimitError));
});
