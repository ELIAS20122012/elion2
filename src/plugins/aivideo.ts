// AI-generated videos (Gemini image + Veo 3.1) from prompt templates in content/templates/*.md.
// /ai <template|idea> → AI writes image/video prompts → paid generation (once, never auto-retried)
// → preview in Telegram + approval → YouTube upload. Key: secrets.json → media.apiKey (billing-enabled project).
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { extractJson } from "../kernel/verify.ts";
import type { Kernel } from "../kernel/kernel.ts";
import { ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest } from "../providers/types.ts";
import { cleanMeta, queueYoutubePublish } from "./youtube.ts";
import { GoogleAuth } from "../connectors/google.ts";

export const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
import type { Plugin } from "./types.ts";

export const AI_SCRIPT_TITLE = "🎨 پرامپت ویدیو AI";
const MARK = /<<<MEDIA\s*([\s\S]*?)\s*MEDIA>>>/;
const API = "https://generativelanguage.googleapis.com/v1beta";

export interface MediaSpec {
  out: string;
  image1: string;
  image2: string;
  video: string;
  title: string;
  description: string;
  tags: string[];
  /** Optional 3rd frame + 2nd clip → two Veo clips joined (8 s + 6 s = 14 s). */
  image3?: string;
  video2?: string;
  /** Reference images (style / world / characters) Elias sent with the request. */
  refs?: string[];
}

/** `/ai` args may start with `<<refs:["C:/…/a.jpg",…]>>` (added by Telegram when photos come with the prompt). */
export function splitRefs(arg: string): { refs: string[]; rest: string } {
  const m = arg.match(/^\s*<<refs:(\[[\s\S]*?\])>>\s*/);
  if (!m) return { refs: [], rest: arg };
  try {
    const refs = (JSON.parse(m[1]!) as unknown[]).map(String).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).slice(0, 3);
    return { refs, rest: arg.slice(m[0].length) };
  } catch {
    return { refs: [], rest: arg.slice(m[0].length) };
  }
}

/** Telegram caption that asks for a video (not a question about the image). */
export function isVideoRequest(caption: string): boolean {
  const c = caption.trim();
  if (/^\/ai\b/i.test(c)) return true;
  return /video|ویدیو|ویدئو|کلیپ|shorts|reels|veo|9:16|tilt-shift|episode/i.test(c) && (c.length > 120 || /بساز|درست کن|make|create|generate/i.test(c));
}

export function templatesDir(home: string) {
  return path.join(home, "content", "templates");
}

export function listTemplates(home: string): string[] {
  const d = templatesDir(home);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : [];
}

/** The planning task: turns a template (or a free idea) into the 3 prompts + YouTube metadata, choosing every option itself. */
export const DEFAULT_TEMPLATE = "minirescue";

