// "Hey Elion" desktop voice assistant. voice/listener.py (mic, wake word, hotkey) records the command and asks the
// daemon over the local dashboard API; the daemon transcribes it with the warm Whisper model, answers (instant
// command or AI task) and returns a .wav that the listener plays on the PC speakers. Everything also lands in Telegram.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Kernel } from "../kernel/kernel.ts";
import type { Transcriber } from "./whisper.ts";
import type { Speaker } from "./tts.ts";

const WAKE_NAME = "(?:ا?ِ?لیون|الیان|اِلیون|ایلیون|لیون|elion|ellion|elian|ilion|alien|eleon|aileen|elyon)";
const WAKE_RE = new RegExp(`^\\s*(?:(?:hey|hi|hay|a|هی|های|هِی|هـی)\\s*[,،.!]?\\s*)?${WAKE_NAME}\\s*[,،.!؟?]?\\s*`, "i");

/** Removes a leading "Hey Elion" (Persian or Latin spelling) from a transcript. */
export function stripWake(text: string): string {
  return text.replace(WAKE_RE, "").trim();
}

/** Spoken phrases that map to an instant command (same ones Telegram understands). */
export function naturalCommand(text: string): { cmd: string; args: string } | null {
  const t = text.trim().replace(/[.!؟?]+$/, "");
  let m = t.match(/^(?:یادم بنداز|یادم بیار|یادآوری کن|remind me)\s+(?:که\s+)?(.+)$/is);
  if (m) return { cmd: "remind", args: m[1]! };
  m = t.match(/^(?:تحقیق کن|research)\s+(?:درباره(?:‌ی|ی)?\s+)?(.+)$/is) ?? t.match(/^درباره(?:‌ی|ی)?\s+(.+?)\s+تحقیق کن$/is);
  if (m) return { cmd: "research", args: m[1]! };
  m = t.match(/^(?:از تیم بپرس|تیم نظر بده|جلسه بگذار(?: درباره(?:‌ی|ی)?)?)\s+(.+)$/is);
  if (m) return { cmd: "team", args: m[1]! };
  if (/^(?:وضعیت|سلامت) سیستم$/.test(t)) return { cmd: "health", args: "" };
  if (/^(?:حساب|وضعیت حساب|اکانت)(?: من| ام‌تی‌فور| mt4)?$/i.test(t)) return { cmd: "account", args: "" };
  if (/^(?:معامله‌ها|معاملات|پوزیشن‌ها)(?: باز)?(?: من)?$/.test(t)) return { cmd: "trades", args: "" };
  return null;
}

/** Commands the AI may trigger with `>>> /cmd` in a spoken answer (read-only or explicitly requested by voice). */
export const SPOKEN_ACTIONS = new Set(["account", "trades", "health", "report", "reminders", "notes", "find", "remind", "research", "team"]);

export function spokenPrompt(text: string): string {
  return [
    "(Spoken request from Elias via the desktop voice assistant \"Hey Elion\". The answer is read aloud:",
    "reply in Persian in 1–3 short natural sentences, no lists, no links, no markdown.",
    "If one of these Elias OS commands answers it, add one line `>>> /command args` — it runs automatically:",
    `${[...SPOKEN_ACTIONS].map((c) => "/" + c).join(" ")}.)`,
    "",
    text,
  ].join("\n");
}

export interface VoiceReply {
  heard?: string;
  text?: string;
  audio?: string;
  taskId?: string;
  wakeOnly?: boolean;
  done?: boolean;
}

export class VoiceAssistant {
  private k: Kernel;
  private transcriber: Transcriber;
  private speak: Speaker | null;
  constructor(k: Kernel, transcriber: Transcriber, speak: Speaker | null) {
    this.k = k;
    this.transcriber = transcriber;
    this.speak = speak;
  }

  private async withAudio(text: string): Promise<VoiceReply> {
    let audio: string | undefined;
    if (this.speak && text.trim()) {
      try {
        audio = await this.speak(text);
      } catch (e) {
        this.k.log("voice.tts_failed", (e as Error).message, { level: "warn" });
      }
    }
    return { text, ...(audio ? { audio } : {}), done: true };
  }

  private async runCommand(cmd: string, args: string): Promise<string | null> {
    const c = this.k.getCommand(cmd);
    if (!c) return null;
    try {
      return await c.run(args);
    } catch (e) {
      return `خطا: ${(e as Error).message}`;
    }
  }

  /** A recorded command (wav) or text → instant reply or a queued AI task. */
  async handle(input: { wav?: string; text?: string }): Promise<VoiceReply> {
    let heard = input.text ?? "";
    if (input.wav) {
      const t = await this.transcriber.transcribe(input.wav);
      heard = t.text;
      fs.rmSync(input.wav, { force: true });
    }
    const text = stripWake(heard);
    if (text.replace(/[\s.,،!؟?]/g, "").length < 2) return { heard, wakeOnly: true };
    this.k.log("voice.heard", text.slice(0, 200));
    const nat = naturalCommand(text);
    if (nat) {
      const reply = await this.runCommand(nat.cmd, nat.args);
      if (reply) return { heard: text, ...(await this.withAudio(reply)) };
    }
    const mem = this.k.listContextSources().some((c) => c.name === "memory:notes");
    const t = this.k.createTask({
      title: `🎙️ ${text.length > 55 ? text.slice(0, 52) + "…" : text}`,
      prompt: spokenPrompt(text),
      source: "voice-local",
      verify: { type: "non_empty" },
      ...(mem ? { capabilities: ["read:memory"], context: ["memory:notes"] } : {}),
    });
    return { heard: text, taskId: t.id, done: false };
  }

