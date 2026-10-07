// Agent team: /team <question> → specialists (agents/*.md) answer on three different AIs (Claude, ChatGPT, Gemini).
// Round 1: independent views. Round 2: each member sees the others, revises or defends, and votes.
// A Claude chair writes the decision with the vote/consensus line; minutes go to Obsidian.
// /team quick <q> = one round. A member whose model fails is re-run on the fallback chain ("auto").
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "./types.ts";
import { readConfig, safeName } from "./research.ts";

export type ModelKey = "claude" | "chatgpt" | "gemini";
export const MODEL_LABEL: Record<ModelKey, string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };
export const MODEL_PROVIDERS: Record<ModelKey, string[]> = { claude: ["claude-code"], chatgpt: ["codex"], gemini: ["gemini-vertex", "gemini-cli", "gemini"] };
const DEFAULT_MODEL: Record<string, ModelKey> = { researcher: "claude", critic: "claude", business: "chatgpt", content: "chatgpt", trader: "gemini" };

const TRADING_RE = "ترید|معامله|trade|trading|MT4|فارکس|forex|طلا|بورس|کریپتو|crypto|بیت‌?کوین|اکسپرت|EA|سیگنال|بروکر|چارت|پوزیشن";

export interface Agent {
  name: string;
  title: string;
  emoji: string;
  model: ModelKey;
  provider?: string;
  /** Regex: the agent joins a whole-team meeting only when the question matches (e.g. the trader). */
  only?: string;
  context: string[];
  capabilities: string[];
  role: string;
}

interface Member {
  name: string;
  emoji: string;
  title: string;
  model: ModelKey;
  taskId: string;
  r2TaskId?: string;
  fellBack?: boolean;
}

interface Meeting {
  question: string;
  quick: boolean;
  phase: 1 | 2;
  members: Member[];
  chairTaskId?: string;
}

export const DEFAULT_AGENTS: Record<string, string> = {
  business: `---\ntitle: کسب‌وکار و مالی\nemoji: 💰\nmodel: chatgpt\n---\nYou are Elias's business and finance advisor. Think about money: pricing, revenue, costs, ROI, time cost, risk to his income, and what actually moves his business (Elion Group, AI systems, social media/content channels, digital products). Trading is a separate small part of his work — don't bring it up unless the question is about it.`,
  trader: `---\ntitle: ترید و ریسک\nemoji: 📈\nmodel: gemini\nonly: ترید|معامله|trade|trading|MT4|فارکس|forex|طلا|بورس|کریپتو|crypto|بیت‌?کوین|اکسپرت|EA|سیگنال|بروکر|چارت|پوزیشن\n---\nYou are Elias's trading and risk partner (he trades on MT4 and builds EAs). Judge everything through risk: downside, discipline, position sizing, drawdown, and whether it protects his capital and focus.`,
  content: `---\ntitle: محتوا و برند\nemoji: 🎬\nmodel: chatgpt\n---\nYou are Elias's content and brand strategist (YouTube Shorts, Instagram, Telegram; his channels cover many topics — not trading-centric). Think about audience, attention, growth, positioning and what content or brand angle this creates.`,
  researcher: `---\ntitle: پژوهشگر\nemoji: 🔎\nmodel: claude\nprovider: claude-research\n---\nYou are the team's researcher. Use WebSearch/WebFetch to find 2–4 current facts, numbers or examples that matter for this question, and cite each with a link. Facts first, opinion last.`,
  critic: `---\ntitle: مخالف\nemoji: 😈\nmodel: claude\n---\nYou are the devil's advocate. Give the strongest argument AGAINST the idea, the blind spots, what could go wrong, and what everyone else will probably miss.`,
};

