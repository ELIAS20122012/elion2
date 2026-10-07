import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { ScriptedProvider } from "../src/providers/mock.ts";
import { youtubePlugin, YouTubeUploadProvider, uploadPrompt, parseUpload, cleanMeta, YT_SCOPE } from "../src/plugins/youtube.ts";
import { GoogleAuth } from "../src/connectors/google.ts";

test("cleanMeta clamps to YouTube limits", () => {
  const m = cleanMeta({ title: "x".repeat(150), description: "<b>hi</b>", tags: ["#a", "", "b".repeat(600), "c"] });
  assert.equal(m.title.length, 100);
  assert.equal(m.description, "bhi/b");
  assert.deepEqual(m.tags, ["a", "c"]);
  const u = { file: "C:\\v\\a.mp4", title: "t", description: "d", tags: ["x"], privacy: "public" as const };
  assert.deepEqual(parseUpload(uploadPrompt(u) + "\n\nfeedback"), u);
});

test("/yt → metadata task (internal) → publish task waits for approval", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "elias-yt-"));
  fs.mkdirSync(path.join(home, "content", "youtube"), { recursive: true });
  fs.writeFileSync(path.join(home, "content", "youtube", "lesson1.mp4"), "video");
  const ai = new ScriptedProvider([{ output: '```json\n{"title":"درس ۱","description":"توضیح","tags":["forex","mt4"]}\n```' }], "ai");
  const k = new Kernel({ dbPath: ":memory:", providers: [ai], defaultProvider: "ai", retryBaseMs: 0 });
  youtubePlugin.setup({ kernel: k, home, options: { privacy: "unlisted" } });
  assert.match(await k.getCommand("yt")!.run(""), /1\. lesson1\.mp4/);
  assert.match(await k.getCommand("yt")!.run("1 | درس اول اسکالپ"), /تأیید/);
  const meta = k.listTasks({ limit: 1 })[0]!;
  assert.equal(meta.source, "internal");
  assert.match(meta.prompt, /درس اول اسکالپ/);
  await k.processNext();
  const pub = k.listTasks({ limit: 1 })[0]!;
  assert.equal(pub.provider, "youtube");
  assert.equal(pub.maxAttempts, 1);
  await k.processNext();
  assert.equal(k.getTask(pub.id)!.status, "awaiting_approval");
  const spec = parseUpload(pub.prompt);
  assert.equal(spec.privacy, "unlisted");
  assert.equal(spec.title, "درس ۱");
});

test("upload provider: resumable init + PUT, scope checked", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-ytp-"));
  fs.mkdirSync(path.join(dir, "config"));
  fs.writeFileSync(path.join(dir, "config", "google-client.json"), JSON.stringify({ installed: { client_id: "id", client_secret: "s" } }));
  fs.writeFileSync(path.join(dir, "config", "google-token.json"), JSON.stringify({ refresh_token: "r", scope: `a ${YT_SCOPE}`, created_at: "" }));
  const file = path.join(dir, "v.mp4");
  fs.writeFileSync(file, "1234567890");
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    if (init.method === "POST") return new Response("{}", { headers: { location: "https://upload.example/session" } });
    return new Response(JSON.stringify({ id: "abc123" }));
  }) as unknown as typeof fetch;
  const p = new YouTubeUploadProvider(new GoogleAuth(path.join(dir, "config"), f), f);
  const r = await p.execute({ taskId: "t", runId: "r", attempt: 1, signal: new AbortController().signal, prompt: uploadPrompt({ file, title: "t", description: "d", tags: [], privacy: "private" }) });
  assert.match(r.output, /youtu\.be\/abc123/);
  assert.deepEqual(calls.slice(1), ["POST https://www.googleapis.com/upload/youtube/v3/videos", "PUT https://upload.example/session"]);
});
