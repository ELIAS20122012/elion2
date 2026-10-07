import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Kernel } from "../src/kernel/kernel.ts";
import { ScriptedProvider } from "../src/providers/mock.ts";
import { parseScript, VideoRenderProvider, onVideoEvent, shortScriptTask } from "../src/plugins/video.ts";
import { youtubePlugin, parseUpload } from "../src/plugins/youtube.ts";

const SCRIPT = JSON.stringify({
  title: "قانون یک درصد",
  description: "توضیح #ترید",
  tags: ["forex", "ریسک"],
  scenes: [
    { text: "چرا ضرر می‌کنی؟", say: "بیشتر تریدرها به خاطر ریسک ضرر می‌کنند." },
    { text: "قانون ۱٪", say: "بیشتر از یک درصد ریسک نکن." },
    { text: "دنبال کن", say: "برای نکات بیشتر دنبال کن." },
  ],
});

test("parseScript validates and clamps", () => {
  const s = parseScript("```json\n" + SCRIPT + "\n```");
  assert.equal(s.scenes.length, 3);
  assert.throws(() => parseScript('{"title":"x","scenes":[{"text":"a","say":"b"}]}'), /2 scenes/);
});

function canRender(): boolean {
  if (process.platform === "win32") return false;
  try {
    execFileSync("python3", ["-c", "import PIL, edge_tts"], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return fs.existsSync("/tmp/package/fonts/ttf/Vazirmatn-Black.ttf");
  } catch {
    return false;
  }
}

test("full chain: script → render (real ffmpeg, silent TTS) → publish awaiting approval", { skip: !canRender() }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "elias-video-"));
  fs.mkdirSync(path.join(home, "data", "fonts"), { recursive: true });
  for (const f of ["Vazirmatn-Black.ttf", "Vazirmatn-Regular.ttf"]) fs.copyFileSync(`/tmp/package/fonts/ttf/${f}`, path.join(home, "data", "fonts", f));
  fs.mkdirSync(path.join(home, "video"));
  fs.copyFileSync(new URL("../video/make_short.py", import.meta.url).pathname, path.join(home, "video", "make_short.py"));
  process.env.ELIAS_FAKE_TTS = "1";
  const k = new Kernel({ dbPath: ":memory:", providers: [new ScriptedProvider([{ output: SCRIPT }], "ai")], defaultProvider: "ai", retryBaseMs: 0 });
  youtubePlugin.setup({ kernel: k, home, options: { privacy: "private" } });
  k.registerProvider(new VideoRenderProvider(home, "python3"));
  k.addEventSink(onVideoEvent(k, home, "@Elias", "fa-IR-FaridNeural"));
  k.createTask(shortScriptTask("ریسک", false));
  await k.processNext(); // script
  await k.processNext(); // render
  const render = k.listTasks({ limit: 3 }).find((t) => t.provider === "video-render")!;
  assert.equal(render.status, "succeeded", render.error ?? "");
  await k.processNext(); // publish → approval
  const pub = k.listTasks({ limit: 1 })[0]!;
  assert.equal(pub.status, "awaiting_approval");
  const spec = parseUpload(pub.prompt);
  assert.match(spec.title, /#Shorts/);
  assert.equal(spec.privacy, "private");
  assert.ok(fs.statSync(spec.file).size > 10_000);
});

test("prompt queue: /short add → list → /short pops first; schedule task uses queue", async () => {
  const { videoPlugin } = await import("../src/plugins/video.ts");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "elias-q-"));
  const k = new Kernel({ dbPath: ":memory:", providers: [new ScriptedProvider([], "ai")], defaultProvider: "ai", retryBaseMs: 0 });
  videoPlugin.setup({ kernel: k, home, options: {} });
  const cmd = k.getCommand("short")!;
  await cmd.run("add اسکالپ طلا در سشن لندن");
  await cmd.run("add مدیریت ریسک با EA");
  assert.match(await cmd.run("list"), /2\. مدیریت ریسک با EA/);
  await cmd.run("");
  assert.match(k.listTasks({ limit: 1 })[0]!.prompt, /اسکالپ طلا/);
  const { QUEUE_TASK } = await import("../src/plugins/video.ts");
  for (const t of k.listTasks({ limit: 10 })) k.cancelTask(t.id);
  k.createTask(QUEUE_TASK);
  await k.processNext();
  assert.ok(k.listTasks({ limit: 5 }).some((t) => t.title.startsWith("🎬 اسکریپت") && /مدیریت ریسک با EA/.test(t.prompt)));
  assert.match(await cmd.run("list"), /خالی/);
});
