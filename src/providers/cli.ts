// Subscription CLIs as providers: Codex CLI (ChatGPT plan), Gemini CLI and Antigravity CLI (Google account, free tier).
// Prompt goes through stdin — no shell quoting — except Antigravity, which takes it as the -p argument (see agyProvider).
// All run read-only (no file edits, no shell).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ProviderUnavailableError,
  limitOrError,
  type ExecutionProvider,
  type ExecutionRequest,
  type ExecutionResult,
  type ProviderHealth,
} from "./types.ts";

const isWin = process.platform === "win32";
/** With shell:true on Windows, args containing spaces must be quoted. */
const q = (s: string) => (isWin ? `"${s}"` : s);

export interface CliSpec {
  name: string;
  command: string;
  args: (outFile: string, prompt: string) => string[];
  /** "stdin" (default): prompt is written to stdin. "arg": the prompt is part of args() and stdin stays empty. */
  promptAs?: "stdin" | "arg";
  /** Run through cmd.exe on Windows (default true: needed for .cmd shims like npm's). Native .exe CLIs set false. */
  shell?: boolean;
  /** Read the answer: from the out-file if the CLI writes one, else stdout. */
  usesOutFile: boolean;
  cwd?: string;
  model?: string;
}

export class CliProvider implements ExecutionProvider {
  readonly name: string;
  private spec: CliSpec;
  constructor(spec: CliSpec) {
    this.spec = spec;
    this.name = spec.name;
  }

  async health(): Promise<ProviderHealth> {
    const r = spawnSync(this.spec.command, ["--version"], { shell: this.useShell, encoding: "utf8", timeout: 20000, windowsHide: true });
    return r.status === 0 ? { ok: true, detail: `${this.spec.command} ${r.stdout.trim().split("\n")[0]}` } : { ok: false, detail: `${this.spec.command} not found` };
  }

  private get useShell(): boolean {
    return this.spec.shell ?? isWin;
  }

  execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const outFile = path.join(os.tmpdir(), `elias-${randomUUID()}.txt`);
    return new Promise((resolve, reject) => {
      const child = spawn(this.spec.command, this.spec.args(outFile, req.prompt), { shell: this.useShell, cwd: this.spec.cwd, windowsHide: true });
      let stdout = "";
      let stderr = "";
      const kill = () => {
        try {
          if (isWin && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          else child.kill();
        } catch {
          /* gone */
        }
      };
      req.signal.addEventListener("abort", kill, { once: true });
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => reject(new ProviderUnavailableError(`Cannot start ${this.spec.command}: ${e.message}`)));
      child.on("close", (code) => {
        req.signal.removeEventListener("abort", kill);
        let out = stdout;
        if (this.spec.usesOutFile && fs.existsSync(outFile)) {
          out = fs.readFileSync(outFile, "utf8");
          fs.rmSync(outFile, { force: true });
        }
        const all = `${stderr}\n${stdout}`;
        if (code !== 0) {
          if (/not recognized|not found|ENOENT/i.test(all)) return reject(new ProviderUnavailableError(`${this.spec.command} is not installed`));
          if (/login|auth|sign in|unauthorized/i.test(all) && !/limit|quota/i.test(all)) return reject(new ProviderUnavailableError(`${this.spec.command} is not logged in`));
          return reject(limitOrError(`${this.spec.name} exited ${code}: ${all.trim().slice(-1500)}`));
        }
        if (!out.trim()) return reject(limitOrError(`${this.spec.name} returned no answer: ${stderr.trim().slice(-500)}`));
        resolve({ output: out.trim(), meta: { provider: this.spec.name } });
      });
      child.stdin.on("error", () => {
        /* the CLI exited before reading stdin — the close handler reports it */
      });
      child.stdin.end(this.spec.promptAs === "arg" ? undefined : req.prompt);
    });
  }
}

export function codexProvider(o: { command?: string; model?: string; cwd?: string } = {}): CliProvider {
  return new CliProvider({
    name: "codex",
    command: o.command ?? "codex",
    usesOutFile: true,
    cwd: o.cwd,
    args: (outFile) => [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      ...(o.model ? ["--model", o.model] : []),
      "--output-last-message",
      q(outFile),
      "-",
    ],
  });
}

export function geminiProvider(o: { command?: string; model?: string; cwd?: string; name?: string } = {}): CliProvider {
  return new CliProvider({
    name: o.name ?? "gemini",
    command: o.command ?? "gemini",
    usesOutFile: false,
    cwd: o.cwd,
    // stdin (the task) is prepended to -p; -p only tells it to answer that.
    args: () => [...(o.model ? ["-m", o.model] : []), "-p", q("Answer the request above.")],
  });
}

/**
 * Antigravity CLI (`agy`, Google's replacement for Gemini CLI). Official headless form: `agy [flags] -p "<prompt>"`.
 * -p takes the prompt as its value and stdin-only prompting is not documented, so the prompt is passed as the argument
 * (flags BEFORE -p). agy is a native binary, so no cmd.exe: Node quotes the argument itself (limit ≈ 32k chars on Windows).
 * No permission-skipping flag on purpose: headless runs stay read-only/policy-gated like the other CLI providers.
 */
export function agyArgs(o: { model?: string } = {}): (outFile: string, prompt: string) => string[] {
  return (_outFile, prompt) => [...(o.model ? ["--model", o.model] : []), "-p", prompt];
}

export function agyProvider(o: { command?: string; model?: string; cwd?: string; name?: string } = {}): CliProvider {
  return new CliProvider({
    name: o.name ?? "antigravity",
    command: o.command ?? "agy",
    usesOutFile: false,
    promptAs: "arg",
    shell: false,
    cwd: o.cwd,
    args: agyArgs(o),
  });
}
