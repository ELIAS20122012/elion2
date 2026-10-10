// elias — command line for the Elias OS kernel (Phase 0).
import { parseArgs } from "node:util";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadSecrets, createKernel, createKernelWithPlugins, ensureWorkspace, writePersona, loadConfig, CONFIG_PATH, CONFIG_DIR, HOME, SECRETS_PATH, telegramToken } from "./config.ts";
import { GoogleAuth, recentMail, upcomingEvents, formatEvents } from "./connectors/google.ts";
import { BRIEFING_SCHEDULE } from "./agents/briefing.ts";
import { loadedPlugins } from "./plugins/host.ts";
import { startDashboard } from "./interfaces/dashboard.ts";
import { makeSpeaker } from "./voice/tts.ts";
import { makeMarker } from "./voice/marks.ts";
import { Tunnel } from "./interfaces/tunnel.ts";
import { shortScriptTask, SHORT_SCHEDULE, VideoRenderProvider, QUEUE_TASK } from "./plugins/video.ts";
import { importClaudeSkills, listClaudeSkills } from "./plugins/claude-skills.ts";
import { TelegramInterface, telegramApi, telegramDownload } from "./interfaces/telegram.ts";
import { WhisperTranscriber } from "./voice/whisper.ts";
import { VoiceAssistant, ListenerProcess } from "./voice/assistant.ts";
import { parseVerify } from "./kernel/verify.ts";
import { schemaVersion } from "./kernel/db.ts";
import { decide } from "./kernel/permissions.ts";
import type { Kernel } from "./kernel/kernel.ts";
import type { KernelEvent, Task, TaskStatus } from "./kernel/types.ts";

const HELP = `Elias OS

Usage: elias <command> [options]

  init                               Create config + database
  doctor                             Check Node, database, providers
  status                             Task counts, pending approvals, schedules

  task add <title> --prompt <text>   Queue a task
       [--provider claude-code|echo] [--cap read:email --cap send:email]
       [--verify non_empty|none|contains:X|regex:X|json:k1,k2]
       [--attempts 3] [--timeout 600] [--priority 0]
  task list [--status queued|...]    List tasks
  task show <id>                     Task details, runs and log
  task cancel <id>                   Cancel a task
  task retry <id>                    Re-queue a failed/cancelled task

  run                                Process runnable tasks now, then exit
  daemon                             Run scheduler + worker until Ctrl+C
  stop [--force]                     Gracefully stop a running daemon (also a hidden one)

  approvals [--all]                  List approval requests
  approve <approval-id> [--note x]   Approve
  reject  <approval-id> [--note x]   Reject (cancels the task)
  policy <capability>                Show what the policy decides for a capability

  schedule add <name> <cron> --title <t> --prompt <p> [task options]
  schedule list | enable <name> | disable <name> | remove <name>

  log [--task <id>] [--limit 50]     Activity log

  google auth                        Connect Gmail + Calendar (read-only, opens browser)
  google test                        Read recent mail + events to check the connection
  briefing install [--time 08:00]    Schedule the daily briefing (sent to Telegram)
  briefing now                       Queue a briefing right away

  dashboard                          Open the local web dashboard (runs inside the daemon)
  short [topic]                      Make a YouTube Short now (script → render → approval → upload)
  short schedule [--time 18:00] [topic]   One automatic Short per day (still asks approval) · short off
  plugins                            Loaded plugins (built-in + plugins/ folder)
  skill list                         All skills (also Telegram /<name>)
  skill run <name> [input...]        Queue a skill as a task
  skill new <name>                   Create skills/<name>.md from a template
  skill import <folder>              Install Claude skills (SKILL.md folders / .zip) for the agents

  voice test <audio-file>            Transcribe a file with the local speech model

  telegram pair                      Link the bot to your Telegram chat (one-time code)
  telegram test                      Send a test message
  telegram unpair                    Remove the linked chat
`;

const TASK_OPTS = {
  prompt: { type: "string" },
  title: { type: "string" },
  provider: { type: "string" },
  cap: { type: "string", multiple: true },
  verify: { type: "string" },
  attempts: { type: "string" },
  timeout: { type: "string" },
  priority: { type: "string" },
  status: { type: "string" },
  note: { type: "string" },
  task: { type: "string" },
  limit: { type: "string" },
  all: { type: "boolean" },
  disabled: { type: "boolean" },
  force: { type: "boolean" },
  time: { type: "string" },
} as const;

