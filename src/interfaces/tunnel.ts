// Cloudflare Tunnel, supervised by the daemon: makes the dashboard reachable at the public hostname
// (protected by Cloudflare Access) without opening any port. Token lives in secrets.json → tunnel.token.
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Kernel } from "../kernel/kernel.ts";

const URL_WIN = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

/** Downloads the official cloudflared binary once (Windows). */
export async function ensureCloudflared(binDir: string): Promise<string> {
  const exe = path.join(binDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(exe)) return exe;
  if (process.platform !== "win32") throw new Error("install cloudflared and put it in data/bin");
  fs.mkdirSync(binDir, { recursive: true });
  const res = await fetch(URL_WIN, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`cloudflared download failed: ${res.status}`);
  const tmp = exe + ".part";
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, exe);
  return exe;
}

export class Tunnel {
  private child: ChildProcess | null = null;
  private stopped = false;
  private failures = 0;
  private k: Kernel;
  private token: string;
  private home: string;
  constructor(k: Kernel, token: string, home: string) {
    this.k = k;
    this.token = token;
    this.home = home;
  }

  async start(): Promise<void> {
    let exe: string;
    try {
      exe = await ensureCloudflared(path.join(this.home, "data", "bin"));
    } catch (e) {
      this.k.log("tunnel.failed", (e as Error).message, { level: "warn" });
      return;
    }
    const log = fs.createWriteStream(path.join(this.home, "data", "tunnel.log"), { flags: "a" });
    const run = () => {
      if (this.stopped) return;
      const started = Date.now();
      this.child = spawn(exe, ["tunnel", "--no-autoupdate", "run", "--token", this.token], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      this.child.stdout?.pipe(log, { end: false });
      this.child.stderr?.pipe(log, { end: false });
      this.k.log("tunnel.started", "Cloudflare Tunnel running");
      this.k.setKv("tunnel.state", JSON.stringify({ up: true, at: new Date().toISOString() }));
      this.child.on("exit", (code) => {
        this.child = null;
        if (this.stopped) return;
        this.failures = Date.now() - started > 60_000 ? 0 : this.failures + 1;
        const wait = Math.min(300_000, 5_000 * 2 ** this.failures);
        this.k.setKv("tunnel.state", JSON.stringify({ up: false, at: new Date().toISOString(), code }));
        this.k.log("tunnel.exited", `cloudflared exited (${code}); restarting in ${Math.round(wait / 1000)}s`, { level: "warn" });
        setTimeout(run, wait).unref();
      });
    };
    run();
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
  }
}
