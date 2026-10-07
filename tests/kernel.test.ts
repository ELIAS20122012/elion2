import { test } from "node:test";
import assert from "node:assert/strict";
import { Kernel } from "../src/kernel/kernel.ts";
import { ScriptedProvider, EchoProvider } from "../src/providers/mock.ts";
import { decide, DEFAULT_POLICY } from "../src/kernel/permissions.ts";
import { parseCron, nextRun } from "../src/kernel/cron.ts";
import { verifyOutput, parseVerify } from "../src/kernel/verify.ts";
import type { ExecutionProvider } from "../src/providers/types.ts";

function mk(providers: ExecutionProvider[], now?: () => Date) {
  return new Kernel({ dbPath: ":memory:", providers, defaultProvider: providers[0]!.name, retryBaseMs: 0, now });
}

test("happy path: queued → running → verifying → succeeded, fully logged", async () => {
  const k = mk([new EchoProvider()]);
  const t = k.createTask({ title: "hello", prompt: "say hi", capabilities: ["read:calendar"] });
  const done = await k.processNext();
  assert.equal(done?.status, "succeeded");
  assert.match(done!.result!, /say hi/);
  const types = k.listEvents({ taskId: t.id }).map((e) => e.type);
  assert.deepEqual(types, ["task.created", "run.started", "task.succeeded"]);
  assert.equal(k.listRuns(t.id)[0]!.status, "succeeded");
});

test("verification failure feeds back into the next attempt, then succeeds", async () => {
  const p = new ScriptedProvider([{ output: "no summary here" }, { output: "SUMMARY: all good" }]);
  const k = mk([p]);
  const t = k.createTask({ title: "brief", prompt: "write brief", verify: { type: "contains", text: "SUMMARY:" } });
  assert.equal((await k.processNext())?.status, "queued");
  const final = await k.processNext();
  assert.equal(final?.status, "succeeded");
  assert.equal(final?.attempts, 2);
  assert.match(p.calls[1]!.prompt, /Previous attempt #1 failed: output must contain "SUMMARY:"/);
  assert.deepEqual(k.listRuns(t.id).map((r) => r.status), ["failed", "succeeded"]);
});

test("exhausted retries end in a real failed state with the failure kind", async () => {
  const k = mk([new ScriptedProvider([{ error: "boom" }, { error: "boom" }])]);
  const t = k.createTask({ title: "x", prompt: "y", maxAttempts: 2 });
  await k.drain();
  const f = k.getTask(t.id)!;
  assert.equal(f.status, "failed");
  assert.equal(f.failureKind, "provider_error");
  assert.equal(f.attempts, 2);
});

test("timeout is detected even if the provider hangs", async () => {
  const k = mk([new ScriptedProvider([{ hang: true }])]);
  const t = k.createTask({ title: "slow", prompt: "y", timeoutMs: 1000, maxAttempts: 1 });
  await k.processNext();
  const f = k.getTask(t.id)!;
  assert.equal(f.status, "failed");
  assert.equal(f.failureKind, "timeout");
});

test("unavailable provider fails fast without burning retries", async () => {
  const k = mk([new ScriptedProvider([{ error: "claude not found", unavailable: true }])]);
  const t = k.createTask({ title: "x", prompt: "y", maxAttempts: 3 });
  await k.drain();
  const f = k.getTask(t.id)!;
  assert.equal(f.status, "failed");
  assert.equal(f.failureKind, "provider_unavailable");
  assert.equal(f.attempts, 1);
});

test("unregistered provider → failed provider_unavailable", async () => {
  const k = mk([new EchoProvider()]);
  const t = k.createTask({ title: "x", prompt: "y", provider: "gpt-9" });
  await k.processNext();
  assert.equal(k.getTask(t.id)!.failureKind, "provider_unavailable");
});

test("approval gate: risky capability blocks until approved, provider never runs before", async () => {
  const p = new ScriptedProvider([{ output: "published" }]);
  const k = mk([p]);
  const t = k.createTask({ title: "upload video", prompt: "publish", capabilities: ["read:files", "publish:youtube"] });
  assert.equal((await k.processNext())?.status, "awaiting_approval");
  assert.equal(p.calls.length, 0);
  assert.equal(await k.processNext(), null); // nothing runnable
  const [ap] = k.listApprovals();
  assert.equal(ap!.capability, "publish:youtube");
  k.decideApproval(ap!.id, true, "ok");
  assert.equal(k.getTask(t.id)!.status, "queued");
  assert.equal((await k.processNext())?.status, "succeeded");
  assert.equal(p.calls.length, 1);
});

test("rejecting an approval cancels the task", async () => {
  const k = mk([new EchoProvider()]);
  const t = k.createTask({ title: "buy", prompt: "pay", capabilities: ["payment:card"] });
  await k.processNext();
  k.decideApproval(k.listApprovals()[0]!.id, false, "no");
  const f = k.getTask(t.id)!;
  assert.equal(f.status, "cancelled");
  assert.equal(f.failureKind, "rejected");
});

test("deny policy → permission_denied", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", policy: { default: "approve", rules: { "trade:execute": "deny" } } });
  const t = k.createTask({ title: "trade", prompt: "buy EURUSD", capabilities: ["trade:execute"] });
  await k.processNext();
  assert.equal(k.getTask(t.id)!.failureKind, "permission_denied");
});

