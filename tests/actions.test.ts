import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeAction } from "../src/interfaces/actions.ts";

test("safe actions run by themselves; deleting, publishing, videos and real PC clean-up need a tap", () => {
  for (const a of ["/remind 14.10.2026 09:00 x", "/termin 15.10.2026 AMS", "/termin", "/remember حساب اصلی RoboForex", "/research طلا",
    "/team سؤال", "/pc", "/pc clean", "/pc tidy", "/lot 1000 1 20", "/notes", "/reminders", "/health", "/note متن"])
    assert.ok(isSafeAction(a), a);
  for (const a of ["/termin del 1", "/reminders off reminder-x", "/forget 2", "/yt 3", "/short x", "/ai x", "/site publish",
    "/pc clean yes", "/pc tidy yes", "/pc undo", "/research off طلا", "/restart", "/unknown", "remind x"])
    assert.ok(!isSafeAction(a), a);
});
