import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { Kernel } from "../src/kernel/kernel.ts";
import { runChecks, transitions, healthReport } from "../src/plugins/health.ts";
import type { ExecutionProvider } from "../src/providers/types.ts";

const prov = (name: string, ok: boolean): ExecutionProvider => ({ name, health: async () => ({ ok, detail: ok ? "ok" : "down" }), execute: async () => ({ output: "" }) });

test("checks: limited Claude, stale backup, failure burst → alerts once, recovery once", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [prov("claude-code", true), prov("codex", true)], defaultProvider: "codex" });
  k.setKv("provider.cooldown.claude-code", String(Date.now() + 3_600_000));
  k.setKv("maintenance.last_backup", new Date(Date.now() - 30 * 3_600_000).toISOString());
  for (let i = 0; i < 3; i++) {
    const t = k.createTask({ title: `t${i}`, prompt: "x", source: "telegram" });
    k.db.prepare("UPDATE tasks SET status='failed' WHERE id=?").run(t.id);
  }
  const r1 = await runChecks(k, os.tmpdir(), {});
  const bad = r1.filter((r) => !r.ok).map((r) => r.key).sort();
  assert.deepEqual(bad, ["ai", "backup", "failures"]);
  assert.match(healthReport(r1), /3 مورد/);
  assert.equal(transitions(k, r1).length, 3);
  assert.equal(transitions(k, await runChecks(k, os.tmpdir(), {})).length, 0); // no repeat
  k.setKv("provider.cooldown.claude-code", "0");
  const rec = transitions(k, await runChecks(k, os.tmpdir(), {}));
  assert.equal(rec.length, 1);
  assert.match(rec[0]!, /دوباره سالم/);
});