export function parseAgent(text: string, name: string): Agent {
  const m = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m || !m[2]!.trim()) throw new Error(`agent ${name}: needs --- front matter --- and a role`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const list = (v: string | undefined, d: string[]) => (v === undefined ? d : v.split(",").map((s) => s.trim()).filter(Boolean));
  const id = (meta.name || name).toLowerCase();
  const mk = (meta.model ?? "").toLowerCase().replace("gpt", "chatgpt").replace("chatchatgpt", "chatgpt");
  const model: ModelKey = mk in MODEL_LABEL ? (mk as ModelKey) : DEFAULT_MODEL[id] ?? "claude";
  return {
    name: id,
    title: meta.title || name,
    emoji: meta.emoji || "🤖",
    model,
    ...(meta.provider ? { provider: meta.provider } : {}),
    ...(meta.only ? { only: meta.only } : id === "trader" ? { only: TRADING_RE } : {}),
    context: list(meta.context, ["memory:notes"]),
    capabilities: list(meta.capabilities, ["read:memory"]),
    role: m[2]!.trim(),
  };
}

export function loadAgents(dir: string, log?: (msg: string) => void): Agent[] {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [n, t] of Object.entries(DEFAULT_AGENTS)) fs.writeFileSync(path.join(dir, `${n}.md`), t + "\n", "utf8");
  }
  const out: Agent[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort()) {
    try {
      out.push(parseAgent(fs.readFileSync(path.join(dir, f), "utf8"), f.replace(/\.md$/, "")));
    } catch (e) {
      log?.((e as Error).message);
    }
  }
  return out;
}

/** "@trader @critic question" → chosen agents + question; no @ → whole team. */
export function pickMembers(agents: Agent[], input: string): { members: Agent[]; question: string; unknown: string[] } {
  const tags = [...input.matchAll(/@([\w-]+)/g)].map((m) => m[1]!.toLowerCase());
  const question = input.replace(/@[\w-]+/g, "").replace(/\s+/g, " ").trim();
  if (!tags.length) {
    const fits = (a: Agent) => {
      if (!a.only) return true;
      try {
        return new RegExp(a.only, "i").test(question);
      } catch {
        return true;
      }
    };
    return { members: agents.filter(fits), question, unknown: [] };
  }
  return { members: agents.filter((a) => tags.includes(a.name)), question, unknown: tags.filter((t) => !agents.some((a) => a.name === t)) };
}

export function agentPrompt(a: Pick<Agent, "role">, question: string): string {
  return [
    a.role,
    "",
    "You are one member of Elias's agent team; other specialists (on other AI models) answer separately and a chair combines the views.",
    "Stay in YOUR perspective only. Be specific to Elias's situation (use DATA notes if present), no generic advice, no guarantees.",
    "Answer in Persian, 4–8 short lines. Last line exactly: «پیشنهاد من: …» (one concrete recommendation).",
    "",
    `Question from Elias: ${question}`,
  ].join("\n");
}

export function round2Prompt(a: Pick<Agent, "role">, question: string, mine: string, others: Array<{ label: string; text: string }>): string {
  return [
    a.role,
    "",
    "Round 2 of Elias's team meeting. Your round-1 view and the other members' views are below.",
    "Respond in Persian, 3–6 short lines: where you changed your mind and why, or why you keep your position against the strongest opposing point.",
    "Then the last line EXACTLY in this form (pick one word): «رأی: موافق — دلیل کوتاه» or «رأی: مخالف — …» or «رأی: مشروط — شرط».",
    "",
    `Question: ${question}`,
    "",
    `### Your round-1 view\n${mine}`,
    "",
    ...others.map((o) => `### ${o.label}\n${o.text}`),
  ].join("\n");
}

export type Vote = "موافق" | "مخالف" | "مشروط";
export function parseVote(text: string | null | undefined): Vote | null {
  const m = (text ?? "").match(/رأی\s*[:：]\s*\**\s*(موافق|مخالف|مشروط)/);
  return m ? (m[1] as Vote) : null;
}

/** One line for the top of the result, e.g. "✅ اجماع: موافق (Claude، ChatGPT، Gemini)". */
export function voteLine(votes: Array<{ model: ModelKey; emoji: string; vote: Vote | null }>): string {
  const cast = votes.filter((v) => v.vote);
  if (!cast.length) return "";
  const byModel = new Map<ModelKey, Set<Vote>>();
  for (const v of cast) byModel.set(v.model, (byModel.get(v.model) ?? new Set()).add(v.vote!));
  const all = new Set(cast.map((v) => v.vote!));
  const models = [...byModel.keys()].map((m) => MODEL_LABEL[m]).join("، ");
  if (all.size === 1) return `✅ اجماع: ${[...all][0]} (${models})`;
  return `⚖️ رأی‌ها: ${cast.map((v) => `${v.emoji} ${v.vote}`).join(" · ")} — بدون اجماع`;
}