export function aiPlanTask(home: string, rawArg: string, history: string[] = []) {
  const { refs: given, rest: arg } = splitRefs(rawArg);
  const refs = [...given];
  const [first = "", ...rest] = arg.trim().split(/\s+/);
  const tpls = listTemplates(home);
  // no template named → the default series (Mini Rescue), unless photos + a full brief were sent
  const tpl = tpls.includes(first) ? first : !given.length && tpls.includes(DEFAULT_TEMPLATE) ? DEFAULT_TEMPLATE : "";
  const extra = (tpl && tpl === first ? rest.join(" ") : arg).trim();
  const template = tpl ? fs.readFileSync(path.join(templatesDir(home), `${tpl}.md`), "utf8").slice(0, 12_000) : "";
  const longForm = /\bvideo2\b/.test(template);
  // a template may carry its own style reference image: content/templates/<name>.ref.(jpg|png)
  if (tpl && !refs.length) {
    for (const ext of ["jpg", "png", "webp"]) {
      const f = path.join(templatesDir(home), `${tpl}.ref.${ext}`);
      if (fs.existsSync(f)) refs.push(f);
    }
  }
  return {
    title: `${AI_SCRIPT_TITLE}: ${tpl || extra || "ایده‌ی خودکار"}`.slice(0, 80),
    source: "internal",
    verify: { type: "json" as const, requiredKeys: ["image1", "video", "title", "description", "tags", ...(longForm ? ["video2"] : ["image2"])] },
    maxAttempts: 2,
    prompt: `You plan ONE short vertical AI video (9:16, ${longForm ? "14 seconds = one start image, then two continuous Veo 3.1 clips (8 s + 6 s; clip 2 continues from the last frame of clip 1)" : "8 seconds, made with an image model + Veo 3.1 first/last-frame interpolation"}).
${template ? `Follow this TEMPLATE. It was written for an interactive chat: do NOT ask questions — make every choice yourself (pick a fresh, specific option; vary from obvious defaults) and produce its final prompts.\n<template>\n${template}\n</template>\n` : ""}
${extra ? `Elias's request / choices (it may be a full "agent" brief with rules and a story formula — follow its rules, style and story formula exactly; ignore any parts that ask questions or talk about other tools):\n<request>\n${extra.slice(0, 12_000)}\n</request>` : template ? "" : "Pick a visually striking idea that fits a Persian channel about trading, AI and tech."}
${history.length ? `Recent episodes — do NOT repeat these scenarios, pick a clearly different one:\n${history.map((h) => "- " + h).join("\n")}\n` : ""}
${refs.length ? `REFERENCE IMAGES (open them with your file tools and study them): ${refs.map((r) => "`" + r + "`").join(", ")}.
They are also given to the image model as visual references, so image1 must describe a NEW scene in exactly that look: same world, art direction, materials, lighting, lens/tilt-shift feel and character types. Describe concrete visual details you see in them.` : ""}

Return ONLY JSON:
${longForm ? `{"image1": "English prompt for the FIRST frame (the problem). Vertical 9:16 composition.",
 "video": "English Veo prompt for clip 1 (8 s, starts from image1): motion + sound. Must END mid-rescue — problem NOT yet solved.",
 "video2": "English Veo prompt for clip 2 (6 s, continues from the exact last frame of clip 1): the fix completes, hand exits, celebration.",
` : `{"image1": "English prompt for the FIRST frame (the start state). Vertical 9:16 composition.",
 "image2": "English edit instruction applied to image1 → the LAST frame (end state), same style, camera and characters.",
 "video": "English Veo prompt: what happens between image1 and image2 (8 seconds): motion + sound.",
`}
 "title": "Persian YouTube Shorts title, max 70 chars",
 "description": "Persian, 2 short lines + 3–5 hashtags",
 "tags": ["8–12 tags, Persian and English"]}
No text/logos inside the images. No real people, brands or copyrighted characters.`,
  };
}

export function parsePlan(raw: string) {
  const j = JSON.parse(extractJson(raw)) as Record<string, unknown>;
  const need = (k: string) => {
    const v = String(j[k] ?? "").trim();
    if (!v) throw new Error(`plan is missing ${k}`);
    return v.slice(0, 4000);
  };
  const opt = (k: string) => (String(j[k] ?? "").trim() ? { [k]: String(j[k]).trim().slice(0, 4000) } : {});
  const long = !!String(j.video2 ?? "").trim();
  return { image1: need("image1"), image2: long ? String(j.image2 ?? "").trim() : need("image2"), video: need("video"), ...opt("image3"), ...opt("video2"), ...cleanMeta(j) } as {
    image1: string; image2: string; video: string; image3?: string; video2?: string; title: string; description: string; tags: string[];
  };
}

/** Refs travel from the plan task title-less prompt to the media spec. */
export function refsOfPlan(prompt: string): string[] {
  const m = prompt.match(/REFERENCE IMAGES \(open them with your file tools and study them\): (.+?)\.\n/);
  return m ? [...m[1]!.matchAll(/`([^`]+)`/g)].map((x) => x[1]!) : [];
}

type Fetch = typeof fetch;

