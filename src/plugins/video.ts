// Automatic YouTube Shorts: /short [topic] → AI script → local render (edge-tts + slides + ffmpeg)
// → preview in Telegram + approval → YouTube upload. Also schedulable: `elias short schedule --time 18:00`.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractJson } from "../kernel/verify.ts";
import type { Kernel } from "../kernel/kernel.ts";
import type { TaskInput } from "../kernel/types.ts";
import { ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest } from "../providers/types.ts";
import { cleanMeta, queueYoutubePublish } from "./youtube.ts";
import type { Plugin } from "./types.ts";

export const SCRIPT_TITLE = "🎬 اسکریپت شورت";
export const SHORT_SCHEDULE = "daily-short";
const MARK = /<<<RENDER\s*([\s\S]*?)\s*RENDER>>>/;

export interface Scene {
  text: string;
  say: string;
}

export function shortScriptTask(topic: string, hasMemory: boolean): TaskInput {
  return {
    title: `${SCRIPT_TITLE}: ${topic || "موضوع خودکار"}`.slice(0, 80),
    source: "internal",
    capabilities: hasMemory ? ["read:memory"] : [],
    context: hasMemory ? ["memory:notes"] : [],
    verify: { type: "json", requiredKeys: ["title", "scenes", "description", "tags"] },
    maxAttempts: 2,
    prompt: `Write a 10–16 second vertical YouTube Short in Persian for Elias's channel. The topic comes ONLY from the request — his channels cover many subjects; do not steer it to trading.
Topic: ${topic || "pick one practical, specific topic yourself that fits the channel and Elias's notes in the DATA (avoid generic ones)"}

Return ONLY JSON:
{"title": "max 70 chars, curiosity, no clickbait lies",
 "scenes": [{"text": "on-screen headline, max 7 words", "say": "spoken narration, 1–2 short natural sentences"}],
 "description": "2 short paragraphs + 3–5 hashtags",
 "tags": ["8–12 short tags, Persian and English"]}
Rules: exactly 3 scenes (hook → one key point → short call to follow); total narration 25–40 words, never more;
spoken, simple Persian; one clear lesson. If about trading, end the description with "آموزشی است، توصیه‌ی مالی نیست".
Never promise profit or give buy/sell signals.`,
  };
}

/** Validates the AI script into something the renderer can trust. */
export function parseScript(raw: string) {
  const j = JSON.parse(extractJson(raw)) as { title?: unknown; description?: unknown; tags?: unknown; scenes?: unknown };
  const scenes = (Array.isArray(j.scenes) ? j.scenes : [])
    .map((s) => ({ text: String((s as Scene)?.text ?? "").trim().slice(0, 80), say: String((s as Scene)?.say ?? "").trim().slice(0, 400) }))
    .filter((s) => s.text && s.say)
    .slice(0, 4);
  if (scenes.length < 2) throw new Error("script needs at least 2 scenes");
  return { ...cleanMeta(j), scenes };
}

function venvPython(home: string): string {
  return process.platform === "win32" ? path.join(home, "data", "video-venv", "Scripts", "python.exe") : path.join(home, "data", "video-venv", "bin", "python");
}

function fonts(home: string) {
  const dir = path.join(home, "data", "fonts");
  const pick = (name: string, fallback: string) => (fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : fallback);
  return { bold: pick("Vazirmatn-Black.ttf", "C:\\Windows\\Fonts\\tahomabd.ttf"), regular: pick("Vazirmatn-Regular.ttf", "C:\\Windows\\Fonts\\tahoma.ttf") };
}

export class VideoRenderProvider implements ExecutionProvider {
  readonly name = "video-render";
  private home: string;
  private python: string;
  constructor(home: string, python = venvPython(home)) {
    this.home = home;
    this.python = python;
  }

  private installed(): boolean {
    return !/[\\/]/.test(this.python) || fs.existsSync(this.python); // bare command (tests) or venv path
  }

  async health() {
    return this.installed() ? { ok: true, detail: "video venv ready" } : { ok: false, detail: "run setup/video-setup.cmd" };
  }

