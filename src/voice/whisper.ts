// Bridge to the local faster-whisper worker (voice/whisper_server.py). The model loads once and stays warm.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Transcript {
  text: string;
  language: string;
  duration: number;
  seconds: number;
}

export interface Transcriber {
  transcribe(file: string, language?: string | null): Promise<Transcript>;
  close(): void;
}

export interface WhisperOptions {
  /** Python executable (the venv created by setup/voice-setup.cmd). */
  python: string;
  script: string;
  model?: string;
  language?: string | null;
  modelDir?: string;
  /** Vocabulary hint for Whisper (initial_prompt), re-read on every call so edits apply at once. */
  prompt?: () => string | null;
  /** Max time for one transcription (ms). */
  timeoutMs?: number;
  /** Max time for the model to load (first run may download it). */
  startTimeoutMs?: number;
}

type Pending = { resolve: (t: Transcript) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class WhisperTranscriber implements Transcriber {
  private opts: WhisperOptions;
  private proc: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private stderr = "";

  constructor(opts: WhisperOptions) {
    this.opts = opts;
  }

  static venvPython(home: string): string {
    return process.platform === "win32"
      ? path.join(home, "data", "voice-venv", "Scripts", "python.exe")
      : path.join(home, "data", "voice-venv", "bin", "python");
  }

  static isInstalled(home: string): boolean {
    return fs.existsSync(WhisperTranscriber.venvPython(home));
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const p = spawn(this.opts.python, [this.opts.script], {
        env: {
          ...process.env,
          ELIAS_WHISPER_MODEL: this.opts.model ?? "small",
          ELIAS_WHISPER_LANG: this.opts.language ?? "",
          ELIAS_WHISPER_DIR: this.opts.modelDir ?? "",
          PYTHONIOENCODING: "utf-8",
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.proc = p;
      const startTimer = setTimeout(() => {
        reject(new Error("Speech model did not load in time"));
        this.close();
      }, this.opts.startTimeoutMs ?? 10 * 60_000);
      p.stderr!.on("data", (d) => (this.stderr = (this.stderr + d).slice(-4000)));
      p.on("error", (e) => {
        clearTimeout(startTimer);
        reject(new Error(`Cannot start Python: ${e.message}`));
      });
      p.on("exit", (code) => {
        clearTimeout(startTimer);
        const err = new Error(`Speech worker exited (${code}): ${this.stderr.trim().split("\n").slice(-3).join(" ")}`);
        for (const [, pend] of this.pending) (clearTimeout(pend.timer), pend.reject(err));
        this.pending.clear();
        this.proc = null;
        this.ready = null;
        reject(err);
      });
      createInterface({ input: p.stdout! }).on("line", (line) => {
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // library noise on stdout
        }
        if ("ready" in msg) {
          clearTimeout(startTimer);
          if (msg.ready) resolve();
          else reject(new Error(`Speech model failed to load: ${msg.error}`));
          return;
        }
        const pend = this.pending.get(msg.id);
        if (!pend) return;
        this.pending.delete(msg.id);
        clearTimeout(pend.timer);
        if (msg.error) pend.reject(new Error(msg.error));
        else pend.resolve({ text: msg.text ?? "", language: msg.language ?? "", duration: msg.duration ?? 0, seconds: msg.seconds ?? 0 });
      });
    });
    return this.ready;
  }

  async transcribe(file: string, language?: string | null): Promise<Transcript> {
    await this.start();
    const id = randomUUID();
    return new Promise<Transcript>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Transcription timed out"));
      }, this.opts.timeoutMs ?? 5 * 60_000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin!.write(JSON.stringify({ id, path: path.resolve(file), language: language ?? this.opts.language ?? null, prompt: this.opts.prompt?.() ?? null }) + "\n");
    });
  }

  close(): void {
    try {
      this.proc?.kill();
    } catch {
      /* already gone */
    }
    this.proc = null;
    this.ready = null;
  }
}