  /** Poll an AI task; when done, runs allowed `>>> /cmd` lines and returns the spoken answer. */
  async result(taskId: string): Promise<VoiceReply> {
    const t = this.k.getTask(taskId);
    if (!t || t.source !== "voice-local") return { done: true, text: "پیدا نشد." };
    if (t.status === "failed" || t.status === "cancelled") return this.withAudio("نتوانستم انجامش بدهم. جزئیات در تلگرام است.");
    if (t.status !== "succeeded") return { done: false };
    const key = `voice.spoken.${taskId}`;
    const cached = this.k.getKv(key);
    if (cached) return JSON.parse(cached) as VoiceReply;
    const lines = (t.result ?? "").split("\n");
    const said: string[] = [];
    for (const line of lines) {
      const m = line.trim().match(/^>>>\s*\/(\w+)\s*(.*)$/);
      if (!m) {
        said.push(line);
        continue;
      }
      if (!SPOKEN_ACTIONS.has(m[1]!)) continue;
      const r = await this.runCommand(m[1]!, m[2] ?? "");
      if (r) said.push(r);
    }
    const reply = await this.withAudio(said.join("\n").trim() || "انجام شد.");
    this.k.setKv(key, JSON.stringify(reply));
    return reply;
  }
}

/** Keeps voice/listener.py running (mic + wake word + hotkey). /listen on|off toggles it. */
export class ListenerProcess {
  private k: Kernel;
  private home: string;
  private python: string;
  private opts: { port: number; hotkey: string; wakeModel: string };
  private child: ChildProcess | null = null;
  private stopped = false;
  private fails = 0;
  private timer: NodeJS.Timeout | null = null;
  constructor(k: Kernel, home: string, python: string, opts: { port: number; hotkey?: string; wakeModel?: string }) {
    this.k = k;
    this.home = home;
    this.python = python;
    this.opts = { port: opts.port, hotkey: opts.hotkey ?? "ctrl+alt+e", wakeModel: opts.wakeModel ?? "tiny" };
  }

  enabled(): boolean {
    return this.k.getKv("voice.listener.enabled") !== "0";
  }

  /** sounddevice + keyboard in the voice venv (installed once, automatically). */
  private ensureDeps(): boolean {
    const check = () => spawnSync(this.python, ["-c", "import sounddevice, keyboard, numpy"], { windowsHide: true, timeout: 60_000 }).status === 0;
    if (check()) return true;
    this.k.log("voice.listener", "installing sounddevice + keyboard into the voice venv…");
    spawnSync(this.python, ["-m", "pip", "install", "--quiet", "sounddevice", "keyboard"], { windowsHide: true, timeout: 600_000 });
    return check();
  }

  start(): void {
    this.stopped = false;
    if (this.child || !this.enabled()) return;
    const script = path.join(this.home, "voice", "listener.py");
    if (!fs.existsSync(this.python) || !fs.existsSync(script)) return void this.k.log("voice.listener", "voice venv or listener.py missing", { level: "warn" });
    if (!this.ensureDeps()) return void this.k.log("voice.listener_failed", "could not install sounddevice/keyboard", { level: "warn" });
    const startedAt = Date.now();
    const child = spawn(this.python, [script], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        ELIAS_PORT: String(this.opts.port),
        ELIAS_HOTKEY: this.opts.hotkey,
        ELIAS_WAKE_MODEL: this.opts.wakeModel,
        ELIAS_WHISPER_DIR: path.join(this.home, "data", "models"),
        ELIAS_VOICE_TMP: path.join(this.home, "data", "voice-tmp"),
      },
    });
    this.child = child;
    this.k.setKv("voice.listener.state", JSON.stringify({ up: true, at: new Date().toISOString() }));
    const log = (d: Buffer) => {
      for (const line of d.toString("utf8").split(/\r?\n/).filter(Boolean)) this.k.log("voice.listener", line.slice(0, 300));
    };
    child.stdout?.on("data", log);
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString("utf8").trim();
      if (s && !/warn/i.test(s)) this.k.log("voice.listener", s.slice(-300), { level: "warn" });
    });
    child.on("exit", (code) => {
      this.child = null;
      this.k.setKv("voice.listener.state", JSON.stringify({ up: false, at: new Date().toISOString(), code }));
      if (this.stopped || !this.enabled()) return;
      this.fails = Date.now() - startedAt < 60_000 ? this.fails + 1 : 0;
      if (this.fails >= 5) return void this.k.log("voice.listener_failed", `listener keeps exiting (code ${code}) — gave up; /listen on to retry`, { level: "error" });
      this.timer = setTimeout(() => this.start(), 15_000 * this.fails + 5_000);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.child?.kill();
    this.child = null;
  }

  setEnabled(on: boolean): void {
    this.k.setKv("voice.listener.enabled", on ? "1" : "0");
    this.fails = 0;
    if (on) this.start();
    else this.stop();
  }

  running(): boolean {
    return !!this.child;
  }
}
