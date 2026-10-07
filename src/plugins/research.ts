// Research agent: /research <topic> → Claude Code (subscription) searches the web, reads sources and writes a
// Persian report with links. The report is saved to Obsidian (04 Knowledge) and a short summary goes to Telegram.
// /research weekly <topic> follows a topic every Saturday; /research list · /research off <topic>.
import fs from "node:fs";
import path from "node:path";
import type { Kernel } from "../kernel/kernel.ts";
import type { TaskInput } from "../kernel/types.ts";
import { ClaudeCodeProvider } from "../providers/claude-code.ts";
import type { Plugin } from "./types.ts";

export const RESEARCH_PROVIDER = "claude-research";
const TITLE = "🔎 تحقیق: ";

export function researchPrompt(topic: string, weekly = false): string {
  return [
    `موضوع تحقیق: ${topic}`,
    "",
    "با WebSearch جستجو کن و دست‌کم ۴ منبع معتبر و متنوع را با WebFetch بخوان (منابع رسمی، مقاله‌های معتبر، داده‌ی تازه).",
    weekly ? "این پیگیری هفتگی است: روی خبرها و تغییرات ۷ روز اخیر تمرکز کن و اگر چیز تازه‌ای نبود صادقانه بگو." : "",
    "ادعای بدون منبع ننویس؛ اگر منابع با هم اختلاف دارند بگو. تاریخ داده‌ها را ذکر کن.",
    "",
    "خروجی فقط یک گزارش Markdown فارسی با همین بخش‌ها و همین ترتیب:",
    "## خلاصه",
    "(حداکثر ۶ بولت کوتاه — مهم‌ترین نتیجه‌ها)",
    "## جزئیات",
    "(توضیح منظم با زیرعنوان؛ بعد از هر ادعا شماره‌ی منبع مثل [1])",
    "## نکته‌های عملی",
    "(فقط اگر به کار Elias می‌آید؛ در همان حوزه‌ی موضوع بمان و آن را به ترید ربط نده مگر موضوع ترید باشد)",
    "## منابع",
    "1. [عنوان منبع](https://...)",
    "",
    "هیچ متن دیگری قبل یا بعد از گزارش ننویس.",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export function researchTask(topic: string, source = "internal", weekly = false): TaskInput {
  return {
    title: `${TITLE}${topic}`.slice(0, 120),
    prompt: researchPrompt(topic, weekly),
    provider: RESEARCH_PROVIDER,
    source,
    verify: { type: "contains", text: "## منابع" },
    maxAttempts: 2,
    timeoutMs: 20 * 60_000,
  };
}

export function section(md: string, name: string): string {
  const m = md.match(new RegExp(`^##\\s*${name}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m"));
  return m ? m[1]!.trim() : "";
}

export function links(md: string, max = 6): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  for (const m of section(md, "منابع").matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (!out.some((o) => o.url === m[2])) out.push({ title: m[1]!.trim(), url: m[2]! });
    if (out.length >= max) break;
  }
  return out;
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export function saveReport(dir: string, folder: string, topic: string, report: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const target = path.join(dir, folder);
  fs.mkdirSync(target, { recursive: true });
  let file = path.join(target, `Research - ${safeName(topic)} - ${date}.md`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(target, `Research - ${safeName(topic)} - ${date} (${i}).md`);
  const front = ["---", `topic: "${topic.replace(/"/g, "'")}"`, `date: ${date}`, "tags: [research, elias-os]", "---", "", `# ${topic}`, ""].join("\n");
  fs.writeFileSync(file, front + report.trim() + "\n", "utf8");
  return file;
}

export function telegramSummary(topic: string, report: string, saved: string | null): string {
  const sum = section(report, "خلاصه") || report.slice(0, 800);
  const src = links(report);
  return [
    `🔎 ${topic}`,
    "",
    sum.slice(0, 1500),
    ...(src.length ? ["", "منابع:", ...src.map((s, i) => `${i + 1}. [${s.title}](${s.url})`)] : []),
    "",
    saved ? `📚 گزارش کامل در Obsidian: ${path.basename(saved, ".md")}` : "⚠️ Vault تنظیم نشده؛ گزارش کامل ذخیره نشد.",
  ].join("\n");
}

const slug = (t: string) => "research-" + (t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "topic");

export function readConfig(home: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, "config", "elias.config.json"), "utf8"));
  } catch {
    return {};
  }
}