export function chairPrompt(question: string, sections: string[], votes: string): string {
  return [
    "You chair a meeting of Elias's agent team (members ran on Claude, ChatGPT and Gemini). Write the meeting result in Persian for Telegram:",
    ...(votes ? ["", `First line EXACTLY: ${votes}`] : []),
    "",
    "🤝 **توافق** — where they agree (1–3 bullets)",
    "⚔️ **اختلاف** — real disagreements, which model/member holds which side, and who is right in your judgement",
    "🧭 **تصمیم** — one clear recommendation + the main condition/risk",
    "✅ **قدم‌های بعدی** — 1–3 concrete actions for this week",
    "",
    "If an action can be done by Elias OS itself, add a line `>>> /command args` after it (e.g. `>>> /remind فردا 10 …`, `>>> /research …`).",
    "Be decisive and short (max ~22 lines). Do not repeat each member's text.",
    "",
    `Question: ${question}`,
    "",
    ...sections,
  ].join("\n");
}

const DONE = new Set(["succeeded", "failed", "cancelled"]);

export const teamPlugin: Plugin = {
  name: "team",
  description: "Agent team meetings on Claude + ChatGPT + Gemini (/team · quick · @agent · agents)",
  setup({ kernel, home, options }) {
    const agentsDir = path.resolve(home, String(options.dir ?? "agents"));
    const cfg = readConfig(home);
    const vault = String(options.vault ?? cfg.plugins?.options?.vault?.dir ?? "");
    const folder = String(options.folder ?? "04 Knowledge/Team Meetings");
    const agents = () => loadAgents(agentsDir, (msg) => kernel.log("team.agent_invalid", msg, { level: "warn" }));
    const byName = (n: string) => agents().find((a) => a.name === n);
    const getMeeting = (id: string) => {
      const raw = kernel.getKv(`team.meeting.${id}`);
      return raw ? (JSON.parse(raw) as Meeting) : null;
    };
    const save = (id: string, m: Meeting) => kernel.setKv(`team.meeting.${id}`, JSON.stringify(m));
    const del = (key: string) => kernel.db.prepare("DELETE FROM kv WHERE key=?").run(key);
    const has = (p: string) => kernel.listProviders().some((x) => x.name === p);
    const cooling = (p: string) => Number(kernel.getKv(`provider.cooldown.${p}`) ?? 0) > Date.now();
    const modelProvider = (m: ModelKey) => MODEL_PROVIDERS[m].find((p) => has(p) && !cooling(p));
    /** The agent's own model, unless it is missing or in a usage-limit cooldown → default chain. */
    const providerFor = (a: Agent): string | undefined => {
      const base = modelProvider(a.model);
      if (!base) return undefined;
      return a.provider ? (has(a.provider) && !cooling(a.provider) ? a.provider : base) : base;
    };
    const label = (mem: Member) => `${mem.emoji} ${mem.title} (${MODEL_LABEL[mem.model]}${mem.fellBack ? "→جایگزین" : ""})`;
    const result = (id?: string) => {
      const t = id ? kernel.getTask(id) : null;
      return t?.status === "succeeded" ? t.result : null;
    };

    const spawn = (mid: string, a: Agent, title: string, prompt: string, provider: string | undefined) => {
      const t = kernel.createTask({
        title: title.slice(0, 120),
        prompt,
        ...(provider ? { provider } : {}),
        capabilities: a.capabilities,
        context: a.context.filter((c) => kernel.listContextSources().some((x) => x.name === c)),
        source: "internal",
        verify: { type: "non_empty" },
        maxAttempts: provider ? 1 : 2,
        timeoutMs: 15 * 60_000,
      });
      kernel.setKv(`team.child.${t.id}`, mid);
      return t.id;
    };

    const startChair = (mid: string, m: Meeting) => {
      const sections: string[] = [];
      const votes: Array<{ model: ModelKey; emoji: string; vote: Vote | null }> = [];
      for (const mem of m.members) {
        const r1 = result(mem.taskId);
        const r2 = result(mem.r2TaskId);
        if (!r1 && !r2) continue;
        sections.push(`### ${label(mem)}\n${r1 ?? ""}${r2 ? `\n\n— دور دوم —\n${r2}` : ""}`);
        if (!m.quick) votes.push({ model: mem.model, emoji: mem.emoji, vote: parseVote(r2) });
      }
      if (!sections.length) {
        kernel.createTask({ title: "👥 جلسه‌ی تیم", prompt: `❌ هیچ عضوی جواب نداد (احتمالاً محدودیت مدل‌ها). بعداً دوباره: /team ${m.question}`, provider: "reminder", source: "team", verify: { type: "non_empty" }, maxAttempts: 1 });
        del(`team.meeting.${mid}`);
        return;
      }
      const chairProvider = has("claude-code") && !cooling("claude-code") ? "claude-code" : undefined;
      const chair = kernel.createTask({
        title: `👥 جلسه‌ی تیم: ${m.question}`.slice(0, 120),
        prompt: chairPrompt(m.question, sections, voteLine(votes)),
        ...(chairProvider ? { provider: chairProvider } : {}),
        source: "team",
        verify: { type: "contains", text: "🧭" },
        maxAttempts: 2,
      });
      m.chairTaskId = chair.id;
      save(mid, m);
      kernel.setKv(`team.chair.${chair.id}`, mid);
    };

    const saveMinutes = (m: Meeting, chairResult: string) => {
      if (!vault || !fs.existsSync(vault)) return;
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const dir = path.join(vault, folder);
      fs.mkdirSync(dir, { recursive: true });
      const views = m.members
        .map((mem) => `### ${label(mem)}\n${result(mem.taskId) ?? "(بدون جواب)"}${result(mem.r2TaskId) ? `\n\n**دور دوم:**\n${result(mem.r2TaskId)}` : ""}`)
        .join("\n\n");
      const body = ["---", `date: ${date}`, "tags: [team-meeting, elias-os]", "---", "", `# ${m.question}`, "", "## نتیجه‌ی جلسه", chairResult, "", "## نظر اعضا", views, ""].join("\n");
      let file = path.join(dir, `Meeting - ${safeName(m.question)} - ${date}.md`);
      for (let i = 2; fs.existsSync(file); i++) file = file.replace(/( \(\d+\))?\.md$/, ` (${i}).md`);
      fs.writeFileSync(file, body, "utf8");
    };

    kernel.addEventSink((e) => {
      if (!e.taskId || (e.type !== "task.succeeded" && e.type !== "task.failed")) return;
      const t = kernel.getTask(e.taskId);
      if (!t || !DONE.has(t.status)) return;

      // chair finished → save minutes, clean up
      const chairOf = kernel.getKv(`team.chair.${t.id}`);
      if (chairOf) {
        const m = getMeeting(chairOf);
        del(`team.chair.${t.id}`);
        del(`team.meeting.${chairOf}`);
        for (const mem of m?.members ?? []) {
          del(`team.child.${mem.taskId}`);
          if (mem.r2TaskId) del(`team.child.${mem.r2TaskId}`);
        }
        if (m && t.status === "succeeded") {
          try {
            saveMinutes(m, t.result ?? "");
          } catch (err) {
            kernel.log("team.save_failed", (err as Error).message, { level: "warn", taskId: t.id });
          }
        }
        return;
      }

      const mid = kernel.getKv(`team.child.${t.id}`);
      if (!mid) return;
      const m = getMeeting(mid);
      if (!m || m.chairTaskId) return;
      const mem = m.members.find((x) => x.taskId === t.id || x.r2TaskId === t.id);
      if (!mem) return;

      // the member's own model failed → run the same prompt once on the fallback chain
      if (t.status !== "succeeded" && t.provider !== kernel.defaultProviderName() && !mem.fellBack) {
        const a = byName(mem.name);
        if (a) {
          mem.fellBack = true;
          const id = spawn(mid, a, t.title, t.prompt, undefined);
          if (mem.r2TaskId === t.id) mem.r2TaskId = id;
          else mem.taskId = id;
          save(mid, m);
          kernel.log("team.fallback", `${mem.name}: ${MODEL_LABEL[mem.model]} failed → fallback chain`, { level: "warn", taskId: t.id });
          return;
        }
      }

      if (m.phase === 1) {
        if (!m.members.every((x) => DONE.has(kernel.getTask(x.taskId)?.status ?? ""))) return;
        const answered = m.members.filter((x) => result(x.taskId));
        if (m.quick || answered.length < 2) return startChair(mid, m);
        m.phase = 2;
        for (const x of answered) {
          const a = byName(x.name);
          if (!a) continue;
          const others = answered.filter((o) => o !== x).map((o) => ({ label: label(o), text: result(o.taskId)! }));
          x.r2TaskId = spawn(mid, a, `👥 ${x.emoji} ${x.title} · دور ۲: ${m.question}`, round2Prompt(a, m.question, result(x.taskId)!, others), x.fellBack ? undefined : providerFor(a));
          if (!x.fellBack && !providerFor(a)) x.fellBack = true;
        }
        save(mid, m);
        return;
      }
      if (m.members.every((x) => !x.r2TaskId || DONE.has(kernel.getTask(x.r2TaskId)?.status ?? ""))) startChair(mid, m);
    });

    kernel.registerCommand({
      name: "team",
      description: "جلسه‌ی تیم ایجنت‌ها روی Claude+ChatGPT+Gemini (/team سؤال · /team quick سؤال · /team @trader سؤال · /team agents)",
      plugin: "team",
      run(args) {
        const all = agents();
        let a = args.trim();
        if (!a) return "استفاده:\n/team سؤال — جلسه‌ی کامل (۲ دور + رأی)\n/team quick سؤال — یک دور، سریع\n/team @trader @critic سؤال — اعضای انتخابی\n/team agents — اعضای تیم";
        if (a === "agents") {
          return `👥 اعضای تیم (پوشه‌ی agents):\n${all
            .map((x) => `${x.emoji} @${x.name} — ${x.title} · ${MODEL_LABEL[x.model]}${x.provider === "claude-research" ? " + اینترنت" : ""}${x.only ? " (فقط سؤال‌های مرتبط)" : ""}${modelProvider(x.model) ? "" : " ⚠️ مدل در دسترس نیست → جایگزین"}`)
            .join("\n")}\n🧭 رئیس جلسه: Claude`;
        }
        const quick = /^quick\b|^سریع\b/i.test(a);
        if (quick) a = a.replace(/^(quick|سریع)\s*/i, "");
        const { members, question, unknown } = pickMembers(all, a);
        if (unknown.length) return `عضو ناشناخته: ${unknown.map((u) => "@" + u).join("، ")}\n/team agents`;
        if (!question) return "سؤال را هم بنویس.";
        if (!members.length) return "تیم خالی است؛ پوشه‌ی agents را چک کن.";
        const mid = Math.random().toString(36).slice(2, 10);
        const m: Meeting = { question, quick, phase: 1, members: [] };
        save(mid, m);
        for (const ag of members) {
          const prov = providerFor(ag);
          const taskId = spawn(mid, ag, `👥 ${ag.emoji} ${ag.title}: ${question}`, agentPrompt(ag, question), prov);
          m.members.push({ name: ag.name, emoji: ag.emoji, title: ag.title, model: ag.model, taskId, ...(prov ? {} : { fellBack: true }) });
        }
        save(mid, m);
        const models = [...new Set(members.map((x) => MODEL_LABEL[x.model]))].join(" + ");
        return `👥 جلسه شروع شد: ${members.map((x) => x.emoji).join(" ")} · ${models}\n${quick ? "یک دور، بعد جمع‌بندی." : "دور ۱ نظر مستقل → دور ۲ بحث و رأی → جمع‌بندی."} چند دقیقه…`;
      },
    });
  },
};
