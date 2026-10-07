import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aiPlanTask, parsePlan, MediaGenProvider, listTemplates } from "../src/plugins/aivideo.ts";

test("template plan task embeds the template and forbids questions", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "elias-ai-"));
  fs.mkdirSync(path.join(home, "content", "templates"), { recursive: true });
  fs.writeFileSync(path.join(home, "content", "templates", "miniature.md"), "TEMPLATE BODY");
  assert.deepEqual(listTemplates(home), ["miniature"]);
  const t = aiPlanTask(home, "miniature پل با چوب بستنی");
  assert.match(t.prompt, /TEMPLATE BODY/);
  assert.match(t.prompt, /do NOT ask questions/);
  assert.match(t.prompt, /پل با چوب بستنی/);
  assert.throws(() => parsePlan('{"image1":"a","image2":"","video":"v"}'), /image2/);
});

test("media provider: image → edit → Veo (inlineData fallback) → poll → download", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "elias-media-"));
  const png = Buffer.from("png").toString("base64");
  const calls: string[] = [];
  let polls = 0;
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${url.replace(/^https:\/\/[^/]+\/v1beta\//, "")}`);
    if (url.includes(":generateContent")) return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: "image/png" } }] } }] });
    if (url.includes(":predictLongRunning")) {
      if (String(init.body).includes("bytesBase64Encoded")) return Response.json({ error: { message: "Unknown name \"bytesBase64Encoded\"" } }, { status: 400 });
      return Response.json({ name: "operations/op1" });
    }
    if (url.endsWith("operations/op1")) return Response.json(++polls < 2 ? { done: false } : { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files/v.mp4" } }] } } });
    return new Response("MP4DATA");
  }) as unknown as typeof fetch;
  const p = new MediaGenProvider({ backend: () => ({ kind: "gemini", key: () => "k" }), fetchImpl: f, pollMs: 1 });
  const spec = { out, image1: "a", image2: "b", video: "c", title: "t", description: "d", tags: [] };
  const r = await p.execute({ taskId: "t", runId: "r", attempt: 1, signal: new AbortController().signal, prompt: `<<<MEDIA ${JSON.stringify(spec)} MEDIA>>>` });
  assert.equal(fs.readFileSync(path.join(out, "video.mp4"), "utf8"), "MP4DATA");
  assert.match(r.output, /video\.mp4/);
  assert.equal(calls.filter((c) => c.includes("predictLongRunning")).length, 2);
});

test("vertex backend: OAuth + fetchPredictOperation + inline video bytes", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "elias-vx-"));
  const png = Buffer.from("png").toString("base64");
  const seen: Array<{ url: string; auth: string }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, auth: String((init.headers as Record<string, string>)?.authorization ?? "") });
    if (url.endsWith(":generateContent")) return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: "image/png" } }] } }] });
    if (url.endsWith(":predictLongRunning")) return Response.json({ name: "projects/p/locations/us-central1/publishers/google/models/veo/operations/1" });
    if (url.endsWith(":fetchPredictOperation")) return Response.json({ done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from("VID").toString("base64") }] } });
    throw new Error("unexpected " + url);
  }) as unknown as typeof fetch;
  const p = new MediaGenProvider({ backend: () => ({ kind: "vertex", project: "proj", token: async () => "tok" }), fetchImpl: f, pollMs: 1 });
  const spec = { out, image1: "a", image2: "b", video: "c", title: "t", description: "d", tags: [] };
  await p.execute({ taskId: "t", runId: "r", attempt: 1, signal: new AbortController().signal, prompt: `<<<MEDIA ${JSON.stringify(spec)} MEDIA>>>` });
  assert.equal(fs.readFileSync(path.join(out, "video.mp4"), "utf8"), "VID");
  assert.ok(seen.every((x) => x.auth === "Bearer tok"));
  assert.match(seen[0]!.url, /us-central1-aiplatform\.googleapis\.com\/v1\/projects\/proj\/locations\/us-central1\/publishers\/google\/models\/gemini-2\.5-flash-image:generateContent$/);
});

test("reference photos: video-intent detection, refs travel plan → spec → image call", async () => {
  const { splitRefs, isVideoRequest, refsOfPlan } = await import("../src/plugins/aivideo.ts");
  assert.equal(isVideoRequest("این چارت را تحلیل کن"), false);
  assert.equal(isVideoRequest("You are the Miniature Village Shorts Agent. Always create short viral videos in the exact visual style of the supplied reference images. Every video is only 8–10 seconds."), true);
  assert.equal(isVideoRequest("/ai یک روستا"), true);
  const refs = ["C:\\\\Elion\\\\elias-os\\\\data\\\\workspace\\\\inbox\\\\1-photo.jpg", "/tmp/2.png"];
  const s = splitRefs(`<<refs:${JSON.stringify(refs)}>> brief here`);
  assert.deepEqual(s.refs, refs);
  assert.equal(s.rest, "brief here");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-"));
  const t = aiPlanTask(home, `<<refs:${JSON.stringify(refs)}>> giant hand helps tiny villagers`);
  assert.match(t.prompt, /REFERENCE IMAGES/);
  assert.deepEqual(refsOfPlan(t.prompt), refs);
  assert.deepEqual(refsOfPlan(aiPlanTask(home, "idea").prompt), []);
});

