// Loads optional config/elias.config.json and wires the kernel with its providers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kernel } from "./kernel/kernel.ts";
import { DEFAULT_POLICY, mergePolicy, type Policy } from "./kernel/permissions.ts";
import { EchoProvider } from "./providers/mock.ts";
import { ClaudeCodeProvider, type ClaudeCodeOptions } from "./providers/claude-code.ts";
import type { KernelEvent } from "./kernel/types.ts";
import { agyProvider, codexProvider, geminiProvider } from "./providers/cli.ts";
import { GeminiVertexProvider } from "./providers/gemini-vertex.ts";
import { GoogleAuth } from "./connectors/google.ts";
import { GeminiApiProvider } from "./providers/gemini-api.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import { FallbackProvider } from "./providers/fallback.ts";
import { loadBuiltinPlugins, loadLocalPlugins, type PluginsConfig } from "./plugins/host.ts";
import { BUILTIN_PLUGINS } from "./plugins/builtin.ts";
import { listClaudeSkills } from "./plugins/claude-skills.ts";

export interface EliasConfig {
  dbPath: string;
  defaultProvider: string;
  timezoneNote?: string;
  policy?: Partial<Policy>;
  claudeCode?: ClaudeCodeOptions;
  daemon?: { pollMs?: number };
  /** Local speech-to-text (faster-whisper). model: tiny|base|small|medium; language: "fa", "de", "en" or null = auto. */
  voice?: { model?: string; language?: string | null };
  /** "Hey Elion" desktop assistant: hotkey (default ctrl+alt+e), wake model (tiny|base), TTS voice. */
  voiceAssistant?: { enabled?: boolean; hotkey?: string; wakeModel?: string; voice?: string };
  /** Fallback order for the "auto" provider + per-provider options. */
  providers?: {
    chain?: string[];
    codex?: { command?: string; model?: string };
    geminiCli?: { command?: string; model?: string };
    /** Antigravity CLI (`agy`). Off until "enabled": true — turn it on after antigravity-setup.cmd prints OK. */
    antigravity?: { enabled?: boolean; command?: string; model?: string };
    vertex?: { model?: string; location?: string };
    gemini?: { command?: string; model?: string };
    ollama?: { url?: string; model?: string };
  };
  /** Disable plugins or pass them options: { "disabled": ["google"], "options": { "<plugin>": {...} } } */
  plugins?: PluginsConfig;
  /** Folder with Claude skills (SKILL.md folders or .zip) — synced into the agent workspace on daemon start. */
  claudeSkills?: { dir?: string };
  /** Local web dashboard inside the daemon (127.0.0.1 only). */
  dashboard?: { enabled?: boolean; port?: number; publicHost?: string; ownerEmail?: string };
  /** Cloudflare Tunnel run by the daemon (token in secrets.json → tunnel.token). */
  tunnel?: { enabled?: boolean };
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = process.env.ELIAS_HOME ? path.resolve(process.env.ELIAS_HOME) : ROOT;
export const CONFIG_PATH = path.join(HOME, "config", "elias.config.json");
export const SECRETS_PATH = path.join(HOME, "config", "secrets.json");
export const CONFIG_DIR = path.join(HOME, "config");

export interface Secrets {
  telegram?: { botToken?: string };
  gemini?: { apiKey?: string };
  tunnel?: { token?: string };
}

/** Secrets live in config/secrets.json (git-ignored) or env vars — never in elias.config.json. */
export function loadSecrets(): Secrets {
  let s: Secrets = {};
  if (fs.existsSync(SECRETS_PATH)) {
    const raw = fs.readFileSync(SECRETS_PATH, "utf8").replace(/^\uFEFF/, "");
    try {
      s = JSON.parse(raw) as Secrets;
    } catch {
      throw new Error(`config/secrets.json is not valid JSON — check the quotes around the token`);
    }
  }
  const envToken = process.env.ELIAS_TELEGRAM_TOKEN;
  if (envToken) s.telegram = { ...s.telegram, botToken: envToken };
  return s;
}

export function telegramToken(): string | null {
  const t = loadSecrets().telegram?.botToken?.trim();
  return t && /^\d+:[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
}

export function loadConfig(): EliasConfig {
  const defaults: EliasConfig = { dbPath: path.join(HOME, "data", "elias.db"), defaultProvider: "auto" };
  if (!fs.existsSync(CONFIG_PATH)) return defaults;
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<EliasConfig>;
  return {
    ...defaults,
    ...raw,
    dbPath: raw.dbPath ? path.resolve(HOME, raw.dbPath) : defaults.dbPath,
  };
}

export const WORKSPACE = path.join(HOME, "data", "workspace");

const PERSONA = `# Elias OS

You are **Elias OS**, Elias's personal assistant and agent. You are NOT working on a codebase
unless a task explicitly says so — never comment on "this is not a coding task".

- Answer in the language of the request (usually Persian), directly and practically.
- Elias builds AI systems (Elias OS, Elion Group) and runs social media / content channels on many topics.
  Trading (MT4) is only ONE small, separate part of his work. Never frame, judge or steer unrelated requests,
  content, ideas or advice through trading; bring up trading only when the request itself is about trading.
- Replies are read in Telegram: short paragraphs, simple lists, **bold** for headings, no tables.
- Do not invent facts about Elias's accounts, email or calendar; say what data you lack.
- Only claim abilities listed under "What Elias OS can do" below. You cannot send email, post, trade
  or create files for Elias unless a listed skill does it.
- When Elias asks for something one of the /commands below does (make a short, remind me, AI video, lot size…),
  answer briefly and end with ONE line exactly like: \`>>> /short مدیریت ریسک برای مبتدی‌ها\` — Elias gets a ▶️ button
  to run it. Never claim you already did it.
- Video: /ai = real AI-generated video (images + Veo) — use it for any described scene, visual prompt or style;
  /short = only a simple text-slide explainer with voice-over. If unsure, choose /ai.
- His video series for YouTube Shorts / Instagram Reels is "Mini Rescue" (a giant hand rescues tiny miniature
  villagers). "Make a video" with no topic → \`>>> /ai\` (next episode); with an idea → \`>>> /ai <idea>\`.
`;

/** Rewrites CLAUDE.md + AGENTS.md (read by Claude Code / Codex) with the live list of skills and commands.
 *  Elias's own additions go in data/workspace/PERSONA.local.md and are appended. */
export function writePersona(kernel: Kernel): void {
  const dir = ensureWorkspace();
  const local = path.join(dir, "PERSONA.local.md");
  const extra = fs.existsSync(local) ? `\n${fs.readFileSync(local, "utf8").trim()}\n` : "";
  const lines = [
    ...kernel.listSkills().map((k) => `- /${k.name} — ${k.description}`),
    ...kernel.listCommands().map((c) => `- /${c.name} — ${c.description}`),
    "- /status /tasks /approvals /retry /cancel — system control",
    "- Any plain message becomes a task answered by AI (Claude → ChatGPT → Gemini → local fallback)",
    "- Voice messages are transcribed locally and handled like text",
    "- Photos/PDFs/files Elias sends land in inbox/ — read them with your file tools when a task points to one",
    `- Data sources (read-only): ${kernel.listContextSources().map((c) => c.name).join(", ")}`,
    "- Daily 08:00 morning briefing in Telegram",
  ];
  const cs = listClaudeSkills(dir);
  if (cs.length) lines.push(`- ${cs.length} installed Claude skills in .claude/skills (use them when a request matches)`);
  const text = `<!-- generated by Elias OS on start — edit PERSONA.local.md instead -->\n${PERSONA}\n## What Elias OS can do\n${lines.join("\n")}\n${extra}`;
  for (const f of ["CLAUDE.md", "AGENTS.md"]) fs.writeFileSync(path.join(dir, f), text, "utf8");
}

/** Agents run in their own workspace (not the source tree) with a persona file Claude Code reads. */
export function ensureWorkspace(): string {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const persona = path.join(WORKSPACE, "CLAUDE.md");
  if (!fs.existsSync(persona)) fs.writeFileSync(persona, PERSONA, "utf8");
  return WORKSPACE;
}

function vertexGemini(cfg: EliasConfig): GeminiVertexProvider {
  const g = new GoogleAuth(path.join(HOME, "config"));
  return new GeminiVertexProvider({
    token: (s) => g.accessToken(s),
    project: () => (g.isAuthorized() ? g.projectId() : null),
    model: cfg.providers?.vertex?.model,
    location: cfg.providers?.vertex?.location,
  });
}

export function createKernel(cfg = loadConfig(), onEvent?: (e: Omit<KernelEvent, "id">) => void): Kernel {
  const policy: Policy = mergePolicy(DEFAULT_POLICY, cfg.policy);
  const kernel = new Kernel({
    dbPath: cfg.dbPath,
    policy,
    defaultProvider: cfg.defaultProvider,
    providers: [
      new EchoProvider(),
      new ClaudeCodeProvider({ cwd: ensureWorkspace(), ...(cfg.claudeCode ?? {}) }),
      codexProvider({ cwd: ensureWorkspace(), ...(cfg.providers?.codex ?? {}) }),
      // Gemini CLI = Google account login (free); "gemini" below is the API-key provider.
      geminiProvider({ cwd: ensureWorkspace(), ...(cfg.providers?.geminiCli ?? {}), name: "gemini-cli" }),
      // Antigravity CLI (free, Google account) replaces Gemini CLI for /team; only registered when enabled in config.
      ...(cfg.providers?.antigravity?.enabled
        ? [agyProvider({ cwd: ensureWorkspace(), command: cfg.providers.antigravity.command, model: cfg.providers.antigravity.model })]
        : []),
      // Gemini on Vertex (Google OAuth, Cloud trial credit). Not in the default fallback chain — used by /team.
      vertexGemini(cfg),
      new GeminiApiProvider({
        key: () => loadSecrets().gemini?.apiKey?.trim() || process.env.GEMINI_API_KEY || null,
        model: cfg.providers?.gemini?.model,
      }),
      new OllamaProvider(cfg.providers?.ollama ?? {}),
    ],
    onEvent,
  });
  const byName = new Map(kernel.listProviders().map((p) => [p.name, p]));
  const chain = (cfg.providers?.chain ?? ["claude-code", "codex", "gemini", "ollama"]).map((n) => byName.get(n)).filter((p) => !!p);
  kernel.registerProvider(
    new FallbackProvider(chain, { get: (k) => kernel.getKv(k), set: (k, v) => kernel.setKv(k, v) }, {
      onSkip: (name, reason, until) =>
        kernel.log("provider.fallback", `${name} ${reason} — skipped until ${new Date(until).toISOString()}`, { level: "warn", data: { provider: name, reason, until } }),
    }),
  );
  loadBuiltinPlugins(kernel, BUILTIN_PLUGINS, HOME, cfg.plugins);
  return kernel;
}

/** Built-ins + local plugins from <home>/plugins (async: they are imported at startup). */
export async function createKernelWithPlugins(cfg = loadConfig(), onEvent?: (e: Omit<KernelEvent, "id">) => void): Promise<Kernel> {
  const kernel = createKernel(cfg, onEvent);
  await loadLocalPlugins(kernel, HOME, cfg.plugins);
  try {
    writePersona(kernel);
  } catch (e) {
    kernel.log("persona.failed", (e as Error).message, { level: "warn" });
  }
  return kernel;
}