async function main(argv: string[]): Promise<number> {
  const { values: o, positionals: pos } = parseArgs({ args: argv, options: TASK_OPTS, allowPositionals: true, strict: true });
  const [cmd, sub, ...rest] = pos;
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(HELP);
    return 0;
  }

  if (cmd === "init") return init();

  const kernel = await createKernelWithPlugins(loadConfig(), cmd === "daemon" ? printEvent : undefined);
  try {
    switch (cmd) {
      case "doctor":
        return await doctor(kernel);
      case "status":
        return status(kernel);
      case "task":
        return taskCmd(kernel, sub, rest, o);
      case "run": {
        kernel.recover();
        kernel.tickScheduler();
        const done = await kernel.drain();
        for (const t of done) printTaskLine(t);
        if (!done.length) console.log("Nothing runnable right now.");
        return 0;
      }
      case "daemon":
        return await daemon(kernel);
      case "stop":
        return await stopDaemon(kernel, !!o.force);
      case "approvals": {
        const list = kernel.listApprovals(o.all ? "all" : "pending");
        if (!list.length) console.log("No approvals.");
        for (const a of list) {
          const t = kernel.getTask(a.taskId);
          console.log(`${a.id}  [${a.status}]  ${a.capability}  ← ${t?.title ?? a.taskId}  (${a.taskId})`);
        }
        return 0;
      }
      case "approve":
      case "reject": {
        if (!sub) throw new Error(`Usage: elias ${cmd} <approval-id>`);
        const a = kernel.decideApproval(sub, cmd === "approve", o.note);
        console.log(`${a.id} → ${a.status}. Task is now: ${kernel.getTask(a.taskId)?.status}`);
        return 0;
      }
      case "policy": {
        if (!sub) throw new Error("Usage: elias policy <capability>");
        console.log(`${sub} → ${decide(kernel.policy, sub)}`);
        return 0;
      }
      case "schedule":
        return scheduleCmd(kernel, sub, rest, o);
      case "google":
        return await googleCmd(sub);
      case "briefing":
        return briefingCmd(kernel, sub, o);
      case "dashboard": {
        const url = `http://127.0.0.1:${loadConfig().dashboard?.port ?? 7420}`;
        if (process.platform === "win32") spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
        console.log(url);
        return 0;
      }
      case "cmd": {
        // Run a Telegram command from the shell: elias cmd pc tidy
        const c = sub ? kernel.getCommand(sub) : null;
        if (!c) throw new Error(`Unknown command "${sub ?? ""}". Commands: ${kernel.listCommands().map((x) => x.name).join(", ")}`);
        console.log(await c.run(rest.join(" ")));
        return 0;
      }
      case "plugins":
        for (const p of loadedPlugins(kernel))
          console.log(`${p.error ? "✖" : "✔"} ${p.name.padEnd(12)} ${p.source.padEnd(8)} ${p.version.padEnd(8)} ${p.error ?? p.description}`);
        return 0;
      case "skill":
        return skillCmd(kernel, sub, rest);
      case "short": {
        if (sub === "test") {
          const out = path.join(HOME, "content", "shorts", "_test");
          const spec = {
            out, voice: "fa-IR-FaridNeural", brand: "Elias OS", title: "test", description: "", tags: [],
            scenes: [
              { text: "تست ساخت ویدیو", say: "سلام! این یک ویدیوی آزمایشی از الیاس او اس است." },
              { text: "صدا و تصویر", say: "اگر این صدا را می‌شنوی و متن فارسی درست است، همه چیز آماده است." },
            ],
          };
          const r = await new VideoRenderProvider(HOME).execute({ taskId: "test", runId: "test", attempt: 1, signal: AbortSignal.timeout(600_000), prompt: `<<<RENDER ${JSON.stringify(spec)} RENDER>>>` });
          const v = (JSON.parse(r.output) as { video: string; seconds: number });
          console.log(`✔ Rendered ${v.seconds}s → ${v.video}`);
          if (process.platform === "win32") spawn("rundll32", ["url.dll,FileProtocolHandler", v.video], { detached: true, stdio: "ignore" }).unref();
          return 0;
        }
        if (sub === "schedule") {
          const m = (o.time ?? "18:00").match(/^(\d{1,2}):(\d{2})$/);
          if (!m) throw new Error("--time must look like 18:00");
          if (kernel.getSchedule(SHORT_SCHEDULE)) kernel.removeSchedule(SHORT_SCHEDULE);
          const s = kernel.addSchedule(SHORT_SCHEDULE, `${Number(m[2])} ${Number(m[1])} * * *`, rest.length ? shortScriptTask(rest.join(" "), true) : QUEUE_TASK);
          console.log(`✔ Daily Short scheduled (${o.time ?? "18:00"}), each one waits for your approval. Next: ${local(s.nextRunAt)}`);
        } else if (sub === "off") {
          if (kernel.getSchedule(SHORT_SCHEDULE)) kernel.removeSchedule(SHORT_SCHEDULE);
          console.log("✔ Daily Short removed");
        } else {
          const t = kernel.createTask(shortScriptTask([sub, ...rest].filter(Boolean).join(" "), true));
          console.log(`Queued ${t.id} — preview + approval will arrive in Telegram.`);
        }
        return 0;
      }
      case "telegram":
        return await telegramCmd(kernel, sub);
      case "voice": {
        if (sub !== "test" || !rest[0]) throw new Error("Usage: elias voice test <audio-file>");
        const t = makeTranscriber();
        if (!t) throw new Error("Voice is not installed — run setup/voice-setup.cmd");
        const r = await t.transcribe(rest[0]);
        t.close();
        console.log(`[${r.language}] ${r.duration}s audio in ${r.seconds}s:\n${r.text}`);
        return 0;
      }
      case "log": {
        for (const e of kernel.listEvents({ taskId: o.task, limit: o.limit ? Number(o.limit) : 50 })) printEvent(e);
        return 0;
      }
      default:
        console.error(`Unknown command "${cmd}".\n`);
        console.log(HELP);
        return 2;
    }
  } finally {
    if (cmd !== "daemon") kernel.close();
  }
}

