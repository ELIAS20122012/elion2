// Local web dashboard (http://127.0.0.1:7420). No build step: one HTML page + a small JSON API.
// Safety: binds to 127.0.0.1 only, checks the Host header (DNS rebinding) and requires an
// X-Elias header on writes (a cross-site page cannot send custom headers without a CORS preflight).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Kernel } from "../kernel/kernel.ts";
import { loadedPlugins } from "../plugins/host.ts";
import type { VoiceAssistant } from "../voice/assistant.ts";

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard.html");

/** Read-only static previews registered by plugins (e.g. /site-preview/ → site-draft). Served sandboxed:
 *  no scripts, unique origin — a previewed page can never call the dashboard API. */
const statics = new Map<string, () => string>();
export function registerStatic(prefix: string, dir: () => string): void {
  statics.set(prefix, dir);
}

function serveStatic(res: http.ServerResponse, pathname: string): boolean {
  for (const [prefix, dir] of statics) {
    if (pathname !== prefix.slice(0, -1) && !pathname.startsWith(prefix)) continue;
    const rel = decodeURIComponent(pathname.slice(prefix.length)) || "index.html";
    const name = /\.[a-z0-9]+$/i.test(rel) ? rel : `${rel}.html`;
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(name)) return send(res, 404, "not found", "text/plain"), true;
    const file = path.join(dir(), name);
    if (!fs.existsSync(file)) return send(res, 404, "not found", "text/plain"), true;
    const type = name.endsWith(".css") ? "text/css" : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".html") ? "text/html" : "text/plain";
    let body = fs.readFileSync(file, "utf8");
    if (type === "text/html") body = body.replace(/(href|src)=(["'])\/(?!\/)/g, `$1=$2${prefix}`);
    res.writeHead(200, {
      "content-type": `${type}; charset=utf-8`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: https:",
    });
    res.end(body);
    return true;
  }
  return false;
}

export function overview(k: Kernel) {
  const now = Date.now();
  return {
    stats: k.stats(),
    heartbeat: k.getKv("daemon.heartbeat"),
    providers: k.listProviders().filter((p) => ["claude-code", "codex", "antigravity", "gemini-vertex", "gemini", "ollama"].includes(p.name)).map((p) => {
      const until = Number(k.getKv(`provider.cooldown.${p.name}`) ?? 0);
      return { name: p.name, coolingUntil: until > now ? new Date(until).toISOString() : null };
    }),
    approvals: k.listApprovals("pending").map((a) => ({ ...a, task: k.getTask(a.taskId)?.title ?? a.taskId })),
    tasks: k.listTasks({ limit: 30 }).map((t) => ({
      id: t.id, title: t.title, status: t.status, provider: t.provider, source: t.source,
      failureKind: t.failureKind, error: t.error, result: t.result?.slice(0, 4000) ?? null, updatedAt: t.updatedAt,
    })),
    schedules: k.listSchedules(),
    skills: k.listSkills().map((s) => ({ name: s.name, description: s.description, plugin: s.plugin })),
    commands: k.listCommands().map((c) => ({ name: c.name, description: c.description, plugin: c.plugin })),
    plugins: loadedPlugins(k),
    events: k.listEvents({ limit: 40 }),
  };
}

function send(res: http.ServerResponse, code: number, body: unknown, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 100_000) throw new Error("body too large");
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/** Remote access: requests for `publicHost` arrive through Cloudflare Tunnel and must carry the
 *  Cloudflare Access identity of the owner (Access blocks everyone else before they reach the PC). */
export interface RemoteAccess {
  publicHost: string;
  ownerEmail: string;
}

export function handler(k: Kernel, port: number, remote: RemoteAccess | null = null, voice: VoiceAssistant | null = null) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const host = String(req.headers.host ?? "").toLowerCase();
      const isRemote = !!remote && host === remote.publicHost.toLowerCase();
      if (!hosts.has(host) && !isRemote) return send(res, 403, { error: "bad host" });
      if (isRemote) {
        const who = String(req.headers["cf-access-authenticated-user-email"] ?? "").toLowerCase();
        if (!req.headers["cf-access-jwt-assertion"] || who !== remote!.ownerEmail.toLowerCase()) {
          k.log("dashboard.denied", `remote request without owner identity (${who || "none"})`, { level: "warn" });
          return send(res, 403, { error: "forbidden" });
        }
      }
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(PAGE, "utf8"), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/overview") return send(res, 200, overview(k));
      if (req.method === "GET" && serveStatic(res, url.pathname)) return;
      // Desktop voice assistant (voice/listener.py) — this PC only, never through the tunnel.
      const vm = url.pathname.match(/^\/api\/voice(?:\/([\w-]+))?$/);
      if (vm) {
        if (isRemote || !voice) return send(res, 404, { error: "not found" });
        if (req.headers["x-elias"] !== "1") return send(res, 403, { error: "missing X-Elias header" });
        if (req.method === "GET" && vm[1]) return send(res, 200, await voice.result(vm[1]));
        if (req.method === "POST" && !vm[1]) {
          const b = await readJson(req);
          const wav = typeof b.wav === "string" ? b.wav : undefined;
          if (wav && !/\.wav$/i.test(wav)) return send(res, 400, { error: "wav only" });
          return send(res, 200, await voice.handle({ ...(wav ? { wav } : {}), ...(typeof b.text === "string" ? { text: b.text } : {}) }));
        }
        return send(res, 404, { error: "not found" });
      }
      if (req.method !== "POST") return send(res, 404, { error: "not found" });
      if (req.headers["x-elias"] !== "1") return send(res, 403, { error: "missing X-Elias header" });
      const body = await readJson(req);
      const m = url.pathname.match(/^\/api\/(approvals|tasks|skills|commands)\/([\w-]+)\/(approve|reject|retry|cancel|run)$/);
      if (url.pathname === "/api/tasks") {
        const prompt = String(body.prompt ?? "").trim();
        if (!prompt) return send(res, 400, { error: "empty prompt" });
        const t = k.createTask({ title: prompt.slice(0, 60), prompt, source: "dashboard", verify: { type: "non_empty" } });
        return send(res, 200, { ok: true, id: t.id });
      }
      if (!m) return send(res, 404, { error: "not found" });
      const [, kind, id, action] = m;
      if (kind === "approvals" && (action === "approve" || action === "reject")) k.decideApproval(id!, action === "approve", "via dashboard");
      else if (kind === "tasks" && action === "retry") k.retryTask(id!, { useDefaultProvider: true });
      else if (kind === "tasks" && action === "cancel") k.cancelTask(id!, "cancelled from dashboard");
      else if (kind === "skills" && action === "run") k.runSkill(id!, String(body.input ?? ""), "dashboard");
      else if (kind === "commands" && action === "run") {
        const c = k.getCommand(id!);
        if (!c) return send(res, 404, { error: "unknown command" });
        return send(res, 200, { ok: true, reply: await c.run(String(body.input ?? "")) });
      }
      else return send(res, 404, { error: "not found" });
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  };
}

export function startDashboard(k: Kernel, port = 7420, remote: RemoteAccess | null = null, voice: VoiceAssistant | null = null): http.Server {
  const server = http.createServer(handler(k, port, remote, voice));
  server.on("error", (e) => k.log("dashboard.failed", (e as Error).message, { level: "warn" }));
  server.listen(port, "127.0.0.1", () => k.log("dashboard.started", `http://127.0.0.1:${port}`));
  return server;
}
