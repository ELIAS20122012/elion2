// Gemini via the AI Studio REST API (free-tier key from aistudio.google.com/apikey). No CLI needed.
import { LimitError, ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest, type ExecutionResult, type ProviderHealth } from "./types.ts";

export class GeminiApiProvider implements ExecutionProvider {
  readonly name = "gemini";
  private key: () => string | null;
  private model: string;
  private system: () => string | null;
  /** system: the Elias OS persona (CLI agents read it from CLAUDE.md themselves; API models get it here) */
  constructor(o: { key: () => string | null; model?: string; system?: () => string | null }) {
    this.key = o.key;
    this.model = o.model ?? "gemini-3.8-flash"; // 2.5-flash is closed to new users (Google, 2026-10)
    this.system = o.system ?? (() => null);
  }

  async health(): Promise<ProviderHealth> {
    return this.key() ? { ok: true, detail: `Gemini API (${this.model})` } : { ok: false, detail: "no Gemini API key in config/secrets.json" };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const key = this.key();
    if (!key) throw new ProviderUnavailableError("no Gemini API key");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        ...(this.system() ? { systemInstruction: { parts: [{ text: this.system() }] } } : {}),
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      }),
      signal: req.signal,
    });
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string; status?: string } };
    if (res.status === 429 || j.error?.status === "RESOURCE_EXHAUSTED") throw new LimitError(`Gemini quota: ${j.error?.message ?? 429}`);
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new ProviderUnavailableError(`Gemini API key rejected: ${j.error?.message ?? res.status}`);
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${j.error?.message ?? ""}`);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty answer");
    return { output: text, meta: { provider: "gemini" } };
  }
}
