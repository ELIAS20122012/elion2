// PC care agent: /pc report (disk, RAM, heavy apps, startup, junk), /pc clean (temp + recycle bin + crash dumps),
// /pc tidy (sorts loose files on Desktop/Downloads into type folders), /pc undo. Destructive steps always show a
// preview first and run only after "/pc clean yes" or "/pc tidy yes". Weekly report: Sunday 18:00.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Plugin } from "./types.ts";

export const PC_SCHEDULE = "pc-weekly";
const DAY = 86_400_000;

export const CATEGORIES: Record<string, string[]> = {
  Images: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "svg", "ico", "tif", "tiff", "psd"],
  Videos: ["mp4", "mov", "mkv", "avi", "webm", "wmv", "m4v"],
  Audio: ["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus"],
  Documents: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "md", "rtf", "odt", "epub"],
  Archives: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  Installers: ["exe", "msi", "msix", "appx", "iso", "dmg", "apk"],
  Code: ["json", "js", "ts", "py", "html", "css", "xml", "yml", "yaml", "mq4", "mq5", "ex4", "ex5", "set", "tpl", "sql", "ps1", "bat", "cmd", "sh"],
  Fonts: ["ttf", "otf", "woff", "woff2"],
};
const SKIP_EXT = new Set(["lnk", "url", "ini", "crdownload", "part", "tmp", "download", "partial"]);

