// YouTube publishing: /yt <file> → AI writes title/description/tags → approval (publish:youtube) → resumable upload.
// Videos live in <home>/content/youtube/. Uploads never retry automatically (no duplicate videos).
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { GoogleAuth } from "../connectors/google.ts";
import { extractJson } from "../kernel/verify.ts";
import { ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest } from "../providers/types.ts";
import type { Plugin } from "./types.ts";
import type { Kernel } from "../kernel/kernel.ts";

export const YT_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const MARK = /<<<UPLOAD\s*([\s\S]*?)\s*UPLOAD>>>/;

export interface UploadSpec {
  file: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "public" | "unlisted" | "private";
}

export function uploadPrompt(u: UploadSpec): string {
  return [
    `🎬 ${u.title}`,
    `فایل: ${path.basename(u.file)} · ${u.privacy}`,
    `تگ‌ها: ${u.tags.join("، ")}`,
    "",
    u.description.slice(0, 400),
    "",
    `<<<UPLOAD ${JSON.stringify(u)} UPLOAD>>>`,
  ].join("\n");
}

export function parseUpload(prompt: string): UploadSpec {
  const m = prompt.match(MARK);
  if (!m) throw new ProviderUnavailableError("No upload spec in task");
  return JSON.parse(m[1]!) as UploadSpec;
}

/** Clamp metadata to YouTube limits (title 100, description 5000, tags 500 chars total, no < >). */
export function cleanMeta(raw: { title?: unknown; description?: unknown; tags?: unknown }) {
  const strip = (s: unknown) => String(s ?? "").replace(/[<>]/g, "").trim();
  const tags: string[] = [];
  let len = 0;
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    const v = strip(t).replace(/^#/, "");
    if (!v || len + v.length + 1 > 480) continue;
    tags.push(v);
    len += v.length + 1;
  }
  return { title: strip(raw.title).slice(0, 100) || "Untitled", description: strip(raw.description).slice(0, 5000), tags };
}

const MIME: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo", m4v: "video/x-m4v" };

export class YouTubeUploadProvider implements ExecutionProvider {
  readonly name = "youtube";
  private auth: GoogleAuth;
  private fetchImpl: typeof fetch;
  constructor(auth: GoogleAuth, fetchImpl: typeof fetch = fetch) {
    this.auth = auth;
    this.fetchImpl = fetchImpl;
  }

  async health() {
    if (!this.auth.isAuthorized()) return { ok: false, detail: "Google not authorized" };
    return this.auth.hasScope(YT_SCOPE) ? { ok: true, detail: "youtube.upload granted" } : { ok: false, detail: "run setup/google-setup.cmd again to grant YouTube upload" };
  }

  async execute(req: ExecutionRequest) {
    const u = parseUpload(req.prompt);
    if (!fs.existsSync(u.file)) throw new ProviderUnavailableError(`File not found: ${u.file}`);
    if (!this.auth.hasScope(YT_SCOPE)) throw new ProviderUnavailableError("YouTube upload not granted — run setup/google-setup.cmd again");
    const token = await this.auth.accessToken(req.signal);
    const size = fs.statSync(u.file).size;
    const type = MIME[path.extname(u.file).slice(1).toLowerCase()] ?? "video/*";
    const init = await this.fetchImpl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-length": String(size),
        "x-upload-content-type": type,
      },
      body: JSON.stringify({
        snippet: { title: u.title, description: u.description, tags: u.tags, categoryId: "27" },
        status: { privacyStatus: u.privacy, selfDeclaredMadeForKids: false },
      }),
      signal: req.signal,
    });
    if (!init.ok) {
      const msg = await init.text();
      if (init.status === 403 && /not been used|disabled/i.test(msg)) throw new ProviderUnavailableError("YouTube Data API v3 is not enabled in the Google Cloud project");
      throw new Error(`YouTube init ${init.status}: ${msg.slice(0, 300)}`);
    }
    const location = init.headers.get("location");
    if (!location) throw new Error("YouTube did not return an upload URL");
    const put = await this.fetchImpl(location, {
      method: "PUT",
      headers: { "content-type": type, "content-length": String(size) },
      body: Readable.toWeb(fs.createReadStream(u.file)) as ReadableStream,
      // @ts-expect-error Node fetch needs duplex for streamed bodies
      duplex: "half",
      signal: req.signal,
    });
    const j = (await put.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!put.ok || !j.id) throw new Error(`YouTube upload ${put.status}: ${j.error?.message ?? "no video id"}`);
    return { output: `✅ آپلود شد (${u.privacy}): https://youtu.be/${j.id}\n${u.title}`, meta: { provider: "youtube", videoId: j.id } };
  }
}

