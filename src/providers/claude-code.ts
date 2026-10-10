// v0.1 runtime: Claude Code CLI in headless mode, running on Elias's existing subscription (no API key).
// Swappable: the kernel only sees the ExecutionProvider interface.
import { spawn, spawnSync } from "node:child_process";
import {
  ProviderUnavailableError,
  limitOrError,
  type ExecutionProvider,
  type ExecutionRequest,
  type ExecutionResult,
  type ProviderHealth,
} from "./types.ts";

export interface ClaudeCodeOptions {
  /** CLI command; default "claude". */
  command?: string;
  model?: string;
  /** Tools Claude Code may use without asking, e.g. ["Read", "WebSearch"]. Empty = none beyond defaults. */
  allowedTools?: string[];
  maxTurns?: number;
  /** Working directory for the agent. */
  cwd?: string;
  /** Provider name (default "claude-code"); the PC agent is a second instance with more tools. */
  name?: string;
  /** MCP servers file (e.g. the browser), used with --strict-mcp-config. */
  mcpConfig?: string;
}

const isWin = process.platform === "win32";

export class ClaudeCodeProvider implements ExecutionProvider {
  readonly name: string;
  private opts: ClaudeCodeOptions;
  constructor(opts: ClaudeCodeOptions = {}) {
    this.opts = opts;
    this.name = opts.name ?? "claude-code";
  }

  private cmd(): string {
    return this.opts.command ?? "claude";
  }

  async health(): Promise<ProviderHealth> {
    const r = spawnSync(this.cmd(), ["--version"], { shell: isWin, encoding: "utf8", timeout: 20000 });
    if (r.error || r.status !== 0) {
      return { ok: false, detail: `"${this.cmd()} --version" failed: ${r.error?.message ?? r.stderr?.trim() ?? "exit " + r.status}` };
    }
    return { ok: true, detail: `Claude Code ${r.stdout.trim()}` };
  }

  buildArgs(): string[] {
    const args = ["-p", "--output-format", "json"];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.maxTurns) args.push("--max-turns", String(this.opts.maxTurns));
    if (this.opts.allowedTools?.length) args.push("--allowedTools", this.opts.allowedTools.join(","));
    if (this.opts.mcpConfig) args.push("--mcp-config", this.opts.mcpConfig, "--strict-mcp-config");
    return args;
  }

  execute(req: ExecutionRequest): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      // The prompt goes through stdin so no shell quoting is ever involved.
      const child = spawn(this.cmd(), this.buildArgs(), {
        shell: isWin,
        cwd: this.opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        req.signal.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () => {
        killTree(child.pid);
        finish(() => reject(new Error("aborted")));
      };
      req.signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) =>
        finish(() => reject(new ProviderUnavailableError(`Cannot start "${this.cmd()}": ${err.message}`))),
      );
      child.on("close", (code) => {
        finish(() => {
          if (code !== 0 && !stdout.trim()) {
            const msg = stderr.trim() || `exit code ${code}`;
            // "not recognized" (Windows) / "not found" (POSIX) means the CLI isn't installed.
            if (/not recognized|not found|ENOENT/i.test(msg)) return reject(new ProviderUnavailableError(msg));
            return reject(limitOrError(`claude exited ${code}: ${msg.slice(0, 2000)}`));
          }
          try {
            const j = JSON.parse(stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number; session_id?: string; subtype?: string };
            if (j.is_error) return reject(limitOrError(`Claude Code error (${j.subtype ?? "unknown"}): ${j.result ?? ""}`));
            // When the plan limit is hit, Claude Code may "succeed" with only the limit notice as the answer.
            if ((j.result ?? "").length < 300 && /usage limit|limit reached/i.test(j.result ?? "")) return reject(limitOrError(j.result ?? ""));
            resolve({
              output: j.result ?? "",
              costUsd: j.total_cost_usd,
              meta: { sessionId: j.session_id, subtype: j.subtype },
            });
          } catch {
            reject(new Error(`Unparseable Claude Code output: ${stdout.slice(0, 500)}`));
          }
        });
      });
      child.stdin.end(req.prompt);
    });
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
