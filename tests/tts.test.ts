import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { speakable, makeSpeaker } from "../src/voice/tts.ts";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { TelegramInterface } from "../src/interfaces/telegram.ts";

test("speakable strips markdown, links, emoji and shortens", () => {
  assert.equal(speakable("✅ **سلام** https://x.y `code`"), "سلام code");
  assert.ok(speakable("جمله. ".repeat(300), 100).length <= 103);
});

test("voice message → task source telegram-voice → spoken reply sent", { skip: process.platform === "win32" }, async () => {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "elias-tts-"));
  fs.mkdirSync(path.join(home, "video"));
  fs.copyFileSync(new URL("../video/tts.py", import.meta.url).pathname, path.join(home, "video", "tts.py"));
  process.env.ELIAS_FAKE_TTS = "1";
  const speak = makeSpeaker(home, "fa-IR-FaridNeural", "python3")!;
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", retryBaseMs: 0 });
  const calls: string[] = [];
  const api = async (m: string) => (calls.push(m), m === "getUpdates" ? [] : {});
  const tg = new TelegramInterface(k, api, { transcriber: {} as any, download: async () => Buffer.alloc(0), dir: home, speak });
  k.setKv("telegram.owner_chat_id", "42");
  k.addEventSink((e) => tg.notify(e));
  (tg as any).fromVoice = true;
  await (tg as any).handleOwnerText("سلام");
  (tg as any).fromVoice = false;
  assert.equal(k.listTasks({ limit: 1 })[0]!.source, "telegram-voice");
  await k.processNext();
  for (let i = 0; i < 50 && !calls.includes("sendVoice"); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(calls.includes("sendVoice"));
});
