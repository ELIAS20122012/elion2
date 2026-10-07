// Gemini on Vertex AI via Elias's Google OAuth (cloud-platform scope) — billed to his Google Cloud
// project (trial credit). Used because Gemini CLI's Google sign-in no longer works for individuals.
import { LimitError, ProviderUnavailableError, type ExecutionProvider, type ExecutionRequest, type ExecutionResult, type ProviderHealth } from "./types.ts";

export interface GeminiVertexOptions {
  token: (s: AbortSignal) => Promise<string>;
  project: () => string | null;
  model?: string;
  location?: string;
  fetch?: typeof fetch;
}

export class GeminiVertexProvider implements ExecutionProvider {
  readonly name = "gemini-vertex";
  private o: GeminiVertexOptions;
  constructor(o: GeminiVertexOptions) {
    this.o = o;
  }

  private model() {
    return this.o.model ?? "gemini-2.5-flash";
  }

  async health(): Promise<ProviderHealth> {
    return this.o.project() ? { ok: true, detail: `Vertex ${this.model()} (${this.o.project()})` } : { ok: false, detail: "Google not connected (google-setup.cmd)" };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const project = this.o.project();
    if (!project) throw new ProviderUnavailableError("Google not connected");
    const loc = this.o.location ?? "us-central1";
    let token: string;
    try {
      token = await this.o.token(req.signal);
    } catch (e) {
      throw new ProviderUnavailableError(`Google auth: ${(e as Error).message}`);
    }
    const res = await (this.o.fetch ?? fetch)(
      `https://${loc}-aiplatform.googleapis.com/v1/projects/${project}/locations/${loc}/publishers/google/models/${this.model()}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-goog-user-project": project },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: req.prompt }] }] }),
        signal: req.signal,
      },
    );
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string; status?: string } };
    if (res.status === 429 || j.error?.status === "RESOURCE_EXHAUSTED") throw new LimitError(`Vertex quota: ${j.error?.message ?? 429}`);
    if (res.status === 401 || res.status === 403) throw new ProviderUnavailableError(`Vertex denied: ${j.error?.message ?? res.status}`);
    if (!res.ok) throw new Error(`Vertex ${res.status}: ${j.error?.message ?? ""}`);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty answer");
    return { output: text, meta: { provider: "gemini-vertex" } };
  }
}
