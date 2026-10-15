// Free OpenAI-compatible APIs (Groq, Cerebras, OpenRouter, Mistral): one class, a free key each.
// Keys live in config/secrets.json → "free": { "groq": "...", ... } (setup/free-ai-keys.cmd writes them).
// The model is picked from the provider's own /models list by preference, so renamed models do not break it;
// set providers.<name>.model in elias.config.json to force one.
import { LimitError, ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest, type ExecutionResult, type ProviderHealth } from "./types.ts";

export interface FreeApi {
  name: string;
  label: string;
  baseUrl: string;
  signup: string;
  /** model ids tried in order (regex on the /models list); the first match wins */
  prefer: RegExp[];
  /** only models matching this are allowed at all (e.g. OpenRouter ":free") */
  only?: RegExp;
}

export const FREE_APIS: FreeApi[] = [
  { name: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", signup: "https://console.groq.com/keys",
    prefer: [/gpt-oss-120b/i, /qwen.*3.*(235|32)/i, /llama.*(4|3\.3).*70/i, /kimi/i, /gpt-oss/i] },
  { name: "cerebras", label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", signup: "https://cloud.cerebras.ai",
    prefer: [/gpt-oss-120b/i, /qwen.*3.*235/i, /llama.*70/i, /qwen/i] },
  { name: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", signup: "https://openrouter.ai/keys",
    only: /:free$/, prefer: [/deepseek.*(r1|v3|chat)/i, /qwen.*3.*(235|coder)/i, /gpt-oss-120b/i, /llama.*70/i] },
  { name: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", signup: "https://console.mistral.ai/api-keys",
    prefer: [/^mistral-medium-latest$/, /^mistral-large-latest$/, /^mistral-small-latest$/] },
];

export function pickModel(ids: string[], api: Pick<FreeApi, "prefer" | "only">): string | null {
  const ok = ids.filter((id) => (api.only ? api.only.test(id) : true) && !/embed|whisper|tts|guard|moderation|vision-only|ocr/i.test(id));
  for (const re of api.prefer) {
    const hit = ok.find((id) => re.test(id));
    if (hit) return hit;
  }
  return ok[0] ?? null;
}

export class OpenAICompatProvider implements ExecutionProvider {
  readonly name: string;
  private api: FreeApi;
  private key: () => string | null;
  private model: string | null;
  private system: () => string | null;
  private fetcher: typeof fetch;

  constructor(o: { api: FreeApi; key: () => string | null; model?: string; system?: () => string | null; fetcher?: typeof fetch }) {
    this.api = o.api;
    this.name = o.api.name;
    this.key = o.key;
    this.model = o.model ?? null;
    this.system = o.system ?? (() => null);
    this.fetcher = o.fetcher ?? fetch;
  }

  private headers(key: string): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${key}`, ...(this.name === "openrouter" ? { "x-title": "Elion" } : {}) };
  }

  private async resolveModel(key: string, signal?: AbortSignal): Promise<string> {
    if (this.model) return this.model;
    const res = await this.fetcher(`${this.api.baseUrl}/models`, { headers: this.headers(key), signal });
    if (res.status === 401 || res.status === 403) throw new ProviderUnavailableError(`${this.api.label} key rejected (${res.status})`);
    if (!res.ok) throw new Error(`${this.api.label} /models ${res.status}`);
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    const m = pickModel((j.data ?? []).map((x) => String(x.id ?? "")).filter(Boolean), this.api);
    if (!m) throw new ProviderUnavailableError(`${this.api.label}: no usable free model`);
    this.model = m;
    return m;
  }

  async health(): Promise<ProviderHealth> {
    const key = this.key();
    if (!key) return { ok: false, detail: `no ${this.api.label} key (setup/free-ai-keys.cmd)` };
    try {
      return { ok: true, detail: `${this.api.label} (${await this.resolveModel(key, AbortSignal.timeout(15_000))})` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const key = this.key();
    if (!key) throw new ProviderUnavailableError(`no ${this.api.label} key`);
    const model = await this.resolveModel(key, req.signal);
    const sys = this.system();
    const res = await this.fetcher(`${this.api.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(key),
      body: JSON.stringify({ model, messages: [...(sys ? [{ role: "system", content: sys }] : []), { role: "user", content: req.prompt }] }),
      signal: req.signal,
    });
    let j: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string } = {};
    try {
      j = (await res.json()) as typeof j;
    } catch {
      /* non-JSON error page */
    }
    const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "";
    if (res.status === 429 || /rate.?limit|quota|exhausted|too many/i.test(msg)) {
      const retry = Number(res.headers.get("retry-after") ?? "");
      throw new LimitError(`${this.api.label} limit: ${msg || 429}`, retry > 0 ? Date.now() + retry * 1000 : null);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderUnavailableError(`${this.api.label} key rejected: ${msg || res.status}`);
    if (res.status === 404) this.model = null; // model renamed/removed: pick again next time
    if (!res.ok) throw new Error(`${this.api.label} ${res.status}: ${msg}`);
    const text = (j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw new Error(`${this.api.label} returned an empty answer`);
    return { output: text, meta: { provider: this.name, model } };
  }
}
