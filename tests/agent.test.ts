import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { DEFAULT_POLICY } from "../src/kernel/permissions.ts";
import { AGENT_PROVIDER, agentPlugin, loginUrl } from "../src/plugins/agent.ts";
import { isSafeAction } from "../src/interfaces/actions.ts";
import { sendableFile } from "../src/plugins/remote.ts";

function mk(options: Record<string, unknown> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "x", retryBaseMs: 0, policy: DEFAULT_POLICY });
  const opened: string[] = [];
  agentPlugin({ open: (u) => (opened.push(u), true) }).setup({ kernel: k, home, options });
  return { k, home, opened };
}

test("agent workspace: rules, browser config and a Claude Code instance with PC tools", () => {
  const { k, home } = mk();
  const dir = path.join(home, "data", "agent");
  const rules = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.match(rules, /NEEDS APPROVAL/);
  assert.match(rules, /passwords/);
  const mcp = JSON.parse(fs.readFileSync(path.join(dir, "mcp.json"), "utf8"));
  assert.ok(mcp.mcpServers.playwright.args.includes(path.join(dir, "chrome-profile")));
  const p = k.listProviders().find((x) => x.name === AGENT_PROVIDER) as any;
  const args: string[] = p.buildArgs();
  assert.ok(args.includes("--strict-mcp-config") && args.join(" ").includes("mcp__playwright") && args.join(" ").includes("PowerShell"));
});

test("/agent queues a PC task that runs without an approval prompt; /agent go continues an approved step", async () => {
  const { k } = mk();
  assert.match(await k.getCommand("agent")!.run("PDF های دانلود را در یک پوشه جمع کن"), /شروع کردم/);
  const t = k.listTasks({ limit: 1 })[0]!;
  assert.equal(t.provider, AGENT_PROVIDER);
  assert.deepEqual(t.capabilities, ["pc:agent"]);
  assert.equal(t.status, "queued");
  k.db.prepare("UPDATE tasks SET status='succeeded', result=? WHERE id=?").run("۱۲ فایل پیدا شد.\nNEEDS APPROVAL: move 12 PDFs to Downloads\\PDF", t.id);
  assert.match(await k.getCommand("agent")!.run(`go ${t.id}`), /move 12 PDFs/);
  const next = k.listTasks({ limit: 1 })[0]!;
  assert.equal(next.parentId, t.id);
  assert.match(next.prompt, /APPROVED this step: move 12 PDFs/);
  assert.match(await k.getCommand("agent")!.run("go tsk_nothere"), /پیدا نشد/);
});

test("/agent login opens the agent Chrome profile; only real sites", async () => {
  const { k, opened } = mk();
  assert.match(await k.getCommand("agent")!.run("login گوگل"), /یک بار خودت وارد شو/);
  assert.deepEqual(opened, ["https://accounts.google.com"]);
  assert.equal(loginUrl("instagram.com"), "https://instagram.com");
  assert.equal(loginUrl("https://x.com/'; calc"), null);
});

test("safety: 'go' needs a tap, secrets are never attached", () => {
  assert.ok(isSafeAction("/agent فایل‌ها را مرتب کن"));
  assert.ok(isSafeAction("/agent login google"));
  assert.ok(!isSafeAction("/agent go tsk_123"));
  assert.ok(!sendableFile("C:\\Elion\\elias-os\\config\\elias.config.json"));
  assert.ok(!sendableFile("C:\\Users\\E\\secrets.json"));
  assert.ok(sendableFile("C:\\Users\\E\\Downloads\\invoice.pdf"));
});

