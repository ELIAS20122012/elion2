import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { parseSkillMd, loadSkillDir } from "../src/plugins/markdown-skills.ts";
import { loadBuiltinPlugins, loadLocalPlugins, loadedPlugins } from "../src/plugins/host.ts";
import { BUILTIN_PLUGINS } from "../src/plugins/builtin.ts";
import { TelegramInterface } from "../src/interfaces/telegram.ts";

const mk = () => new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", retryBaseMs: 0 });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "elias-plugins-"));

test("markdown skill: front matter → task with input substituted", () => {
  const s = parseSkillMd("---\nname: Mail\ndescription: ایمیل\ncapabilities: read:email\ncontext: gmail:recent\nverify: contains:📧\ntimeout: 60\n---\nCheck mail. Focus: {{input}}", "x");
  assert.equal(s.name, "mail");
  const t = s.build("بانک");
  assert.match(t.prompt, /Focus: بانک/);
  assert.deepEqual(t.capabilities, ["read:email"]);
  assert.deepEqual(t.context, ["gmail:recent"]);
  assert.deepEqual(t.verify, { type: "contains", text: "📧" });
  assert.equal(t.timeoutMs, 60_000);
  assert.match(parseSkillMd("---\n---\nHi", "hi").build("more").prompt, /Request from Elias: more/);
});

test("broken skill files are reported, not fatal", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "ok.md"), "---\ndescription: ok\n---\nprompt");
  fs.writeFileSync(path.join(dir, "bad.md"), "no front matter");
  const r = loadSkillDir(dir);
  assert.deepEqual(r.skills.map((s) => s.name), ["ok"]);
  assert.match(r.errors[0]!, /bad\.md/);
});

test("built-in plugins register sources + brief skill; disabled ones are skipped", async () => {
  const k = mk();
  loadBuiltinPlugins(k, BUILTIN_PLUGINS, tmp(), { disabled: ["google"] });
  assert.deepEqual(loadedPlugins(k).map((p) => p.name), ["core", "memory", "briefing", "trading", "youtube", "video", "aivideo", "reminders", "maintenance", "vault", "mt4", "health", "research", "team", "website", "skills"]);
  assert.ok(k.listContextSources().some((c) => c.name === "tasks:open"));
  assert.ok(!k.listContextSources().some((c) => c.name === "gmail:recent"));
  const t = k.runSkill("brief", "", "cli");
  assert.equal(t.title, "گزارش صبح");
  assert.throws(() => k.registerSkill({ name: "Bad-Name", description: "", plugin: "x", build: () => ({ title: "", prompt: "" }) }));
});

test("local plugins load from plugins/; failures are recorded", async () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, "plugins", "good"), { recursive: true });
  const typesUrl = new URL("../src/plugins/types.ts", import.meta.url).href;
  fs.writeFileSync(
    path.join(home, "plugins", "good", "index.ts"),
    `import type { Plugin } from ${JSON.stringify(typesUrl)};\nconst p: Plugin = { name: "good", description: "g", setup({ kernel, options }) { kernel.registerSkill({ name: "hi", description: String(options.d), plugin: "good", build: (i) => ({ title: "hi", prompt: i }) }); } };\nexport default p;\n`,
  );
  fs.writeFileSync(path.join(home, "plugins", "broken.mjs"), "export default { nope: true };");
  fs.mkdirSync(path.join(home, "plugins", "_example"));
  fs.writeFileSync(path.join(home, "plugins", "_example", "index.mjs"), "throw new Error('should be skipped')");
  const k = mk();
  await loadLocalPlugins(k, home, { options: { good: { d: "سلام" } } });
  const loaded = loadedPlugins(k);
  assert.deepEqual(loaded.map((p) => [p.name, !!p.error]), [["broken", true], ["good", false]]);
  assert.equal(k.getSkill("hi")?.description, "سلام");
});

test("telegram: /<skill> args queues the skill; unknown command is rejected", async () => {
  const k = mk();
  loadBuiltinPlugins(k, BUILTIN_PLUGINS, tmp(), { disabled: ["google"] });
  k.registerSkill({ name: "sum", description: "خلاصه", plugin: "test", build: (i) => ({ title: "sum", prompt: `S: ${i}` }) });
  const sent: Array<Record<string, unknown>> = [];
  const api = async (method: string, params: Record<string, unknown>) => {
    sent.push({ method, ...params });
    return method === "getUpdates" ? [] : {};
  };
  const tg = new TelegramInterface(k, api);
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleOwnerText("/sum hello world");
  assert.equal(k.listTasks({ limit: 1 })[0]!.prompt, "S: hello world");
  await (tg as any).handleOwnerText("/nope");
  assert.match(String(sent.at(-1)!.text), /\/skills/);
  await tg.syncCommands();
  const cmds = (sent.find((s) => s.method === "setMyCommands")!.commands as Array<{ command: string }>).map((c) => c.command);
  assert.ok(cmds.includes("brief") && cmds.includes("sum") && cmds.includes("status"));
  assert.match(tg.helpText(), /\/brief/);
});

