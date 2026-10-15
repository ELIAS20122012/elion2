// MT4 (read-only) via the EliasBridge EA: account/positions/history JSON in <MT4 Common>/Files/EliasOS.
// /account /trades /draw · context mt4:account · risk watch every 5 min · daily P&L at 23:00. Never trades.
import fs from "node:fs";
import path from "node:path";
import type { Kernel } from "../kernel/kernel.ts";
import type { ExecutionProvider } from "../providers/types.ts";
import type { Plugin } from "./types.ts";
import { execFile } from "node:child_process";
import { fileMark } from "./remote.ts";

/** Finds MT4 terminals that have EliasBridge.mq4 but no up-to-date .ex4 and compiles it with that terminal's MetaEditor. */
export function compileBridges(k: Kernel, termRoot = path.join(process.env.APPDATA ?? "", "MetaQuotes", "Terminal")): void {
  if (process.platform !== "win32" || !fs.existsSync(termRoot)) return;
  for (const id of fs.readdirSync(termRoot)) {
    const experts = path.join(termRoot, id, "MQL4", "Experts");
    const mq4 = path.join(experts, "EliasBridge.mq4");
    const ex4 = path.join(experts, "EliasBridge.ex4");
    if (!fs.existsSync(mq4)) continue;
    if (fs.existsSync(ex4) && fs.statSync(ex4).mtimeMs >= fs.statSync(mq4).mtimeMs) continue;
    let install = "";
    try {
      install = fs.readFileSync(path.join(termRoot, id, "origin.txt")).toString("utf16le").replace(/^\uFEFF/, "").trim();
    } catch {
      continue;
    }
    const editor = path.join(install, "metaeditor.exe");
    if (!fs.existsSync(editor)) continue;
    // MetaEditor wants the quotes around the path only (/compile:"C:\…\x.mq4"), so pass arguments verbatim.
    execFile(editor, [`/compile:"${mq4}"`, "/log"], { windowsHide: true, timeout: 120_000, windowsVerbatimArguments: true, shell: false }, () => {
      const ok = fs.existsSync(ex4) && fs.statSync(ex4).mtimeMs >= fs.statSync(mq4).mtimeMs;
      k.log(ok ? "mt4.compiled" : "mt4.compile_failed", `${ok ? "EliasBridge compiled" : "EliasBridge compile failed"} in ${install}`, { level: ok ? "info" : "warn" });
    });
  }
}

export interface Mt4Order {
  ticket: number;
  symbol: string;
  type: number; // 0 buy, 1 sell, 2-5 pending
  lots: number;
  open_price: number;
  sl: number;
  tp: number;
  open_time: string;
  profit: number;
  risk_money?: number;
  close_price?: number;
  close_time?: string;
}

export interface Mt4Account {
  login: number;
  server: string;
  company: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  floating_pl: number;
  today_closed_pl: number;
  today_closed_count: number;
  server_time: string;
  chart_symbol?: string;
  open: Mt4Order[];
}

export interface RiskRules {
  maxRiskPct: number;
  maxDailyLossPct: number;
  requireStop: boolean;
}

const TYPES = ["Buy", "Sell", "Buy Limit", "Sell Limit", "Buy Stop", "Sell Stop"];
const money = (v: number, c = "") => `${v >= 0 ? "+" : ""}${v.toFixed(2)}${c ? " " + c : ""}`;

export function defaultDir(): string {
  return path.join(process.env.APPDATA ?? "", "MetaQuotes", "Terminal", "Common", "Files", "EliasOS");
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "latin1")) as T;
  } catch {
    return null;
  }
}

export function feedAgeMs(dir: string): number {
  try {
    return Date.now() - fs.statSync(path.join(dir, "account.json")).mtimeMs;
  } catch {
    return Infinity;
  }
}

export function accountSummary(a: Mt4Account): string {
  const pos = a.open.filter((o) => o.type <= 1);
  const pend = a.open.length - pos.length;
  return [
    `💼 ${a.company} #${a.login} (${a.currency})`,
    `بالانس: ${a.balance.toFixed(2)} · اکوئیتی: ${a.equity.toFixed(2)}`,
    `شناور: ${money(a.floating_pl)} · بسته‌شده امروز: ${money(a.today_closed_pl)} (${a.today_closed_count} معامله)`,
    `مارجین آزاد: ${a.free_margin.toFixed(2)}`,
    ...(pos.length
      ? ["", `📂 پوزیشن‌های باز (${pos.length}):`, ...pos.map((o) => `${TYPES[o.type]} ${o.symbol} ${o.lots} @ ${o.open_price} · SL ${o.sl || "❌"} · ${money(o.profit)}`)]
      : ["", "پوزیشن بازی نیست."]),
    ...(pend ? [`⏳ سفارش معلق: ${pend}`] : []),
  ].join("\n");
}