test("telegram: an agent answer never auto-runs actions, gets an approval button and its files", async () => {
  const { TelegramInterface } = await import("../src/interfaces/telegram.ts");
  const { k } = mk();
  let reminded = false;
  k.registerCommand({ name: "remind", description: "", plugin: "t", run: () => ((reminded = true), "ok") });
  const shot = path.join(os.tmpdir(), `agent-shot-${Date.now()}.png`);
  fs.writeFileSync(shot, "png");
  const calls: any[] = [];
  const tg = new TelegramInterface(k, async (m: string, p: any) => (calls.push({ m, ...p }), {}));
  k.setKv("telegram.owner_chat_id", "42");
  const t = k.createTask({ title: "🤖 x", prompt: "x", provider: AGENT_PROVIDER, source: "telegram", capabilities: ["pc:agent"] });
  const result = `آماده است.\n<<<PHOTO ${shot} PHOTO>>>\n<<<FILE C:\\Elion\\elias-os\\config\\secrets.json FILE>>>\n>>> /remind 2h x\nNEEDS APPROVAL: send the email`;
  k.db.prepare("UPDATE tasks SET status='succeeded', result=? WHERE id=?").run(result, t.id);
  tg.notify({ type: "task.succeeded", taskId: t.id, message: "", data: null } as any);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(reminded, false);
  const msg = calls.find((c) => c.reply_markup?.inline_keyboard);
  const labels = msg.reply_markup.inline_keyboard.map((r: any) => r[0].text).join(" | ");
  assert.match(labels, new RegExp(`/agent go ${t.id}`));
  assert.ok(calls.some((c) => c.m === "sendPhoto" && c.__file.path === shot));
  assert.ok(!calls.some((c) => c.m === "sendDocument"));
  assert.ok(!calls.some((c) => /<<<|secrets/.test(String(c.text ?? ""))));
});

test("both Google accounts are named in the agent rules", () => {
  const { home } = mk({ googleAccounts: ["a@gmail.com", "b@gmail.com"] });
  const rules = fs.readFileSync(path.join(home, "data", "agent", "CLAUDE.md"), "utf8");
  assert.match(rules, /2 Google accounts .*a@gmail\.com, b@gmail\.com/);
  assert.match(rules, /check every account/);
  const plain = fs.readFileSync(path.join(mk().home, "data", "agent", "CLAUDE.md"), "utf8");
  assert.doesNotMatch(plain, /Google accounts signed in/);
});

test("briefing reads every Gmail account through the agent; the stored daily schedule is rebuilt once", async () => {
  const { BUILTIN_PLUGINS } = await import("../src/plugins/builtin.ts");
  const { loadBuiltinPlugins } = await import("../src/plugins/host.ts");
  const { briefingTask } = await import("../src/agents/briefing.ts");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "brief-"));
  const k = new Kernel({ dbPath: ":memory:", providers: [], defaultProvider: "x", retryBaseMs: 0, policy: DEFAULT_POLICY });
  k.addSchedule("daily-briefing", "0 8 * * *", briefingTask()); // old template, before the agent
  loadBuiltinPlugins(k, BUILTIN_PLUGINS, home, { disabled: ["google"] });
  const s = k.getSchedule("daily-briefing")!;
  assert.equal(s.cron, "0 8 * * *");
  assert.equal(s.template.provider, AGENT_PROVIDER);
  assert.match(s.template.prompt, /EVERY Google account/);
  assert.ok(s.template.capabilities!.includes("pc:agent"));
  const t = k.runSkill("brief", "", "cli");
  assert.equal(t.provider, AGENT_PROVIDER);
  assert.equal(briefingTask().provider, undefined); // without the agent: unchanged
});

test("agent: browser MCP uses the local install when present, else a pinned npx (never @latest)", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { agentMcpConfig, PLAYWRIGHT_MCP } = await import("../src/plugins/agent.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eos-agent-"));
  const npx = agentMcpConfig("P", dir) as { mcpServers: { playwright: { command: string; args: string[] } } };
  assert.equal(npx.mcpServers.playwright.command, "npx");
  assert.ok(npx.mcpServers.playwright.args.includes(PLAYWRIGHT_MCP));
  assert.ok(!npx.mcpServers.playwright.args.some((a) => a.endsWith("@latest")));
  const cli = path.join(dir, "node_modules", "@playwright", "mcp", "cli.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "");
  const local = agentMcpConfig("P", dir) as { mcpServers: { playwright: { command: string; args: string[] } } };
  assert.equal(local.mcpServers.playwright.command, process.execPath);
  assert.equal(local.mcpServers.playwright.args[0], cli);
  assert.ok(local.mcpServers.playwright.args.includes("P"));
});
