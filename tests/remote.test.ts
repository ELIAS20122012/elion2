import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { findFiles, remotePlugin, resolveApp, type Run } from "../src/plugins/remote.ts";
import { isSafeAction } from "../src/interfaces/actions.ts";

function setup(run: Run, roots: string[] = []) {
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "x", retryBaseMs: 0 });
  remotePlugin({ run, roots, tmp: os.tmpdir() }).setup({ kernel: k, home: "", options: {} });
  return (name: string, args = "") => Promise.resolve(k.getCommand(name)!.run(args));
}

test("open: known apps, Persian names, links; unknown names and odd links refused", async () => {
  assert.equal(resolveApp("کروم"), "chrome");
  assert.equal(resolveApp("youtube.com"), "https://youtube.com");
  assert.equal(resolveApp("rm -rf"), null);
  const calls: string[][] = [];
  const cmd = setup((c, a) => (calls.push([c, ...a]), { code: 0, out: "" }));
  assert.match(await cmd("open", "chrome"), /باز شد/);
  assert.equal(calls[0]!.at(-1), "Start-Process -FilePath 'chrome'");
  await cmd("open", "https://example.com/a?b='x'&calc");
  assert.equal(calls[1]!.at(-1), "Start-Process -FilePath 'https://example.com/a?b=''x''&calc'"); // quoted, never run by a shell
  assert.match(await cmd("open", "format c:"), /نمی‌شناسم/);
});

test("power and close ask first; only 'yes' acts; lock/cancel act at once", async () => {
  const calls: string[] = [];
  const cmd = setup((c, a) => (calls.push([c, ...a].join(" ")), { code: 0, out: "" }));
  assert.match(await cmd("power", "restart"), />>> \/power restart yes/);
  assert.equal(calls.length, 0);
  assert.match(await cmd("power", "restart yes"), /۶۰ ثانیه/);
  assert.match(calls[0]!, /^shutdown \/r \/t 60/);
  assert.match(await cmd("power", "lock"), /قفل/);
  assert.match(await cmd("close", "chrome"), />>> \/close chrome yes/);
  assert.match(await cmd("close", "explorer yes"), /نمی‌بندم/);
  assert.ok(isSafeAction("/power restart") && !isSafeAction("/power restart yes"));
  assert.ok(isSafeAction("/close chrome") && !isSafeAction("/close chrome yes"));
  assert.ok(isSafeAction("/screen") && isSafeAction("/open chrome") && isSafeAction("/file report"));
});

test("file: found in Elias's folders, choice when several, secrets never sent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rm-"));
  fs.writeFileSync(path.join(root, "invoice-2026.pdf"), "x");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "invoice-old.pdf"), "x");
  fs.writeFileSync(path.join(root, "secrets.json"), "{}");
  assert.deepEqual(findFiles("secrets", [root]), []);
  const cmd = setup(() => ({ code: 0, out: "" }), [root]);
  assert.match(await cmd("file", "invoice"), />>> \/file 1 invoice/);
  assert.match(await cmd("file", "1 invoice"), /<<<FILE .*invoice-(2026|old)\.pdf FILE>>>/);
  assert.match(await cmd("file", "2026"), /<<<FILE .*invoice-2026\.pdf FILE>>>/);
  assert.match(await cmd("file", "nothing-here"), /پیدا نشد/);
});

test("telegram sends a command's photo/file and turns its >>> lines into buttons", async () => {
  const { TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "x", retryBaseMs: 0 });
  const f = path.join(os.tmpdir(), `elias-screen-test-${Date.now()}.png`);
  fs.writeFileSync(f, "png");
  k.registerCommand({ name: "screen", description: "", plugin: "t", run: () => `🖥\n<<<PHOTO ${f} PHOTO>>>` });
  k.registerCommand({ name: "power", description: "", plugin: "t", run: () => "⚠️ ?\n>>> /power restart yes" });
  const calls: any[] = [];
  const tg = new TelegramInterface(k, async (m: string, p: any) => (calls.push({ m, ...p }), {}));
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleOwnerText("/screen");
  assert.ok(calls.some((c) => c.m === "sendPhoto" && c.__file.path === f));
  assert.ok(!calls.some((c) => c.m === "sendMessage" && /<<<PHOTO/.test(c.text)));
  assert.ok(!fs.existsSync(f)); // screenshots are temporary
  await (tg as any).handleOwnerText("/power restart");
  const btn = calls.find((c) => c.reply_markup?.inline_keyboard);
  assert.match(btn.reply_markup.inline_keyboard[0][0].text, /power restart yes/);
});