test("default series: no template named → minirescue, history avoided", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-"));
  fs.mkdirSync(path.join(home, "content", "templates"), { recursive: true });
  fs.writeFileSync(path.join(home, "content", "templates", "minirescue.md"), "# Mini Rescue rules");
  const t = aiPlanTask(home, "قایق نزدیک آبشار", ["پل چوب بستنی"]);
  assert.match(t.prompt, /Mini Rescue rules/);
  assert.match(t.prompt, /قایق نزدیک آبشار/);
  assert.match(t.prompt, /do NOT repeat[\s\S]*پل چوب بستنی/);
  assert.match(aiPlanTask(home, "").prompt, /Mini Rescue rules/);
});

test("14 s form: template with image3 asks for 3 frames + 2 clips; plan parses them", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-"));
  fs.mkdirSync(path.join(home, "content", "templates"), { recursive: true });
  fs.writeFileSync(path.join(home, "content", "templates", "minirescue.md"), "frames: image1 image2 image3, video video2");
  const t = aiPlanTask(home, "");
  assert.match(t.prompt, /14 seconds/);
  assert.ok(t.verify.requiredKeys.includes("video2"));
  const p = parsePlan(JSON.stringify({ image1: "a", image2: "b", image3: "c", video: "v", video2: "w", title: "t", description: "d", tags: ["x"] }));
  assert.equal(p.image3, "c");
  assert.equal(p.video2, "w");
});

test("joinClips concatenates two clips with audio", { skip: !fs.existsSync("/usr/bin/ffmpeg") }, async () => {
  const { joinClips } = await import("../src/plugins/aivideo.ts");
  const { spawnSync } = await import("node:child_process");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "join-"));
  const mk = (f: string, s: number) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=red:s=180x320:d=${s}`, "-f", "lavfi", "-i", `sine=d=${s}`, "-shortest", path.join(d, f)]);
  mk("a.mp4", 2); mk("b.mp4", 1);
  await joinClips([path.join(d, "a.mp4"), path.join(d, "b.mp4")], path.join(d, "out.mp4"));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(d, "out.mp4")], { encoding: "utf8" });
  assert.ok(Math.abs(Number(probe.stdout) - 3) < 0.3);
});

test("manual mode: plan → prompts event → two clips joined → ready; billing error switches mode", { skip: !fs.existsSync("/usr/bin/ffmpeg") }, async () => {
  const { Kernel } = await import("../src/kernel/kernel.ts");
  const { onAiVideoEvent, addManualClip, AI_SCRIPT_TITLE } = await import("../src/plugins/aivideo.ts");
  const { spawnSync } = await import("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "man-"));
  const plan = JSON.stringify({ image1: "a", image2: "b", image3: "c", video: "v", video2: "w", title: "نجات", description: "d", tags: ["x"] });
  const k = new Kernel({ dbPath: ":memory:", providers: [{ name: "fake", health: async () => ({ ok: true, detail: "" }), execute: async () => ({ output: plan }) }], defaultProvider: "fake" });
  const events: string[] = [];
  k.addEventSink((e) => events.push(e.type));
  k.addEventSink(onAiVideoEvent(k, home));
  k.setKv("aivideo.mode", "manual");
  k.createTask({ title: `${AI_SCRIPT_TITLE}: x`, prompt: "p", source: "internal" });
  while (await k.processNext()) {}
  assert.ok(events.includes("aivideo.manual"));
  assert.ok(!k.listTasks({ limit: 20 }).some((t) => t.provider === "media-gen"));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "clips-"));
  for (const [f, s] of [["a.mp4", 2], ["b.mp4", 1]] as const) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=blue:s=180x320:d=${s}`, "-f", "lavfi", "-i", `sine=d=${s}`, "-shortest", path.join(d, f)]);
  assert.match(await addManualClip(k, path.join(d, "a.mp4")), /1 از 2/);
  assert.match(await addManualClip(k, path.join(d, "b.mp4")), /چسبانده/);
  assert.ok(events.includes("aivideo.ready"));
  assert.equal(k.getKv("aivideo.manual.current"), null);

  // billing failure in auto mode → manual + episode continues manually
  k.setKv("aivideo.mode", "auto");
  const spec = { out: path.join(home, "ep2"), image1: "a", image2: "b", video: "v", title: "t", description: "d", tags: [] };
  k.registerProvider({ name: "media-gen", health: async () => ({ ok: true, detail: "" }), execute: async () => { throw new Error("Media API 402: prepayment credits depleted"); } });
  k.createTask({ title: "🎥", provider: "media-gen", source: "internal", maxAttempts: 1, prompt: `<<<MEDIA ${JSON.stringify(spec)} MEDIA>>>` });
  while (await k.processNext()) {}
  assert.equal(k.getKv("aivideo.mode"), "manual");
  assert.ok(k.getKv("aivideo.manual.current"));
});

