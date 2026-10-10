// Local models via Ollama (free, offline, slower on CPU) — last line of the fallback chain.
import { ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest, type ExecutionResult, type ProviderHealth } from "./types.ts";

export class OllamaProvider implements ExecutionProvider {
  readonly name = "ollama";
  private url: string;
  private model: string;
  private system: () => string | null;
  constructor(o: { url?: string; model?: string; system?: () => string | null } = {}) {
    this.url = o.url ?? "http://127.0.0.1:11434";
    this.model = o.model ?? "qwen2.5:7b";
    this.system = o.system ?? (() => null);
  }

  async health(): Promise<ProviderHealth> {
    try {
      const r = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const j = (await r.json()) as { models?: { name: string }[] };
      const names = (j.models ?? []).map((m) => m.name);
      return names.some((n) => n.startsWith(this.model))
        ? { ok: true, detail: `ollama ${this.model}` }
        : { ok: false, detail: `ollama running, model ${this.model} not pulled (have: ${names.join(", ") || "none"})` };
    } catch {
      return { ok: false, detail: "ollama not running" };
    }
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    let r: Response;
    try {
      r = await fetch(`${this.url}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: req.prompt, stream: false, ...(this.system() ? { system: this.system() } : {}) }),
        signal: req.signal,
      });
    } catch (e) {
      if (req.signal.aborted) throw e;
      throw new ProviderUnavailableError("ollama not running");
    }
    const j = (await r.json()) as { response?: string; error?: string };
    if (!r.ok || j.error) throw new ProviderUnavailableError(`ollama: ${j.error ?? r.status}`);
    return { output: (j.response ?? "").trim(), meta: { provider: "ollama" } };
  }
}
