// Control the PC from Telegram: /screen (screenshot), /open <app or link>, /file <name> (send a file from the PC),
// /apps (open windows), /close <app>, /power lock|sleep|restart|shutdown|cancel.
// Anything that can lose work (closing an app, sleep, restart, shutdown) answers with a ▶️ "… yes" button first.
// Files are only searched in Elias's own folders and never secrets/keys/config.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Plugin } from "./types.ts";

/** A command result may carry a file for Telegram: «<<<PHOTO path PHOTO>>>» or «<<<FILE path FILE>>>». */
export const fileMark = (kind: "PHOTO" | "FILE", p: string) => `<<<${kind} ${p} ${kind}>>>`;

export type Run = (cmd: string, args: string[]) => { code: number; out: string };
const realRun: Run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};
const ps = (run: Run, script: string) => run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);

/** Friendly names (English + Persian) → what Windows should start. Anything else must be a link or a known name. */
export const APPS: Record<string, string> = {
  chrome: "chrome", کروم: "chrome", browser: "chrome", مرورگر: "chrome",
  edge: "msedge",
  notepad: "notepad", نوت‌پد: "notepad", نوتپد: "notepad",
  calculator: "calc", calc: "calc", ماشین‌حساب: "calc", ماشین: "calc",
  explorer: "explorer", files: "explorer", فایل‌ها: "explorer", اکسپلورر: "explorer",
  downloads: `explorer|${path.join(os.homedir(), "Downloads")}`, دانلودها: `explorer|${path.join(os.homedir(), "Downloads")}`,
  desktop: `explorer|${path.join(os.homedir(), "Desktop")}`, دسکتاپ: `explorer|${path.join(os.homedir(), "Desktop")}`,
  obsidian: "obsidian:", ابسیدین: "obsidian:",
  vscode: "code", code: "code",
  telegram: "tg:", تلگرام: "tg:",
  spotify: "spotify:", اسپاتیفای: "spotify:",
  settings: "ms-settings:", تنظیمات: "ms-settings:",
  taskmgr: "taskmgr", "task manager": "taskmgr", تسک‌منیجر: "taskmgr",
  word: "winword", excel: "excel", powerpoint: "powerpnt",
  youtube: "https://www.youtube.com", یوتیوب: "https://www.youtube.com",
  gmail: "https://mail.google.com", جیمیل: "https://mail.google.com",
  panel: "http://127.0.0.1:7420", پنل: "http://127.0.0.1:7420",
};

export function resolveApp(name: string): string | null {
  const n = name.trim().toLowerCase().replace(/^(را|رو)\s+|\s+(را|رو)$/g, "");
  if (/^https?:\/\/\S+$/i.test(name.trim())) return name.trim();
  if (APPS[n]) return APPS[n]!;
  if (/^[a-z0-9.-]+\.(com|org|net|io|de|at|ir|ai)(\/\S*)?$/i.test(n)) return `https://${n}`;
  return null;
}

const BLOCKED = /(secret|password|passwd|token|\.env$|\.pem$|\.key$|id_rsa|\.ssh|credential|wallet|google-token|google-client|cookies)/i;

/** Finds Elias's file by (part of) its name in his own folders. Newest match first. */
export function findFiles(query: string, roots: string[], limit = 5): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: { p: string; t: number }[] = [];
  let seen = 0;
  const stack = roots.filter((r) => fs.existsSync(r));
  while (stack.length && seen < 60_000) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      seen++;
      const p = path.join(d, e.name);
      if (BLOCKED.test(p) || e.name.startsWith(".") || e.name === "node_modules" || e.name === "AppData") continue;
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase().includes(q)) {
        try { hits.push({ p, t: fs.statSync(p).mtimeMs }); } catch { /* gone */ }
      }
    }
  }
  return hits.sort((a, b) => b.t - a.t).slice(0, limit).map((h) => h.p);
}

export function defaultRoots(): string[] {
  const h = os.homedir();
  return ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive"].map((d) => path.join(h, d));
}

const SCREENSHOT = (out: string) => `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;
$g=[System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);
$bmp.Save('${out.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png);
$g.Dispose();$bmp.Dispose()`;