interface Opts {
  prompt?: string; title?: string; provider?: string; cap?: string[]; verify?: string; attempts?: string;
  timeout?: string; priority?: string; status?: string; note?: string; task?: string; limit?: string;
  all?: boolean; disabled?: boolean; force?: boolean; time?: string;
}

function taskInputFrom(o: Opts, title: string) {
  if (!o.prompt) throw new Error("--prompt is required");
  return {
    title,
    prompt: o.prompt,
    provider: o.provider,
    capabilities: o.cap ?? [],
    verify: parseVerify(o.verify),
    maxAttempts: o.attempts ? Number(o.attempts) : undefined,
    timeoutMs: o.timeout ? Number(o.timeout) * 1000 : undefined,
    priority: o.priority ? Number(o.priority) : undefined,
  };
}

function taskCmd(k: Kernel, sub: string | undefined, rest: string[], o: Opts): number {
  switch (sub) {
    case "add": {
      const title = rest.join(" ") || o.title;
      if (!title) throw new Error("Usage: elias task add <title> --prompt <text>");
      const t = k.createTask(taskInputFrom(o, title));
      console.log(`Queued ${t.id}  "${t.title}"  provider=${t.provider}  caps=[${t.capabilities.join(", ")}]`);
      return 0;
    }
    case "list": {
      const list = k.listTasks({ status: o.status as TaskStatus | undefined, limit: o.limit ? Number(o.limit) : 50 });
      if (!list.length) console.log("No tasks.");
      for (const t of list) printTaskLine(t);
      return 0;
    }
    case "show": {
      const t = k.getTask(rest[0] ?? "");
      if (!t) throw new Error("Task not found");
      console.log(JSON.stringify({ ...t, prompt: t.prompt.length > 400 ? t.prompt.slice(0, 400) + "…" : t.prompt }, null, 2));
      console.log("\nRuns:");
      for (const r of k.listRuns(t.id))
        console.log(`  #${r.attempt} ${r.status} ${r.provider} ${r.durationMs ?? "-"}ms ${r.failureKind ?? ""} ${r.error ?? ""}`);
      console.log("\nLog:");
      for (const e of k.listEvents({ taskId: t.id, limit: 100 })) printEvent(e);
      return 0;
    }
    case "cancel":
      printTaskLine(k.cancelTask(rest[0] ?? ""));
      return 0;
    case "retry":
      printTaskLine(k.retryTask(rest[0] ?? ""));
      return 0;
    default:
      throw new Error("Usage: elias task add|list|show|cancel|retry");
  }
}

