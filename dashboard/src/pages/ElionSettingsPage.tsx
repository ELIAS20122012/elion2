import { useEffect, useRef, useState } from "react";
import { ElionSidebar } from "../components/ElionChrome";
import { ACCENTS, beep, ensureNotifyPermission, LANDING_ROUTES, notifyUser, notifySupported, resetSettings, TZ_OPTIONS, useSettings, type ElionSettings } from "../lib/elionSettings";
import { setLang, t } from "../lib/i18n";
import { journalApi, type TgNotify } from "../lib/journalApi";
import { setDefaultReplaySpeed, setDefaultTf, useMaxPerDay } from "../lib/prefs";
import { SPEEDS } from "../lib/useReplay";
import { useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";

/**
 * Every control on this page is now real: settings persist in localStorage (lib/elionSettings.ts) and
 * are applied by ElionGlobalEffects (font size, accent, midnight theme, animations, exit prompt, daily
 * backup, trade/session notifications), the Trade page (default lot/risk/SL/TP, max positions, hedging,
 * suggested lot, grid), the header clock (timezone/date/time format) and the router (landing page).
 * Options from the original mockup that this app has nothing behind (languages, light theme, candle
 * styles, sidebar styles, cloud sync, email/news alerts, screenshots, data-retention deletion) were
 * removed rather than left as switches that do nothing.
 */

const APP_VERSION = "0.1.0";
const TF = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const SPEEDS_LIST: number[] = [...SPEEDS];
const SPEEDS_OPT = SPEEDS_LIST.map((s) => `${s}x`);

type Row = {
  label?: string; icon?: string; sep?: boolean; line?: string; gap?: string; w?: string; labelC?: string;
  select?: boolean; options?: string[]; value?: string; onChange?: (v: string) => void;
  input?: boolean; unit?: boolean; unitValue?: string; onUnit?: (v: string) => void;
  toggle?: boolean; track?: string; knob?: string; onToggle?: () => void;
  check?: boolean; chkBg?: string; chkBd?: string; chkOp?: number;
  link?: boolean; onClick?: () => void; btn?: string; btnBd?: string; btnBg?: string; btnFg?: string;
  chips?: boolean; chipList?: { l: string; rm: () => void }[];
  colors?: boolean; colorList?: { c: string; ring: string; on: () => void }[];
  status?: boolean;
};
type Card = { icon: string; title: string; rows: Row[]; footer?: string; footerIcon?: string; onFooter?: () => void; preview?: boolean };

const CARD: React.CSSProperties = { borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const CTL: React.CSSProperties = { borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", color: "var(--e-text)", outline: "none" };

function Select({ value, options, onChange, h, fs, w }: { value: string; options: string[]; onChange: (v: string) => void; h: number; fs: number; w: string }) {
  return (
    <div style={{ position: "relative", width: w }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...CTL, appearance: "none", WebkitAppearance: "none", width: "100%", height: h, fontSize: fs, padding: `0 ${h === 26 ? 22 : 24}px 0 ${h === 26 ? 8 : 10}px`, cursor: "pointer" }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="e-icon" style={{ position: "absolute", right: h === 26 ? 4 : 6, top: h === 26 ? 4 : 6, fontSize: 17, pointerEvents: "none" }}>expand_more</span>
    </div>
  );
}

function Toggle({ track, knob, onClick }: { track: string; knob: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ width: 30, height: 18, borderRadius: 9, background: track, position: "relative", cursor: "pointer", transition: "background .2s" }}>
      <div style={{ position: "absolute", top: 2, left: knob, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
    </div>
  );
}

/** the controls half of a row — shared by all three card sizes */
function Controls({ r, h, fs }: { r: Row; h: number; fs: number }) {
  return (
    <>
      {r.select && <Select value={r.value!} options={r.options!} onChange={r.onChange!} h={h} fs={fs} w={r.w!} />}
      {r.input && <input value={r.value} onChange={(e) => r.onChange!(e.target.value)} style={{ ...CTL, width: "48%", boxSizing: "border-box", height: 30, fontSize: 12, padding: "0 10px" }} />}
      {r.unit && (
        <div style={{ width: "48%", display: "grid", gridTemplateColumns: "1fr 60px", gap: 6 }}>
          <input value={r.value} onChange={(e) => r.onChange!(e.target.value)} style={{ ...CTL, minWidth: 0, boxSizing: "border-box", height: 30, fontSize: 12, padding: "0 10px" }} />
          <Select value={r.unitValue!} options={["%", "$"]} onChange={r.onUnit!} h={30} fs={12} w="100%" />
        </div>
      )}
      {r.chips && (
        <div style={{ width: "48%", height: 30, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "flex", alignItems: "center", gap: 4, padding: "0 4px", overflow: "hidden" }}>
          {r.chipList!.map((h2) => (
            <span key={h2.l} style={{ height: 22, padding: "0 5px", borderRadius: 3, border: "1px solid var(--e-border-2)", background: "#16242a", display: "flex", alignItems: "center", gap: 3, fontSize: 11.5, whiteSpace: "nowrap" }}>
              {h2.l}<span className="e-icon" onClick={h2.rm} style={{ fontSize: 13, cursor: "pointer" }}>close</span>
            </span>
          ))}
        </div>
      )}
      {r.colors && (
        <div style={{ display: "flex", gap: 6 }}>
          {r.colorList!.map((k, i) => <span key={i} onClick={k.on} style={{ width: 14, height: 14, borderRadius: "50%", background: k.c, cursor: "pointer", boxShadow: k.ring }} />)}
        </div>
      )}
      {r.toggle && <Toggle track={r.track!} knob={r.knob!} onClick={r.onToggle!} />}
      {r.status && (
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--e-up-2)", width: 98 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--e-up-2)" }} />Enabled
        </span>
      )}
      {r.link && <span className="e-icon" onClick={r.onClick} style={{ fontSize: 20, cursor: "pointer" }}>chevron_right</span>}
      {r.btn && (
        <div className="e-btn" onClick={r.onClick} style={{ width: r.w, height: 26, boxSizing: "border-box", borderRadius: 4, border: `1px solid ${r.btnBd}`, background: r.btnBg, color: r.btnFg, display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer" }}>{r.btn}</div>
      )}
    </>
  );
}

/** one card, rendered at the size the tab panel asks for */
function SettingsCard({ c, big, previewBars }: { c: Card; big: boolean; previewBars?: { x: number; y: number; h: number; c: string }[] }) {
  return (
    <div style={{ ...CARD, padding: big ? "14px 16px 16px" : "12px 14px 10px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: big ? 30 : 28, marginBottom: big ? 8 : 6 }}>
        <span className="e-icon" style={{ fontSize: big ? 24 : 22 }}>{c.icon}</span>
        <span style={{ fontSize: big ? 16 : 14.5 }}>{c.title}</span>
      </div>
      {c.rows.map((r, i) => (
        <div key={i} style={{ minHeight: big ? 40 : 34, display: "flex", alignItems: "center", gap: big ? 10 : 8, borderTop: `1px solid ${r.line}` }}>
          <span style={{ flex: 1, fontSize: big ? 13 : 12, color: r.labelC }}>{r.label}</span>
          <Controls r={r} h={big ? 30 : 26} fs={big ? 12 : 11.5} />
        </div>
      ))}
      {c.preview && previewBars && (
        <div style={{ height: 56, marginTop: 8, borderRadius: 4, border: "1px solid var(--e-border)", background: "#0a1417", display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, padding: "4px 6px" }}>
          <svg viewBox="0 0 90 48" style={{ width: 90, height: 48 }}>
            {previewBars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={2.4} height={b.h} fill={b.c} />)}
          </svg>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
            <span style={{ fontSize: 12, letterSpacing: ".12em" }}>ELION</span>
            <div onClick={c.onFooter} style={{ height: 24, borderRadius: 3, border: "1px solid var(--e-gold)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11.5, color: "var(--e-ivory)", cursor: "pointer" }}>
              <span className="e-icon" style={{ fontSize: 15 }}>visibility</span>Preview Theme
            </div>
          </div>
        </div>
      )}
      {c.footer && (
        <div className="e-gold-btn" onClick={c.onFooter} style={{ height: 34, marginTop: 10, borderRadius: 4, border: "1px solid var(--e-gold)", background: "#16170f", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--e-ivory)", cursor: "pointer" }}>
          <span className="e-icon" style={{ fontSize: 17 }}>{c.footerIcon}</span>{c.footer}
        </div>
      )}
    </div>
  );
}

const TF_SEC: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
const SEC_TF: Record<number, string> = Object.fromEntries(Object.entries(TF_SEC).map(([k, v]) => [v, k]));

const TEMPLATE_KEY = "rt.indicatorTemplate";
const BOOL_KEYS = ["confirmExit", "sounds", "hedge", "rrBox", "autoSize", "checklistReq", "showGrid", "anim", "nExec", "nClose", "nSess", "nNews", "autoBackup"] as const;
type BoolKey = (typeof BOOL_KEYS)[number];

export default function ElionSettingsPage() {
  const app = useApp();
  const j = useJournal();
  const { active, activeId, trades, refreshTrades, refreshAccounts } = j;
  const [cap, setCap] = useMaxPerDay();
  const [st, patch] = useSettings();
  const [tg, setTg] = useState<TgNotify | null>(null);
  useEffect(() => { journalApi.notifySettings().then(setTg).catch(() => setTg(null)); }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState("General");
  const [toast, setToast] = useState("");
  const [toastOk, setToastOk] = useState(true);
  const tt = useRef(0);

  useEffect(() => () => window.clearTimeout(tt.current), []);

  const flash = (msg: string, ok = true) => {
    window.clearTimeout(tt.current);
    setToast(msg); setToastOk(ok);
    tt.current = window.setTimeout(() => setToast(""), 3200);
  };

  const resetAll = () => {
    resetSettings();
    setDefaultTf(60); setDefaultReplaySpeed(5); setCap(3);
    app.setTfSec(60); app.replay.setSpeed(5);
    flash("All settings restored to their defaults.");
  };

  const exportTrades = () => {
    if (!active || trades.length === 0) return flash("No trades to export for this account.", false);
    const header = ["ticket", "symbol", "direction", "volume", "open_time", "open_price", "close_time", "close_price", "sl", "tp", "profit", "commission", "swap"];
    const rows = trades.map((tr) => [tr.ticket, tr.symbol, tr.direction, tr.volume, tr.open_time, tr.open_price, tr.close_time ?? "", tr.close_price ?? "", tr.sl ?? "", tr.tp ?? "", tr.profit, tr.commission, tr.swap].join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${active.name.replace(/\s+/g, "_")}-trades.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flash(`${trades.length} trades exported (CSV).`);
  };

  const importFile = async (file: File) => {
    if (activeId == null) return flash("Pick an account first.", false);
    setImporting(true);
    try {
      const r = await journalApi.importFile(activeId, file);
      await Promise.all([refreshTrades(), refreshAccounts()]);
      flash(`${r.parsed} trades in file (${r.inserted} new, ${r.updated} already there).`);
    } catch (e) {
      flash((e as Error).message, false);
    }
    setImporting(false);
  };

  const clearLocalData = () => {
    if (!window.confirm(t("Clear all local app data (drawings, indicators, preferences)? This can't be undone."))) return;
    try {
      localStorage.clear();
    } catch { /* ignore */ }
    flash("Local data cleared. Reloading…", false);
    window.setTimeout(() => window.location.reload(), 900);
  };

  const backupNow = async () => {
    try {
      const r = await journalApi.backup(false);
      flash(`Backup saved: backend/backups/${r.file} (${Math.round(r.size / 1024)} KB).`);
    } catch (e) {
      flash((e as Error).message, false);
    }
  };

  const saveTemplate = () => {
    try {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(app.indicators));
      flash(`Saved ${app.indicators.length} indicator(s) as your template.`);
    } catch {
      flash("Couldn't save the template (browser storage unavailable).", false);
    }
  };
  const applyTemplate = () => {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY);
      if (!raw) return flash("No saved template yet — set up indicators on the Trade chart, then Save.", false);
      const list = JSON.parse(raw);
      app.setIndicators(list);
      flash(`Applied your template (${list.length} indicator(s)).`);
    } catch {
      flash("The saved template couldn't be read.", false);
    }
  };

  const toggleNotify = async () => {
    if (st.notify) return patch({ notify: false });
    if (!notifySupported()) return flash("This browser has no notification support.", false);
    if (!(await ensureNotifyPermission())) return flash("The browser blocked notifications — allow them for this site (lock icon in the address bar), then try again.", false);
    patch({ notify: true });
    flash("Browser notifications are on.");
  };

  const testNotification = async () => {
    beep(true);
    if (await ensureNotifyPermission()) {
      notifyUser("ELION", "Notifications are working.");
      if (!st.notify) new Notification("ELION", { body: "Notifications are working (turn on Browser Notifications to receive real alerts)." });
      flash("Test notification sent.");
    } else {
      flash(notifySupported() ? "Notifications are blocked for this site — you only hear the sound." : "This browser has no notification support.", false);
    }
  };

  const acc = ACCENTS[st.accent] ?? ACCENTS[0];

  const base = (o: Row): Row => ({ line: o.sep ? "var(--e-line)" : "transparent", gap: o.sep ? "8px" : "0px", w: "48%", labelC: "var(--e-text)", ...o, ...(o.sep ? { line: "var(--e-line)" } : {}) });
  const S = (label: string, k: keyof ElionSettings, options: string[], extra: Row = {}) =>
    base({ label, select: true, value: String(st[k]), options, onChange: (val) => patch({ [k]: val } as Partial<ElionSettings>), ...extra });
  const SV = (label: string, value: string, options: string[], onChange: (v: string) => void, extra: Row = {}) =>
    base({ label, select: true, value, options, onChange, ...extra });
  const I = (label: string, k: keyof ElionSettings, extra: Row = {}) =>
    base({ label, input: true, value: String(st[k]), onChange: (val) => patch({ [k]: val } as Partial<ElionSettings>), ...extra });
  const T = (label: string, k: BoolKey, extra: Row = {}) => {
    const on = st[k];
    return base({ label, toggle: true, track: on ? acc : "#3a474b", knob: on ? "14px" : "2px", onToggle: () => patch({ [k]: !on } as Partial<ElionSettings>), ...extra });
  };
  const B = (label: string, btn: string, fn: () => void, extra: Row = {}) => base({ label, btn, onClick: fn, w: "98px", btnBd: "var(--e-border-2)", btnBg: "var(--e-panel-2)", btnFg: "var(--e-text)", ...extra });
  const note = (label: string, extra: Row = {}) => base({ label, labelC: "var(--e-text-2)", ...extra });

  const tfLabel = SEC_TF[app.tfSec] ?? "M1";
  const templateCount = (() => { try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "[]").length as number; } catch { return 0; } })();

  const gen: Card = {
    icon: "shield", title: "General Settings", rows: [
      SV("Language", st.lang === "fa" ? "فارسی" : "English", ["English", "فارسی"], (val) => setLang(val === "فارسی" ? "fa" : "en"), { icon: "language" }),
      S("Timezone (header clock)", "tz", Object.keys(TZ_OPTIONS), { icon: "schedule" }),
      S("Date Format (header clock)", "df", ["DD Mon YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"], { icon: "calendar_month" }),
      S("Time Format (header clock)", "tf", ["24-hour", "12-hour"], { icon: "event" }),
      S("Font Size", "font", ["Small", "Medium", "Large"], { icon: "text_fields" }),
      S("Default Landing Page", "landing", Object.keys(LANDING_ROUTES), { sep: true }),
      T("Confirm Before Exit", "confirmExit"),
      T("Play Sounds", "sounds", { onToggle: () => { const next = !st.sounds; patch({ sounds: next }); if (next) window.setTimeout(() => beep(true), 50); } }),
    ],
  };

  const capOptions = [...new Set(["1", "2", "3", "5", "10", String(cap)])].sort((a, b) => Number(a) - Number(b));

  const topCards: Card[] = [
    { icon: "leaderboard", title: "Trading Settings", rows: [
      I("Default Lot Size", "lot"),
      I("Default Stop Loss (points, 0 = none)", "slPts"),
      I("Default Take Profit (points, 0 = none)", "tpPts"),
      base({ label: "Default Risk Per Trade", unit: true, value: String(st.risk), unitValue: st.riskU, onChange: (val) => patch({ risk: val }), onUnit: (val) => patch({ riskU: val as "%" | "$" }) }),
      S("Max Open Positions", "maxPos", ["Unlimited", "1", "2", "3", "5"]),
      SV("Daily Trade Cap (risk gauge)", String(cap), capOptions, (val) => { const n = Number(val); if (Number.isFinite(n) && n >= 1) setCap(n); }),
      T("Allow Hedging", "hedge"), T("Require Checklist Before Orders", "checklistReq"), T("Show Risk:Reward Box", "rrBox"), T("Suggest Lot Size From Risk", "autoSize"),
      note("Lot/risk/SL/TP defaults load into the Trade panel; positions and hedging are checked before an order is sent. Points are 0.01 on XAUUSD.", { sep: true }),
    ] },
    { icon: "query_stats", title: "Chart Settings", rows: [
      SV("Default Timeframe", tfLabel, TF, (val) => { const sec = TF_SEC[val]; if (sec) { app.setTfSec(sec); setDefaultTf(sec); } }),
      T("Show Grid", "showGrid"),
      B("Indicator Template", "Save", saveTemplate, { sep: true, w: "74px" }),
      B(`Saved template (${templateCount})`, "Apply", applyTemplate, { w: "74px" }),
      note("Drawings and indicators already auto-save as you work.", { sep: true }),
    ] },
    { icon: "schedule", title: "Backtest Settings", rows: [
      SV("Replay Speed (default)", `${app.replay.speed}x`, SPEEDS_OPT, (val) => { const n = Number(val.replace("x", "")); if (SPEEDS_LIST.includes(n)) { app.replay.setSpeed(n); setDefaultReplaySpeed(n); } }),
      note("The Backtest page is still a layout preview — its symbol, data source and commission options aren't connected to a data engine yet.", { sep: true }),
    ] },
  ];

  const tgRow = (label: string, k: keyof Omit<TgNotify, "configured">, extra: Row = {}) => {
    const on = !!tg?.[k];
    return base({ label, toggle: true, track: on ? acc : "#3a474b", knob: on ? "14px" : "2px",
      onToggle: () => journalApi.saveNotify({ [k]: !on }).then(setTg).catch((e) => flash((e as Error).message, false)), ...extra });
  };
  const testTelegram = () => journalApi.testNotify().then(() => flash("Test message sent to Telegram.")).catch((e) => flash((e as Error).message, false));

  const bottomCards: Card[] = [
    { icon: "notifications", title: "Notification Settings", rows: [
      base({ label: "Browser Notifications", toggle: true, track: st.notify ? acc : "#3a474b", knob: st.notify ? "14px" : "2px", onToggle: toggleNotify }),
      T("Trade Opened", "nExec"), T("Trade Closed (TP / SL hit)", "nClose"), T("Session Start (London / NY / Tokyo)", "nSess"),
      T("High-Impact USD News (15 min ahead)", "nNews"),
      note("Browser alerts fire while ELION is open in a tab.", { sep: true }),
      tgRow("Telegram Alerts (Elias OS bot)", "enabled", { sep: true }),
      tgRow("Telegram: Position Opened", "opens"), tgRow("Telegram: Closed (SL / TP hit, P&L)", "closes"), tgRow("Telegram: Order Changes & Failures", "orders"),
      B("Telegram Test Message", "Send", testTelegram, { w: "74px" }),
      note(tg == null ? "Loading…" : tg.configured ? "Telegram alerts come from the journal server — they arrive even with no browser open." : "Elias OS bot isn't paired yet — open the bot in Telegram and send /start.", { sep: true }),
    ], footer: "Test Notification", footerIcon: "notifications", onFooter: testNotification },
    { icon: "palette", title: "Appearance", rows: [
      S("Color Theme", "colorTheme", ["ELION Dark", "ELION Midnight"], { w: "126px" }),
      base({ label: "Accent Color", colors: true, colorList: ACCENTS.map((c, i) => ({ c, ring: i === st.accent ? "0 0 0 2px #0b1518, 0 0 0 3px #f3e6c8" : "none", on: () => patch({ accent: i }) })) }),
      T("Show Animations", "anim"),
    ] },
    { icon: "dns", title: "Data & Sync", rows: [
      T("Auto Backup (Daily)", "autoBackup", { onToggle: () => { const next = !st.autoBackup; patch({ autoBackup: next }); if (next) journalApi.backup(true).then((r) => flash(r.skipped ? "Today's backup already exists." : `Backup saved: ${r.file}`)).catch((e) => flash((e as Error).message, false)); } }),
      B("Back Up Journal Now", "Back up", backupNow, { w: "84px" }),
      B("Export Trade Data", "Export", exportTrades, { sep: true, w: "84px" }),
      B("Import Trade Data", importing ? "…" : "Import", () => fileRef.current?.click(), { w: "84px" }),
      note("Backups are copies of journal.db in backend/backups (newest 30 kept).", { sep: true }),
    ] },
    { icon: "verified_user", title: "Account & Security", rows: [
      note("This app runs locally for one user — no accounts, passwords or API keys."),
      note("Data lives in the local journal server and this browser's storage.", { sep: true }),
      base({ label: "Danger Zone", labelC: "#ef5a50", sep: true }),
      B("Clear All Local Data", "Clear", clearLocalData, { btnBd: "#8a2a26", btnBg: "#5a1a18", btnFg: "#fff" }),
      B("Reset All Settings", "Reset", resetAll, { btnBd: "#8a2a26", btnBg: "#5a1a18", btnFg: "#fff" }),
    ] },
  ];

  const TAB_CARD: Record<string, Card | undefined> = {
    Trading: topCards[0], Charts: topCards[1], Backtest: topCards[2],
    Notifications: bottomCards[0], Appearance: bottomCards[1],
    "Data & Sync": bottomCards[2], "Account & Security": bottomCards[3],
  };
  const TABS: [string, string][] = [["settings", "General"], ["track_changes", "Trading"], ["add_chart", "Charts"], ["history", "Backtest"], ["notifications", "Notifications"], ["palette", "Appearance"], ["sync", "Data & Sync"], ["lock", "Account & Security"], ["info", "About"]];

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Settings" />

      <main style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 30, height: 52 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".5em", color: "var(--e-gold)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 14 }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,436px)", height: 38, borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 14px", color: "var(--e-text-3)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>Search settings, symbols, or ask ELION...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl  K</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: j.live?.connected ? "var(--e-up-2)" : "var(--e-muted)", boxShadow: j.live?.connected ? "0 0 6px var(--e-up-2)" : "none" }} />{active ? active.name : "No account"}
            </div>
            <div style={{ color: "var(--e-text-3)", fontSize: 12, paddingLeft: 16 }}>{active ? `${active.platform.toUpperCase()}  |  ${active.broker ?? "—"}` : "Add one on Connection"}</div>
          </div>
          <div style={{ position: "relative" }} onClick={() => setTab("Notifications")}>
            <span className="e-icon" style={{ fontSize: 26, cursor: "pointer", color: st.notify ? "var(--e-gold)" : undefined }}>{st.notify ? "notifications_active" : "notifications"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 15 }}>EF</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Elias Farahani</div>
              <div style={{ fontSize: 11, color: "var(--e-text-2)" }}>Trader | Build the Edge</div>
            </div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#16242a", display: "grid", placeItems: "center" }}>
            <span className="e-icon fill" style={{ fontSize: 22, color: "var(--e-ivory)" }}>dark_mode</span>
          </div>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, paddingLeft: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, letterSpacing: ".18em", color: "var(--e-ivory)", lineHeight: 1 }}>SETTINGS</div>
            <div style={{ fontSize: 12.5, letterSpacing: ".24em" }}>CUSTOMIZE YOUR TRADING ENVIRONMENT.</div>
          </div>
          <div className="e-gold-btn" onClick={resetAll} style={{ height: 38, padding: "0 20px", borderRadius: 4, border: "1px solid var(--e-gold)", background: "#16170f", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--e-ivory)", cursor: "pointer" }}>
            <span className="e-icon" style={{ fontSize: 19 }}>sync</span>Reset to Default
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {TABS.map(([icon, label]) => {
            const a = label === tab;
            return (
              <div key={label} onClick={() => setTab(label)} style={{ height: 44, padding: "0 20px", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${a ? "rgba(233,215,176,.7)" : "var(--e-line)"}`, background: a ? "linear-gradient(180deg,#3a3220,#231f15)" : "var(--e-panel-2)", color: a ? "var(--e-ivory)" : "var(--e-text)" }}>
                <span className="e-icon" style={{ fontSize: 19 }}>{icon}</span>{label}
              </div>
            );
          })}
        </div>

        {/* one panel per tab, same pattern the Connection page uses */}
        {tab === "General" && (
          <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, maxWidth: 1180 }}>
            <SettingsCard c={gen} big />
            <div style={{ height: 186, boxSizing: "border-box", borderRadius: 6, border: "1px solid #243236", background: "linear-gradient(135deg,#1d1f19 0%,#0e1618 60%)", padding: "18px 22px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 48, lineHeight: 0.6, color: "var(--e-gold)", height: 22 }}>&ldquo;</span>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", fontSize: 25, lineHeight: 1.4, color: "var(--e-ivory)" }}>Small settings.<br />A big difference.</div>
              <div style={{ textAlign: "right", fontSize: 13, marginTop: -10 }}>— ELION</div>
            </div>
          </div>
        )}

        {TAB_CARD[tab] !== undefined && (
          <div className="e-fill e-fill-child" style={{ maxWidth: 840 }}><SettingsCard c={TAB_CARD[tab]!} big /></div>
        )}

        {tab === "About" && (
          <div className="e-fill" style={{ ...CARD, maxWidth: 840, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 30 }}>
              <span className="e-icon" style={{ fontSize: 24 }}>info</span><span style={{ fontSize: 16 }}>About</span>
            </div>
            {([
              ["App", "ELION Trading dashboard"],
              ["Version", APP_VERSION],
              ["Runs", "Locally on this PC — Vite dev server behind a private Cloudflare tunnel"],
              ["Journal server", "127.0.0.1:8000"],
              ["Price bridge", "127.0.0.1:8765 (MT5)"],
              ["Accounts", "Managed on the Connection page"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, borderTop: "1px solid var(--e-line-2)", paddingTop: 8 }}>
                <span className="e-icon" style={{ fontSize: 15, color: "var(--e-text-2)" }}>radio_button_checked</span>
                <span style={{ flex: 1 }}>{k}</span>
                <span style={{ color: "var(--e-text-2)" }}>{v}</span>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: "var(--e-muted)" }}>
              The older Persian pages are still reachable at #/overview, #/chart-classic, #/journal-classic, #/analysis-classic, #/backtest-classic, #/rules-classic, #/account-classic and #/settings-classic.
            </div>
          </div>
        )}

        <div style={{ height: 50, borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel-4)", display: "flex", alignItems: "center", gap: 14, padding: "0 16px" }}>
          <span className="e-icon" style={{ fontSize: 24, color: "var(--e-gold)" }}>info</span>
          <span style={{ flex: 1, fontSize: 14 }}>Settings keep you consistent. Consistency builds results.</span>
        </div>
      </main>

      <input ref={fileRef} type="file" accept=".htm,.html,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />

      {toast && (
        <div style={{ position: "fixed", right: 24, bottom: 80, padding: "10px 14px", borderRadius: 6, background: toastOk ? "#0f2a26" : "#2a1414", border: `1px solid ${toastOk ? "#2c7a5f" : "#8a2a26"}`, fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, zIndex: 10 }}>
          <span className="e-icon" style={{ fontSize: 18 }}>{toastOk ? "check_circle" : "warning"}</span>{toast}
        </div>
      )}
    </div>
  );
}

