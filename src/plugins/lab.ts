// AI lab v1: compare the models Elias OS can use on the same question and learn which is best for what.
//   /compare <question>   runs it on every working model (Claude, ChatGPT/Codex, Gemini, local Ollama …), then posts
//                         one message with each answer, its time and length
//   /lab best N           Elias marks answer N of the last comparison as the best (counts as a win)
//   /lab stats            per model: runs, success rate, average time, wins
// Paid-per-use models (Vertex) are never included. Results live in kv (lab.run.<id>, lab.stats).
import type { Kernel } from "../kernel/kernel.ts";
import type { Plugin } from "./types.ts";

export const LAB_PREFIX = "🧪 lab:";
export const LAB_MODELS = ["claude-code", "codex", "antigravity", "gemini-cli", "gemini", "ollama"] as const;
const LABEL: Record<string, string> = {
  "claude-code": "Claude", codex: "ChatGPT (Codex)", antigravity: "Gemini (Antigravity)", "gemini-cli": "Gemini CLI", gemini: "Gemini API", ollama: "Ollama (local)",
};

/** Rough kind of request, from keywords (no AI call): the lab learns the best model per kind. */
export const CATEGORIES = ["code", "writing", "ideas", "translate", "analysis", "general"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CAT_LABEL: Record<Category, string> = { code: "کد", writing: "نوشتن", ideas: "ایده", translate: "ترجمه", analysis: "تحلیل", general: "عمومی" };
export function categorize(text: string): Category {
  const t = text.split("\n\n---\nDATA")[0]!.toLowerCase();
  if (/ترجمه|translat|übersetz|به انگلیسی|به آلمانی|به فارسی|in english|auf deutsch/.test(t)) return "translate";
  if (/\bcode\b|(^|\s)کد(\s|$)|اسکریپت|برنامه‌?نویسی|باگ|\bbug|python|javascript|typescript|\bsql\b|function|regex|mql|\bea\b/.test(t)) return "code";
  if (/ایده|پیشنهاد بده|اسم |عنوان|\bidea|brainstorm|name for|خلاق/.test(t)) return "ideas";
  if (/بنویس|متن|کپشن|ایمیل|نامه|پیام|پست|مقاله|\bwrite\b|caption|\bemail\b|\bpost\b|schreib/.test(t)) return "writing";
  if (/تحلیل|مقایسه|چرا|بررسی|توضیح بده|analy|compare|explain|why |pros and cons|بهتره/.test(t)) return "analysis";
  return "general";
}

/** The model the lab trusts for this kind of request: ≥2 wins and ≥60 % of the wins of that kind. */
export function bestFor(cats: Record<string, Record<string, Stat>>, cat: Category): string | null {
  const rows = Object.entries(cats[cat] ?? {});
  const total = rows.reduce((a, [, s]) => a + s.wins, 0);
  const top = rows.sort((a, b) => b[1].wins - a[1].wins)[0];
  return top && top[1].wins >= 2 && top[1].wins / total >= 0.6 ? top[0] : null;
}

interface LabRun { id: string; prompt: string; category?: Category; providers: string[]; tasks: Record<string, string>; created: string; reported?: boolean; order?: string[] }
export interface Stat { runs: number; ok: number; ms: number; wins: number }

const getJson = <T>(k: Kernel, key: string, dflt: T): T => {
  try {
    const v = k.getKv(key);
    return v ? (JSON.parse(v) as T) : dflt;
  } catch {
    return dflt;
  }
};

/** Models that are registered and answer their health check (within 20 s). */
export async function workingModels(k: Kernel, wanted: readonly string[] = LAB_MODELS): Promise<string[]> {
  const have = new Map(k.listProviders().map((p) => [p.name, p]));
  const checks = wanted
    .filter((n) => have.has(n))
    .map(async (n) => {
      try {
        const h = await Promise.race([have.get(n)!.health(), new Promise<{ ok: boolean }>((r) => setTimeout(() => r({ ok: false }), 20_000))]);
        return h.ok ? n : null;
      } catch {
        return null;
      }
    });
  return (await Promise.all(checks)).filter((x): x is string => !!x);
}

export function report(k: Kernel, run: LabRun): { text: string; order: string[] } {
  const parts: string[] = [];
  const order: string[] = [];
  for (const p of run.providers) {
    const t = k.getTask(run.tasks[p]!);
    const r = t ? k.listRuns(t.id).at(-1) : undefined;
    const secs = r?.durationMs != null ? `${(r.durationMs / 1000).toFixed(0)}s` : "—";
    if (t?.status === "succeeded" && t.provider === p) {
      order.push(p);
      const ans = (t.result ?? "").trim();
      parts.push(`${order.length}. ${LABEL[p] ?? p} · ⏱ ${secs} · ${ans.length} حرف\n${ans.length > 700 ? ans.slice(0, 700) + " …" : ans}`);
    } else if (t?.status === "succeeded") {
      parts.push(`✗ ${LABEL[p] ?? p} · در دسترس نبود (Elias OS به مدل دیگری رفت؛ این جواب حساب نمی‌شود)`);
    } else {
      parts.push(`✗ ${LABEL[p] ?? p} · ${t?.failureKind ?? t?.status ?? "?"}: ${(t?.error ?? "").slice(0, 120)}`);
    }
  }
  return {
    text: `🧪 مقایسه‌ی مدل‌ها\n«${run.prompt.slice(0, 150)}»\n\n${parts.join("\n\n")}${order.length > 1 ? `\n\nکدام بهتر بود؟ بنویس: /lab best شماره` : ""}`,
    order,
  };
}

export const labPlugin: Plugin = {
  name: "lab",
  description: "AI lab: /compare a question across all models, /lab best, /lab stats",
  setup({ kernel }) {
    const runKey = (id: string) => `lab.run.${id}`;

    kernel.addEventSink((e) => {
      if ((e.type !== "task.succeeded" && e.type !== "task.failed") || !e.taskId) return;
      const t = kernel.getTask(e.taskId);
      if (!t || !t.title.startsWith(LAB_PREFIX)) return;
      if (e.type === "task.failed" && t.status !== "failed") return; // a retry is coming
      const id = t.title.slice(LAB_PREFIX.length).split(":")[0]!;
      const run = getJson<LabRun | null>(kernel, runKey(id), null);
      if (!run || run.reported) return;
      const tasks = Object.values(run.tasks).map((tid) => kernel.getTask(tid));
      if (!tasks.every((x) => x && ["succeeded", "failed", "cancelled"].includes(x.status))) return;
      // stats
      const stats = getJson<Record<string, Stat>>(kernel, "lab.stats", {});
      const cats = getJson<Record<string, Record<string, Stat>>>(kernel, "lab.cats", {});
      const cat = run.category ?? categorize(run.prompt);
      for (const p of run.providers) {
        const x = kernel.getTask(run.tasks[p]!);
        for (const s of [(stats[p] ??= { runs: 0, ok: 0, ms: 0, wins: 0 }), ((cats[cat] ??= {})[p] ??= { runs: 0, ok: 0, ms: 0, wins: 0 })]) {
          s.runs++;
          if (x?.status === "succeeded" && x.provider === p) { // a fallback to another model is not this model's answer
            s.ok++;
            s.ms += kernel.listRuns(x.id).at(-1)?.durationMs ?? 0;
          }
        }
      }
      kernel.setKv("lab.stats", JSON.stringify(stats));
      kernel.setKv("lab.cats", JSON.stringify(cats));
      const r = report(kernel, run);
      kernel.setKv(runKey(id), JSON.stringify({ ...run, reported: true, order: r.order }));
      kernel.setKv("lab.last", id);
      kernel.createTask({ title: "🧪 نتیجه‌ی مقایسه", prompt: r.text, provider: "reminder", source: "lab", verify: { type: "non_empty" }, maxAttempts: 1 });
    });

    kernel.registerCommand({
      name: "compare",
      description: "یک سؤال را به همه‌ی مدل‌ها بده و مقایسه کن (/compare سؤال)",
      plugin: "lab",
      async run(args) {
        const prompt = args.trim();
        if (prompt.length < 3) return "استفاده: /compare یک ایده‌ی ویدیو برای کانال آموزش هوش مصنوعی بده";
        const providers = await workingModels(kernel);
        if (providers.length < 2) return `برای مقایسه حداقل دو مدل سالم لازم است (الان: ${providers.join("، ") || "هیچ"}).`;
        const id = Date.now().toString(36);
        const tasks: Record<string, string> = {};
        for (const p of providers) {
          tasks[p] = kernel.createTask({
            title: `${LAB_PREFIX}${id}:${p}`,
            prompt,
            provider: p,
            source: "internal",
            verify: { type: "non_empty" },
            maxAttempts: 1,
            timeoutMs: 5 * 60_000,
          }).id;
        }
        kernel.setKv(runKey(id), JSON.stringify({ id, prompt, category: categorize(prompt), providers, tasks, created: new Date().toISOString() } satisfies LabRun));
        return `🧪 سؤال را به ${providers.length} مدل دادم: ${providers.map((p) => LABEL[p] ?? p).join("، ")}.\nوقتی همه جواب دادند، مقایسه را می‌فرستم.`;
      },
    });

    kernel.registerCommand({
      name: "lab",
      description: "آزمایشگاه: /lab stats · /lab best شماره",
      plugin: "lab",
      run(args) {
        const [cmd, n] = args.trim().split(/\s+/);
        const stats = getJson<Record<string, Stat>>(kernel, "lab.stats", {});
        if (cmd === "best") {
          const last = kernel.getKv("lab.last");
          const run = last ? getJson<LabRun | null>(kernel, runKey(last), null) : null;
          const p = run?.order?.[Number(n) - 1];
          if (!run || !p) return "اول یک مقایسه انجام بده (/compare …)، بعد شماره‌ی بهترین جواب را بنویس.";
          (stats[p] ??= { runs: 0, ok: 0, ms: 0, wins: 0 }).wins++;
          kernel.setKv("lab.stats", JSON.stringify(stats));
          const cats = getJson<Record<string, Record<string, Stat>>>(kernel, "lab.cats", {});
          const cat = run.category ?? categorize(run.prompt);
          ((cats[cat] ??= {})[p] ??= { runs: 0, ok: 0, ms: 0, wins: 0 }).wins++;
          kernel.setKv("lab.cats", JSON.stringify(cats));
          const best = bestFor(cats, cat);
          return `🏆 ثبت شد: ${LABEL[p] ?? p} برنده‌ی این مقایسه (${CAT_LABEL[cat]}).${best ? `\nاز این به بعد کارهای «${CAT_LABEL[cat]}» اول به ${LABEL[best] ?? best} می‌رود.` : ""}`;
        }
        if (cmd === "auto") {
          if (n === "off" || n === "on") kernel.setKv("lab.routing", n);
          return kernel.getKv("lab.routing") === "off" ? "انتخاب خودکار مدل خاموش است (/lab auto on)." : "انتخاب خودکار مدل روشن است (/lab auto off).";
        }
        const rows = Object.entries(stats).sort((a, b) => b[1].wins - a[1].wins || b[1].ok - a[1].ok);
        if (!rows.length) return "هنوز مقایسه‌ای نشده. مثال: /compare یک اسم برای کانال یوتیوب پیشنهاد بده";
        const cats = getJson<Record<string, Record<string, Stat>>>(kernel, "lab.cats", {});
        const routes = CATEGORIES.map((c) => [c, bestFor(cats, c)] as const).filter(([, b]) => b);
        const routing = kernel.getKv("lab.routing") === "off"
          ? "\n\nانتخاب خودکار مدل: خاموش"
          : routes.length
            ? `\n\n🎯 انتخاب خودکار:\n${routes.map(([c, b]) => `• ${CAT_LABEL[c]} → ${LABEL[b!] ?? b}`).join("\n")}`
            : "\n\n🎯 انتخاب خودکار: هنوز داده‌ی کافی نیست (برای هر نوع کار حداقل ۲ برد لازم است).";
        return `🧪 آمار مدل‌ها\n${rows
          .map(([p, s]) => `• ${LABEL[p] ?? p}: ${s.wins} برد · ${s.ok}/${s.runs} موفق · میانگین ${s.ok ? (s.ms / s.ok / 1000).toFixed(0) : "—"} ثانیه`)
          .join("\n")}${routing}`;
      },
    });

    // the "auto" provider asks the lab which model to try first for this kind of request
    const auto = kernel.listProviders().find((p) => p.name === "auto") as { setPreference?: (fn: (req: { prompt: string }) => string[] | null) => void } | undefined;
    auto?.setPreference?.((req) => {
      if (kernel.getKv("lab.routing") === "off") return null;
      const best = bestFor(getJson<Record<string, Record<string, Stat>>>(kernel, "lab.cats", {}), categorize(req.prompt));
      return best ? [best] : null;
    });
  },
};