function scheduleCmd(k: Kernel, sub: string | undefined, rest: string[], o: Opts): number {
  switch (sub) {
    case "add": {
      const [name, cron] = rest;
      if (!name || !cron || !o.title) throw new Error('Usage: elias schedule add <name> "<cron>" --title <t> --prompt <p>');
      const s = k.addSchedule(name, cron, taskInputFrom(o, o.title), !o.disabled);
      console.log(`Schedule ${s.name} (${s.cron}) next run: ${local(s.nextRunAt)}${s.enabled ? "" : " [disabled]"}`);
      return 0;
    }
    case "list": {
      const list = k.listSchedules();
      if (!list.length) console.log("No schedules.");
      for (const s of list)
        console.log(`${s.enabled ? "ON " : "OFF"}  ${s.name.padEnd(20)} ${s.cron.padEnd(15)} next=${local(s.nextRunAt)} last=${local(s.lastFiredAt)}`);
      return 0;
    }
    case "enable":
    case "disable":
      k.setScheduleEnabled(rest[0] ?? "", sub === "enable");
      console.log(`Schedule ${rest[0]} ${sub}d.`);
      return 0;
    case "remove":
      k.removeSchedule(rest[0] ?? "");
      console.log(`Schedule ${rest[0]} removed.`);
      return 0;
    default:
      throw new Error("Usage: elias schedule add|list|enable|disable|remove");
  }
}

function init(): number {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    const example = path.join(HOME, "config", "elias.config.example.json");
    fs.copyFileSync(example, CONFIG_PATH);
    console.log(`Created ${CONFIG_PATH}`);
  } else console.log(`Config exists: ${CONFIG_PATH}`);
  const k = createKernel();
  console.log(`Database ready: ${loadConfig().dbPath} (schema v${schemaVersion(k.db)})`);
  k.close();
  return 0;
}

async function doctor(k: Kernel): Promise<number> {
  let ok = true;
  const [maj, min] = process.versions.node.split(".").map(Number);
  const nodeOk = maj! > 22 || (maj === 22 && min! >= 18);
  console.log(`${nodeOk ? "✔" : "✘"} Node ${process.versions.node} ${nodeOk ? "" : "(need >= 22.18)"}`);
  ok &&= nodeOk;
  console.log(`✔ Database ${loadConfig().dbPath} (schema v${schemaVersion(k.db)})`);
  console.log(`✔ Config ${fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : "(defaults — run `elias init`)"}`);
  for (const p of k.listProviders()) {
    const h = await p.health();
    console.log(`${h.ok ? "✔" : "✘"} provider ${p.name}: ${h.detail}`);
    if (p.name === loadConfig().defaultProvider) ok &&= h.ok;
  }
  const tok = telegramToken();
  const paired = k.getKv("telegram.owner_chat_id");
  console.log(`${tok && paired ? "✔" : "-"} telegram: ${tok ? "token set" : "no token"}, ${paired ? "paired" : "not paired"}`);
  const hb = k.getKv("daemon.heartbeat");
  console.log(`${hb ? "•" : "-"} daemon heartbeat: ${hb ? local(hb) : "never"}`);
  return ok ? 0 : 1;
}

function status(k: Kernel): number {
  const st = k.stats();
  console.log("Tasks:", Object.entries(st).map(([s, n]) => `${s}=${n}`).join("  "));
  const ap = k.listApprovals("pending");
  console.log(`Pending approvals: ${ap.length}`);
  for (const a of ap) console.log(`  ${a.id}  ${a.capability}  (${a.taskId})`);
  console.log(`Schedules: ${k.listSchedules().filter((s) => s.enabled).length} enabled`);
  const hb = k.getKv("daemon.heartbeat");
  console.log(`Daemon heartbeat: ${hb ? local(hb) : "never"}`);
  return 0;
}