/** Queues the approval-gated upload task. Privacy comes from plugins.options.youtube.privacy (default public). */
export function queueYoutubePublish(kernel: Kernel, m: { file: string; title: string; description: string; tags: string[] }, parentId: string | null = null) {
  const privacy = (kernel.getKv("youtube.privacy") ?? "public") as UploadSpec["privacy"];
  return kernel.createTask({
    title: `انتشار یوتیوب: ${m.title}`.slice(0, 120),
    provider: "youtube",
    capabilities: ["publish:youtube"],
    verify: { type: "contains", text: "youtu.be/" },
    maxAttempts: 1,
    timeoutMs: 6 * 3600_000,
    source: "youtube",
    parentId,
    prompt: uploadPrompt({ privacy, ...m }),
  });
}

export const youtubePlugin: Plugin = {
  name: "youtube",
  description: "Publish videos from content/youtube to YouTube (/yt) — always asks for approval",
  setup({ kernel, home, options }) {
    const dir = path.join(home, "content", "youtube");
    const privacy = (["public", "unlisted", "private"].includes(String(options.privacy)) ? options.privacy : "public") as UploadSpec["privacy"];
    kernel.setKv("youtube.privacy", privacy);
    kernel.registerProvider(new YouTubeUploadProvider(new GoogleAuth(path.join(home, "config"))));

    const videos = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => VIDEO_EXT.test(f)).sort() : []);

    kernel.registerCommand({
      name: "yt",
      description: "انتشار ویدیو در یوتیوب (/yt شماره یا نام فایل | توضیح)",
      plugin: "youtube",
      run(args) {
        fs.mkdirSync(dir, { recursive: true });
        const list = videos();
        const [pick = "", ...noteParts] = args.split("|");
        const note = noteParts.join("|").trim();
        if (!pick.trim()) {
          return list.length
            ? `🎬 ویدیوهای آماده (${dir}):\n${list.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nانتشار: /yt شماره | موضوع یا توضیح`
            : `ویدیویی نیست. فایل را در این پوشه بگذار:\n${dir}`;
        }
        const n = Number(pick.trim());
        const file = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find((f) => f.toLowerCase() === pick.trim().toLowerCase());
        if (!file) return "فایل پیدا نشد. /yt برای لیست";
        const sidecar = path.join(dir, file.replace(VIDEO_EXT, ".txt"));
        const notes = [note, fs.existsSync(sidecar) ? fs.readFileSync(sidecar, "utf8").slice(0, 3000) : ""].filter(Boolean).join("\n");
        const t = kernel.createTask({
          title: `متادیتای یوتیوب: ${file}`,
          source: "internal",
          capabilities: ["read:memory"],
          context: kernel.listContextSources().some((c) => c.name === "memory:notes") ? ["memory:notes"] : [],
          verify: { type: "json", requiredKeys: ["title", "description", "tags"] },
          maxAttempts: 2,
          prompt: `Write YouTube metadata in Persian for Elias's video file "${file}" (his channels cover many topics — take the topic from the file name/content only; never assume it is about trading).
Notes about the video: ${notes || "(none — infer carefully from the file name)"}

Return ONLY JSON: {"title": "...", "description": "...", "tags": ["..."]}
- title: max 90 characters, curiosity without clickbait lies
- description: 3 short paragraphs + 3–5 hashtags at the end; if about trading add "آموزشی است، توصیه‌ی مالی نیست"
- tags: 8–15 short tags, Persian and English
Never promise guaranteed profit.`,
        });
        kernel.setKv(`youtube.meta.${t.id}`, JSON.stringify({ file: path.join(dir, file) }));
        return `✍️ دارم عنوان و توضیحات را می‌نویسم… بعد برای تأیید انتشار پیام می‌آید.`;
      },
    });

    kernel.addEventSink((e) => {
      if (!e.taskId || (e.type !== "task.succeeded" && e.type !== "task.failed")) return;
      const raw = kernel.getKv(`youtube.meta.${e.taskId}`);
      if (!raw) return;
      kernel.db.prepare("DELETE FROM kv WHERE key=?").run(`youtube.meta.${e.taskId}`);
      if (e.type !== "task.succeeded") return;
      try {
        const { file } = JSON.parse(raw) as { file: string };
        const meta = cleanMeta(JSON.parse(extractJson(kernel.getTask(e.taskId)?.result ?? "")));
        queueYoutubePublish(kernel, { file, ...meta }, e.taskId);
      } catch (err) {
        kernel.log("youtube.failed", `metadata → publish: ${(err as Error).message}`, { level: "error", taskId: e.taskId });
      }
    });
  },
};
