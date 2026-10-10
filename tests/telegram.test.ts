import { test } from "node:test";
import assert from "node:assert/strict";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { TelegramInterface, markdownToHtml, type TelegramApi } from "../src/interfaces/telegram.ts";

const OWNER = 111;
const STRANGER = 999;

function setup() {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", retryBaseMs: 0 });
  const calls: Array<{ method: string; params: Record<string, any> }> = [];
  let updates: any[] = [];
  const api: TelegramApi = async (method, params) => {
    calls.push({ method, params });
    if (method === "getUpdates") {
      const u = updates.filter((x) => x.update_id >= (params.offset as number));
      updates = [];
      return u;
    }
    return { message_id: calls.length };
  };
  const tg = new TelegramInterface(k, api);
  k.addEventSink((e) => tg.notify(e));
  let uid = 1;
  const push = (u: object) => updates.push({ update_id: uid++, ...u });
  const msg = (chatId: number, text: string) => push({ message: { chat: { id: chatId, type: "private" }, from: { id: chatId }, text } });
  const sent = () => calls.filter((c) => c.method === "sendMessage");
  return { k, tg, calls, push, msg, sent };
}

async function pair(s: ReturnType<typeof setup>) {
  const code = s.tg.startPairing();
  s.msg(OWNER, `/start ${code}`);
  await s.tg.pollOnce();
  await s.tg.flush();
}

test("pairing with the right code binds the owner; wrong code does not", async () => {
  const s = setup();
  const code = s.tg.startPairing();
  s.msg(STRANGER, "/start 000000");
  await s.tg.pollOnce();
  assert.equal(s.tg.ownerChatId(), null);
  s.msg(OWNER, `/start ${code}`);
  await s.tg.pollOnce();
  assert.equal(s.tg.ownerChatId(), OWNER);
  // code is single-use
  s.tg.unpair();
  s.msg(STRANGER, `/start ${code}`);
  await s.tg.pollOnce();
  assert.equal(s.tg.ownerChatId(), null);
});

test("expired pairing code is rejected", async () => {
  const s = setup();
  const code = s.tg.startPairing(-1);
  s.msg(OWNER, `/start ${code}`);
  await s.tg.pollOnce();
  assert.equal(s.tg.ownerChatId(), null);
});

test("strangers are ignored after pairing; no task is created", async () => {
  const s = setup();
  await pair(s);
  const before = s.sent().length;
  s.msg(STRANGER, "delete everything");
  await s.tg.pollOnce();
  assert.equal(s.k.listTasks().length, 0);
  assert.equal(s.sent().length, before);
});

test("owner message becomes a task and the verified result is sent back", async () => {
  const s = setup();
  await pair(s);
  s.msg(OWNER, "summarize my day");
  await s.tg.pollOnce();
  const [t] = s.k.listTasks();
  assert.equal(t!.source, "telegram");
  await s.k.processNext();
  await s.tg.flush();
  const last = s.sent().at(-1)!.params.text as string;
  assert.match(last, /✅ <b>summarize my day<\/b>/);
  assert.match(last, /ECHO\(attempt 1\): summarize my day/);
});

test("approval request arrives with buttons; pressing ✅ approves and the task runs", async () => {
  const s = setup();
  await pair(s);
  const t = s.k.createTask({ title: "Upload video", prompt: "publish it", capabilities: ["publish:youtube"], source: "telegram" });
  await s.k.processNext();
  await s.tg.flush();
  const ask = s.sent().find((c) => c.params.reply_markup)!;
  const btn = ask.params.reply_markup.inline_keyboard[0][0];
  assert.match(btn.callback_data, /^apr:y:apr_/);
  s.push({ callback_query: { id: "cb1", from: { id: OWNER }, data: btn.callback_data, message: { chat: { id: OWNER }, message_id: 5 } } });
  await s.tg.pollOnce();
  assert.equal(s.k.getTask(t.id)!.status, "queued");
  assert.ok(s.calls.some((c) => c.method === "editMessageText" && /تأیید شد/.test(c.params.text)));
  assert.equal((await s.k.processNext())!.status, "succeeded");
});

test("a callback from a stranger cannot approve", async () => {
  const s = setup();
  await pair(s);
  s.k.createTask({ title: "Pay", prompt: "pay", capabilities: ["payment:card"] });
  await s.k.processNext();
  const ap = s.k.listApprovals()[0]!;
  s.push({ callback_query: { id: "cb2", from: { id: STRANGER }, data: `apr:y:${ap.id}`, message: { chat: { id: STRANGER }, message_id: 1 } } });
  await s.tg.pollOnce();
  assert.equal(s.k.listApprovals()[0]!.status, "pending");
});