async function daemon(k: Kernel): Promise<number> {
  const pollMs = loadConfig().daemon?.pollMs ?? 10_000;
  // Single instance: two daemons would fight over Telegram polling.
  const otherPid = Number(k.getKv("daemon.pid") ?? 0);
  if (otherPid && otherPid !== process.pid && isAlive(otherPid)) {
    console.error(`Elias OS is already running (pid ${otherPid}).`);
    k.close();
    return 3;
  }
  k.setKv("daemon.pid", String(process.pid));
  k.setKv("daemon.stop", "0");
  const recovered = k.recover();
  const csDir = loadConfig().claudeSkills?.dir;
  if (csDir) {
    try {
      const r = importClaudeSkills(csDir, ensureWorkspace());
      if (r.installed.length || r.errors.length) {
        k.log("claude_skills.synced", `${r.installed.length} installed, ${r.errors.length} errors`, { level: r.errors.length ? "warn" : "info", data: r });
        writePersona(k);
      }
    } catch (e) {
      k.log("claude_skills.failed", (e as Error).message, { level: "warn" });
    }
  }

  let stopping = false;
  const token = telegramToken();
  let tg: TelegramInterface | null = null;
  let tgLoop: Promise<void> = Promise.resolve();
  const voice = makeTranscriber();
  if (token) {
    tg = new TelegramInterface(
      k,
      telegramApi(token),
      voice ? { transcriber: voice, download: telegramDownload(token), dir: path.join(HOME, "data", "voice-tmp"), speak: makeSpeaker(HOME) ?? undefined } : null,
      { download: telegramDownload(token), inbox: path.join(ensureWorkspace(), "inbox"), relInbox: "inbox", mark: makeMarker(HOME) ?? undefined },
    );
    console.log(voice ? "Voice: enabled (faster-whisper)" : "Voice: not installed (run setup/voice-setup.cmd)");
    k.addEventSink((e) => tg!.notify(e));
    tgLoop = tg.run(() => stopping);
    tg.syncCommands().catch((e) => k.log("telegram.commands_failed", (e as Error).message, { level: "warn" }));
    console.log(tg.ownerChatId() ? "Telegram: connected" : "Telegram: waiting for pairing (run: elias telegram pair)");
  } else console.log("Telegram: no bot token in config/secrets.json — running without Telegram");
  const dash = loadConfig().dashboard;
  const va = loadConfig().voiceAssistant ?? {};
  const assistant = voice && va.enabled !== false ? new VoiceAssistant(k, voice, makeSpeaker(HOME, va.voice ?? "fa-IR-FaridNeural", undefined, "wav")) : null;
  const dashboard = dash?.enabled === false ? null : startDashboard(k, dash?.port ?? 7420, dash?.publicHost && dash?.ownerEmail ? { publicHost: dash.publicHost, ownerEmail: dash.ownerEmail } : null, assistant);
  if (dashboard) console.log(`Dashboard: http://127.0.0.1:${dash?.port ?? 7420}`);
  // "Hey Elion": microphone listener on this PC (Windows), talks to the dashboard API above.
  const listener = dashboard && assistant && process.platform === "win32" ? new ListenerProcess(k, HOME, WhisperTranscriber.venvPython(HOME), { port: dash?.port ?? 7420, hotkey: va.hotkey, wakeModel: va.wakeModel }) : null;
  if (listener) {
    k.registerCommand({
      name: "listen",
      description: "دستیار صوتی «Hey Elion» روی کامپیوتر (/listen on|off)",
      plugin: "voice",
      run(args) {
        const a = args.trim().toLowerCase();
        if (a === "off") {
          listener.setEnabled(false);
          return "🔇 میکروفون خاموش شد. روشن: /listen on";
        }
        if (a === "on") {
          listener.setEnabled(true);
          return `🎙️ روشن شد. بگو «Hey Elion …» یا کلید ${va.hotkey ?? "ctrl+alt+e"} را بزن.`;
        }
        return listener.running() ? `🎙️ دستیار صوتی روشن است («Hey Elion» یا ${va.hotkey ?? "ctrl+alt+e"}). خاموش: /listen off` : "🔇 دستیار صوتی خاموش است. روشن: /listen on";
      },
    });
    k.registerCommand({
      name: "words",
      description: "کلمه‌هایی که تشخیص صدا باید بشناسد (/words · /words add کلمه)",
      plugin: "voice",
      run(args) {
        const f = path.join(HOME, "config", "voice-words.txt");
        const cur = voiceWords() ?? "";
        const m = args.trim().match(/^add\s+(.+)$/i);
        if (m) {
          fs.writeFileSync(f, `${cur} ${m[1]!.trim()}`.trim().slice(0, 800) + "\n", "utf8");
          return `✅ اضافه شد: ${m[1]!.trim()}`;
        }
        return `🗣️ کلمه‌های تشخیص صدا:\n${cur}\n\nاضافه: /words add کلمه`;
      },
    });
    setTimeout(() => listener.start(), 3000);
    console.log("Voice assistant: Hey Elion");
  }
  const tunnelToken = loadSecrets().tunnel?.token?.trim();
  const tunnel = dashboard && tunnelToken && loadConfig().tunnel?.enabled !== false ? new Tunnel(k, tunnelToken, HOME) : null;
  void tunnel?.start();
  if (tunnel) console.log(`Remote dashboard: https://${dash?.publicHost ?? "(publicHost not set)"}`);
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  k.log("daemon.started", `Daemon started (poll ${pollMs}ms, recovered ${recovered})`, { data: { pid: process.pid } });
  // Restart = exit code 1; the hidden supervisor (run-hidden.cmd) starts the new code right away.
  // Triggers: Telegram /restart (kv daemon.restart) or a data/restart.flag file dropped by a deploy.
  // Run-once: data/run-once.txt = absolute path of a .cmd inside the Elion folder (written by Elias or a deploy).
  // Runs it once in the background (no console), output → data/run-once.log, then the file is removed.
  const runOnce = () => {
    const f = path.join(HOME, "data", "run-once.txt");
    if (!fs.existsSync(f)) return;
    const target = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").trim();
    fs.rmSync(f, { force: true });
    const root = path.dirname(HOME).toLowerCase();
    const abs = path.resolve(target);
    if (!abs.toLowerCase().startsWith(root + path.sep) || !/\.(cmd|bat)$/i.test(abs) || !fs.existsSync(abs)) {
      return void k.log("runonce.refused", `not allowed: ${target}`, { level: "warn" });
    }
    const log = fs.openSync(path.join(HOME, "data", "run-once.log"), "w");
    k.log("runonce.started", abs);
    const p = spawn("cmd.exe", ["/d", "/c", abs], { cwd: path.dirname(abs), stdio: ["ignore", log, log], windowsHide: true });
    const timer = setTimeout(() => p.kill(), 45 * 60_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      fs.closeSync(log);
      k.log("runonce.finished", `${path.basename(abs)} exit ${code}`, { level: code === 0 ? "info" : "warn" });
    });
  };
  if (process.platform === "win32") setTimeout(runOnce, 5000);
  setInterval(() => process.platform === "win32" && runOnce(), 30_000).unref();
  const flag = path.join(HOME, "data", "restart.flag");
  let restart = false;
  const stopRequested = () => {
    if (!stopping && (k.getKv("daemon.restart") === "1" || fs.existsSync(flag))) {
      k.setKv("daemon.restart", "0");
      fs.rmSync(flag, { force: true });
      restart = true;
      k.log("daemon.restarting", "Restart requested");
      stop();
    }
    if (!stopping && k.getKv("daemon.stop") === "1") stop();
    return stopping;
  };
  while (!stopRequested()) {
    try {
      k.setKv("daemon.heartbeat", new Date().toISOString());
      k.tickScheduler();
      while (!stopping && (await k.processNext())) {
        /* keep draining */
      }
    } catch (e) {
      k.log("daemon.error", e instanceof Error ? e.message : String(e), { level: "error" });
    }
    for (let waited = 0; waited < pollMs && !stopRequested(); waited += 250) await new Promise((r) => setTimeout(r, 250));
  }
  k.log("daemon.stopped", "Daemon stopped");
  k.db.prepare("DELETE FROM kv WHERE key = 'daemon.pid'").run();
  await Promise.race([tg?.flush(), new Promise((r) => setTimeout(r, 10_000))]);
  void tgLoop; // an in-flight Telegram long-poll is simply abandoned
  dashboard?.close();
  listener?.stop();
  tunnel?.stop();
  k.close();
  process.exit(restart ? 1 : 0);
}

