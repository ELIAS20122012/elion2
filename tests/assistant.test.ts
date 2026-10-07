import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Kernel } from "../src/kernel/kernel.ts";
import { stripWake, naturalCommand, VoiceAssistant } from "../src/voice/assistant.ts";
import { handler } from "../src/interfaces/dashboard.ts";

test("wake phrase stripped in Persian and Latin spellings", () => {
  assert.equal(stripWake("هی الیون، حساب من چطوره؟"), "حساب من چطوره؟");
  assert.equal(stripWake("Hey Elion, what's up"), "what's up");
  assert.equal(stripWake("های لیون یادم بنداز"), "یادم بنداز");
  assert.equal(stripWake("hey alien."), "");
  assert.equal(stripWake("سلام خوبی"), "سلام خوبی");
});

test("natural commands", () => {
  assert.deepEqual(naturalCommand("یادم بنداز فردا ساعت ۱۰ زنگ بزنم"), { cmd: "remind", args: "فردا ساعت ۱۰ زنگ بزنم" });
  assert.deepEqual(naturalCommand("درباره‌ی قیمت طلا تحقیق کن."), { cmd: "research", args: "قیمت طلا" });
  assert.equal(naturalCommand("حساب من")?.cmd, "account");
  assert.equal(naturalCommand("یک جوک بگو"), null);
});

function kernelWith(output: string) {
  const k = new Kernel({ dbPath: ":memory:", providers: [{ name: "fake", health: async () => ({ ok: true, detail: "" }), execute: async () => ({ output }) }], defaultProvider: "fake" });
  k.registerCommand({ name: "account", description: "", plugin: "t", run: () => "بالانس ۴۸۰ یورو" });
  return k;
}
const tr = (text: string) => ({ transcribe: async () => ({ text, language: "fa", duration: 1, seconds: 0.1 }), close() {} });
const speak = async (t: string) => `/tmp/${t.length}.wav`;

test("assistant: instant command, wake-only, AI task with auto action", async () => {
  const k = kernelWith("الان می‌گم.\n>>> /account\n>>> /publish x");
  const va = new VoiceAssistant(k, tr("هی الیون حساب من"), speak);
  const r1 = await va.handle({ wav: "/nonexistent.wav" });
  assert.equal(r1.text, "بالانس ۴۸۰ یورو");
  assert.ok(r1.audio?.endsWith(".wav"));
  assert.equal((await new VoiceAssistant(k, tr("Hey Elion."), speak).handle({ wav: "/x.wav" })).wakeOnly, true);
  const r2 = await new VoiceAssistant(k, tr("هی الیون امروز چه خبر؟"), speak).handle({ wav: "/x.wav" });
  assert.equal(r2.done, false);
  assert.equal((await va.result(r2.taskId!)).done, false);
  while (await k.processNext()) {}
  const r3 = await va.result(r2.taskId!);
  assert.equal(r3.done, true);
  assert.match(r3.text!, /الان می‌گم[\s\S]*بالانس/);
  assert.doesNotMatch(r3.text!, /publish/);
  assert.match(k.getTask(r2.taskId!)!.prompt, /Hey Elion/);
});

test("dashboard voice API: local only, needs X-Elias", async () => {
  const k = kernelWith("ok");
  const va = new VoiceAssistant(k, tr("حساب من"), speak);
  const srv = http.createServer(handler(k, 7499, { publicHost: "panel.x.org", ownerEmail: "a@b.c" }, va));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  const raw = (host: string, headers: Record<string, string>) =>
    new Promise<number>((resolve) => {
      const req = http.request({ port, path: "/api/voice", method: "POST", headers: { host, "content-type": "application/json", ...headers } }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.end(JSON.stringify({ text: "حساب من" }));
    });
  assert.equal(await raw("127.0.0.1:7499", { "x-elias": "1" }), 200);
  assert.equal(await raw("127.0.0.1:7499", {}), 403);
  assert.equal(await raw("panel.x.org", { "x-elias": "1", "cf-access-jwt-assertion": "j", "cf-access-authenticated-user-email": "a@b.c" }), 404);
  srv.close();
});
