// The Execution Provider interface keeps the core model-agnostic.
// Claude Code (on Elias's subscription) is just the v0.1 runtime; ChatGPT, Gemini, local models,
// or plain code can be swapped in by implementing this interface.

export interface ExecutionRequest {
  taskId: string;
  runId: string;
  attempt: number;
  prompt: string;
  /** Aborted by the kernel on timeout or cancellation. Providers must stop work when it fires. */
  signal: AbortSignal;
}

export interface ExecutionResult {
  output: string;
  costUsd?: number;
  meta?: Record<string, unknown>;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string;
}

export interface ExecutionProvider {
  readonly name: string;
  health(): Promise<ProviderHealth>;
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
}

/** Thrown by providers for errors that retrying will not fix (auth missing, binary not installed...). */
export class ProviderUnavailableError extends Error {
  override name = "ProviderUnavailableError";
}

/** The provider hit a usage/rate limit. `resetAt` (ms epoch) if the provider told us when it resets. */
export class LimitError extends Error {
  override name = "LimitError";
  readonly resetAt: number | null;
  constructor(message: string, resetAt: number | null = null) {
    super(message);
    this.resetAt = resetAt;
  }
}

const LIMIT_RE = /usage limit|limit reached|rate.?limit|quota|resource_exhausted|too many requests|\b429\b|hit your .*limit|out of credits|insufficient credits/i;

/** Turns provider error text into a LimitError when it looks like a usage limit. */
export function limitOrError(text: string): Error {
  if (!LIMIT_RE.test(text)) return new Error(text);
  const epoch = text.match(/\|(\d{10})\b/); // Claude: "usage limit reached|1759500000"
  return new LimitError(text.slice(0, 500), epoch ? Number(epoch[1]) * 1000 : null);
}