export const DEFAULT_VOICE_WORDS = [
  "سلام الیون. حساب MT4، معامله‌ها، پوزیشن، استاپ لاس، تیک پرافیت، لات، ریسک، طلا، انس، دلار، یورو، بیت‌کوین،",
  "اکسپرت، اندیکاتور، یادآوری، یادم بنداز، فردا، ساعت، تحقیق کن، جلسه‌ی تیم، یوتیوب، شورتس، اینستاگرام، ریلز،",
  "تلگرام، ویدیو، شاگرد، آموزش، Elias OS، Obsidian، ایمیل، تقویم.",
].join(" ");

/** config/voice-words.txt — Elias's own words for better Persian recognition (created with defaults). */
function voiceWords(): string | null {
  const f = path.join(HOME, "config", "voice-words.txt");
  try {
    if (!fs.existsSync(f)) fs.writeFileSync(f, DEFAULT_VOICE_WORDS + "\n", "utf8");
    const t = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 800) : null;
  } catch {
    return null;
  }
}

function makeTranscriber(): WhisperTranscriber | null {
  if (!WhisperTranscriber.isInstalled(HOME)) return null;
  const v = loadConfig().voice ?? {};
  return new WhisperTranscriber({
    python: WhisperTranscriber.venvPython(HOME),
    script: path.join(HOME, "voice", "whisper_server.py"),
    model: v.model ?? "large-v3-turbo", // best Persian accuracy; ~2x audio length on the PC CPU (small misheard most words)
    language: v.language === undefined ? "fa" : v.language,
    modelDir: path.join(HOME, "data", "models"),
    prompt: () => voiceWords(),
  });
}