test("telegram: /retry re-queues recent failed tasks on the default provider", async () => {
  const k = mk();
  const t = k.createTask({ title: "x", prompt: "p", provider: "echo" });
  k.cancelTask(t.id);
  k.db.prepare("UPDATE tasks SET status='failed', provider='claude-code' WHERE id=?").run(t.id);
  const tg = new TelegramInterface(k, async () => ({}));
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleOwnerText("/retry");
  const r = k.getTask(t.id)!;
  assert.equal(r.status, "queued");
  assert.equal(r.provider, "echo");
});

test("memory plugin: /remember → /notes → context → /forget", async () => {
  const home = tmp();
  const k = mk();
  loadBuiltinPlugins(k, BUILTIN_PLUGINS, home, { disabled: ["google"] });
  const tg = new TelegramInterface(k, async () => ({}));
  const sent: string[] = [];
  (tg as any).send = async (t: string) => void sent.push(t);
  k.setKv("telegram.owner_chat_id", "42");
  await (tg as any).handleOwnerText("/remember حساب اصلی من IC Markets است");
  await (tg as any).handleOwnerText("/notes");
  assert.match(sent.at(-1)!, /1\. حساب اصلی من IC Markets است/);
  const src = k.listContextSources().find((c) => c.name === "memory:notes")!;
  assert.match(await src.fetch(new AbortController().signal), /IC Markets/);
  await (tg as any).handleOwnerText("سلام");
  assert.deepEqual(k.listTasks({ limit: 1 })[0]!.context, ["memory:notes"]);
  await (tg as any).handleOwnerText("/forget 1");
  assert.match(await src.fetch(new AbortController().signal), /No saved notes/);
});

test("/lot: exact position size, rounded down", async () => {
  const { lotSize, tradingPlugin } = await import("../src/plugins/trading.ts");
  assert.equal(lotSize(5000, 1, 25).lots, 0.2);
  assert.equal(lotSize(10000, 2, 30).lots, 0.66);
  assert.equal(lotSize(1000, 0.5, 40, 1).lots, 0.12);
  const k = mk();
  tradingPlugin.setup({ kernel: k, options: {}, home: "" });
  assert.match(await k.getCommand("lot")!.run("5000 1% 25"), /0\.20 لات/);
  assert.match(await k.getCommand("lot")!.run("abc"), /استفاده/);
});

test("all shipped skills/*.md parse", () => {
  const r = loadSkillDir(new URL("../skills", import.meta.url).pathname);
  assert.deepEqual(r.errors, []);
  assert.ok(r.skills.length >= 11);
});

test("claude skills: zip + folder import, unchanged zips skipped, '_' ignored", { skip: process.platform === "win32" }, async () => {
  const { importClaudeSkills, listClaudeSkills } = await import("../src/plugins/claude-skills.ts");
  const { execFileSync } = await import("node:child_process");
  const src = tmp();
  const build = tmp();
  fs.mkdirSync(path.join(build, "zipped"));
  fs.writeFileSync(path.join(build, "zipped", "SKILL.md"), "---\nname: zipped\ndescription: z\n---\nbody");
  execFileSync("zip", ["-qr", path.join(src, "zipped.zip"), "zipped"], { cwd: build });
  fs.copyFileSync(path.join(src, "zipped.zip"), path.join(src, "_ALL.zip"));
  fs.mkdirSync(path.join(src, "folder"));
  fs.writeFileSync(path.join(src, "folder", "SKILL.md"), "---\nname: folder\ndescription: f\n---\nbody");
  const ws = tmp();
  const r1 = importClaudeSkills(src, ws);
  assert.deepEqual(r1.installed.sort(), ["folder", "zipped"]);
  assert.deepEqual(listClaudeSkills(ws), ["folder", "zipped"]);
  const r2 = importClaudeSkills(src, ws);
  assert.equal(r2.skipped, 1);
});
