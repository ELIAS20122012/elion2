// Core domain types for the Elias OS kernel.
// Nothing here knows about trading, content, email, etc. — those are plugins.

export const TASK_STATUSES = [
  "queued",
  "awaiting_approval",
  "running",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["succeeded", "failed", "cancelled"];

/** Real, distinguishable failure states (never a silent "done"). */
export type FailureKind =
  | "provider_error"
  | "provider_unavailable"
  | "timeout"
  | "verification_failed"
  | "permission_denied"
  | "rejected"
  | "crashed"
  | "context_unavailable"
  | "context_error"
  | "rate_limited";

export type VerifySpec =
  | { type: "none" }
  | { type: "non_empty" }
  | { type: "contains"; text: string }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json"; requiredKeys?: string[] };

export interface TaskInput {
  title: string;
  prompt: string;
  provider?: string;
  capabilities?: string[];
  /** Named context sources (e.g. "gmail:recent") whose data is fetched and appended to the prompt. */
  context?: string[];
  verify?: VerifySpec;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  source?: string;
  scheduleId?: string | null;
  parentId?: string | null;
  /** ISO time; the task waits in the queue until then (reminders, delayed jobs). */
  notBefore?: string | null;
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  provider: string;
  status: TaskStatus;
  capabilities: string[];
  context: string[];
  verify: VerifySpec;
  priority: number;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  result: string | null;
  error: string | null;
  failureKind: FailureKind | null;
  source: string;
  scheduleId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  notBefore: string | null;
}

export type RunStatus = "running" | "succeeded" | "failed" | "crashed";

export interface Run {
  id: string;
  taskId: string;
  attempt: number;
  provider: string;
  status: RunStatus;
  output: string | null;
  error: string | null;
  failureKind: FailureKind | null;
  feedback: string | null;
  costUsd: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  taskId: string;
  capability: string;
  status: ApprovalStatus;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  note: string | null;
}

export type EventLevel = "debug" | "info" | "warn" | "error";

export interface KernelEvent {
  id: number;
  ts: string;
  level: EventLevel;
  type: string;
  taskId: string | null;
  runId: string | null;
  message: string;
  data: unknown;
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  template: TaskInput;
  enabled: boolean;
  lastFiredAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

/** A read-only data source the kernel can fetch for a task. Requires `capability` on the task. */
export interface ContextSource {
  name: string;
  capability: string;
  description: string;
  fetch(signal: AbortSignal): Promise<string>;
}

/** Thrown by a context source that is not configured (e.g. Google not authorized). Not retried. */
export class ContextUnavailableError extends Error {
  override name = "ContextUnavailableError";
}

/** A named task template ("/brief", "elias skill run brief"). Contributed by plugins or skills/*.md. */
export interface Skill {
  /** Telegram-safe command name: a-z, 0-9, _ (max 32). */
  name: string;
  description: string;
  plugin: string;
  build(input: string): TaskInput;
}

/** An instant command (no AI, no task) — e.g. /remember. Returns the reply text. */
export interface Command {
  name: string;
  description: string;
  plugin: string;
  run(args: string): string | Promise<string>;
}
