import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { TelegramInterface, type TelegramApi } from "../src/interfaces/telegram.ts";
import { WhisperTranscriber, type Transcriber } from "../src/voice/whisper.ts";

const OWNER = 111;

function setup(transcriber: Transcriber | null, files: string[] = []) {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo" });
  k.setKv("telegram.owner_chat_id", String(OWNER));
  const sent: string[] = [];
  let updates: any[] = [];
  const api: TelegramApi = async (m, p) => {
    if (m === "getUpdates") return updates.splice(0);
    if (m === "getFile") return { file_path: "voice/file_7.oga" };
    if (m === "sendMessage") sent.push(p.text as string);
    return {};
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-v-"));
  const tg = new TelegramInterface(
    k,
    api,
    transcriber
      ? { transcriber, dir, download: async (fp) => (files.push(fp), Buffer.from("OggS-fake-audio")) }
      : null,
  );
  let id = 1;
  const voice = (chatId: number, duration = 5) =>
    updates.push({ update_id: id++, message: { chat: { id: chatId, type: "private" }, voice: { file_id: "F1", duration } } });
  return { k, tg, sent, voice, dir };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("voice message → transcript shown to Elias → becomes a task; audio file deleted", async () => {
  let seen = "";
  const fake: Transcriber = {
    transcribe: async (f) => ((seen = fs.readFileSync(f, "utf8")), { text: "گزارش امروز را بده", language: "fa", duration: 3, seconds: 1 }),
    close() {},
  };
  const s = setup(fake);
  s.voice(OWNER);
  await s.tg.pollOnce();
  await settle();
  await s.tg.flush();
  assert.equal(seen, "OggS-fake-audio");
  assert.ok(s.sent.includes("🎙️ «گزارش امروز را بده»"));
  const [t] = s.k.listTasks();
  assert.equal(t!.prompt, "گزارش امروز را بده");
  assert.equal(t!.source, "telegram-voice");
  assert.deepEqual(fs.readdirSync(s.dir), []);
});

test("voice from a stranger is ignored", async () => {
  let called = false;
  const s = setup({ transcribe: async () => ((called = true), { text: "x", language: "fa", duration: 1, seconds: 1 }), close() {} });
  s.voice(999);
  await s.tg.pollOnce();
  await settle();
  assert.equal(called, false);
  assert.equal(s.k.listTasks().length, 0);
});

test("too long voice and missing setup get a clear answer; errors are reported, not swallowed", async () => {
  const a = setup({ transcribe: async () => ({ text: "x", language: "fa", duration: 1, seconds: 1 }), close() {} });
  a.voice(OWNER, 900);
  await a.tg.pollOnce();
  await settle();
  await a.tg.flush();
  assert.match(a.sent.at(-1)!, /بیش از 5 دقیقه/);

  const b = setup(null);
  b.voice(OWNER);
  await b.tg.pollOnce();
  await settle();
  await b.tg.flush();
  assert.match(b.sent.at(-1)!, /voice-setup\.cmd/);

  const c = setup({ transcribe: async () => { throw new Error("model crashed"); }, close() {} });
  c.voice(OWNER);
  await c.tg.pollOnce();
  await settle();
  await c.tg.flush();
  assert.match(c.sent.at(-1)!, /model crashed/);
  assert.deepEqual(fs.readdirSync(c.dir), []); // audio removed even on failure
});

// ───────── bridge protocol against a fake Python worker ─────────

const FAKE_WORKER = `
import sys, json, os
print("some library banner")
print(json.dumps({"ready": True, "model": os.environ.get("ELIAS_WHISPER_MODEL")}), flush=True)
for line in sys.stdin:
    r = json.loads(line)
    if "bad" in r["path"]:
        print(json.dumps({"id": r["id"], "error": "cannot decode"}), flush=True)
    else:
        print(json.dumps({"id": r["id"], "text": "\\u0633\\u0644\\u0627\\u0645 " + str(r["language"]), "language": "fa", "duration": 2.0, "seconds": 0.5}), flush=True)
`;

test("WhisperTranscriber talks to the worker: ready line, results, errors, language default", async (t) => {
  const py = ["python3", "python"].find((c) => {
    try {
      return spawnSync(c, ["--version"]).status === 0;
    } catch {
      return false;
    }
  });
  if (!py) return t.skip("python not available");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-w-"));
  const script = path.join(dir, "fake.py");
  fs.writeFileSync(script, FAKE_WORKER);
  const w = new WhisperTranscriber({ python: py, script, language: "fa" });
  try {
    const r = await w.transcribe(path.join(dir, "a.oga"));
    assert.equal(r.text, "سلام fa");
    await assert.rejects(w.transcribe(path.join(dir, "bad.oga")), /cannot decode/);
    const r2 = await w.transcribe(path.join(dir, "b.oga"), "de");
    assert.equal(r2.text, "سلام de");
  } finally {
    w.close();
  }
});

test("WhisperTranscriber reports a worker that fails to load", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-w-"));
  const script = path.join(dir, "fail.py");
  fs.writeFileSync(script, 'import json; print(json.dumps({"ready": False, "error": "No module named faster_whisper"}), flush=True)\n');
  const w = new WhisperTranscriber({ python: "python3", script });
  await assert.rejects(w.transcribe("x.oga"), /faster_whisper/);
  w.close();
});