export function categoryOf(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  for (const [cat, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return cat;
  return "Other";
}

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`);

/** Size of a folder, bounded so huge trees never block the daemon for long. */
export function folderSize(dir: string, limit = 200_000): { bytes: number; files: number } {
  let bytes = 0, files = 0;
  const stack = [dir];
  while (stack.length && files < limit) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) { bytes += fs.statSync(p).size; files++; }
      } catch { /* locked */ }
    }
  }
  return { bytes, files };
}

/** Deletes files older than `minAgeMs` inside `dir` (not the folder itself). Locked files are skipped. */
export function cleanFolder(dir: string, minAgeMs = DAY, now = Date.now()): { bytes: number; files: number; skipped: number } {
  let bytes = 0, files = 0, skipped = 0;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { bytes, files, skipped }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      const st = fs.statSync(p);
      if (now - st.mtimeMs < minAgeMs) continue;
      const size = e.isDirectory() ? folderSize(p).bytes : st.size;
      fs.rmSync(p, { recursive: true, force: true });
      bytes += size; files++;
    } catch { skipped++; }
  }
  return { bytes, files, skipped };
}

export interface TidyMove { from: string; to: string }

/** Plan: loose files (not folders, not shortcuts, not in-progress downloads) older than a day → <dir>/<Category>/. */
export function planTidy(dirs: string[], now = Date.now()): TidyMove[] {
  const moves: TidyMove[] = [];
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      if (SKIP_EXT.has(path.extname(e.name).slice(1).toLowerCase())) continue;
      const from = path.join(dir, e.name);
      try { if (now - fs.statSync(from).mtimeMs < DAY) continue; } catch { continue; }
      moves.push({ from, to: path.join(dir, categoryOf(e.name), e.name) });
    }
  }
  return moves;
}

function freeName(p: string): string {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; ; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

export function applyTidy(moves: TidyMove[]): { done: TidyMove[]; failed: number } {
  const done: TidyMove[] = [];
  let failed = 0;
  for (const m of moves) {
    try {
      fs.mkdirSync(path.dirname(m.to), { recursive: true });
      const to = freeName(m.to);
      fs.renameSync(m.from, to);
      done.push({ from: m.from, to });
    } catch { failed++; }
  }
  return { done, failed };
}

export function undoTidy(moves: TidyMove[]): number {
  let n = 0;
  for (const m of [...moves].reverse()) {
    try {
      if (fs.existsSync(m.to) && !fs.existsSync(m.from)) { fs.renameSync(m.to, m.from); n++; }
    } catch { /* moved again by hand */ }
  }
  return n;
}

function ps(script: string, timeout = 60_000): string {
  if (process.platform !== "win32") return "";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout, windowsHide: true });
  return (r.stdout ?? "").trim();
}

interface Paths { temp: string[]; crash: string[]; tidy: string[] }

function defaultPaths(): Paths {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const desktop = [path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop")].filter((d) => fs.existsSync(d));
  return {
    temp: [os.tmpdir(), path.join(process.env.SystemRoot ?? "C:\\Windows", "Temp")],
    crash: [path.join(local, "CrashDumps")],
    tidy: [path.join(home, "Downloads"), ...desktop],
  };
}

function systemReport(): string[] {
  if (process.platform !== "win32") return [`🖥 RAM آزاد: ${mb(os.freemem())} از ${mb(os.totalmem())}`];
  const out = ps(`
$d = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and ($_.Used + $_.Free) -gt 0 } | ForEach-Object { "DISK|$($_.Name)|$($_.Free)|$($_.Used + $_.Free)" }
$p = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 40 | Group-Object ProcessName | ForEach-Object { "PROC|$($_.Name)|$(($_.Group | Measure-Object WorkingSet64 -Sum).Sum)" } | Select-Object -First 8
$s = @(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | ForEach-Object { "START|$($_.Name)" })
$up = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$c = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$d; $p; $s; "UP|$([int]$up.TotalHours)"; "CPU|$c"`);
  const lines: string[] = [];
  const rows = out.split(/\r?\n/).map((l) => l.split("|"));
  const disks = rows.filter((r) => r[0] === "DISK");
  for (const [, name, free, total] of disks) {
    const f = Number(free), t = Number(total), pct = t ? Math.round((f / t) * 100) : 0;
    lines.push(`💽 درایو ${name}: ${mb(f)} آزاد از ${mb(t)} (${pct}%)${pct < 15 ? " ⚠️ کم" : ""}`);
  }
  const used = os.totalmem() - os.freemem();
  const ramPct = Math.round((used / os.totalmem()) * 100);
  lines.push(`🧠 RAM: ${ramPct}% پر (${mb(used)} از ${mb(os.totalmem())})${ramPct > 85 ? " ⚠️" : ""}`);
  const cpu = rows.find((r) => r[0] === "CPU")?.[1];
  if (cpu) lines.push(`⚙️ CPU الان: ${cpu}%`);
  const up = Number(rows.find((r) => r[0] === "UP")?.[1] ?? 0);
  if (up) lines.push(`⏱ روشن از ${up >= 48 ? `${Math.round(up / 24)} روز` : `${up} ساعت`} پیش${up > 72 ? " — یک ری‌استارت سرعت را بهتر می‌کند" : ""}`);
  const procs = rows.filter((r) => r[0] === "PROC");
  if (procs.length) lines.push("", "🐘 سنگین‌ترین برنامه‌ها (RAM):", ...procs.map(([, n, b]) => `- ${n}: ${mb(Number(b))}`));
  const starts = rows.filter((r) => r[0] === "START").map((r) => r[1]);
  if (starts.length) lines.push("", `🚀 برنامه‌های استارتاپ (${starts.length}): ${starts.slice(0, 15).join("، ")}`, "خاموش کردنشان: Task Manager ← Startup apps");
  return lines;
}

function junkLines(p: Paths): { lines: string[]; total: number } {
  const lines: string[] = [];
  let total = 0;
  for (const d of [...p.temp, ...p.crash]) {
    if (!fs.existsSync(d)) continue;
    const s = folderSize(d);
    total += s.bytes;
    lines.push(`- ${d}: ${mb(s.bytes)} (${s.files} فایل)`);
  }
  if (process.platform === "win32") {
    const rb = Number(ps("(New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum | ForEach-Object { $_.Sum }") || 0);
    total += rb;
    lines.push(`- سطل بازیافت: ${mb(rb)}`);
  }
  return { lines, total };
}

export function pcPlugin(paths: Paths = defaultPaths()): Plugin {
  return {
    name: "pc",
    description: "PC care: /pc report · clean · tidy · undo",
    setup({ kernel }) {
      const report = () => {
        const j = junkLines(paths);
        const loose = planTidy(paths.tidy);
        return [
          "🖥 وضعیت کامپیوتر",
          ...systemReport(),
          "",
          `🗑 فایل‌های اضافه: ${mb(j.total)}`,
          ...j.lines,
          `📂 فایل‌های نامرتب در Desktop/Downloads: ${loose.length}`,
          "",
          "/pc clean — پاکسازی · /pc tidy — مرتب‌سازی",
        ].join("\n");
      };
      kernel.registerProvider({
        name: "pc",
        health: async () => ({ ok: true, detail: "built-in" }),
        execute: async () => ({ output: report() }),
      });
      if (!kernel.getSchedule(PC_SCHEDULE)) {
        kernel.addSchedule(PC_SCHEDULE, "0 18 * * 0", { title: "🖥 گزارش هفتگی کامپیوتر", prompt: "report", provider: "pc", source: "report", verify: { type: "non_empty" }, maxAttempts: 1 });
      }
      kernel.registerCommand({
        name: "pc",
        description: "مدیریت کامپیوتر: /pc · /pc clean · /pc tidy · /pc undo",
        plugin: "pc",
        run(args) {
          const [sub, confirm] = args.trim().toLowerCase().split(/\s+/);
          if (!sub || sub === "report") return report();
          if (sub === "clean") {
            if (confirm !== "yes") {
              const j = junkLines(paths);
              return ["🗑 این‌ها پاک می‌شوند (فایل‌های temp قدیمی‌تر از ۱ روز، crash dumpها، سطل بازیافت):", ...j.lines, `جمع: ${mb(j.total)}`, "", "تأیید: /pc clean yes"].join("\n");
            }
            let bytes = 0, files = 0, skipped = 0;
            for (const d of [...paths.temp, ...paths.crash]) {
              const r = cleanFolder(d);
              bytes += r.bytes; files += r.files; skipped += r.skipped;
            }
            if (process.platform === "win32") {
              const rb = Number(ps("(New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum | ForEach-Object { $_.Sum }") || 0);
              ps("Clear-RecycleBin -Force -ErrorAction SilentlyContinue");
              bytes += rb;
            }
            kernel.log("pc.clean", `${files} items, ${bytes} bytes`);
            return `✅ ${mb(bytes)} آزاد شد (${files} مورد)${skipped ? ` · ${skipped} فایل در حال استفاده بود و ماند` : ""}`;
          }
          if (sub === "tidy") {
            const plan = planTidy(paths.tidy);
            if (!plan.length) return "📂 همه‌چیز مرتب است.";
            if (confirm !== "yes") {
              const byCat: Record<string, number> = {};
              for (const m of plan) byCat[path.basename(path.dirname(m.to))] = (byCat[path.basename(path.dirname(m.to))] ?? 0) + 1;
              return [`📂 ${plan.length} فایل در ${paths.tidy.join(" و ")} به پوشه‌ی نوعشان می‌روند:`, ...Object.entries(byCat).map(([c, n]) => `- ${c}: ${n}`), "", "میانبرها و دانلودهای نیمه‌کاره دست نمی‌خورند. برگرداندن: /pc undo", "تأیید: /pc tidy yes"].join("\n");
            }
            const r = applyTidy(plan);
            kernel.setKv("pc.tidy.last", JSON.stringify(r.done));
            kernel.log("pc.tidy", `${r.done.length} files moved`);
            return `✅ ${r.done.length} فایل مرتب شد${r.failed ? ` · ${r.failed} فایل باز بود و ماند` : ""}. برگرداندن: /pc undo`;
          }
          if (sub === "undo") {
            const last = JSON.parse(kernel.getKv("pc.tidy.last") ?? "[]") as TidyMove[];
            if (!last.length) return "چیزی برای برگرداندن نیست.";
            const n = undoTidy(last);
            kernel.setKv("pc.tidy.last", "[]");
            return `↩️ ${n} فایل به جای قبلی برگشت.`;
          }
          return "استفاده: /pc · /pc clean · /pc tidy · /pc undo";
        },
      });
    },
  };
}