export function remotePlugin(o: { run?: Run; roots?: string[]; tmp?: string } = {}): Plugin {
  const run = o.run ?? realRun;
  const roots = o.roots ?? defaultRoots();
  const tmp = o.tmp ?? os.tmpdir();
  return {
    name: "remote",
    description: "PC control from Telegram: /screen /open /file /apps /close /power",
    setup({ kernel }) {
      kernel.registerCommand({
        name: "screen",
        description: "عکس از صفحه‌ی کامپیوتر",
        plugin: "remote",
        run() {
          const out = path.join(tmp, `elias-screen-${Date.now()}.png`);
          const r = ps(run, SCREENSHOT(out));
          return r.code === 0 && fs.existsSync(out) ? `🖥 صفحه‌ی کامپیوتر\n${fileMark("PHOTO", out)}` : `عکس صفحه نشد: ${r.out.slice(-200)}`;
        },
      });
      kernel.registerCommand({
        name: "open",
        description: "باز کردن برنامه یا لینک (/open chrome · /open youtube.com)",
        plugin: "remote",
        run(args) {
          const target = resolveApp(args);
          if (!target) return `نمی‌شناسم: «${args.trim()}». برنامه‌ها: ${[...new Set(Object.keys(APPS).filter((k) => /^[a-z]/.test(k)))].join("، ")} — یا یک لینک.`;
          const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
          const [exe, arg] = target.split("|");
          const r = ps(run, arg ? `Start-Process -FilePath ${q(exe!)} -ArgumentList ${q(`"${arg}"`)}` : `Start-Process -FilePath ${q(exe!)}`);
          return r.code === 0 ? `✅ باز شد: ${args.trim()}` : `باز نشد: ${r.out.slice(-200)}`;
        },
      });
      kernel.registerCommand({
        name: "file",
        description: "فرستادن فایل از کامپیوتر (/file اسم فایل)",
        plugin: "remote",
        run(args) {
          const pick = args.trim().match(/^(\d)\s+(.+)$/);
          const list = findFiles(pick ? pick[2]! : args, roots);
          if (!list.length) return `فایلی با «${args.trim()}» در دسکتاپ، داکیومنت، دانلود، عکس‌ها و وان‌درایو پیدا نشد.`;
          const chosen = pick ? list[Number(pick[1]) - 1] : list.length === 1 ? list[0] : null;
          if (!chosen) return `چند فایل پیدا شد:\n${list.map((p, i) => `${i + 1}. ${path.basename(p)} — ${path.dirname(p)}`).join("\n")}\n${list.map((_, i) => `>>> /file ${i + 1} ${args.trim()}`).join("\n")}`;
          const size = fs.statSync(chosen).size;
          if (size > 49 * 1024 * 1024) return `فایل بزرگ‌تر از ۵۰ مگابایت است (محدودیت تلگرام): ${chosen}`;
          return `📎 ${path.basename(chosen)}\n${fileMark("FILE", chosen)}`;
        },
      });
      kernel.registerCommand({
        name: "apps",
        description: "برنامه‌های باز روی کامپیوتر",
        plugin: "remote",
        run() {
          const r = ps(run, `Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object WorkingSet64 -Descending | ForEach-Object { "$($_.ProcessName)|$([math]::Round($_.WorkingSet64/1MB))|$($_.MainWindowTitle)" }`);
          const rows = r.out.split(/\r?\n/).filter(Boolean).slice(0, 20).map((l) => {
            const [n, mbs, title] = l.split("|");
            return `• ${n} (${mbs} MB) — ${(title ?? "").slice(0, 50)}`;
          });
          return rows.length ? `🪟 برنامه‌های باز:\n${rows.join("\n")}\nبستن: /close اسم` : "برنامه‌ی بازی پیدا نشد.";
        },
      });
      kernel.registerCommand({
        name: "close",
        description: "بستن برنامه (/close chrome) — با تأیید",
        plugin: "remote",
        run(args) {
          const m = args.trim().match(/^(.+?)(\s+yes)?$/i);
          const name = (m?.[1] ?? "").replace(/\.exe$/i, "").trim();
          if (!/^[\w.-]{2,40}$/.test(name)) return "استفاده: /close chrome";
          if (/^(explorer|winlogon|csrss|svchost|node|powershell|cmd|python|system|lsass|dwm|wininit|services)$/i.test(name)) return `«${name}» را نمی‌بندم (برای ویندوز یا Elias OS لازم است).`;
          if (!m?.[2]) return `⚠️ «${name}» بسته شود؟ کارهای ذخیره‌نشده از بین می‌رود.\n>>> /close ${name} yes`;
          const r = ps(run, `Get-Process -Name '${name}' -ErrorAction Stop | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep 3; Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Stop-Process -Force`);
          return r.code === 0 ? `✅ بسته شد: ${name}` : `پیدا نشد یا بسته نشد: ${name}`;
        },
      });
      kernel.registerCommand({
        name: "power",
        description: "قفل/خواب/ری‌استارت/خاموش (/power lock · sleep · restart · shutdown · cancel)",
        plugin: "remote",
        run(args) {
          const [act, yes] = args.trim().toLowerCase().split(/\s+/);
          const fa: Record<string, string> = { lock: "قفل", sleep: "خواب", restart: "ری‌استارت", shutdown: "خاموش" };
          if (act === "lock") return run("rundll32", ["user32.dll,LockWorkStation"]).code === 0 ? "🔒 کامپیوتر قفل شد." : "قفل نشد.";
          if (act === "cancel") return run("shutdown", ["/a"]).code === 0 ? "✅ ری‌استارت/خاموشی لغو شد." : "چیزی برای لغو نبود.";
          if (!act || !fa[act]) return "استفاده: /power lock · sleep · restart · shutdown · cancel";
          if (yes !== "yes") return `⚠️ کامپیوتر ${fa[act]} شود؟ Elias OS هم تا روشن شدن دوباره در دسترس نیست.\n>>> /power ${act} yes`;
          if (act === "sleep") {
            run("rundll32", ["powrprof.dll,SetSuspendState", "0,1,0"]);
            return "😴 کامپیوتر به خواب رفت.";
          }
          const r = run("shutdown", [act === "restart" ? "/r" : "/s", "/t", "60", "/c", "Elias OS"]);
          return r.code === 0 ? `⏳ ${fa[act]} تا ۶۰ ثانیه دیگر. لغو: /power cancel` : `انجام نشد: ${r.out.slice(-200)}`;
        },
      });
    },
  };
}
