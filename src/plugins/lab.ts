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

interface LabRun { id: string; prompt: string; providers: string[]; tasks: Record<string, string>; created: string; reported?: boolean; order?: string[] }
interface Stat { runs: number; ok: number; ms: number; wins: number }

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
      for (const p of run.providers) {
        const x = kernel.getTask(run.tasks[p]!);
        const s = (stats[p] ??= { runs: 0, ok: 0, ms: 0, wins: 0 });
        s.runs++;
        if (x?.status === "succeeded" && x.provider === p) { // a fallback to another model is not this model's answer
          s.ok++;
          s.ms += kernel.listRuns(x.id).at(-1)?.durationMs ?? 0;
        }
      }
      kernel.setKv("lab.stats", JSON.stringify(stats));
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
        kernel.setKv(runKey(id), JSON.stringify({ id, prompt, providers, tasks, created: new Date().toISOString() } satisfies LabRun));
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
          return `🏆 ثبت شد: ${LABEL[p] ?? p} برنده‌ی این مقایسه.`;
        }
        const rows = Object.entries(stats).sort((a, b) => b[1].wins - a[1].wins || b[1].ok - a[1].ok);
        if (!rows.length) return "هنوز مقایسه‌ای نشده. مثال: /compare یک اسم برای کانال یوتیوب پیشنهاد بده";
        return `🧪 آمار مدل‌ها\n${rows
          .map(([p, s]) => `• ${LABEL[p] ?? p}: ${s.wins} برد · ${s.ok}/${s.runs} موفق · میانگین ${s.ok ? (s.ms / s.ok / 1000).toFixed(0) : "—"} ثانیه`)
          .join("\n")}`;
      },
    });
  },
};
