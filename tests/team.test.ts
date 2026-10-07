import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { teamPlugin, loadAgents, pickMembers, parseAgent, parseVote, voteLine } from "../src/plugins/team.ts";
import type { ExecutionProvider } from "../src/providers/types.ts";

test("agents: defaults seeded with models, @-selection, old files get default model", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ag-")), "agents");
  const agents = loadAgents(dir);
  assert.deepEqual(agents.map((a) => `${a.name}:${a.model}`), ["business:chatgpt", "content:chatgpt", "critic:claude", "researcher:claude", "trader:gemini"]);
  assert.equal(parseAgent("---\ntitle: x\n---\nrole", "trader").model, "gemini");
  assert.equal(parseAgent("---\nmodel: GPT\n---\nrole", "zz").model, "chatgpt");
  const p = pickMembers(agents, "@trader @critic اکانت فاند بخرم؟");
  assert.deepEqual(p.members.map((a) => a.name), ["critic", "trader"]);
  assert.equal(p.question, "اکانت فاند بخرم؟");
  assert.deepEqual(pickMembers(agents, "@nobody x").unknown, ["nobody"]);
  assert.throws(() => parseAgent("no front matter", "x"));
});

test("votes: parse + consensus line", () => {
  assert.equal(parseVote("...\nرأی: مشروط — اگر"), "مشروط");
  assert.equal(parseVote("**رأی:** موافق"), "موافق");
  assert.equal(parseVote("بدون رأی"), null);
  assert.match(voteLine([{ model: "claude", emoji: "😈", vote: "موافق" }, { model: "gemini", emoji: "📈", vote: "موافق" }]), /✅ اجماع: موافق \(Claude، Gemini\)/);
  assert.match(voteLine([{ model: "claude", emoji: "😈", vote: "مخالف" }, { model: "gemini", emoji: "📈", vote: "موافق" }]), /بدون اجماع/);
});

function setup(failing: string[] = []) {
  const calls: string[] = [];
  const mk = (name: string): ExecutionProvider => ({
    name,
    health: async () => ({ ok: true, detail: "" }),
    execute: async (r) => {
      calls.push(name);
      if (failing.includes(name)) throw new Error("limit");
      if (r.prompt.includes("You chair")) return { output: `${r.prompt.split("\n").find((l) => l.startsWith("First line EXACTLY"))?.slice(19) ?? ""}\n🧭 تصمیم: انجام بده` };
      if (r.prompt.includes("Round 2")) return { output: `قبول دارم\nرأی: موافق — خوب است` };
      return { output: `نظر ${name}\nپیشنهاد من: x` };
    },
  });
  const k = new Kernel({ dbPath: ":memory:", providers: ["claude-code", "codex", "gemini-cli", "auto"].map(mk), defaultProvider: "auto" });
  k.registerProvider({ name: "reminder", health: async () => ({ ok: true, detail: "" }), execute: async (r) => ({ output: r.prompt }) });
  return { k, calls };
}

test("full meeting: 3 models, round 2 votes, consensus, minutes saved", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  const { k, calls } = setup();
  await teamPlugin.setup({ kernel: k, home, options: { vault } });
  assert.match(await k.getCommand("team")!.run("agents"), /Gemini/);
  assert.match(await k.getCommand("team")!.run("@business @critic @trader کانال تلگرام پولی بزنم؟"), /Claude \+ ChatGPT \+ Gemini|ChatGPT \+ Claude \+ Gemini/);
  while (await k.processNext()) {}
  assert.ok(["claude-code", "codex", "gemini-cli"].every((p) => calls.includes(p)));
  const chair = k.listTasks({ limit: 50 }).find((t) => t.source === "team");
  assert.equal(chair?.status, "succeeded");
  assert.equal(chair?.provider, "claude-code");
  assert.match(chair!.result!, /✅ اجماع: موافق/);
  assert.match(chair!.prompt, /دور دوم/);
  const dir = path.join(vault, "04 Knowledge", "Team Meetings");
  assert.match(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), "utf8"), /نتیجه‌ی جلسه[\s\S]*دور دوم/);
  assert.equal((k.db.prepare("SELECT COUNT(*) n FROM kv WHERE key LIKE 'team.%'").get() as { n: number }).n, 0);
});

test("quick meeting + failed model falls back to the chain", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
  const { k, calls } = setup(["gemini-cli"]);
  await teamPlugin.setup({ kernel: k, home, options: {} });
  await k.getCommand("team")!.run("quick @trader @critic سؤال");
  while (await k.processNext()) {}
  assert.ok(calls.includes("auto"));
  assert.ok(!k.listTasks({ limit: 50 }).some((t) => t.title.includes("دور ۲")));
  const chair = k.listTasks({ limit: 50 }).find((t) => t.source === "team");
  assert.match(chair!.prompt, /Gemini→جایگزین/);
  assert.equal(chair?.status, "succeeded");
});

test("gemini-vertex provider: request + quota mapping", async () => {
  const { GeminiVertexProvider } = await import("../src/providers/gemini-vertex.ts");
  let url = "";
  const ok = new GeminiVertexProvider({ token: async () => "tok", project: () => "proj-1", fetch: (async (u: string) => { url = u; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "سلام" }] } }] })); }) as unknown as typeof fetch });
  const r = await ok.execute({ taskId: "t", runId: "r", attempt: 1, prompt: "x", signal: new AbortController().signal });
  assert.equal(r.output, "سلام");
  assert.match(url, /us-central1-aiplatform.*projects\/proj-1.*gemini-2\.5-flash:generateContent/);
  const lim = new GeminiVertexProvider({ token: async () => "tok", project: () => "p", fetch: (async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 })) as unknown as typeof fetch });
  await assert.rejects(lim.execute({ taskId: "t", runId: "r", attempt: 1, prompt: "x", signal: new AbortController().signal }), /quota/);
  assert.equal((await new GeminiVertexProvider({ token: async () => "", project: () => null }).health()).ok, false);
});

test("trader joins whole-team meetings only for trading questions", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ag-")), "agents");
  const agents = loadAgents(dir);
  assert.ok(!pickMembers(agents, "روی یوتیوب تمرکز کنم یا اینستاگرام؟").members.some((a) => a.name === "trader"));
  assert.ok(pickMembers(agents, "الان طلا بخرم؟").members.some((a) => a.name === "trader"));
  assert.ok(pickMembers(agents, "@trader کانال جدید؟").members.some((a) => a.name === "trader"));
});