async function googleCmd(sub: string | undefined): Promise<number> {
  const g = new GoogleAuth(CONFIG_DIR);
  switch (sub) {
    case "auth":
      g.loadClient();
      await g.authorize();
      console.log("\n✔ Google connected (Gmail + Calendar, read-only).");
      return 0;
    case "test": {
      const mail = await recentMail(g, { max: 10 });
      console.log(`✔ Gmail: ${mail.length} emails in the last 24h (${mail.filter((m) => m.unread).length} unread)`);
      for (const m of mail.slice(0, 3)) console.log(`   - ${m.subject}`);
      const ev = await upcomingEvents(g);
      console.log(`✔ Calendar: ${ev.length} events today/tomorrow`);
      if (ev.length) console.log(formatEvents(ev.slice(0, 5)).replace(/^/gm, "   "));
      return 0;
    }
    default:
      console.log(`Google: client ${fs.existsSync(g.clientPath) ? "✔" : "missing"}, authorized ${g.isAuthorized() ? "✔" : "no"}`);
      return 0;
  }
}

const SKILL_TEMPLATE = (name: string) => `---
name: ${name}
description: توضیح کوتاه (در منوی تلگرام دیده می‌شود)
capabilities:
context:
verify: non_empty
---
Answer in Persian, short and practical, formatted for Telegram.

Request: {{input}}
`;

function skillCmd(k: Kernel, sub: string | undefined, rest: string[]): number {
  switch (sub) {
    case "list":
    case undefined:
      for (const s of k.listSkills()) console.log(`/${s.name.padEnd(14)} ${s.plugin.padEnd(9)} ${s.description}`);
      return 0;
    case "run": {
      const [name, ...input] = rest;
      if (!name) throw new Error("Usage: elias skill run <name> [input...]");
      const t = k.runSkill(name, input.join(" "), "cli");
      console.log(`Queued ${t.id} (${t.title}) — the result will arrive in Telegram.`);
      return 0;
    }
    case "import": {
      const src = rest.join(" ") || loadConfig().claudeSkills?.dir;
      if (!src) throw new Error("Usage: elias skill import <folder>");
      const r = importClaudeSkills(src, ensureWorkspace());
      console.log(`✔ ${r.installed.length} installed, ${r.skipped} unchanged, ${r.errors.length} errors · total ${listClaudeSkills(ensureWorkspace()).length}`);
      for (const e of r.errors) console.log(`  ✖ ${e}`);
      return r.errors.length ? 1 : 0;
    }
    case "new": {
      const name = (rest[0] ?? "").toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw new Error("Usage: elias skill new <name>  (a-z, 0-9, _)");
      const file = path.join(HOME, "skills", `${name}.md`);
      if (fs.existsSync(file)) throw new Error(`${file} already exists`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, SKILL_TEMPLATE(name), "utf8");
      console.log(`Created ${file} — edit it, then restart Elias OS (or it loads on next start).`);
      return 0;
    }
    default:
      throw new Error("Usage: elias skill list | run <name> [input] | new <name>");
  }
}