/** Rule checks on the live snapshot. Returns alert keys + messages (keys dedupe repeated alerts). */
export function riskAlerts(a: Mt4Account, r: RiskRules): Array<{ key: string; msg: string }> {
  const out: Array<{ key: string; msg: string }> = [];
  for (const o of a.open.filter((x) => x.type <= 1)) {
    if (r.requireStop && !(o.sl > 0)) out.push({ key: `nosl.${o.ticket}`, msg: `⚠️ بدون استاپ: ${TYPES[o.type]} ${o.symbol} ${o.lots} لات (#${o.ticket})` });
    else if ((o.risk_money ?? -1) > 0 && a.balance > 0) {
      const pct = (o.risk_money! / a.balance) * 100;
      if (pct > r.maxRiskPct) out.push({ key: `risk.${o.ticket}.${o.sl}`, msg: `⚠️ ریسک ${pct.toFixed(2)}٪ (حد تو ${r.maxRiskPct}٪): ${o.symbol} #${o.ticket} — ${o.risk_money!.toFixed(2)} ${a.currency}` });
    }
  }
  const day = a.today_closed_pl + a.floating_pl;
  if (a.balance > 0 && day < 0 && (-day / a.balance) * 100 > r.maxDailyLossPct) {
    out.push({ key: `daily.${a.server_time.slice(0, 10)}`, msg: `🛑 ضرر امروز ${((-day / a.balance) * 100).toFixed(2)}٪ از حد روزانه‌ی ${r.maxDailyLossPct}٪ گذشت — وقت توقف است.` });
  }
  return out;
}

export function tradesToday(hist: Mt4Order[], serverDate: string): string {
  const day = hist.filter((o) => (o.close_time ?? "").startsWith(serverDate));
  if (!day.length) return "امروز معامله‌ی بسته‌شده‌ای نیست.";
  const total = day.reduce((s, o) => s + o.profit, 0);
  const wins = day.filter((o) => o.profit > 0).length;
  return [
    `📒 معاملات امروز (${day.length}) · نتیجه ${money(total)} · برد ${wins}/${day.length}`,
    ...day.map((o) => `${o.profit >= 0 ? "✅" : "❌"} ${TYPES[o.type]} ${o.symbol} ${o.lots} · ${o.open_price} → ${o.close_price} · ${money(o.profit)}`),
  ].join("\n");
}

/** "/draw 4188 مقاومت | 4122 حمایت" → draw.txt lines for the EA chart. */
export function parseDraw(args: string): string[] | null {
  const a = args.trim();
  if (a === "clear" || a === "پاک") return ["CLEAR"];
  const parts = a.split(/[|,،\n]/).map((x) => x.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const p of parts) {
    const m = p.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (!m) continue;
    const label = m[2]!.trim();
    const type = /مقاومت|res/i.test(label) ? "res" : /حمایت|sup/i.test(label) ? "sup" : "other";
    lines.push(`*|${m[1]}|${type}|${label.replace(/\|/g, " ").slice(0, 40)}`);
  }
  return lines.length ? lines : null;
}

