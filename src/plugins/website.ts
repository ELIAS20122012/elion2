// Elion Group website agent. The site is the static folder site/ (Cloudflare Pages project, deployed with wrangler).
// /site <what to change> → AI rewrites the pages into site-draft/ → preview link (panel) → approval → deploy.
// Guard rails: privacy.html and the homepage's app description + privacy link (needed for Google OAuth) always stay.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractJson } from "../kernel/verify.ts";
import type { Kernel } from "../kernel/kernel.ts";
import type { ExecutionProvider } from "../providers/types.ts";
import { registerStatic } from "../interfaces/dashboard.ts";
import { readConfig } from "./research.ts";
import type { Plugin } from "./types.ts";

/** Pinned so a deploy never changes behaviour because a new wrangler was released. Bump deliberately. */
const WRANGLER = "wrangler@4.149.0";

export const SITE_PLAN_TITLE = "🌐 ویرایش سایت";
const MAX_FILES = 12;

export function readSite(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => /\.(html|css|txt|xml|svg)$/i.test(f)).sort()) out[f] = fs.readFileSync(path.join(dir, f), "utf8");
  return out;
}

export function siteTask(current: Record<string, string>, request: string) {
  return {
    title: `${SITE_PLAN_TITLE}: ${request}`.slice(0, 100),
    source: "internal",
    verify: { type: "json" as const, requiredKeys: ["files", "summary"] },
    maxAttempts: 2,
    prompt: `You maintain the website of Elion Group (Elias Farahani's company: AI systems — Elias OS, AI agents — and content
channels; trading is only a small side topic, don't make the site about trading unless asked). It is a small static site
(plain HTML + inline CSS, no frameworks, no external scripts, mobile-friendly, fast, clean modern design, English unless asked).

Current files:
${Object.entries(current).map(([n, c]) => `<file name="${n}">\n${c}\n</file>`).join("\n")}

Elias's request: ${request}

Rules:
- Keep privacy.html unless the request is explicitly about it (then keep it a complete privacy policy for Elias OS / Google data).
- index.html MUST keep a short honest description of "Elias OS" (private single-user assistant of the owner) and a link href="/privacy" —
  Google OAuth verification depends on it. You may add more about Elion Group around it.
- Never invent clients, numbers, testimonials, prices or awards. No personal data beyond the existing contact email.
- Links between pages use clean paths ("/privacy", "/projects").
- Max ${MAX_FILES} files, names like "projects.html" (lowercase, no folders).

Return ONLY JSON: {"files": {"index.html": "<full html>", ...all files that should exist...}, "summary": "Persian, 2–4 bullet lines: what changed"}`,
  };
}

/** Validates the AI output and enforces the guard rails. Returns the final file map. */
export function checkSite(raw: string, current: Record<string, string>): { files: Record<string, string>; summary: string } {
  const j = JSON.parse(extractJson(raw)) as { files?: Record<string, unknown>; summary?: unknown };
  const files: Record<string, string> = {};
  for (const [name, body] of Object.entries(j.files ?? {})) {
    if (!/^[a-z0-9][a-z0-9-]*\.(html|css|txt|xml|svg)$/.test(name)) throw new Error(`bad file name: ${name}`);
    const b = String(body ?? "");
    if (/\.html$/.test(name) && !/<html[\s>]/i.test(b)) throw new Error(`${name} is not a full HTML page`);
    if (/<script[^>]+src=/i.test(b)) throw new Error(`${name}: external scripts are not allowed`);
    files[name] = b;
  }
  if (Object.keys(files).length > MAX_FILES) throw new Error("too many files");
  if (!files["index.html"]) throw new Error("index.html missing");
  if (!files["privacy.html"] && current["privacy.html"]) files["privacy.html"] = current["privacy.html"];
  let idx = files["index.html"];
  if (!/href=["']\/privacy(\.html)?["']/.test(idx) || !/Elias OS/.test(idx)) {
    const footer = `<footer style="margin-top:40px;font-size:14px;color:#555"><p>Elias OS is a private, single-user assistant built and operated by Elias Farahani (Elion Group) for his own schedule, email overview and tasks. It is not offered to the public.</p><p><a href="/privacy">Privacy Policy</a></p></footer>`;
    idx = /<\/body>/i.test(idx) ? idx.replace(/<\/body>/i, `${footer}</body>`) : idx + footer;
    files["index.html"] = idx;
  }
  return { files, summary: String(j.summary ?? "").trim() || "تغییرات انجام شد." };
}

export function writeDir(dir: string, files: Record<string, string>): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b, "utf8");
}