/** Where the paid calls go: Vertex AI (Google Cloud billing / trial credit, OAuth) or the Gemini API (AI Studio prepay key). */
export type MediaBackend =
  | { kind: "vertex"; token: (signal: AbortSignal) => Promise<string>; project: string; location?: string }
  | { kind: "gemini"; key: () => string | null };

type Img = { data: string; mimeType: string };

export class MediaGenProvider implements ExecutionProvider {
  readonly name = "media-gen";
  private backend: () => MediaBackend | null;
  private fetchImpl: Fetch;
  private imageModel: string;
  private videoModel: string;
  private pollMs: number;
  constructor(o: { backend: () => MediaBackend | null; imageModel?: string; videoModel?: string; fetchImpl?: Fetch; pollMs?: number }) {
    this.backend = o.backend;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.imageModel = o.imageModel ?? "gemini-2.5-flash-image";
    this.videoModel = o.videoModel ?? "veo-3.1-fast-generate-001";
    this.pollMs = o.pollMs ?? 10_000;
  }

  async health() {
    const b = this.backend();
    return b ? { ok: true, detail: `${b.kind}: ${this.imageModel} + ${this.videoModel}` } : { ok: false, detail: "no backend — run google-setup.cmd (Vertex) or media-key.cmd" };
  }

  private base(b: MediaBackend, model: string) {
    if (b.kind === "gemini") return `${API}/models/${model}`;
    const loc = b.location ?? "us-central1";
    return `https://${loc}-aiplatform.googleapis.com/v1/projects/${b.project}/locations/${loc}/publishers/google/models/${model}`;
  }