test("invalid capability is rejected at creation", () => {
  const k = mk([new EchoProvider()]);
  assert.throws(() => k.createTask({ title: "x", prompt: "y", capabilities: ["Publish YouTube"] }));
});

test("crash recovery requeues interrupted tasks", async () => {
  const k = mk([new EchoProvider()]);
  const t = k.createTask({ title: "x", prompt: "y" });
  k.db.prepare("UPDATE tasks SET status='running', attempts=1 WHERE id=?").run(t.id);
  assert.equal(k.recover(), 1);
  assert.equal(k.getTask(t.id)!.status, "queued");
  assert.equal((await k.processNext())?.status, "succeeded");
});

test("scheduler fires once when due and computes the next run", () => {
  let now = new Date(2026, 9, 2, 7, 59, 0); // local 07:59
  const k = mk([new EchoProvider()], () => now);
  const s = k.addSchedule("daily-briefing", "0 8 * * *", { title: "Daily briefing", prompt: "brief me", capabilities: ["read:email"] });
  assert.equal(new Date(s.nextRunAt!).getHours(), 8);
  assert.equal(k.tickScheduler().length, 0);
  now = new Date(2026, 9, 2, 8, 0, 30);
  const fired = k.tickScheduler();
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.source, "schedule");
  assert.equal(k.tickScheduler().length, 0); // no double fire
  const next = new Date(k.getSchedule("daily-briefing")!.nextRunAt!);
  assert.equal(next.getDate(), 3);
  assert.equal(next.getHours(), 8);
});

test("cancel while running aborts and ignores late output", async () => {
  const p = new ScriptedProvider([{ output: "late", delayMs: 200 }]);
  const k = mk([p]);
  const t = k.createTask({ title: "x", prompt: "y" });
  const pr = k.processNext();
  await new Promise((r) => setTimeout(r, 20));
  k.cancelTask(t.id);
  await pr;
  assert.equal(k.getTask(t.id)!.status, "cancelled");
});

test("policy matching: exact > longest wildcard > default", () => {
  assert.equal(decide(DEFAULT_POLICY, "read:email"), "allow");
  assert.equal(decide(DEFAULT_POLICY, "publish:instagram"), "approve");
  assert.equal(decide(DEFAULT_POLICY, "trade:execute"), "approve");
  assert.equal(decide(DEFAULT_POLICY, "something:new"), "approve");
  assert.equal(decide({ default: "deny", rules: { "a:*": "approve", "a:b*": "allow" } }, "a:bc"), "allow");
});

test("cron parsing and next-run math", () => {
  const c = parseCron("*/15 9-17 * * 1-5");
  const n = nextRun(c, new Date(2026, 9, 3, 12, 0)); // Saturday
  assert.equal(n.getDay(), 1); // Monday
  assert.equal(n.getHours(), 9);
  assert.equal(n.getMinutes(), 0);
  assert.equal(nextRun(parseCron("0 0 * * 7"), new Date(2026, 9, 2)).getDay(), 0);
  assert.throws(() => parseCron("61 * * * *"));
  assert.throws(() => parseCron("* * *"));
});

test("verify specs", () => {
  assert.equal(verifyOutput(parseVerify("json:summary,items"), '```json\n{"summary":"x","items":[]}\n```').ok, true);
  assert.equal(verifyOutput(parseVerify("json:summary"), "{}").ok, false);
  assert.equal(verifyOutput(parseVerify("regex:^OK"), "OK done").ok, true);
  assert.equal(verifyOutput(parseVerify(undefined), "  ").ok, false);
});

test("internal schedules stay internal (silent in Telegram)", () => {
  let now = new Date(2026, 9, 2, 7, 59, 0);
  const k = mk([new EchoProvider()], () => now);
  k.addSchedule("watch", "*/5 * * * *", { title: "watch", prompt: "x", source: "internal" });
  now = new Date(2026, 9, 2, 8, 0, 30);
  assert.equal(k.tickScheduler()[0]!.source, "internal");
});