export const websitePlugin: Plugin = {
  name: "website",
  description: "Elion Group website agent (/site) — draft, preview, publish with approval",
  setup({ kernel, home, options }) {
    const siteDir = path.join(home, String(options.dir ?? "site"));
    const draftDir = path.join(home, "site-draft");
    const project = String(options.project ?? "elion-os-site");
    const cfg = readConfig(home);
    const panel = cfg.dashboard?.publicHost ? `https://${cfg.dashboard.publicHost}` : `http://127.0.0.1:${cfg.dashboard?.port ?? 7420}`;
    registerStatic("/site-preview/", () => (fs.existsSync(draftDir) ? draftDir : siteDir));

    kernel.registerProvider({
      name: "site-deploy",
      health: async () => ({ ok: fs.existsSync(siteDir), detail: `wrangler pages → ${project}` }),
      execute: (req) =>
        new Promise((resolve, reject) => {
          if (!fs.existsSync(draftDir)) return reject(new Error("no draft to publish"));
          writeDir(siteDir, readSite(draftDir));
          const p = spawn("npx", ["-y", WRANGLER, "pages", "deploy", "site", "--project-name", project, "--branch", "main", "--commit-dirty=true"], {
            cwd: home,
            shell: process.platform === "win32",
            windowsHide: true,
          });
          let log = "";
          p.stdout.on("data", (d) => (log += d));
          p.stderr.on("data", (d) => (log += d));
          const onAbort = () => p.kill();
          req.signal.addEventListener("abort", onAbort, { once: true });
          p.on("error", reject);
          p.on("close", (code) => {
            req.signal.removeEventListener("abort", onAbort);
            if (code !== 0) return reject(new Error(`wrangler exit ${code}: ${log.slice(-400)}`));
            fs.rmSync(draftDir, { recursive: true, force: true });
            const url = log.match(/https:\/\/\S+\.pages\.dev/)?.[0];
            resolve({ output: `🌐 سایت منتشر شد.${url ? `\n${url}` : ""}` });
          });
        }),
    } satisfies ExecutionProvider);

    kernel.addEventSink((e) => {
      if (e.type !== "task.succeeded" || !e.taskId) return;
      const t = kernel.getTask(e.taskId);
      if (!t?.title.startsWith(SITE_PLAN_TITLE)) return;
      let msg: string;
      try {
        const r = checkSite(t.result ?? "", readSite(siteDir));
        writeDir(draftDir, r.files);
        msg = `🌐 پیش‌نویس سایت آماده است\n\n${r.summary}\n\n👀 پیش‌نمایش: ${panel}/site-preview/\n\nانتشار: /site publish · دور انداختن: /site discard · تغییر بیشتر: /site <درخواست>`;
      } catch (err) {
        msg = `❌ پیش‌نویس سایت قابل قبول نبود: ${(err as Error).message}\nدوباره: /site ${t.title.slice(SITE_PLAN_TITLE.length + 2)}`;
      }
      kernel.createTask({ title: "🌐 سایت", prompt: msg, provider: "reminder", source: "website", verify: { type: "non_empty" }, maxAttempts: 1 });
    });

    kernel.registerCommand({
      name: "site",
      description: "ایجنت سایت Elion Group (/site درخواست · publish · discard · status)",
      plugin: "website",
      run(args) {
        const a = args.trim();
        if (!a || a === "status") {
          const pages = Object.keys(readSite(siteDir));
          const draft = fs.existsSync(draftDir) ? Object.keys(readSite(draftDir)) : null;
          return `🌐 سایت (${project}): ${pages.join("، ") || "خالی"}\n${draft ? `📝 پیش‌نویس منتظر: ${draft.join("، ")}\n👀 ${panel}/site-preview/\n/site publish یا /site discard` : "پیش‌نویسی در انتظار نیست."}\n\nمثال: /site یک صفحه‌ی projects با معرفی Elias OS و سری Mini Rescue بساز`;
        }
        if (a === "discard") {
          fs.rmSync(draftDir, { recursive: true, force: true });
          return "🗑 پیش‌نویس حذف شد؛ سایت فعلی دست نخورد.";
        }
        if (a === "publish") {
          if (!fs.existsSync(draftDir)) return "پیش‌نویسی برای انتشار نیست. اول: /site درخواست";
          kernel.createTask({
            title: "🌐 انتشار سایت Elion Group",
            prompt: `انتشار پیش‌نویس سایت روی Cloudflare (${project}).\nصفحه‌ها: ${Object.keys(readSite(draftDir)).join("، ")}\nپیش‌نمایش: ${panel}/site-preview/`,
            provider: "site-deploy",
            capabilities: ["publish:website"],
            source: "website",
            verify: { type: "non_empty" },
            maxAttempts: 1,
            timeoutMs: 5 * 60_000,
          });
          return "🔐 انتشار برای تأیید تو فرستاده شد.";
        }
        const base = fs.existsSync(draftDir) ? readSite(draftDir) : readSite(siteDir);
        kernel.createTask(siteTask(base, a));
        return "🌐 دارم سایت را طبق درخواستت می‌نویسم… پیش‌نویس و لینک پیش‌نمایش این‌جا می‌آید (بدون تأیید تو منتشر نمی‌شود).";
      },
    });
  },
};