  private async call(b: MediaBackend, url: string, init: RequestInit, signal: AbortSignal): Promise<any> {
    const auth: Record<string, string> =
      b.kind === "gemini" ? { "x-goog-api-key": b.key()! } : { authorization: `Bearer ${await b.token(signal)}`, "x-goog-user-project": b.project };
    const res = await this.fetchImpl(url, { ...init, signal, headers: { "content-type": "application/json", ...auth, ...(init.headers ?? {}) } });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg = String(j.error?.message ?? res.status);
      if ([400, 401, 402, 403, 404].includes(res.status)) throw new ProviderUnavailableError(`Media API ${res.status}: ${msg.slice(0, 300)}`);
      throw new Error(`Media API ${res.status}: ${msg.slice(0, 300)}`); // 429/5xx: fail, never requeue (paid)
    }
    return j;
  }

  /** Gemini image model: text (+ optional input image) → image bytes. */
  async image(b: MediaBackend, prompt: string, signal: AbortSignal, input?: Img | Img[]): Promise<Img> {
    const parts: unknown[] = [{ text: prompt }];
    for (const i of Array.isArray(input) ? input : input ? [input] : []) parts.push({ inlineData: i });
    const j = await this.call(b, `${this.base(b, this.imageModel)}:generateContent`, {
      method: "POST",
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } }),
    }, signal);
    const img = (j.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data)?.inlineData;
    if (!img) throw new Error(`no image returned (${j.candidates?.[0]?.finishReason ?? j.promptFeedback?.blockReason ?? "unknown"})`);
    return img as Img;
  }

  /** Veo with one automatic re-word when the content filter rejects the prompt (rejected prompts are not generated). */
  private async veoSafe(b: MediaBackend, prompt: string, first: Img, last: Img | null, signal: AbortSignal, seconds = 8): Promise<Buffer> {
    try {
      return await this.veo(b, prompt, first, last, signal, seconds);
    } catch (e) {
      if (!VEO_FILTER_RE.test(String((e as Error).message))) throw e;
      return this.veo(b, safeVideoPrompt(prompt), first, last, signal, seconds);
    }
  }

  private async veo(b: MediaBackend, prompt: string, first: Img, last: Img | null, signal: AbortSignal, seconds = 8): Promise<Buffer> {
    const url = `${this.base(b, this.videoModel)}:predictLongRunning`;
    const body = (img: (x: Img) => unknown) =>
      JSON.stringify({
        instances: [{ prompt, image: img(first), ...(last ? { lastFrame: img(last) } : {}) }],
        parameters: { aspectRatio: "9:16", durationSeconds: seconds, resolution: "720p", generateAudio: true, sampleCount: 1 },
      });
    let op;
    try {
      op = await this.call(b, url, { method: "POST", body: body((x) => ({ bytesBase64Encoded: x.data, mimeType: x.mimeType })) }, signal);
    } catch (e) {
      // The Gemini API REST shape may differ — retry once with inlineData.
      if (b.kind !== "gemini" || !/bytesBase64Encoded|Unknown name|Invalid JSON payload/i.test(String(e))) throw e;
      op = await this.call(b, url, { method: "POST", body: body((x) => ({ inlineData: { mimeType: x.mimeType, data: x.data } })) }, signal);
    }
    let done = op;
    while (!done.done) {
      await new Promise((r, rej) => {
        const t = setTimeout(r, this.pollMs);
        signal.addEventListener("abort", () => (clearTimeout(t), rej(new Error("aborted"))), { once: true });
      });
      done =
        b.kind === "gemini"
          ? await this.call(b, `${API}/${op.name}`, { method: "GET" }, signal)
          : await this.call(b, `${this.base(b, this.videoModel)}:fetchPredictOperation`, { method: "POST", body: JSON.stringify({ operationName: op.name }) }, signal);
    }
    if (done.error) throw new Error(`Veo failed: ${done.error.message ?? JSON.stringify(done.error)}`);
    const v = done.response?.videos?.[0];
    if (v?.bytesBase64Encoded) return Buffer.from(v.bytesBase64Encoded, "base64");
    const uri = done.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error(`Veo returned no video (filtered: ${JSON.stringify(done.response?.raiMediaFilteredReasons ?? done.response?.generateVideoResponse?.raiMediaFilteredReasons ?? "?")})`);
    const vid = await this.fetchImpl(uri, { headers: b.kind === "gemini" ? { "x-goog-api-key": b.key()! } : {}, signal, redirect: "follow" });
    if (!vid.ok) throw new Error(`video download ${vid.status}`);
    return Buffer.from(await vid.arrayBuffer());
  }

  async execute(req: ExecutionRequest) {
    const m = req.prompt.match(MARK);
    if (!m) throw new ProviderUnavailableError("No media spec in task");
    const b = this.backend();
    if (!b) throw new ProviderUnavailableError("No media backend — run google-setup.cmd again (Vertex AI)");
    const spec = JSON.parse(m[1]!) as MediaSpec;
    fs.mkdirSync(spec.out, { recursive: true });
    const refs: Img[] = (spec.refs ?? [])
      .filter((f) => fs.existsSync(f))
      .map((f) => ({ data: fs.readFileSync(f).toString("base64"), mimeType: /\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg" }));
    const first = await this.image(
      b,
      refs.length
        ? `Create a NEW image in exactly the same visual style, world, materials, lighting, camera/tilt-shift look and character design as the attached reference image(s) — not a copy of them, a new scene:\n${spec.image1}`
        : spec.image1,
      req.signal,
      refs,
    );
    fs.writeFileSync(path.join(spec.out, "frame1.png"), Buffer.from(first.data, "base64"));
    const last = spec.video2 ? first : await this.image(b, spec.image2, req.signal, first);
    if (!spec.video2) fs.writeFileSync(path.join(spec.out, "frame2.png"), Buffer.from(last.data, "base64"));
    const file = path.join(spec.out, "video.mp4");
    if (spec.video2) {
      // continuity: clip 2 starts from the REAL last frame of clip 1 (no forced end frames → no jumps/repeats)
      const c1 = path.join(spec.out, "clip1.mp4");
      const c2 = path.join(spec.out, "clip2.mp4");
      fs.writeFileSync(c1, await this.veoSafe(b, spec.video, first, null, req.signal, 8));
      const lastPng = path.join(spec.out, "clip1-last.png");
      lastFrame(c1, lastPng);
      const cont: Img = { data: fs.readFileSync(lastPng).toString("base64"), mimeType: "image/png" };
      fs.writeFileSync(c2, await this.veoSafe(b, spec.video2, cont, null, req.signal, 6));
      await joinClips([c1, c2], file);
    } else {
      fs.writeFileSync(file, await this.veoSafe(b, spec.video, first, last, req.signal));
    }
    return { output: JSON.stringify({ video: file, title: spec.title, description: spec.description, tags: spec.tags }), meta: { provider: `media-gen/${b.kind}` } };
  }
}

/** Veo's content filter ("third-party content providers") — the prompt was not billed; reword and try once more. */
export const VEO_FILTER_RE = /third-party content|could not be submitted|usage guidelines|violat|sensitive words|responsible ai/i;

/** Removes words that make Veo think of existing toys/brands/characters and stresses originality. */
export function safeVideoPrompt(p: string): string {
  const cleaned = p
    .replace(/\b(collectible|collector|toy|toys|figurines?|action figures?|lego|playmobil|funko|pixar|disney|thomas|minion\w*|barbie|nintendo|mario|pokemon)\b(-style)?/gi, (m) =>
      /figurine/i.test(m) ? "tiny characters" : "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/ ,/g, ",");
  return `${cleaned}\nAll characters, objects and places are completely original and generic (no existing brands, toys, films or characters).`;
}

/** Last frame of a clip as PNG (ffmpeg). */
export function lastFrame(clip: string, out: string, ffmpeg = process.env.ELIAS_FFMPEG || "ffmpeg"): void {
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-sseof", "-0.2", "-i", clip, "-frames:v", "1", "-update", "1", out], { windowsHide: true, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`ffmpeg last frame failed: ${(r.stderr || r.error?.message || "").slice(-300)}`);
}

/** ffmpeg concat (re-encode; with audio, falling back to video-only if a clip has no audio track). */
export async function joinClips(clips: string[], out: string, ffmpeg = process.env.ELIAS_FFMPEG || "ffmpeg"): Promise<void> {
  const inputs = clips.flatMap((c) => ["-i", c]);
  const n = clips.length;
  const withAudio = clips.map((_, i) => `[${i}:v][${i}:a]`).join("") + `concat=n=${n}:v=1:a=1[v][a]`;
  const videoOnly = clips.map((_, i) => `[${i}:v]`).join("") + `concat=n=${n}:v=1:a=0[v]`;
  const run = (filter: string, maps: string[]) =>
    spawnSync(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, ...maps, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "18", ...(maps.includes("[a]") ? ["-c:a", "aac", "-b:a", "160k"] : []), out], { windowsHide: true, encoding: "utf8", timeout: 300_000 });
  let r = run(withAudio, ["-map", "[v]", "-map", "[a]"]);
  if (r.status !== 0) r = run(videoOnly, ["-map", "[v]"]);
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`ffmpeg join failed: ${(r.stderr || r.error?.message || "").slice(-300)}`);
}

/** Billing / credit errors → the free trial credit is used up (switch to manual mode). */
export const BILLING_RE = /\b402\b|billing|credit|prepay|free trial|BILLING_DISABLED|payment/i;

export interface ManualJob {
  out: string;
  title: string;
  description: string;
  tags: string[];
  need: number;
  clips: string[];
}

/** Manual mode: Elias makes the images/clips in the Gemini app / Flow (his subscription); Elias OS joins + delivers. */
export function startManual(k: Kernel, spec: MediaSpec): void {
  fs.mkdirSync(spec.out, { recursive: true });
  fs.writeFileSync(path.join(spec.out, "prompts.json"), JSON.stringify(spec, null, 2), "utf8");
  const job: ManualJob = { out: spec.out, title: spec.title, description: spec.description, tags: spec.tags, need: spec.video2 ? 2 : 1, clips: [] };
  k.setKv("aivideo.manual.current", JSON.stringify(job));
  k.log("aivideo.manual", `manual episode: ${spec.title}`, { data: { spec } });
}

/** A clip Elias sent back. Returns the reply text; joins + delivers when all clips are in (or force). */
export async function addManualClip(k: Kernel, file: string | null, force = false): Promise<string> {
  const raw = k.getKv("aivideo.manual.current");
  if (!raw) return "قسمت دستی در انتظاری نیست. /ai";
  const job = JSON.parse(raw) as ManualJob;
  if (file) {
    const dest = path.join(job.out, `clip${job.clips.length + 1}${path.extname(file) || ".mp4"}`);
    fs.copyFileSync(file, dest);
    job.clips.push(dest);
    k.setKv("aivideo.manual.current", JSON.stringify(job));
  }
  if (!job.clips.length) return "هنوز کلیپی نفرستادی.";
  if (job.clips.length < job.need && !force) return `🎬 کلیپ ${job.clips.length} از ${job.need} رسید. کلیپ بعدی را بفرست (یا /ai done اگر همین کافی است).`;
  const out = path.join(job.out, "video.mp4");
  if (job.clips.length === 1) fs.copyFileSync(job.clips[0]!, out);
  else await joinClips(job.clips, out);
  k.db.prepare("DELETE FROM kv WHERE key=?").run("aivideo.manual.current");
  const title = /#shorts/i.test(job.title) ? job.title : `${job.title} #Shorts`.slice(0, 100);
  k.log("aivideo.ready", `ready: ${job.title}`, { data: { file: out, title, description: job.description, tags: job.tags } });
  return "✅ کلیپ‌ها چسبانده شد؛ ویدیوی نهایی الان می‌آید.";
}

function stamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

export function onAiVideoEvent(k: Kernel, home: string) {
  return (e: { type: string; taskId: string | null }) => {
    if (!e.taskId) return;
    if (e.type === "task.failed") {
      const t = k.getTask(e.taskId);
      if (t?.provider !== "media-gen" || t.status !== "failed" || !BILLING_RE.test(t.error ?? "")) return;
      // the Google credit is used up → manual mode from now on; today's episode continues manually
      k.setKv("aivideo.mode", "manual");
      k.log("aivideo.mode", "media generation billing error → manual mode", { level: "warn", taskId: t.id });
      const m = t.prompt.match(MARK);
      if (m) startManual(k, JSON.parse(m[1]!) as MediaSpec);
      return;
    }
    if (e.type !== "task.succeeded") return;
    const t = k.getTask(e.taskId);
    if (!t) return;
    try {
      if (t.title.startsWith(AI_SCRIPT_TITLE)) {
        const p = parsePlan(t.result ?? "");
        const hist = JSON.parse(k.getKv("aivideo.history") ?? "[]") as string[];
        k.setKv("aivideo.history", JSON.stringify([p.title, ...hist].slice(0, 15)));
        const refs = refsOfPlan(t.prompt);
        const spec: MediaSpec = { out: path.join(home, "content", "ai-videos", stamp()), ...p, ...(refs.length ? { refs } : {}) };
        if ((k.getKv("aivideo.mode") ?? "auto") === "manual") return startManual(k, spec);
        fs.mkdirSync(spec.out, { recursive: true });
        fs.writeFileSync(path.join(spec.out, "prompts.json"), JSON.stringify(spec, null, 2), "utf8");
        k.createTask({
          title: `🎥 ساخت ویدیو AI: ${p.title}`.slice(0, 80),
          provider: "media-gen",
          source: "internal",
          parentId: t.id,
          maxAttempts: 1, // paid: never retry automatically
          timeoutMs: 20 * 60_000,
          verify: { type: "contains", text: "video.mp4" },
          prompt: `<<<MEDIA ${JSON.stringify(spec)} MEDIA>>>`,
        });
      } else if (t.provider === "media-gen") {
        const r = JSON.parse(t.result ?? "{}") as { video: string; title: string; description: string; tags: string[] };
        const title = /#shorts/i.test(r.title) ? r.title : `${r.title} #Shorts`.slice(0, 100);
        if ((k.getKv("aivideo.publish") ?? "manual") === "manual") {
          // Elias uploads himself for now: the video + ready-to-copy title/description/tags go to Telegram
          k.log("aivideo.ready", `ready: ${r.title}`, { taskId: t.id, data: { file: r.video, title, description: r.description, tags: r.tags } });
        } else queueYoutubePublish(k, { file: r.video, title, description: r.description, tags: r.tags }, t.id);
      }
    } catch (err) {
      k.log("aivideo.failed", `${t.title}: ${(err as Error).message}`, { level: "error", taskId: t.id });
    }
  };
}

export const aiVideoPlugin: Plugin = {
  name: "aivideo",
  description: "AI videos (Gemini image + Veo 3.1) from content/templates — /ai",
  setup({ kernel, home, options }) {
    const keyFile = path.join(home, "config", "secrets.json");
    const key = () => {
      try {
        const s = JSON.parse(fs.readFileSync(keyFile, "utf8").replace(/^﻿/, "")) as { media?: { apiKey?: string } };
        return s.media?.apiKey?.trim() || null;
      } catch {
        return null;
      }
    };
    const google = new GoogleAuth(path.join(home, "config"));
    const backend = (): MediaBackend | null => {
      const want = String(options.backend ?? "auto");
      if (want !== "gemini" && google.hasScope(CLOUD_SCOPE)) {
        const project = String(options.project ?? google.projectId() ?? "");
        if (project) return { kind: "vertex", project, location: options.location as string | undefined, token: (s) => google.accessToken(s) };
      }
      const k = key();
      return want !== "vertex" && k ? { kind: "gemini", key: () => k } : null;
    };
    kernel.registerProvider(new MediaGenProvider({ backend, imageModel: options.imageModel as string | undefined, videoModel: options.videoModel as string | undefined }));
    kernel.registerCommand({
      name: "ai",
      description: "ویدیوی هوش مصنوعی (/ai قالب یا ایده)",
      plugin: "aivideo",
      run(args) {
        const tpls = listTemplates(home);
        const a = args.trim();
        const hist = () => JSON.parse(kernel.getKv("aivideo.history") ?? "[]") as string[];
        if (a === "ideas" || a === "ایده") {
          kernel.createTask({
            title: "🦾 ایده‌های Mini Rescue",
            source: "telegram",
            verify: { type: "non_empty" },
            prompt: `Give exactly 10 fresh "Mini Rescue" scenarios (tiny figurine people face a dramatic problem → a giant real human hand fixes it with ONE simple real-world object). Format, one per line: "N. [different emoji] [Tiny people struggle] → [Giant hand fix]", max 8 words each, all unique${hist().length ? `, none like these recent ones: ${hist().join(" | ")}` : ""}. Write them in Persian. Then one line: «برای ساخت: /ai شماره یا متن ایده» and for each idea add a line \`>>> /ai <that idea in Persian>\`.`,
          });
          return "🦾 دارم ۱۰ ایده می‌سازم…";
        }
        const daily = a.match(/^daily\s*(off|\d{1,2}(?::\d{2})?)?$/i);
        if (daily) {
          const arg = daily[1]?.toLowerCase();
          if (arg === "off") {
            if (kernel.getSchedule("ai-daily")) kernel.removeSchedule("ai-daily");
            return "🛑 ساخت روزانه خاموش شد.";
          }
          const [h, m = "0"] = (arg ?? "10:00").split(":");
          if (kernel.getSchedule("ai-daily")) kernel.removeSchedule("ai-daily");
          kernel.addSchedule("ai-daily", `${Number(m)} ${Number(h)} * * *`, { title: "🦾 Mini Rescue روزانه", prompt: "daily", provider: "ai-daily", source: "internal", verify: { type: "non_empty" }, maxAttempts: 1 });
          return `🗓 هر روز ساعت ${h}:${m.padStart(2, "0")} یک ویدیوی Mini Rescue ساخته و در تلگرام فرستاده می‌شود. خاموش: /ai daily off`;
        }
        const mode = a.match(/^mode\s*(auto|manual)?$/i);
        if (mode) {
          if (mode[1]) kernel.setKv("aivideo.mode", mode[1].toLowerCase());
          const cur = kernel.getKv("aivideo.mode") ?? "auto";
          return cur === "manual"
            ? "✋ حالت دستی: Elias OS پرامپت‌ها را می‌فرستد، تو در Gemini/Flow می‌سازی و کلیپ‌ها را این‌جا می‌فرستی (بدون هزینه). خودکار: /ai mode auto"
            : "🤖 حالت خودکار: تصویر و ویدیو با Vertex (اعتبار Google Cloud). دستی: /ai mode manual";
        }
        if (a === "done") return addManualClip(kernel, null, true);
        const pub = a.match(/^publish\s+(manual|youtube)$/i);
        if (pub) {
          kernel.setKv("aivideo.publish", pub[1]!.toLowerCase());
          return pub[1]!.toLowerCase() === "manual" ? "📥 ویدیوها فقط در تلگرام فرستاده می‌شوند (خودت آپلود می‌کنی)." : "📤 ویدیوها با تأیید تو در یوتیوب منتشر می‌شوند.";
        }
        if (a === "help") {
          return `🎨 قالب‌ها: ${tpls.length ? tpls.join("، ") : "(خالی)"}\nاستفاده: /ai — یک قسمت تازه · /ai ایده · /ai ideas — ۱۰ ایده · /ai daily 10:00|off · /ai publish manual|youtube\nقالب جدید: یک فایل .md در ${templatesDir(home)}`;
        }
        const manual = (kernel.getKv("aivideo.mode") ?? "auto") === "manual";
        if (!manual && !backend()) return "اتصال به Vertex AI آماده نیست — google-setup.cmd را دوباره اجرا کن (یا /ai mode manual).";
        const n = splitRefs(args).refs.length;
        if (manual) {
          kernel.createTask(aiPlanTask(home, args, hist()));
          return "✋ حالت دستی: دارم ایده و پرامپت‌ها را می‌نویسم؛ چند دقیقه‌ی دیگر مرحله‌به‌مرحله این‌جا می‌آید.";
        }
        kernel.createTask(aiPlanTask(home, args, hist()));
        return `🎨 شروع شد${n ? ` با ${n} عکس مرجع` : ""}: پرامپت‌ها ← ساخت تصویر${n ? " به سبک عکس‌ها" : ""} ← ویدیو ۱۴ ثانیه‌ای با Veo (چند دقیقه) ← پیش‌نمایش برای تأیید.`;
      },
    });
    // daily episode: the schedule fires this provider, which queues a plan with the current history
    kernel.registerProvider({
      name: "ai-daily",
      health: async () => ({ ok: true, detail: "built-in" }),
      execute: async () => {
        if ((kernel.getKv("aivideo.mode") ?? "auto") !== "manual" && !backend()) throw new ProviderUnavailableError("no media backend");
        const t = kernel.createTask(aiPlanTask(home, "", JSON.parse(kernel.getKv("aivideo.history") ?? "[]") as string[]));
        return { output: `queued ${t.id}` };
      },
    });
    // Elias asked for one episode per day (2026-10-04) — created once; "/ai daily off" stays off.
    if (!kernel.getKv("aivideo.daily.init")) {
      kernel.setKv("aivideo.daily.init", "1");
      if (!kernel.getSchedule("ai-daily")) kernel.addSchedule("ai-daily", String(options.dailyCron ?? "0 10 * * *"), { title: "🦾 Mini Rescue روزانه", prompt: "daily", provider: "ai-daily", source: "internal", verify: { type: "non_empty" }, maxAttempts: 1 });
    }
    kernel.registerCommand({
      name: "aiclip",
      description: "کلیپ ساخته‌شده در Gemini/Flow برای قسمت دستی (تلگرام خودکار صدا می‌زند)",
      plugin: "aivideo",
      run: (file) => addManualClip(kernel, file.trim() || null),
    });
    kernel.addEventSink(onAiVideoEvent(kernel, home));
  },
};