test("failures are reported, /status and /tasks answer", async () => {
  const s = setup();
  await pair(s);
  s.k.createTask({ title: "Broken", prompt: "x", provider: "nope" });
  await s.k.processNext();
  s.msg(OWNER, "/status");
  s.msg(OWNER, "/tasks");
  await s.tg.pollOnce();
  await s.tg.flush();
  const texts = s.sent().map((c) => c.params.text as string);
  assert.ok(texts.some((t) => /❌ شکست: Broken/.test(t)));
  assert.ok(texts.some((t) => /📊 وضعیت/.test(t)));
  assert.ok(texts.some((t) => /Broken/.test(t) && /provider_unavailable/.test(t)));
});

test("offset advances so updates are never handled twice", async () => {
  const s = setup();
  await pair(s);
  s.msg(OWNER, "one");
  await s.tg.pollOnce();
  await s.tg.pollOnce();
  assert.equal(s.k.listTasks().length, 1);
  const lastGet = s.calls.filter((c) => c.method === "getUpdates").at(-1)!;
  assert.equal(lastGet.params.offset, 3);
});

test("markdown from the model becomes safe Telegram HTML", () => {
  assert.equal(markdownToHtml("**Risk** <1%> & `R:R`"), "<b>Risk</b> &lt;1%&gt; &amp; <code>R:R</code>");
  assert.equal(markdownToHtml("## Title\n- a"), "<b>Title</b>\n• a");
});

test("if Telegram rejects HTML, the message is resent as plain text", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo" });
  const sent: any[] = [];
  const api: TelegramApi = async (m, p) => {
    if (m === "sendMessage" && p.parse_mode) throw new Error("can't parse entities");
    if (m === "sendMessage") sent.push(p);
    return {};
  };
  const tg = new TelegramInterface(k, api);
  k.setKv("telegram.owner_chat_id", "1");
  await tg.send("<b>hi</b> &amp; bye", { parse_mode: "HTML" });
  assert.equal(sent[0].text, "hi & bye");
  assert.equal(sent[0].parse_mode, undefined);
});

test("AI answer with '>>> /cmd' line → ▶️ button → tapping runs the command; /remind runs by itself", async () => {
  const { extractActions, TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const { Kernel } = await import("../src/kernel/kernel.ts");
  const { EchoProvider } = await import("../src/providers/mock.ts");
  assert.deepEqual(extractActions("باشه.\n`>>> /remind 2h چای`"), { text: "باشه.", actions: ["/remind 2h چای"] });
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", retryBaseMs: 0 });
  let ran = "", researched = "";
  k.registerCommand({ name: "remind", description: "", plugin: "t", run: (a) => ((ran = a), "ok") });
  k.registerCommand({ name: "yt", description: "", plugin: "t", run: (a) => ((researched = a), "ok") });
  const sent: any[] = [];
  const tg = new TelegramInterface(k, async (m: string, p: any) => (sent.push({ m, ...p }), m === "getUpdates" ? [] : {}));
  k.setKv("telegram.owner_chat_id", "42");
  const t = k.createTask({ title: "x", prompt: "باشه\n>>> /remind 2h چای\n>>> /yt 3", source: "telegram" });
  k.addEventSink((e) => tg.notify(e));
  await k.processNext();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ran, "2h چای"); // safe local action: done without a tap
  const msg = sent.find((s) => s.reply_markup?.inline_keyboard);
  assert.ok(msg, "button sent");
  assert.equal(msg.reply_markup.inline_keyboard.length, 1);
  const data = msg.reply_markup.inline_keyboard[0][0].callback_data;
  await (tg as any).handleCallback({ id: "c", data, message: { chat: { id: 42 } }, from: { id: 42 } });
  assert.equal(researched, "3"); // publishing waits for the tap
  void t;
});

test("photo/document → saved to workspace inbox → AI task told to read it", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const { Kernel } = await import("../src/kernel/kernel.ts");
  const { EchoProvider } = await import("../src/providers/mock.ts");
  const inbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "elias-inbox-")), "inbox");
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo" });
  const api = async (m: string) => (m === "getFile" ? { file_path: "photos/file_1.jpg" } : m === "getUpdates" ? [] : {});
  const tg = new TelegramInterface(k, api, null, { download: async () => Buffer.from("JPEG"), inbox });
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleFile({ file_id: "x", file_name: "chart gold.jpg", file_size: 4 }, "تحلیل کن");
  const files = fs.readdirSync(inbox);
  assert.equal(files.length, 1);
  assert.match(files[0]!, /chart_gold\.jpg$/);
  const t = k.listTasks({ limit: 1 })[0]!;
  assert.match(t.prompt, /inbox\/\d+-chart_gold\.jpg/);
  assert.match(t.prompt, /تحلیل کن/);
});