  execute(req: ExecutionRequest) {
    const m = req.prompt.match(MARK);
    if (!m) return Promise.reject(new ProviderUnavailableError("No render spec in task"));
    if (!this.installed()) return Promise.reject(new ProviderUnavailableError("Video tools not installed — run setup/video-setup.cmd"));
    const spec = JSON.parse(m[1]!) as { out: string; title: string; description: string; tags: string[] };
    fs.mkdirSync(spec.out, { recursive: true });
    const specFile = path.join(spec.out, "spec.json");
    fs.writeFileSync(specFile, JSON.stringify({ ...spec, fonts: fonts(this.home) }), "utf8");
    const script = path.join(this.home, "video", "make_short.py");
    return new Promise<{ output: string; meta: Record<string, unknown> }>((resolve, reject) => {
      const p = spawn(this.python, [script, specFile], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      const kill = () => p.kill();
      req.signal.addEventListener("abort", kill, { once: true });
      p.on("error", (e) => reject(e));
      p.on("close", (code) => {
        req.signal.removeEventListener("abort", kill);
        const line = out.trim().split(/\r?\n/).pop() ?? "";
        if (code !== 0 || !line.startsWith("{")) return reject(new Error(`render failed (${code}): ${err.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400)}`));
        const r = JSON.parse(line) as { video: string; seconds: number };
        resolve({
          output: JSON.stringify({ ...r, title: spec.title, description: spec.description, tags: spec.tags }),
          meta: { provider: "video-render" },
        });
      });
    });
  }
}

function slug(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function onVideoEvent(k: Kernel, home: string, brand: string, voice: string) {
  return (e: { type: string; taskId: string | null }) => {
    if (e.type !== "task.succeeded" || !e.taskId) return;
    const t = k.getTask(e.taskId);
    if (!t) return;
    try {
      if (t.title.startsWith(SCRIPT_TITLE)) {
        const s = parseScript(t.result ?? "");
        const spec = { out: path.join(home, "content", "shorts", slug()), voice, brand, ...s };
        k.createTask({
          title: `🎞 ساخت ویدیو: ${s.title}`.slice(0, 80),
          provider: "video-render",
          source: "internal",
          parentId: t.id,
          maxAttempts: 2,
          timeoutMs: 20 * 60_000,
          verify: { type: "contains", text: "short.mp4" },
          prompt: `<<<RENDER ${JSON.stringify(spec)} RENDER>>>`,
        });
      } else if (t.provider === "video-render") {
        const r = JSON.parse(t.result ?? "{}") as { video: string; title: string; description: string; tags: string[] };
        const title = /#shorts/i.test(r.title) ? r.title : `${r.title} #Shorts`.slice(0, 100);
        queueYoutubePublish(k, { file: r.video, title, description: r.description, tags: r.tags }, t.id);
      }
    } catch (err) {
      k.log("video.failed", `${t.title}: ${(err as Error).message}`, { level: "error", taskId: t.id });
    }
  };
}

/** Prompt queue: one prompt per line in content/shorts/prompts.txt ("#" = comment). Takes and removes the first. */
export function popPrompt(home: string): string {
  const file = path.join(home, "content", "shorts", "prompts.txt");
  if (!fs.existsSync(file)) return "";
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"));
  if (i < 0) return "";
  const [p] = lines.splice(i, 1);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return p!.trim();
}

export function queuedPrompts(home: string): string[] {
  const file = path.join(home, "content", "shorts", "prompts.txt");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
}

/** The daily schedule runs this tiny task: it takes the next queued prompt (or lets the AI pick) and starts a Short. */
export const QUEUE_TASK: TaskInput = { title: "🎬 شورت روزانه", prompt: "next", provider: "short-queue", source: "internal", verify: { type: "non_empty" }, maxAttempts: 1 };

export const videoPlugin: Plugin = {
  name: "video",
  description: "Automatic YouTube Shorts: /short [topic] → script → render → approval → upload",
  setup({ kernel, home, options }) {
    const brand = String(options.brand ?? "");
    const voice = String(options.voice ?? "fa-IR-FaridNeural");
    kernel.registerProvider(new VideoRenderProvider(home));
    kernel.registerProvider({
      name: "short-queue",
      health: async () => ({ ok: true, detail: `${queuedPrompts(home).length} prompts queued` }),
      execute: async () => {
        const p = popPrompt(home);
        const t = kernel.createTask(shortScriptTask(p, hasMemory()));
        return { output: `started ${t.id}: ${p || "(auto topic)"}` };
      },
    });
    const hasMemory = () => kernel.listContextSources().some((c) => c.name === "memory:notes");
    kernel.registerCommand({
      name: "short",
      description: "یوتیوب شورت خودکار (/short پرامپت · /short add پرامپت · /short list)",
      plugin: "video",
      run(args) {
        const a = args.trim();
        if (a === "list") {
          const q = queuedPrompts(home);
          return q.length ? `📝 صف پرامپت‌ها (${q.length}):\n${q.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : `صف خالی است. هر خط یک پرامپت در:\n${path.join(home, "content", "shorts", "prompts.txt")}`;
        }
        if (a.startsWith("add ")) {
          const file = path.join(home, "content", "shorts", "prompts.txt");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.appendFileSync(file, `\n${a.slice(4).replace(/\s+/g, " ").trim()}`, "utf8");
          return `➕ به صف اضافه شد (${queuedPrompts(home).length} در صف)`;
        }
        const topic = a || popPrompt(home);
        kernel.createTask(shortScriptTask(topic, hasMemory()));
        return "🎬 شروع شد: اسکریپت ← صداگذاری و ساخت ویدیو ← پیش‌نمایش برای تأیید. چند دقیقه طول می‌کشد.";
      },
    });
    kernel.addEventSink(onVideoEvent(kernel, home, brand, voice));
  },
};