test("long form: clip 2 starts from the real last frame of clip 1, no end frames, one image", { skip: !fs.existsSync("/usr/bin/ffmpeg") }, async () => {
  const { spawnSync } = await import("node:child_process");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "elias-long-"));
  const src = path.join(out, "src.mp4");
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=180x320:d=1", "-f", "lavfi", "-i", "sine=d=1", "-shortest", src]);
  const vid = fs.readFileSync(src).toString("base64");
  const png = Buffer.from("png").toString("base64");
  const bodies: any[] = [];
  let images = 0;
  const f = (async (url: string, init: RequestInit = {}) => {
    if (url.endsWith(":generateContent")) { images++; return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: "image/png" } }] } }] }); }
    if (url.endsWith(":predictLongRunning")) { bodies.push(JSON.parse(String(init.body))); return Response.json({ name: "op" }); }
    if (url.endsWith(":fetchPredictOperation")) return Response.json({ done: true, response: { videos: [{ bytesBase64Encoded: vid }] } });
    throw new Error("unexpected " + url);
  }) as unknown as typeof fetch;
  const p = new MediaGenProvider({ backend: () => ({ kind: "vertex", project: "p", token: async () => "t" }), fetchImpl: f, pollMs: 1 });
  const spec = { out, image1: "a", image2: "", video: "c1", video2: "c2", title: "t", description: "d", tags: [] };
  await p.execute({ taskId: "t", runId: "r", attempt: 1, signal: new AbortController().signal, prompt: `<<<MEDIA ${JSON.stringify(spec)} MEDIA>>>` });
  assert.equal(images, 1);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every((b) => !b.instances[0].lastFrame));
  assert.equal(bodies[1].instances[0].image.mimeType, "image/png");
  assert.notEqual(bodies[1].instances[0].image.bytesBase64Encoded, png); // real extracted frame, not the start image
  assert.deepEqual([bodies[0].parameters.durationSeconds, bodies[1].parameters.durationSeconds], [8, 6]);
  assert.ok(fs.existsSync(path.join(out, "video.mp4")));
});

test("Veo filter: prompt reworded once, then succeeds", async () => {
  const { safeVideoPrompt } = await import("../src/plugins/aivideo.ts");
  assert.doesNotMatch(safeVideoPrompt("Tiny figurines remain stylised 3D collectible-style; a LEGO train"), /figurine|collectible|lego/i);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "elias-flt-"));
  const png = Buffer.from("png").toString("base64");
  const prompts: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    if (url.endsWith(":generateContent")) return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: "image/png" } }] } }] });
    if (url.endsWith(":predictLongRunning")) { prompts.push(JSON.parse(String(init.body)).instances[0].prompt); return Response.json({ name: "op" + prompts.length }); }
    if (url.endsWith(":fetchPredictOperation")) {
      const op = JSON.parse(String(init.body)).operationName;
      return Response.json(op === "op1" ? { done: true, error: { message: "The prompt could not be submitted due to the interests of third-party content providers." } } : { done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from("V").toString("base64") }] } });
    }
    throw new Error(url);
  }) as unknown as typeof fetch;
  const p = new MediaGenProvider({ backend: () => ({ kind: "vertex", project: "p", token: async () => "t" }), fetchImpl: f, pollMs: 1 });
  const spec = { out, image1: "a", image2: "b", video: "toy figurines run", title: "t", description: "d", tags: [] };
  await p.execute({ taskId: "t", runId: "r", attempt: 1, signal: new AbortController().signal, prompt: `<<<MEDIA ${JSON.stringify(spec)} MEDIA>>>` });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /completely original/);
});

test("template style reference image is attached automatically", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-"));
  const d = path.join(home, "content", "templates");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "minirescue.md"), "rules");
  fs.writeFileSync(path.join(d, "minirescue.ref.jpg"), "x");
  const t = aiPlanTask(home, "");
  assert.match(t.prompt, /REFERENCE IMAGES/);
  assert.match(t.prompt, /minirescue\.ref\.jpg/);
});