export const researchPlugin: Plugin = {
  name: "research",
  description: "Web research agent: /research → Obsidian 04 Knowledge + Telegram",
  setup({ kernel, home, options }) {
    const cfg = readConfig(home);
    const dir = String(options.dir ?? cfg.plugins?.options?.vault?.dir ?? "");
    const folder = String(options.folder ?? "04 Knowledge");
    const cron = String(options.weeklyCron ?? "0 9 * * 6");
    kernel.registerProvider(
      Object.assign(
        new ClaudeCodeProvider({ cwd: path.join(home, "data", "workspace"), ...(cfg.claudeCode ?? {}), allowedTools: ["WebSearch", "WebFetch"], maxTurns: 40 }),
        { name: RESEARCH_PROVIDER },
      ),
    );

    kernel.addEventSink((e) => {
      if (!e.taskId || (e.type !== "task.succeeded" && e.type !== "task.failed")) return;
      const t = kernel.getTask(e.taskId);
      if (!t || t.provider !== RESEARCH_PROVIDER || !t.title.startsWith(TITLE)) return;
      const topic = t.title.slice(TITLE.length);
      let msg: string;
      if (e.type === "task.failed") {
        if (t.status !== "failed") return; // a retry is coming
        msg = `❌ تحقیق «${topic}» انجام نشد: ${(t.error ?? "").slice(0, 200)}\nدوباره: /research ${topic}`;
      } else {
        let saved: string | null = null;
        try {
          if (dir && fs.existsSync(dir)) saved = saveReport(dir, folder, topic, t.result ?? "");
        } catch (err) {
          kernel.log("research.save_failed", (err as Error).message, { level: "warn", taskId: t.id });
        }
        msg = telegramSummary(topic, t.result ?? "", saved);
      }
      kernel.createTask({ title: "🔎 نتیجه‌ی تحقیق", prompt: msg, provider: "reminder", source: "research", verify: { type: "non_empty" }, maxAttempts: 1 });
    });

    kernel.registerCommand({
      name: "research",
      description: "تحقیق اینترنتی با منبع (/research موضوع · weekly موضوع · list · off موضوع)",
      plugin: "research",
      run(args) {
        const a = args.trim();
        const [sub, ...rest] = a.split(/\s+/);
        const topic = rest.join(" ").trim();
        const weekly = kernel.listSchedules().filter((s) => s.name.startsWith("research-"));
        if (!a) return "استفاده:\n/research موضوع\n/research weekly موضوع — پیگیری هر شنبه\n/research list\n/research off موضوع";
        if (sub === "list") return weekly.length ? `🔁 پیگیری‌های هفتگی:\n${weekly.map((s) => `- ${s.template.title.slice(TITLE.length)}`).join("\n")}` : "پیگیری هفتگی نداری.";
        if (sub === "off") {
          const s = weekly.find((x) => x.name === slug(topic) || x.template.title === `${TITLE}${topic}`);
          if (!s) return "این موضوع در پیگیری‌ها نیست. /research list";
          kernel.removeSchedule(s.id);
          return `🛑 پیگیری «${topic}» خاموش شد.`;
        }
        if (sub === "weekly") {
          if (!topic) return "استفاده: /research weekly موضوع";
          if (kernel.getSchedule(slug(topic))) return "این موضوع از قبل پیگیری می‌شود.";
          kernel.addSchedule(slug(topic), cron, researchTask(topic, "internal", true));
          kernel.createTask(researchTask(topic));
          return `🔁 «${topic}» هر شنبه ساعت ۹ پیگیری می‌شود. اولین گزارش همین الان شروع شد.`;
        }
        kernel.createTask(researchTask(a));
        return `🔎 دارم درباره‌ی «${a}» تحقیق می‌کنم… چند دقیقه طول می‌کشد؛ خلاصه اینجا می‌آید و گزارش کامل در Obsidian.`;
      },
    });
  },
};
