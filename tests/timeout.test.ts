import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../src/kernel/timeout.ts";

test("withTimeout returns the work result and leaves no timer behind", async () => {
  const t0 = Date.now();
  assert.equal(await withTimeout(Promise.resolve("ok"), 60_000, "late"), "ok");
  assert.ok(Date.now() - t0 < 1000);
});

test("withTimeout falls back when the work is too slow", async () => {
  assert.equal(await withTimeout(new Promise<string>(() => {}), 20, "late"), "late");
});
