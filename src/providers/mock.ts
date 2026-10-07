import {
  ProviderUnavailableError,
  type ExecutionProvider,
  type ExecutionRequest,
  type ExecutionResult,
  type ProviderHealth,
} from "./types.ts";

/** Deterministic provider for smoke tests and dry runs: echoes the prompt. */
export class EchoProvider implements ExecutionProvider {
  readonly name = "echo";
  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "built-in echo provider" };
  }
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    return { output: `ECHO(attempt ${req.attempt}): ${req.prompt}` };
  }
}

export type ScriptStep =
  | { output: string; delayMs?: number }
  | { error: string; delayMs?: number; unavailable?: boolean }
  | { hang: true };

/** Test provider that plays back a fixed script of outputs / errors / hangs, one per call. */
export class ScriptedProvider implements ExecutionProvider {
  readonly name: string;
  readonly calls: ExecutionRequest[] = [];
  private steps: ScriptStep[];
  constructor(steps: ScriptStep[], name = "scripted") {
    this.steps = [...steps];
    this.name = name;
  }
  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "scripted" };
  }
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    this.calls.push(req);
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedProvider: script exhausted");
    if ("hang" in step) {
      return new Promise((_, reject) => {
        req.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    if ("error" in step) {
      throw step.unavailable ? new ProviderUnavailableError(step.error) : new Error(step.error);
    }
    return { output: step.output };
  }
}