function briefingCmd(k: Kernel, sub: string | undefined, o: Opts): number {
  switch (sub) {
    case "install": {
      const m = (o.time ?? "08:00").match(/^(\d{1,2}):(\d{2})$/);
      if (!m) throw new Error("--time must look like 08:00");
      if (k.getSchedule(BRIEFING_SCHEDULE)) k.removeSchedule(BRIEFING_SCHEDULE);
      const brief = k.getSkill("brief");
      if (!brief) throw new Error('The "briefing" plugin is disabled');
      const s = k.addSchedule(BRIEFING_SCHEDULE, `${Number(m[2])} ${Number(m[1])} * * *`, brief.build(""));
      console.log(`✔ Daily briefing scheduled (${o.time ?? "08:00"}). Next: ${local(s.nextRunAt)}`);
      return 0;
    }
    case "now": {
      const t = k.runSkill("brief", "", "cli");
      console.log(`Queued ${t.id} — the briefing will arrive in Telegram.`);
      return 0;
    }
    default:
      throw new Error("Usage: elias briefing install [--time 08:00] | briefing now");
  }
}

async function telegramCmd(k: Kernel, sub: string | undefined): Promise<number> {
  const token = telegramToken();
  if (!token) throw new Error(`No valid bot token. Put it in ${SECRETS_PATH} as {"telegram":{"botToken":"123456:ABC..."}}`);
  const tg = new TelegramInterface(k, telegramApi(token));
  const me = (await telegramApi(token)("getMe", {})) as { username: string };
  switch (sub) {
    case "pair": {
      if (tg.ownerChatId()) console.log("Already paired. Re-pairing replaces the linked chat.");
      tg.unpair();
      const code = tg.startPairing();
      console.log("");
      console.log("  ==============================================");
      console.log(`   Open Telegram -> @${me.username} and send:`);
      console.log("");
      console.log(`        /start ${code}`);
      console.log("");
      console.log("   Code is valid for 10 minutes.");
      console.log("  ==============================================");
      const dpid = Number(k.getKv("daemon.pid") ?? 0);
      const daemonAlive = dpid > 0 && isAlive(dpid);
      if (daemonAlive) console.log("   (Elias OS is running — it will receive the code.)");
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline && !tg.ownerChatId()) {
        if (daemonAlive) await new Promise((r) => setTimeout(r, 2000));
        else await tg.pollOnce(20);
      }
      if (!tg.ownerChatId()) {
        console.log("Timed out. Run `elias telegram pair` again.");
        return 1;
      }
      console.log(`\nPaired with @${me.username}. ✔`);
      return 0;
    }
    case "test":
      if (!tg.ownerChatId()) throw new Error("Not paired yet — run `elias telegram pair`");
      await tg.send("🧪 Test from Elias OS — Telegram works.");
      await tg.flush();
      console.log(`Sent test message via @${me.username}.`);
      return 0;
    case "unpair":
      tg.unpair();
      console.log("Unpaired.");
      return 0;
    default:
      console.log(`Bot: @${me.username}  paired: ${tg.ownerChatId() ? "yes" : "no"}`);
      return 0;
  }
}

async function stopDaemon(k: Kernel, force: boolean): Promise<number> {
  const pid = Number(k.getKv("daemon.pid") ?? 0);
  if (!pid || !isAlive(pid)) {
    console.log("Elias OS is not running.");
    return 0;
  }
  k.setKv("daemon.stop", "1");
  console.log(`Stopping Elias OS (pid ${pid})…`);
  for (let i = 0; i < (force ? 90 : 120) && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 500));
  if (isAlive(pid) && force) {
    process.kill(pid);
    await new Promise((r) => setTimeout(r, 1000));
    k.db.prepare("DELETE FROM kv WHERE key = 'daemon.pid'").run();
    k.log("daemon.killed", `Daemon pid ${pid} force-stopped`, { level: "warn" });
    console.log("Force-stopped.");
    return 0;
  }
  if (isAlive(pid)) {
    console.log("Still running (probably finishing a task). It will stop when the task ends.");
    return 1;
  }
  console.log("Stopped.");
  return 0;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function printTaskLine(t: Task): void {
  const err = t.failureKind ? `  ✘ ${t.failureKind}: ${t.error ?? ""}` : "";
  console.log(`${t.id}  ${t.status.padEnd(17)} ${t.attempts}/${t.maxAttempts}  ${t.title}${err}`);
}

function printEvent(e: Omit<KernelEvent, "id">): void {
  const icon = { debug: " ", info: "•", warn: "!", error: "✘" }[e.level];
  console.log(`${local(e.ts)} ${icon} ${e.type.padEnd(22)} ${e.message}${e.taskId ? `  [${e.taskId}]` : ""}`);
}

function local(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
