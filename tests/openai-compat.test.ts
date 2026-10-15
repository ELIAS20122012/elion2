import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_APIS, OpenAICompatProvider, pickModel } from "../src/providers/openai-compat.ts";
import { LimitError, ProviderUnavailableError } from "../src/providers/types.ts";
import { withFreeApis } from "../src/config.ts";

const groq = FREE_APIS.find((a) => a.name === "groq")!;
const or = FREE_APIS.find((a) => a.name === "openrouter")!;
const req = (prompt = "hi") => ({ taskId: "t", runId: "r", attempt: 1, prompt, signal: AbortSignal.timeout(5000) });

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const r = handler(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
}

test("free APIs: model picked by preference; OpenRouter only :free models; embeddings ignored", () => {
  assert.equal(pickModel(["whisper-large-v3", "llama-3.1-8b-instant", "openai/gpt-oss-120b"], groq), "openai/gpt-oss-120b");
  assert.equal(pickModel(["deepseek/deepseek-r1", "qwen/qwen3-235b-a22b:free", "x/y:free"], or), "qwen/qwen3-235b-a22b:free");
  assert.equal(pickModel(["text-embedding-3"], groq), null);
});

test("free APIs: chat call with persona, limit and key errors, no key = unavailable", async () => {
  let sent: Record<string, unknown> = {};
  const ok = new OpenAICompatProvider({
    api: groq, key: () => "k", system: () => "PERSONA",
    fetcher: fakeFetch((url, init) => {
      if (url.endsWith("/models")) return { body: { data: [{ id: "llama-3.1-8b-instant" }, { id: "openai/gpt-oss-120b" }] } };
      sent = JSON.parse(String(init!.body));
      return { body: { choices: [{ message: { content: "<think>x</think> سلام" } }] } };
    }),
  });
  const r = await ok.execute(req("hello"));
  assert.equal(r.output, "سلام");
  assert.equal(sent.model, "openai/gpt-oss-120b");
  assert.deepEqual((sent.messages as Array<{ role: string }>).map((m) => m.role), ["system", "user"]);
  assert.match((await ok.health()).detail, /gpt-oss-120b/);

  const limited = new OpenAICompatProvider({ api: groq, key: () => "k", model: "m", fetcher: fakeFetch(() => ({ status: 429, body: { error: { message: "Rate limit reached" } }, headers: { "retry-after": "30" } })) });
  await assert.rejects(limited.execute(req()), (e) => e instanceof LimitError && (e as LimitError).resetAt! > Date.now());
  const bad = new OpenAICompatProvider({ api: groq, key: () => "k", model: "m", fetcher: fakeFetch(() => ({ status: 401, body: { error: { message: "invalid key" } } })) });
  await assert.rejects(bad.execute(req()), ProviderUnavailableError);
  const none = new OpenAICompatProvider({ api: groq, key: () => null });
  assert.equal((await none.health()).ok, false);
  await assert.rejects(none.execute(req()), ProviderUnavailableError);
});

test("free APIs join the fallback chain before ollama, once", () => {
  assert.deepEqual(withFreeApis(["claude-code", "codex", "ollama"]), ["claude-code", "codex", "groq", "cerebras", "openrouter", "mistral", "ollama"]);
  assert.deepEqual(withFreeApis(["claude-code", "groq"]), ["claude-code", "groq", "cerebras", "openrouter", "mistral"]);
});