export function findChartImage(dir: string, termRoot = path.join(process.env.APPDATA ?? "", "MetaQuotes", "Terminal")): string | null {
  const candidates: Array<{ p: string; mtime: number }> = [];
  const commonImg = path.join(dir, "chart.png");
  if (fs.existsSync(commonImg)) {
    try { candidates.push({ p: commonImg, mtime: fs.statSync(commonImg).mtimeMs }); } catch {}
  }
  if (fs.existsSync(termRoot)) {
    try {
      for (const id of fs.readdirSync(termRoot)) {
        if (/^(common|community|help)$/i.test(id)) continue;
        const localImg = path.join(termRoot, id, "MQL4", "Files", "chart.png");
        if (fs.existsSync(localImg)) {
          try { candidates.push({ p: localImg, mtime: fs.statSync(localImg).mtimeMs }); } catch {}
        }
      }
    } catch {}
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.p;
}

export const mt4Plugin: Plugin = {
  name: "mt4",
  description: "MT4 read-only: /account /trades /draw /chart, risk alerts, daily P&L",
  setup({ kernel, home, options }) {
    const dir = String(options.dir ?? defaultDir());
    const termRoot = path.join(process.env.APPDATA ?? "", "MetaQuotes", "Terminal");
    const rules: RiskRules = {
      maxRiskPct: Number(options.maxRiskPct ?? 1),
      maxDailyLossPct: Number(options.maxDailyLossPct ?? 3),
      requireStop: options.requireStop !== false,
    };
    const staleMs = 15 * 60_000;
    const account = () => readJson<Mt4Account>(path.join(dir, "account.json"));
    const history = () => readJson<Mt4Order[]>(path.join(dir, "history.json")) ?? [];
    const offline = () =>
      feedAgeMs(dir) === Infinity
        ? "MT4 وصل نیست — EliasBridge را روی یک چارت MT4 بگذار (setup/mt4-setup.cmd)."
        : `اطلاعات MT4 قدیمی است (${Math.round(feedAgeMs(dir) / 60000)} دقیقه) — MT4 یا EA خاموش است؟`;
    void home;

    if (options.autoCompile !== false) compileBridges(kernel);

    kernel.registerContextSource({
      name: "mt4:account",
      capability: "read:trading",
      description: "Live MT4 account, open positions and today's closed trades (read-only)",
      fetch: async () => {
        const a = account();
        if (!a || feedAgeMs(dir) > staleMs) return offline();
        return `${accountSummary(a)}\n\n${tradesToday(history(), a.server_time.slice(0, 10))}`;
      },
    });

    const alert = (k: Kernel, text: string) =>
      k.createTask({ title: "📈 هشدار ترید", prompt: text, provider: "reminder", source: "reminder", verify: { type: "non_empty" }, maxAttempts: 1 });

    const provider: ExecutionProvider = {
      name: "mt4",
      health: async () => ({ ok: feedAgeMs(dir) < staleMs, detail: feedAgeMs(dir) < staleMs ? "bridge live" : "bridge offline" }),
      execute: async (req) => {
        const job = req.prompt.trim().split(/\s/)[0];
        const a = account();
        if (!a || feedAgeMs(dir) > staleMs) return { output: "offline" };
        if (job === "risk") {
          const fired: string[] = [];
          for (const al of riskAlerts(a, rules)) {
            const key = `mt4.alerted.${al.key}`;
            if (kernel.getKv(key)) continue;
            kernel.setKv(key, new Date().toISOString());
            alert(kernel, al.msg);
            fired.push(al.key);
          }
          return { output: fired.length ? `alerts: ${fired.join(", ")}` : "ok" };
        }
        if (job === "daily") return { output: `${tradesToday(history(), a.server_time.slice(0, 10))}\n\n${accountSummary(a)}` };
        throw new Error(`unknown mt4 job "${job}"`);
      },
    };
    kernel.registerProvider(provider);
    const job = (title: string, prompt: string, source: string) => ({ title, prompt, provider: "mt4", source, verify: { type: "non_empty" as const }, maxAttempts: 1 });
    if (!kernel.getSchedule("mt4-risk-watch")) kernel.addSchedule("mt4-risk-watch", "*/5 * * * *", job("📈 پایش ریسک", "risk", "internal"));
    if (!kernel.getSchedule("mt4-daily")) kernel.addSchedule("mt4-daily", "0 23 * * 1-5", job("📒 گزارش روزانه‌ی ترید", "daily", "report"));

    kernel.registerCommand({
      name: "account",
      description: "وضعیت حساب MT4 و پوزیشن‌ها",
      plugin: "mt4",
      run() {
        const a = account();
        return a && feedAgeMs(dir) < staleMs ? accountSummary(a) : offline();
      },
    });
    kernel.registerCommand({
      name: "trades",
      description: "معاملات بسته‌شده‌ی امروز",
      plugin: "mt4",
      run() {
        const a = account();
        return a && feedAgeMs(dir) < staleMs ? tradesToday(history(), a.server_time.slice(0, 10)) : offline();
      },
    });
    kernel.registerCommand({
      name: "chart",
      description: "دیدن چارت زنده متاتریدر (طلا XAUUSD)",
      plugin: "mt4",
      run() {
        const shot = findChartImage(dir, termRoot);
        if (!shot) {
          return (
            "📊 چارت متاتریدر هنوز در دسترس نیست.\n" +
            "۱. مطمئن شو متاتریدر باز است.\n" +
            "۲. اکسپرت EliasBridge را روی چارت طلا بگذار.\n" +
            "💡 همچنین می‌توانی از دستور /screen برای دیدن کل صفحه مانیتور استفاده کنی."
          );
        }
        const a = account();
        const sym = a?.chart_symbol ? a.chart_symbol : "XAUUSD";
        const accInfo = a ? ` · ${a.company} #${a.login}` : "";
        return `📈 چارت زنده ${sym}${accInfo}\n${fileMark("PHOTO", shot)}`;
      },
    });
    kernel.registerCommand({
      name: "draw",
      description: "کشیدن سطح روی چارت MT4 (/draw 4188 مقاومت | 4122 حمایت · /draw clear)",
      plugin: "mt4",
      run(args) {
        const lines = parseDraw(args);
        if (!lines) return "استفاده: /draw 4188 مقاومت | 4122 حمایت   ·   /draw clear";
        if (feedAgeMs(dir) > staleMs) return offline();
        fs.mkdirSync(dir, { recursive: true });
        // UTF-16LE with BOM so MT4 (FILE_UNICODE) reads Persian labels correctly; the EA deletes the file after drawing.
        fs.writeFileSync(path.join(dir, "draw.txt"), Buffer.from("\ufeff" + lines.join("\r\n") + "\r\n", "utf16le"));
        return lines[0] === "CLEAR" ? "🧹 خط‌های Elias از چارت پاک می‌شوند." : `📍 ${lines.length} سطح روی چارت MT4 کشیده می‌شود (چارتی که EA رویش است).`;
      },
    });
  },
};
