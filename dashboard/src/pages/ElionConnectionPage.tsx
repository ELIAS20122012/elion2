import { useEffect, useRef, useState } from "react";
import { AccountDialog, KIND_LABEL } from "../components/AccountBar";
import { t } from "../lib/i18n";
import { ElionSidebar } from "../components/ElionChrome";
import { journalApi, type Account, type BridgeInfo, type EngineStatus, type Platform as AcctPlatform } from "../lib/journalApi";
import { useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";

/**
 * Ported from design/elion/connection.dc.html (reference design). Voice Connect drives the browser's
 * real SpeechRecognition API, exactly as the reference does. The "Accounts" tab was rewired end to end
 * to the real journal (useJournal/useAllAccounts) instead of four fixed platform cards with fake
 * connect/disconnect toggles: MT5 and MT4 now really add accounts through the same API and dialog the
 * Persian journal page uses, newly auto-detected MT4 terminals get a real one-click add (same as the
 * Persian DetectedBanner), the overview table lists real accounts with real live status, and "Refresh
 * All" really refetches. Connect/Disconnect is real too: it flips a real `enabled` column (added this
 * pass) that the backend's MT5/MT4 auto-sync loops and /live endpoint now actually honor — disabling an
 * account immediately reports "not connected" and stops pulling in new trades, without deleting
 * anything; re-enabling resumes it (and kicks an immediate MT5 resync instead of waiting ~10s). Removing
 * an account is a separate, clearly-destructive action since the real API only offers full delete there
 * (which also deletes its trades) — that one still says so plainly. Two things the reference implied
 * that this app has no equivalent for — a direct broker/exchange API connection and cloud backup — are
 * labeled as not available rather than wired to a toggle that would not do anything.
 */

const DASH = "—";
const CTL: React.CSSProperties = { borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", color: "var(--e-text)", outline: "none" };
const CARD: React.CSSProperties = { borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const TEAL = "var(--e-up-2)";
const OVERVIEW_COLS = "1.25fr 1fr .8fr 1.35fr 1.1fr 1.2fr 132px";
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Row = { k: string; v: string; c: string; account?: Account };
type PlatformCard = {
  name: string; tile: string; tileBg: string; tileFg: string; tileSize: string; desc: string;
  cols: string; rows: Row[]; btn?: string; btnIcon?: string; onBtn?: () => void;
  status: string; stC: string; stDot: string; cardBd: string; cardBg: string;
  engineKey?: "mt5" | "mt4";
};

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };

function Dropdown({ value, options, onChange, padLeft = 12 }: { value: string; options: string[]; onChange: (v: string) => void; padLeft?: number }) {
  return (
    <div style={{ position: "relative" }}>
      {padLeft > 12 && <span className="e-icon" style={{ position: "absolute", left: 10, top: 7, fontSize: 17, pointerEvents: "none" }}>mic</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...CTL, appearance: "none", WebkitAppearance: "none", width: "100%", height: 34, fontSize: 12.5, padding: `0 26px 0 ${padLeft}px`, cursor: "pointer" }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="e-icon" style={{ position: "absolute", right: 8, top: 8, fontSize: 18, pointerEvents: "none" }}>expand_more</span>
    </div>
  );
}

export default function ElionConnectionPage() {
  const app = useApp();
  const j = useJournal();
  const rows = useAllAccounts(j.accounts, j.status === "ok", 8000);

  const [tab, setTab] = useState("Accounts");
  const [dialog, setDialog] = useState<{ mode: "new"; platform?: AcctPlatform } | { mode: "edit"; account: Account } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [voice, setVoice] = useState<"ready" | "listening">("ready");
  const [transcript, setTranscript] = useState("");
  const [feats, setFeats] = useState([1, 1, 1, 1, 1]);
  const [mic, setMic] = useState("Default (System)");
  const [vlang, setVlang] = useState("English");
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [addingDetected, setAddingDetected] = useState<string | null>(null);
  const [bridgeInfo, setBridgeInfo] = useState<BridgeInfo | null>(null);
  const [pathCopied, setPathCopied] = useState(false);

  useEffect(() => {
    if (j.status === "ok") journalApi.bridgeInfo().then(setBridgeInfo).catch(() => {});
  }, [j.status]);

  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineBusy, setEngineBusy] = useState<"mt5" | "mt4" | null>(null);
  useEffect(() => {
    if (j.status !== "ok") return;
    let dead = false;
    const tick = () => journalApi.engine().then((e) => !dead && setEngine(e)).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3000);
    return () => { dead = true; window.clearInterval(id); };
  }, [j.status]);
  const toggleEngine = async (p: "mt5" | "mt4") => {
    if (!engine || engineBusy) return;
    const label = p === "mt5" ? "MetaTrader 5" : "MetaTrader 4";
    const turningOff = engine[p].on;
    if (turningOff && !window.confirm(t(`Switch ${label} off?\n\nThe app stops using it and its terminal window(s) are closed. Positions stay open at your broker.`))) return;
    setEngineBusy(p);
    try {
      const next = turningOff ? await journalApi.engineStop(p) : await journalApi.engineStart(p);
      setEngine(next);
      const refresh = () => journalApi.engine().then(setEngine).catch(() => {}); // terminals take a moment to appear/disappear
      window.setTimeout(refresh, 4000); window.setTimeout(refresh, 10000);
      flash(turningOff ? `${label} switched off.` : `${label} switched on — its terminal is opening.`);
    } catch (e) {
      flash((e as Error).message);
    }
    setEngineBusy(null);
  };

  const copyIndicatorPath = async () => {
    if (!bridgeInfo) return;
    try {
      await navigator.clipboard.writeText(bridgeInfo.indicator_path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1500);
    } catch { /* clipboard blocked: path is still shown to select/copy by hand */ }
  };

  const tt = useRef(0), rec = useRef<SR | null>(null);

  useEffect(() => () => {
    window.clearTimeout(tt.current);
    try { rec.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const flash = (m: string) => {
    window.clearTimeout(tt.current);
    setToast(m);
    tt.current = window.setTimeout(() => setToast(""), 2600);
  };

  const toggleVoice = () => {
    if (voice === "listening") {
      try { rec.current?.stop(); } catch { /* already stopped */ }
      rec.current = null; setVoice("ready");
      return;
    }
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    setVoice("listening"); setTranscript("");
    if (!Ctor) { setTranscript("Voice recognition is not supported in this browser."); return; }
    try {
      const r = new Ctor();
      rec.current = r;
      r.lang = ({ English: "en-US", "فارسی": "fa-IR", Deutsch: "de-DE" } as Record<string, string>)[vlang];
      r.interimResults = true;
      r.continuous = true;
      r.onresult = (e: any) => {
        let t = "";
        for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
        setTranscript(t);
      };
      r.onerror = (e: any) => {
        setVoice("ready");
        setTranscript(e.error === "not-allowed" ? "Microphone permission denied." : "Voice error: " + e.error);
      };
      r.onend = () => { if (rec.current === r) setVoice("ready"); };
      r.start();
    } catch {
      setVoice("ready"); setTranscript("Microphone is not available here.");
    }
  };

  const listening = voice === "listening";

  const removeAccount = async (a: Account) => {
    if (!window.confirm(t(`Remove "${a.name}"? This deletes it and ALL of its trades/notes from the journal permanently — use Disconnect instead if you just want to pause it.`))) return;
    try {
      await journalApi.deleteAccount(a.id);
      await j.refreshAccounts();
      flash(`${a.name} removed.`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const [toggling, setToggling] = useState<number | null>(null);
  const toggleConnect = async (a: Account) => {
    setToggling(a.id);
    try {
      await journalApi.updateAccount(a.id, { enabled: !a.enabled });
      await j.refreshAccounts();
      flash(`${a.name} ${a.enabled ? "disconnected" : "connected"}.`);
    } catch (e) {
      flash((e as Error).message);
    }
    setToggling(null);
  };

  const addDetected = async (login: string, company: string, server: string, isLive: boolean) => {
    setAddingDetected(login);
    try {
      const a = await journalApi.createAccount({ name: `MT4 ${login}`, platform: "mt4", kind: "manual", login, broker: company, is_live: isLive, initial_balance: null });
      await j.refreshAccounts();
      j.setActive(a.id);
      flash(`MT4 ${login} connected.`);
    } catch (e) {
      flash((e as Error).message);
    }
    setAddingDetected(null);
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([j.refreshAccounts(), j.refreshTrades()]);
      flash("All accounts refreshed.");
    } finally {
      setRefreshing(false);
    }
  };

  const importFile = async (file: File) => {
    if (j.activeId == null) return flash("Pick or add an account first.");
    setImporting(true);
    try {
      const r = await journalApi.importFile(j.activeId, file);
      await j.refreshTrades();
      flash(`${r.parsed} trades in file (${r.inserted} new, ${r.updated} already there).`);
    } catch (e) {
      flash((e as Error).message);
    }
    setImporting(false);
  };

  const platformCard = (platform: AcctPlatform, name: string, tile: string, tileBg: string, desc: string): PlatformCard => {
    const list = rows.filter((r) => r.account.platform === platform);
    const nOn = list.filter((r) => r.live?.connected).length;
    const anyOn = nOn > 0;
    return {
      name, tile, tileBg, tileFg: "#fff", tileSize: platform === "other" ? "22px" : "26px",
      desc, cols: "1fr 1.2fr",
      engineKey: platform === "mt5" || platform === "mt4" ? platform : undefined,
      status: list.length === 0 ? "Not Connected" : `${nOn} / ${list.length} Connected`,
      stC: anyOn ? TEAL : "var(--e-text-3)", stDot: anyOn ? "#3ccfb2" : "#8e9896",
      cardBd: anyOn ? "#1f6b5c" : "var(--e-line)",
      cardBg: anyOn ? "linear-gradient(180deg,#0f2226,#0b1719)" : "linear-gradient(180deg,#0f1b1f,#0b1518)",
      rows: list.length === 0
        ? [{ k: "none", v: engine && (platform === "mt5" || platform === "mt4") && engine[platform].on ? `Switch is on, but no ${platform.toUpperCase()} account is added yet — press “Connect” below and enter your login.` : "No accounts added yet", c: "var(--e-muted)" }]
        : list.slice(0, 4).map((r) => ({
          k: String(r.account.id),
          account: r.account,
          v: !r.account.enabled
            ? `${r.account.login ?? r.account.name} · disconnected`
            : r.live?.connected
              ? `${r.account.login ?? r.account.name} · ${r.live.balance != null ? usd(r.live.balance) : DASH}`
              : `${r.account.login ?? r.account.name} · not connected yet`,
          c: r.live?.connected ? "var(--e-text)" : "var(--e-muted)",
        })),
      btn: `Connect ${name}`, btnIcon: "add",
      onBtn: () => setDialog({ mode: "new", platform }),
    };
  };

  const platforms: PlatformCard[] = [
    platformCard("mt5", "MetaTrader 5", "5", "radial-gradient(circle at 35% 30%,#f7d774,#3f9a52 55%,#1f5aa8)", "MT5 accounts auto-sync every few seconds once added — no manual connect step after that."),
    platformCard("mt4", "MetaTrader 4", "4", "radial-gradient(circle at 35% 30%,#f7d774,#3f9a52 55%,#1f5aa8)", "Put the JournalBridge indicator on a chart in MT4; detected accounts show up below to add with one click."),
    platformCard("other", "Manual / File Import", "↑", "#157a52", "Add an account by hand, or import an MT4/MT5 statement file into the selected account."),
    {
      name: "Direct Broker / Exchange API", tile: "⛓", tileBg: "#2a3a3f", tileFg: "#fff", tileSize: "22px",
      desc: "Not available — this app only reads MT4/MT5 (local terminal or indicator) or imported files. No direct broker/exchange API connections.",
      cols: "1fr 1.2fr", status: "Not Available", stC: "var(--e-text-3)", stDot: "#8e9896",
      cardBd: "var(--e-line)", cardBg: "linear-gradient(180deg,#0f1b1f,#0b1518)",
      rows: [{ k: "n", v: "Nothing to configure here.", c: "var(--e-muted)" }],
    },
  ];

  const overview = rows.map((r) => {
    const a = r.account, live = r.live, connected = !!live?.connected;
    return {
      key: a.id,
      acct: a,
      tile: a.platform === "mt5" ? "5" : a.platform === "mt4" ? "4" : "·",
      tileBg: a.platform === "mt5" || a.platform === "mt4" ? "#3f9a52" : "#2a3a3f",
      tileFg: "#fff",
      name: a.name,
      account: a.login ?? DASH,
      type: `${KIND_LABEL[a.kind]}${a.is_live ? " · Live" : " · Demo"}`,
      status: !a.enabled ? "Disconnected" : connected ? "Connected" : live?.engine_off ? "Engine off" : "Not Connected",
      stC: !a.enabled ? "var(--e-down-3)" : connected ? TEAL : "var(--e-text-3)",
      stDot: !a.enabled ? "#e0463f" : connected ? "#3ccfb2" : "#8e9896",
      balance: live?.balance != null ? usd(live.balance) : DASH,
      sync: live?.last_seen_ago != null ? `${Math.round(live.last_seen_ago)}s ago` : DASH,
      op: 1,
      onEdit: () => setDialog({ mode: "edit", account: a }),
      onRemove: () => removeAccount(a),
    };
  });

  const VOICE_FEATS = ["Open charts and timeframes", "Analyze setups and ask questions", "Record trade notes by voice", "Execute commands (e.g. add screenshot)", "Works on desktop and mobile"];
  const TABS: [string, string][] = [["switch_account", "Accounts"], ["mic", "Voice Connect"], ["dns", "Data & Sync"]];
  const connectedCount = rows.filter((r) => r.live?.connected).length;
  const STATUS_TILES: [string, string, string, string, string, string][] = [
    ["link", "#3ccfb2", "#1f5a4c", "#0e2a26", "Accounts", `${connectedCount} of ${j.accounts.length} Connected`],
    ["database", "#6aa9f5", "#1f4270", "#0e1d33", "Journal Server", j.status === "ok" ? "Connected" : j.status === "loading" ? "Connecting…" : "Offline"],
    ["conversion_path", "#c08af0", "#3e2a5c", "#1d1530", "Chart Feed", app.live.status === "live" ? "Live" : app.live.status === "connecting" ? "Connecting…" : "Disconnected"],
    ["shield", "#e9c77a", "#5c4a1f", "#2a2412", "Security", "Read-only — no orders placed"],
  ];

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Connection" />

      <main style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 30, height: 52 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".5em", color: "var(--e-gold)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 14 }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,418px)", height: 38, borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 14px", color: "var(--e-text-3)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>Search symbols, settings, or ask ELION...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl  K</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: app.live.status === "live" ? "#3ccfb2" : "#8e9896", boxShadow: app.live.status === "live" ? "0 0 6px #3ccfb2" : "none" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span>{j.active ? j.active.name : "No account"}</span><span style={{ color: "var(--e-text-3)", fontSize: 12 }}>{j.active ? `${j.active.platform.toUpperCase()}${j.active.broker ? " | " + j.active.broker : ""}` : "Add one below"}</span>
            </div>
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, paddingLeft: 2 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, letterSpacing: ".18em", color: "var(--e-ivory)", lineHeight: 1 }}>CONNECTION</div>
            <div style={{ fontSize: 12.5, letterSpacing: ".24em" }}>CONNECT YOUR ACCOUNTS. SYNC DATA. ENABLE VOICE.</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {TABS.map(([icon, label]) => {
            const a = label === tab;
            return (
              <div key={label} onClick={() => setTab(label)} style={{ height: 44, padding: "0 24px", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${a ? "rgba(233,215,176,.7)" : "var(--e-line)"}`, background: a ? "linear-gradient(180deg,#3a3220,#231f15)" : "var(--e-panel-2)", color: a ? "var(--e-ivory)" : "var(--e-text)" }}>
                <span className="e-icon" style={{ fontSize: 19 }}>{icon}</span>{label}
              </div>
            );
          })}
        </div>

        {j.detected.length > 0 && (
          <div style={{ ...CARD, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, borderColor: "#3a5f2e" }}>
            <div style={{ fontSize: 13.5, color: TEAL }}>MT4 terminal{j.detected.length > 1 ? "s" : ""} detected — not in the journal yet</div>
            {j.detected.map((d) => (
              <div key={d.login} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>#{d.login} · {d.company} · {d.server} · {d.balance?.toFixed(2)} {d.currency}</span>
                <div onClick={() => addDetected(d.login, d.company, d.server, !/demo/i.test(d.server))} style={{ height: 30, padding: "0 14px", borderRadius: 4, border: "1px solid var(--e-gold)", background: "#16170f", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--e-ivory)", cursor: addingDetected === d.login ? "default" : "pointer", opacity: addingDetected === d.login ? 0.6 : 1 }}>
                  <span className="e-icon" style={{ fontSize: 16 }}>add</span>{addingDetected === d.login ? "Adding…" : "Connect"}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "Accounts" && (
          <>
            {/* ---- platform cards ---- */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 16, minHeight: 290 }}>
              {platforms.map((p) => (
                <div key={p.name} style={{ borderRadius: 6, border: `1px solid ${p.cardBd}`, background: p.cardBg, padding: "16px 16px 14px", display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ width: 58, height: 58, flexShrink: 0, borderRadius: 10, background: p.tileBg, display: "grid", placeItems: "center", fontSize: p.tileSize, fontWeight: 800, color: p.tileFg }}>{p.tile}</div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 15, whiteSpace: "nowrap" }}>{p.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap", color: p.stC }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.stDot }} />{p.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--e-text)" }}>{p.desc}</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, padding: "10px 12px 8px 2px" }}>
                    {p.rows.map((r) => (
                      <div key={r.k} style={{ display: "grid", gridTemplateColumns: r.account ? p.cols : "1fr", fontSize: 12.5, alignItems: "center", gap: 8 }}>
                        <span style={{ color: r.c, lineHeight: 1.45 }}>{r.v}</span>
                        {r.account && (
                          <div
                            onClick={() => toggleConnect(r.account!)}
                            style={{ justifySelf: "end", height: 22, padding: "0 10px", borderRadius: 11, border: `1px solid ${r.account.enabled ? "#6e2a26" : "var(--e-gold)"}`, color: r.account.enabled ? "#e0928c" : "var(--e-ivory)", fontSize: 10.5, display: "flex", alignItems: "center", cursor: toggling === r.account.id ? "default" : "pointer", opacity: toggling === r.account.id ? 0.5 : 1 }}
                          >
                            {toggling === r.account.id ? "…" : r.account.enabled ? "Disconnect" : "Connect"}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {p.btn && (
                    <div className="e-gold-btn" onClick={p.name === "Manual / File Import" ? () => setDialog({ mode: "new", platform: "other" }) : p.onBtn} style={{ height: 38, borderRadius: 4, border: "1px solid var(--e-gold)", background: "#16170f", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13.5, color: "var(--e-ivory)", cursor: "pointer" }}>
                      <span className="e-icon" style={{ fontSize: 18 }}>{p.btnIcon}</span>{p.btn}
                    </div>
                  )}
                  {p.name === "Manual / File Import" && (
                    <div onClick={() => (importing ? undefined : fileRef.current?.click())} style={{ height: 30, marginTop: 8, borderRadius: 4, border: "1px solid var(--e-border-2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "var(--e-text)", cursor: importing ? "default" : "pointer" }}>
                      <span className="e-icon" style={{ fontSize: 16 }}>upload</span>{importing ? "Importing…" : j.active ? `Import File into "${j.active.name}"` : "Add an account first"}
                    </div>
                  )}
                  {p.name === "MetaTrader 4" && bridgeInfo && (
                    <div style={{ marginTop: 8, padding: "6px 8px", borderRadius: 4, border: "1px solid var(--e-border-2)", background: "var(--e-panel-2)", display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        <span className="e-icon" style={{ fontSize: 14, color: bridgeInfo.indicator_exists ? TEAL : "var(--e-muted)" }}>{bridgeInfo.indicator_exists ? "check_circle" : "info"}</span>
                        <span style={{ flex: 1, color: "var(--e-text-2)" }}>{bridgeInfo.indicator_exists ? "Indicator installed" : "Not installed — copy to MQL4/Indicators:"}</span>
                        <span onClick={copyIndicatorPath} style={{ color: "var(--e-gold)", cursor: "pointer" }}>{pathCopied ? "Copied" : "Copy path"}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--e-muted)" }}>
                        {bridgeInfo.files.length > 0 ? `${bridgeInfo.files.length} account file(s) seen in Common\\Files` : "No MT4 terminal is reporting to Common\\Files yet"}
                      </div>
                    </div>
                  )}
                  {p.engineKey && (() => {
                    const k = p.engineKey!;
                    const st = engine?.[k];
                    const on = !!st?.on, busy = engineBusy === k;
                    const terms = st?.terminals ?? [];
                    return (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--e-line-2)", display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5 }}>{`${k === "mt5" ? "MetaTrader 5" : "MetaTrader 4"} switch`}</div>
                          <div style={{ fontSize: 11, color: on ? TEAL : "var(--e-muted)", marginTop: 3, lineHeight: 1.4 }}>
                            {engine == null ? "Checking…" : busy ? (on ? "Switching off…" : "Switching on…") : on
                              ? `On — ${terms.length ? "terminal open" : "terminal opening…"}${k === "mt5" ? ` · price bridge ${(st as { bridge?: boolean } | undefined)?.bridge ? "running" : "starting…"}` : ""}`
                              : `Off — ${terms.length ? "terminal open, app ignores it" : "nothing is opened or read"}`}
                          </div>
                        </div>
                        <div
                          onClick={() => toggleEngine(k)}
                          title={on ? "Switch off (closes the terminal window)" : "Switch on (opens the terminal)"}
                          style={{ width: 44, height: 24, borderRadius: 12, background: on ? "#3ccfb2" : "#3a474b", position: "relative", cursor: busy || engine == null ? "default" : "pointer", opacity: busy || engine == null ? 0.6 : 1, transition: "background .2s", flexShrink: 0 }}
                        >
                          <div style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* ---- overview + status ---- */}
            <div style={{ ...CARD, height: overview.length > 4 ? "auto" : 304, boxSizing: "border-box", padding: "12px 16px 12px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>Connected Accounts Overview</span>
                <div onClick={refreshAll} style={{ height: 30, padding: "0 12px", borderRadius: 4, border: "1px solid var(--e-border-2)", display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <span className={`e-icon${refreshing ? " e-spin" : ""}`} style={{ fontSize: 17 }}>sync</span>Refresh All
                </div>
              </div>
              {j.status !== "ok" && overview.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 6, borderRadius: 4, border: "1px solid #6e2a26", background: "#2a1414", fontSize: 11.5, color: "#f3b5ae" }} dir="auto">
                  <span className="e-icon" style={{ fontSize: 16 }}>warning</span>Journal server unreachable right now — rows below are frozen from the last successful update, not live.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: OVERVIEW_COLS, alignItems: "center", fontSize: 12.5, padding: "6px 2px", background: "var(--e-panel-2)", borderRadius: 3 }}>
                <span>Platform</span><span>Login</span><span>Type</span><span>Status</span><span>Balance</span><span>Last Sync</span><span>Actions</span>
              </div>
              {overview.length === 0 && <div style={{ padding: "24px 4px", fontSize: 12.5, color: "var(--e-muted)" }}>No accounts yet — connect MT5/MT4 above or add one manually.</div>}
              {overview.map((o) => (
                <div key={o.key} style={{ display: "grid", gridTemplateColumns: OVERVIEW_COLS, alignItems: "center", fontSize: 12.5, padding: "6px 2px", borderTop: "1px solid var(--e-line-2)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 5, background: o.tileBg, color: o.tileFg, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800 }}>{o.tile}</span>{o.name}
                  </span>
                  <span>{o.account}</span><span>{o.type}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, color: o.stC }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: o.stDot }} />{o.status}</span>
                  <span>{o.balance}</span><span>{o.sync}</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <span
                      className="e-icon"
                      onClick={() => toggleConnect(o.acct)}
                      title={o.acct.enabled ? "Disconnect" : "Connect"}
                      style={{ width: 30, height: 30, boxSizing: "border-box", borderRadius: 4, border: `1px solid ${o.acct.enabled ? "#6e2a26" : "var(--e-gold)"}`, color: o.acct.enabled ? "#e0928c" : "var(--e-ivory)", display: "grid", placeItems: "center", fontSize: 17, cursor: toggling === o.acct.id ? "default" : "pointer", opacity: toggling === o.acct.id ? 0.5 : 1 }}
                    >
                      {o.acct.enabled ? "link_off" : "link"}
                    </span>
                    <span className="e-icon" onClick={o.onEdit} title="Edit account" style={{ width: 30, height: 30, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 17, cursor: "pointer" }}>settings</span>
                    <span className="e-icon" onClick={o.onRemove} title="Remove account (deletes its trades) — permanent" style={{ width: 30, height: 30, boxSizing: "border-box", borderRadius: 4, border: "1px solid #6e2a26", color: "#e0928c", display: "grid", placeItems: "center", fontSize: 17, cursor: "pointer" }}>delete</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "470fr 404fr", gap: 16 }}>
              <div style={{ ...CARD, padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 16 }}>Data Storage</div>
                <div style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", gap: 12, alignItems: "center" }}>
                  <span className="e-icon" style={{ width: 52, height: 34, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "grid", placeItems: "center", fontSize: 20 }}>hard_drive</span>
                  <div><div style={{ fontSize: 12.5 }}>Local Journal Server</div><div style={{ fontSize: 11.5, color: "var(--e-text-3)", marginTop: 4 }}>Trades are stored locally by the journal server on this machine.</div></div>
                  <span style={{ alignSelf: "start", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: j.status === "ok" ? TEAL : "var(--e-down-3)" }}>
                    <span className="e-icon fill" style={{ fontSize: 15 }}>{j.status === "ok" ? "check_circle" : "error"}</span>{j.status === "ok" ? "Active" : "Offline"}
                  </span>
                </div>
                {j.status !== "ok" && j.statusError && (
                  <div style={{ fontSize: 11, color: "var(--e-down-3)", padding: "0 0 0 66px" }} dir="auto">{j.statusError}</div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", gap: 12, alignItems: "center" }}>
                  <span className="e-icon" style={{ width: 52, height: 34, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "grid", placeItems: "center", fontSize: 20 }}>cloud_sync</span>
                  <div><div style={{ fontSize: 12.5 }}>Cloud Backup</div><div style={{ fontSize: 11.5, color: "var(--e-text-3)", marginTop: 4 }}>Not available — this app has no cloud sync yet.</div></div>
                  <span style={{ alignSelf: "start", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--e-muted)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#8e9896" }} />Not Available
                  </span>
                </div>
              </div>

              <div style={{ ...CARD, padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 15 }}>Connection Status</div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 10 }}>
                  {STATUS_TILES.map(([icon, col, bd, bg, title, val]) => (
                    <div key={title} style={{ borderRadius: 4, border: `1px solid ${bd}`, background: bg, display: "flex", alignItems: "center", gap: 14, padding: "0 14px" }}>
                      <span className="e-icon" style={{ fontSize: 30, color: col }}>{icon}</span>
                      <div>
                        <div style={{ fontSize: 12.5 }}>{title}</div>
                        <div style={{ fontSize: 12, color: "var(--e-text-2)", marginTop: 4 }}>{val}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "Voice Connect" && (
          <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "515px minmax(0,1fr)", gap: 16 }}>
            <div style={{ ...CARD, minHeight: 324, boxSizing: "border-box", padding: "16px 16px 14px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17 }}>Voice Connect</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: listening ? "#6aa9f5" : TEAL }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: listening ? "#6aa9f5" : "#3ccfb2" }} />{listening ? "Listening…" : "Ready"}
                </span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>Uses this browser's real speech recognition (no server involved).</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 34, padding: "0 20px" }}>
                <div onClick={toggleVoice} className={listening ? "e-mic-live" : ""} style={{ width: 104, height: 104, flexShrink: 0, borderRadius: "50%", border: "2px solid #4aa8f0", background: "radial-gradient(circle,#0f2436 0%,#0a1620 70%)", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "0 0 30px rgba(90,180,255,.3)" }}>
                  <span className="e-icon" style={{ fontSize: 52, color: "#9fd4ff" }}>{listening ? "graphic_eq" : "mic"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {VOICE_FEATS.map((label, i) => {
                    const on = !!feats[i];
                    return (
                      <div key={label} onClick={() => setFeats((s) => s.map((v, k) => (k === i ? (v ? 0 : 1) : v)))} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, cursor: "pointer" }}>
                        <span style={{ width: 15, height: 15, borderRadius: 3, boxSizing: "border-box", border: `1.5px solid ${on ? "#3ccfb2" : "#56625f"}`, background: on ? "#3ccfb2" : "transparent", display: "grid", placeItems: "center" }}>
                          <span className="e-icon" style={{ fontSize: 13, color: "#081013", opacity: on ? 1 : 0 }}>check</span>
                        </span>{label}
                      </div>
                    );
                  })}
                </div>
              </div>
              {transcript && <div style={{ fontSize: 12, color: "#9fd4ff", margin: "-6px 0 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>&ldquo;{transcript}&rdquo;</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 34px", gap: 10, alignItems: "end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12.5 }}>Microphone</span>
                  <Dropdown value={mic} options={["Default (System)", "Headset", "USB Microphone"]} onChange={setMic} padLeft={34} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12.5 }}>Language</span>
                  <Dropdown value={vlang} options={["English", "فارسی", "Deutsch"]} onChange={setVlang} />
                </div>
                <span className="e-icon" style={{ width: 34, height: 34, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border)", display: "grid", placeItems: "center", fontSize: 19 }}>settings</span>
              </div>
              <div onClick={toggleVoice} style={{ height: 36, marginTop: 12, borderRadius: 4, background: listening ? "var(--e-panel-2)" : "linear-gradient(90deg,#e8b563,#f5d99a)", color: listening ? "var(--e-ivory)" : "#1a1409", border: `1px solid ${listening ? "var(--e-gold)" : "transparent"}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13.5, fontWeight: 500, cursor: "pointer" }}>
                <span className="e-icon" style={{ fontSize: 18 }}>{listening ? "stop_circle" : "mic"}</span>{listening ? "Stop Voice Connect" : "Start Voice Connect"}
              </div>
            </div>
            <div style={{ ...CARD, padding: "16px", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--e-muted)", fontSize: 12.5 }}>
              Voice commands ("open chart", "add note", ...) aren't wired to app actions yet — this only captures and shows the transcript for now.
            </div>
          </div>
        )}

        {tab === "Data & Sync" && (
          <div className="e-fill" style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 15 }}>How syncing actually works here</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["Account list", "Refreshed every 30 seconds"],
                ["Selected account's trades", "Refreshed every 20 seconds"],
                ["Live balance / open positions", "Refreshed every 3–8 seconds per account"],
                ["MT4 terminal detection", "Scanned every 4 seconds"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, borderTop: "1px solid var(--e-line-2)", paddingTop: 8 }}>
                  <span className="e-icon" style={{ fontSize: 15, color: "var(--e-text-2)" }}>radio_button_checked</span>
                  <span style={{ flex: 1 }}>{l}</span>
                  <span style={{ color: "var(--e-text-2)" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--e-muted)" }}>These intervals are fixed in the app for now — not user-configurable yet.</div>
          </div>
        )}
      </main>

      <input ref={fileRef} type="file" accept=".htm,.html,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />

      {dialog && (
        <AccountDialog
          account={dialog.mode === "edit" ? dialog.account : null}
          defaultPlatform={dialog.mode === "new" ? dialog.platform : undefined}
          onClose={() => setDialog(null)}
          onSaved={async (id) => {
            await j.refreshAccounts();
            if (id != null) j.setActive(id);
            setDialog(null);
            flash("Account saved.");
          }}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", right: 24, bottom: 24, padding: "10px 14px", borderRadius: 6, background: "#0f2a26", border: "1px solid #2c7a5f", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, zIndex: 10 }}>
          <span className="e-icon" style={{ fontSize: 18 }}>check_circle</span>{toast}
        </div>
      )}
    </div>
  );
}


