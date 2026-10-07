// "auto" provider: tries subscriptions in order; when one hits its limit it cools down and the next one answers.
import { LimitError, ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest, type ExecutionResult, type ProviderHealth } from "./types.ts";

export interface FallbackStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface FallbackEvents {
  onSkip?: (provider: string, reason: string, until: number) => void;
}

export class FallbackProvider implements ExecutionProvider {
  readonly name = "auto";
  private chain: ExecutionProvider[];
  private store: FallbackStore;
  private events: FallbackEvents;
  private now: () => number;
  readonly limitCooldownMs: number;
  readonly unavailableCooldownMs: number;

  constructor(chain: ExecutionProvider[], store: FallbackStore, events: FallbackEvents = {}, o: { now?: () => number; limitCooldownMs?: number; unavailableCooldownMs?: number } = {}) {
    this.chain = chain;
    this.store = store;
    this.events = events;
    this.now = o.now ?? Date.now;
    this.limitCooldownMs = o.limitCooldownMs ?? 60 * 60_000;
    this.unavailableCooldownMs = o.unavailableCooldownMs ?? 15 * 60_000;
  }

  coolingUntil(name: string): number {
    return Number(this.store.get(`provider.cooldown.${name}`) ?? 0);
  }

  private cool(name: string, until: number, reason: string): void {
    this.store.set(`provider.cooldown.${name}`, String(until));
    this.events.onSkip?.(name, reason, until);
  }

  async health(): Promise<ProviderHealth> {
    const parts: string[] = [];
    let ok = false;
    for (const p of this.chain) {
      const h = await p.health();
      const cool = this.coolingUntil(p.name) > this.now();
      ok ||= h.ok && !cool;
      parts.push(`${p.name}:${h.ok ? (cool ? "cooling" : "ok") : "off"}`);
    }
    return { ok, detail: parts.join(" → ") };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const errors: string[] = [];
    for (const p of this.chain) {
      if (this.coolingUntil(p.name) > this.now()) {
        errors.push(`${p.name}: cooling down`);
        continue;
      }
      try {
        const res = await p.execute(req);
        return { ...res, meta: { ...(res.meta ?? {}), provider: p.name } };
      } catch (e) {
        if (req.signal.aborted) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof LimitError) this.cool(p.name, e.resetAt ?? this.now() + this.limitCooldownMs, "limit");
        else if (e instanceof ProviderUnavailableError) this.cool(p.name, this.now() + this.unavailableCooldownMs, "unavailable");
        else throw e; // a real task error — let the kernel's retry/verify loop handle it
        errors.push(`${p.name}: ${msg.slice(0, 160)}`);
      }
    }
    throw new LimitError(`All providers are limited or unavailable — ${errors.join(" | ")}`);
  }
}
