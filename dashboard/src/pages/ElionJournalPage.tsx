import { useEffect, useMemo, useRef, useState } from "react";
import { EMOTIONS, ERRORS } from "../components/TradeDrawer";
import { dateLocale } from "../lib/i18n";
import { durationSec, isClosed, net, summarize, byDay } from "../lib/analytics";
import { fmtDateTime, fmtPrice } from "../lib/data";
import { journalApi, type JTrade, type Notes } from "../lib/journalApi";
import { sessionAt } from "../lib/sessions";
import { useJournal } from "../state/JournalContext";
import { ElionBrand, ElionSidebar, useElionClock } from "../components/ElionChrome";
import { RULES } from "../lib/rules";

/**
 * Ported from design/elion/journal.dc.html (reference design). The trade table, stat cards and detail
 * panel are wired to the real journal (the active account's real trades from useJournal()). A few things
 * the reference implied — an AI trade score, an 8-point rule checklist, 3 screenshots per trade — have no
 * real system behind them in this app, so the detail panel shows the journal's actual per-trade fields
 * instead (setup validity, emotion, execution error, MFE/MAE, notes) and lets you edit and save them for
 * real via the same API the Persian journal page uses.
 */

const VALID_LABEL: Record<string, string> = { yes: "Valid setup", no: "Invalid setup", unsure: "Unsure" };
const VALID_STYLE: Record<string, [string, string]> = { yes: ["#173c35", "#8fe3c8"], no: ["#4a1a18", "#f3b5ae"], unsure: ["#1d2c31", "#dfe5e3"] };

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdSigned = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDurEn(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function rMultiple(t: JTrade): number | null {
  if (t.sl == null || t.close_price == null) return null;
  const risk = Math.abs(t.open_price - t.sl);
  if (!risk) return null;
  const sign = net(t) >= 0 ? 1 : -1;
  return (Math.abs(t.close_price - t.open_price) / risk) * sign;
}

function thumbPts(t: JTrade): string {
  const exit = t.close_price ?? t.open_price;
  const min = Math.min(t.open_price, exit), max = Math.max(t.open_price, exit) || 1;
  const y = (v: number) => 23 - ((v - min) / (max - min || 1)) * 20;
  return `0,${y(t.open_price).toFixed(1)} 64,${y(exit).toFixed(1)}`;
}

function svgPaths(vals: number[], w = 60, h = 26) {
  if (vals.length < 2) return { line: "", area: "" };
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals) || 1;
  const X = (i: number) => (i / (vals.length - 1)) * w;
  const Y = (v: number) => h - ((v - min) / (max - min || 1)) * h;
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const line = "M" + pts.join(" L");
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

function dayBars(trades: JTrade[], n = 5): string[] {
  const days = byDay(trades, 999).slice(0, n).reverse();
  const max = Math.max(1, ...days.map((d) => d.count));
  const bars = days.map((d) => `${Math.max(10, (d.count / max) * 100)}%`);
  while (bars.length < n) bars.unshift("10%");
  return bars;
}

export default function ElionJournalPage() {
  const clock = useElionClock();
  const { accounts, active, activeId, setActive, trades, status, statusError, live, refreshTrades } = useJournal();
  const [filter, setFilter] = useState("All");
  const [range, setRange] = useState("Today");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState("Overview");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setSel(null); setOpen(false); }, [activeId]);

  const nowSec = Date.now() / 1000;
  const rangeCutoff = range === "Today" ? Math.floor(nowSec / 86400) * 86400 : range === "This Week" ? nowSec - 7 * 86400 : range === "This Month" ? nowSec - 30 * 86400 : 0;
  const inRange = useMemo(() => trades.filter((t) => (t.close_time ?? t.open_time) >= rangeCutoff), [trades, rangeCutoff]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inRange
      .filter((t) => filter === "All" || (filter === "Buy" && t.direction === "buy") || (filter === "Sell" && t.direction === "sell") || (filter === "Win" && net(t) > 0) || (filter === "Loss" && net(t) <= 0))
      .filter((t) => !q || [t.symbol, t.ticket, t.setup_id ?? "", t.emotion ?? "", t.error ?? ""].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.open_time - a.open_time);
  }, [inRange, filter, query]);

  const per = 14;
  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const curPage = Math.min(page, pages - 1);
  const rows = filtered.slice(curPage * per, curPage * per + per);

  const counts = {
    All: inRange.length,
    Buy: inRange.filter((t) => t.direction === "buy").length,
    Sell: inRange.filter((t) => t.direction === "sell").length,
    Win: inRange.filter((t) => net(t) > 0).length,
    Loss: inRange.filter((t) => net(t) <= 0).length,
  };

  const sum = useMemo(() => summarize(trades), [trades]);
  const rMultiples = trades.map(rMultiple).filter((v): v is number => v != null);
  const avgRR = rMultiples.length ? rMultiples.reduce((s, v) => s + v, 0) / rMultiples.length : null;
  const doneRules = RULES.filter((r) => r.status === "approved").length;
  const cumNetSeries = useMemo(() => {
    let eq = 0;
    return trades
      .filter(isClosed)
      .sort((a, b) => (a.close_time as number) - (b.close_time as number))
      .map((t) => (eq += net(t)));
  }, [trades]);
  const { line: pnlLine, area: pnlArea } = svgPaths(cumNetSeries);
  const barsTrend = dayBars(trades);

  const t = sel != null ? trades.find((x) => x.id === sel) ?? null : null;
  const idx = t ? trades.findIndex((x) => x.id === t.id) : -1;

  const [note, setNote] = useState<Notes | null>(null);
  useEffect(() => {
    if (t) setNote({ setup_valid: t.setup_valid, setup_id: t.setup_id, emotion: t.emotion, error: t.error, note: t.note });
    else setNote(null);
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const saveNote = async () => {
    if (!t || !note) return;
    setSaving(true);
    try {
      await journalApi.saveNotes(t.id, note);
      await refreshTrades();
    } catch { /* toast-free: the Edit tab shows the fields unchanged if this fails */ }
    setSaving(false);
  };

  useEffect(() => {
    if (!t || tab !== "Overview") return;
    const raf = requestAnimationFrame(() => {
      const el = chartRef.current;
      if (!el || !el.isConnected || !el.clientWidth) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
      if (!h) return;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const exit = t.close_price ?? t.open_price;
      const vals = [t.open_price, exit, t.sl, t.tp].filter((v): v is number => v != null);
      const R = 40, B = 18, pw = w - R, ph = h - B;
      const min = Math.min(...vals) - (Math.max(...vals) - Math.min(...vals) || 1) * 0.1;
      const max = Math.max(...vals) + (Math.max(...vals) - Math.min(...vals) || 1) * 0.1;
      const Y = (v: number) => ph - ((v - min) / (max - min || 1)) * ph;
      ctx.font = "9.5px Manrope, sans-serif"; ctx.textBaseline = "middle"; ctx.fillStyle = "#8e9896"; ctx.textAlign = "left";
      [min, (min + max) / 2, max].forEach((v) => {
        ctx.strokeStyle = "rgba(200,215,210,.08)"; ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(pw, Y(v)); ctx.stroke();
        ctx.fillText(v.toFixed(2), pw + 5, Y(v));
      });
      if (t.sl != null) { ctx.setLineDash([2, 3]); ctx.strokeStyle = "rgba(224,90,78,.6)"; ctx.beginPath(); ctx.moveTo(0, Y(t.sl)); ctx.lineTo(pw, Y(t.sl)); ctx.stroke(); }
      if (t.tp != null) { ctx.strokeStyle = "rgba(62,196,149,.6)"; ctx.beginPath(); ctx.moveTo(0, Y(t.tp)); ctx.lineTo(pw, Y(t.tp)); ctx.stroke(); }
      ctx.setLineDash([]);
      const ex = pw * 0.12, xx = pw * 0.88;
      ctx.strokeStyle = "rgba(233,215,176,.8)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(ex, Y(t.open_price)); ctx.lineTo(xx, Y(exit)); ctx.stroke();
      ctx.font = "600 12px Manrope, sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#ecdcb8"; ctx.fillText("Entry", ex, Y(t.open_price) - 12);
      ctx.fillStyle = net(t) >= 0 ? "#3ec495" : "#e05a4e"; ctx.fillText(t.close_time ? "Exit" : "Open", xx, Y(exit) - 12);
      [[ex, t.open_price, "#ecdcb8"], [xx, exit, net(t) >= 0 ? "#3ec495" : "#e05a4e"]].forEach(([a, b, c]) => {
        ctx.fillStyle = c as string; ctx.beginPath(); ctx.arc(a as number, Y(b as number), 3.5, 0, 7); ctx.fill();
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [t?.id, t?.close_price, t?.sl, t?.tp, tab]);

  const tabNames = ["Overview", "Journal", "Edit"];

  const accountLabel = active ? `${active.name}${active.login ? ` · ${active.login}` : ""}` : "No account";
  const today = new Date();

  if (accounts.length === 0 || !active) {
    return (
      <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
        <ElionSidebar active="Journal" />
        <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <ElionBrand />
          <div style={{ marginTop: 24, borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: 24, maxWidth: 480 }}>
            {status !== "ok"
              ? statusError ?? "Journal server is offline — start it and reload."
              : "No trading accounts yet. Add one from Settings → Account."}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Journal" />
      <main style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 22, height: 44 }}>
          <ElionBrand />
          <div style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--e-text-2)" }}>DISCIPLINE BUILDS FREEDOM</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,440px)", height: 36, borderRadius: 18, border: "1px solid var(--e-field-line)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px", color: "#7f8b89" }}>
              <span className="e-icon" style={{ fontSize: 18 }}>search</span>
              <span style={{ flex: 1, fontSize: 11 }}>Search trades, setups, notes, or ask Elion...</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: status === "ok" ? "var(--e-up)" : "var(--e-down)", boxShadow: status === "ok" ? "0 0 6px var(--e-up)" : "none" }} />
              {status === "ok" ? "Journal Connected" : "Journal Offline"}
            </div>
            <div style={{ color: "var(--e-muted)" }}>{clock}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", display: "grid", placeItems: "center", fontWeight: 700 }}>EF</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontWeight: 600 }}>Elias Farahani</div>
              <div style={{ fontSize: 10, color: "var(--e-muted)" }}>Trader | Build the Edge</div>
            </div>
          </div>
        </header>

        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: open ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
              <div style={{ width: 46, height: 46, borderRadius: 10, border: "1px solid var(--e-gold-line)", background: "linear-gradient(180deg,#1b2a2e,#121e22)", display: "grid", placeItems: "center", color: "var(--e-gold)" }}>
                <span className="e-icon" style={{ fontSize: 26 }}>menu_book</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 600, color: "#f3f1ea" }}>Trading Journal</div>
                <div style={{ fontSize: 13, color: "var(--e-text-2)", marginTop: 2 }}>Review. Learn. Improve. Repeat.</div>
              </div>
              <div style={{ textAlign: "right", fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", fontSize: 17, lineHeight: 1.35, color: "var(--e-text)" }}>&ldquo;A journal turns experience into an edge.&rdquo;<br />— ELION</div>
            </div>

            <div className="e-two" style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 10 }}>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 10px", borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", whiteSpace: "nowrap" }}>
                  <span className="e-icon" style={{ fontSize: 18, color: "var(--e-text-3)" }}>description</span>
                  <select value={activeId ?? ""} onChange={(e) => setActive(Number(e.target.value))} style={{ background: "transparent", border: 0, outline: 0, color: "var(--e-text)", fontWeight: 600, fontSize: 12 }}>
                    {accounts.map((a) => <option key={a.id} value={a.id} style={{ color: "#000" }}>{a.name}</option>)}
                  </select>
                  {active.is_live && <span style={{ padding: "2px 8px", borderRadius: 9, background: "#1d6b52", color: "#a9ecd0", fontSize: 10, fontWeight: 600 }}>LIVE</span>}
                  <span style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid var(--e-border-2)", fontSize: 10, color: "var(--e-text-3)" }}>{active.platform.toUpperCase()}</span>
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 18px", display: "flex", alignItems: "center", gap: 28, minWidth: 0 }}>
                <div><div style={{ fontSize: 11, color: "var(--e-text-2)" }}>Equity</div><div style={{ fontSize: 19, fontWeight: 600, marginTop: 2 }}>{live?.equity != null ? usd(live.equity) : "—"}</div></div>
                <div><div style={{ fontSize: 11, color: "var(--e-text-2)" }}>Balance</div><div style={{ fontSize: 19, fontWeight: 600, marginTop: 2 }}>{live?.balance != null ? usd(live.balance) : "—"}</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--e-text-3)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: live?.connected ? "var(--e-up)" : "var(--e-down)", boxShadow: live?.connected ? "0 0 6px var(--e-up)" : "none" }} />
                  {live?.open_count ? `${live.open_count} open position${live.open_count > 1 ? "s" : ""}` : live?.connected ? "No open position" : "Not connected"}
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: 10, display: "flex", alignItems: "center" }}>
                <a href="#/account" style={{ height: 38, padding: "0 18px", borderRadius: 9, border: "1px solid var(--e-gold-line)", display: "flex", alignItems: "center", color: "var(--e-ivory)", fontWeight: 500, whiteSpace: "nowrap" }}>Account Settings</a>
              </div>
            </div>

            <div className="e-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr)) 88px", gap: 8 }}>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--e-text-3)" }}>Total Trades</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 21, fontWeight: 600 }}>{trades.length}</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 26 }}>
                    {barsTrend.map((b, i) => <div key={i} style={{ width: 4, height: b, background: "rgba(62,196,149,.55)", borderRadius: 1 }} />)}
                  </div>
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--e-text-3)" }}>Net P&amp;L</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 600, color: sum.net >= 0 ? "var(--e-up)" : "var(--e-down)", whiteSpace: "nowrap" }}>{sum.count ? usdSigned(sum.net) : "—"}</span>
                  {pnlArea && (
                    <svg viewBox="0 0 60 26" preserveAspectRatio="none" style={{ flex: 1, minWidth: 0, height: 26 }}>
                      <path d={pnlArea} fill={sum.net >= 0 ? "rgba(62,196,149,.2)" : "rgba(224,90,78,.2)"} />
                      <path d={pnlLine} fill="none" stroke={sum.net >= 0 ? "#3ec495" : "#e05a4e"} strokeWidth={1.2} />
                    </svg>
                  )}
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--e-text-3)" }}>Win Rate</div>
                  <div style={{ fontSize: 21, fontWeight: 600 }}>{sum.count ? `${Math.round(sum.winRate * 100)}%` : "—"}</div>
                </div>
                <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: "50%", background: `conic-gradient(#3ec495 ${sum.winRate * 360}deg, #1b2a2e 0)`, display: "grid", placeItems: "center" }}>
                  <div style={{ width: 25, height: 25, borderRadius: "50%", background: "#0d181b" }} />
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--e-text-3)" }}>Profit Factor</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 21, fontWeight: 600 }}>{sum.profitFactor != null ? sum.profitFactor.toFixed(2) : "—"}</span>
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--e-text-3)" }}>Avg. R-Multiple</div>
                <span style={{ fontSize: 21, fontWeight: 600, whiteSpace: "nowrap" }}>{avgRR != null ? `${avgRR >= 0 ? "+" : ""}${avgRR.toFixed(2)}R` : "—"}</span>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--e-text-3)", lineHeight: 1.2 }}>Rule Compliance</div>
                  <div style={{ fontSize: 21, fontWeight: 600 }}>{RULES.length ? `${Math.round((doneRules / RULES.length) * 100)}%` : "—"}</div>
                </div>
                <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: "50%", background: `conic-gradient(#3ec495 ${RULES.length ? (doneRules / RULES.length) * 360 : 0}deg, #1b2a2e 0)`, display: "grid", placeItems: "center" }}>
                  <div style={{ width: 25, height: 25, borderRadius: "50%", background: "#0d181b" }} />
                </div>
              </div>
              <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center" }}>
                <span className="e-icon" style={{ fontSize: 20, color: "var(--e-gold)" }}>calendar_month</span>
                <div style={{ fontSize: 10, color: "var(--e-text-3)" }}>Calendar</div>
                <div style={{ fontSize: 10, color: "var(--e-muted)" }}>{today.toLocaleDateString(dateLocale("en-GB"), { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0" }}>
              <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-4)" }}>
                {(["All", "Buy", "Sell", "Win", "Loss"] as const).map((l) => {
                  const on = l === filter;
                  return (
                    <div key={l} onClick={() => { setFilter(l); setPage(0); }} style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 10px", borderRadius: 8, cursor: "pointer", fontSize: 12, background: on ? "#1b2a2e" : "transparent", border: `1px solid ${on ? "var(--e-gold-line)" : "transparent"}`, color: on ? "var(--e-ivory)" : "var(--e-text-3)" }}>
                      {l}<span style={{ padding: "1px 6px", borderRadius: 5, background: on ? "rgba(233,215,176,.2)" : "#15252a", fontSize: 10.5 }}>{counts[l]}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-4)" }}>
                {["Today", "This Week", "This Month", "Custom"].map((l) => (
                  <div key={l} onClick={() => { setRange(l); setPage(0); }} style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", borderRadius: 8, cursor: "pointer", fontSize: 12, background: l === range ? "#1b2a2e" : "transparent", color: l === range ? "var(--e-ivory)" : "var(--e-text-3)" }}>
                    {l}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 140, display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-4)", color: "var(--e-muted)" }}>
                <span className="e-icon" style={{ fontSize: 17 }}>search</span>
                <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search trades..." style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--e-text)", fontSize: 12 }} />
              </div>
            </div>

            <div className="e-table" style={{ flex: 1, borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", overflow: "hidden", ["--tw" as string]: "860px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "76px 60px 56px 62px 62px 66px 44px 60px 56px 68px minmax(80px,1fr) 62px", alignItems: "center", columnGap: 4, padding: "0 10px", height: 42, fontSize: 11, color: "var(--e-text-2)", borderBottom: "1px solid var(--e-line-3)" }}>
                <span>Date & Time</span><span>Symbol</span><span>Type</span><span>Entry</span><span>Exit</span><span>P&amp;L</span><span>R</span><span>Duration</span><span>Session</span><span>Setup</span><span>Tags</span><span>Move</span>
              </div>
              {rows.length === 0 && <div style={{ padding: "24px 12px", fontSize: 11.5, color: "var(--e-muted)" }}>No trades match.</div>}
              {rows.map((r) => {
                const rr = rMultiple(r);
                const val = isClosed(r) ? net(r) : r.profit;
                return (
                  <div key={r.id} className="e-row" onClick={() => { setSel(r.id); setOpen(true); setTab("Overview"); }} style={{ display: "grid", gridTemplateColumns: "76px 60px 56px 62px 62px 66px 44px 60px 56px 68px minmax(80px,1fr) 62px", alignItems: "center", columnGap: 4, padding: "0 10px", height: 34, fontSize: 11, borderBottom: "1px solid #121f23", cursor: "pointer", background: r.id === sel ? "rgba(233,215,176,.07)" : "transparent", boxShadow: r.id === sel ? "inset 0 0 0 1px rgba(233,215,176,.35)" : "none" }}>
                    <span style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.open_time).slice(5)}</span>
                    <span>{r.symbol}</span>
                    <span><span style={{ display: "inline-block", padding: "3px 7px", borderRadius: 4, fontSize: 10, background: r.direction === "sell" ? "#6e1f1c" : "#1d4a3b", color: r.direction === "sell" ? "#f3b5ae" : "#a9ecd0" }}>{r.direction === "sell" ? "SELL" : "BUY"}</span></span>
                    <span>{fmtPrice(r.open_price)}</span>
                    <span>{isClosed(r) ? fmtPrice(r.close_price) : "open"}</span>
                    <span style={{ fontWeight: 600, color: val >= 0 ? "var(--e-up)" : "var(--e-down)" }}>{usdSigned(val)}</span>
                    <span>{rr != null ? rr.toFixed(1) : "—"}</span>
                    <span style={{ whiteSpace: "nowrap" }}>{isClosed(r) ? fmtDurEn(durationSec(r)) : "—"}</span>
                    <span>{sessionAt(r.open_time)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.setup_id ?? "—"}</span>
                    <span style={{ display: "flex", gap: 4, overflow: "hidden" }}>
                      {r.setup_valid && <span style={{ padding: "3px 7px", borderRadius: 4, fontSize: 10, whiteSpace: "nowrap", background: VALID_STYLE[r.setup_valid][0], color: VALID_STYLE[r.setup_valid][1] }}>{r.setup_valid}</span>}
                      {r.emotion && <span style={{ padding: "3px 7px", borderRadius: 4, fontSize: 10, whiteSpace: "nowrap", background: "#1a282c" }}>{r.emotion}</span>}
                      {r.error && <span style={{ padding: "3px 7px", borderRadius: 4, fontSize: 10, whiteSpace: "nowrap", background: "#4a1a18", color: "#f3b5ae" }}>{r.error}</span>}
                    </span>
                    <svg viewBox="0 0 64 26" preserveAspectRatio="none" style={{ width: 60, height: 28, borderRadius: 3, border: "1px solid var(--e-border)", background: "#0a1417" }}>
                      <polyline points={thumbPts(r)} fill="none" stroke={val >= 0 ? "var(--e-up)" : "var(--e-down)"} strokeWidth={1} />
                    </svg>
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 12px", fontSize: 11, color: "var(--e-text-2)" }}>
                <span>{filtered.length ? `Showing ${curPage * per + 1} - ${Math.min(filtered.length, curPage * per + per)} of ${filtered.length} trades` : "No trades match"}</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <div onClick={() => setPage(Math.max(0, curPage - 1))} style={{ width: 28, height: 28, display: "grid", placeItems: "center", cursor: "pointer" }}><span className="e-icon" style={{ fontSize: 18 }}>chevron_left</span></div>
                  {Array.from({ length: pages }, (_, i) => (
                    <div key={i} onClick={() => setPage(i)} style={{ width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center", cursor: "pointer", fontSize: 12, background: i === curPage ? "var(--e-gold-2)" : "transparent", color: i === curPage ? "#1a1409" : "var(--e-text-3)", border: `1px solid ${i === curPage ? "var(--e-gold-2)" : "transparent"}` }}>{i + 1}</div>
                  ))}
                  <div onClick={() => setPage(Math.min(pages - 1, curPage + 1))} style={{ width: 28, height: 28, display: "grid", placeItems: "center", cursor: "pointer" }}><span className="e-icon" style={{ fontSize: 18 }}>chevron_right</span></div>
                </div>
              </div>
            </div>
          </div>

          {open && t && note && (
            <aside style={{ borderRadius: 14, border: "1px solid var(--e-line)", background: "linear-gradient(180deg,#0f1b1f,#0a1417)", padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, fontSize: 19, fontWeight: 600 }}>Trade Detail</div>
                <div onClick={() => setSel(trades[Math.max(0, idx - 1)]?.id ?? t.id)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--e-border)", display: "grid", placeItems: "center", cursor: "pointer" }}><span className="e-icon" style={{ fontSize: 18 }}>chevron_left</span></div>
                <div onClick={() => setSel(trades[Math.min(trades.length - 1, idx + 1)]?.id ?? t.id)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--e-border)", display: "grid", placeItems: "center", cursor: "pointer" }}><span className="e-icon" style={{ fontSize: 18 }}>chevron_right</span></div>
                <div onClick={() => setOpen(false)} style={{ width: 28, height: 28, display: "grid", placeItems: "center", cursor: "pointer" }}><span className="e-icon" style={{ fontSize: 20 }}>close</span></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>#{t.ticket}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, fontSize: 12, background: (isClosed(t) ? net(t) : t.profit) >= 0 ? "#173c35" : "#4a1a18", color: (isClosed(t) ? net(t) : t.profit) >= 0 ? "#8fe3c8" : "#f3b5ae" }}>
                  <span className="e-icon fill" style={{ fontSize: 15 }}>{(isClosed(t) ? net(t) : t.profit) >= 0 ? "check_circle" : "cancel"}</span>{isClosed(t) ? ((isClosed(t) ? net(t) : t.profit) >= 0 ? "Win" : "Loss") : "Open"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t.symbol}</span>
                <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, background: t.direction === "sell" ? "#6e1f1c" : "#1d4a3b", color: t.direction === "sell" ? "#f3b5ae" : "#a9ecd0" }}>{t.direction === "sell" ? "SELL" : "BUY"}</span>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 19, fontWeight: 600, color: (isClosed(t) ? net(t) : t.profit) >= 0 ? "var(--e-up)" : "var(--e-down)" }}>{usdSigned(isClosed(t) ? net(t) : t.profit)}</div>
                  {rMultiple(t) != null && <div style={{ fontSize: 11, color: "var(--e-text-2)", marginTop: 2 }}>R  {rMultiple(t)!.toFixed(2)}</div>}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", borderRadius: 10, background: "var(--e-panel-2)", border: "1px solid var(--e-line)", padding: 3 }}>
                {tabNames.map((l) => {
                  const on = l === tab;
                  return (
                    <div key={l} onClick={() => setTab(l)} style={{ height: 32, display: "grid", placeItems: "center", fontSize: 11.5, borderRadius: 7, cursor: "pointer", background: on ? "#16252a" : "transparent", color: on ? "var(--e-ivory)" : "var(--e-text-2)", borderBottom: `2px solid ${on ? "var(--e-gold)" : "transparent"}` }}>
                      {l}
                    </div>
                  );
                })}
              </div>

              {tab === "Overview" && (
                <>
                  <div style={{ borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-3)", height: 170, display: "flex", flexDirection: "column", padding: "8px 8px 4px" }}>
                    <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>{t.symbol} · entry → {isClosed(t) ? "exit" : "current"}</div>
                    <div style={{ position: "relative", flex: 1, minHeight: 0 }}><canvas ref={chartRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: "4px 16px", fontSize: 11.5, padding: "2px 2px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", rowGap: 8 }}>
                      <span style={{ color: "var(--e-text-2)" }}>Entry</span><span>{fmtPrice(t.open_price)}</span>
                      <span style={{ color: "var(--e-text-2)" }}>Exit</span><span>{isClosed(t) ? fmtPrice(t.close_price) : "open"}</span>
                      <span style={{ color: "var(--e-text-2)" }}>SL</span><span>{fmtPrice(t.sl)}</span>
                      <span style={{ color: "var(--e-text-2)" }}>TP</span><span>{fmtPrice(t.tp)}</span>
                      <span style={{ color: "var(--e-text-2)" }}>Lot Size</span><span>{t.volume}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "78px 1fr", rowGap: 8, alignItems: "center" }}>
                      <span style={{ color: "var(--e-text-2)" }}>Opened</span><span>{fmtDateTime(t.open_time)}</span>
                      <span style={{ color: "var(--e-text-2)" }}>Closed</span><span>{t.close_time ? fmtDateTime(t.close_time) : "—"}</span>
                      <span style={{ color: "var(--e-text-2)" }}>Duration</span><span>{isClosed(t) ? fmtDurEn(durationSec(t)) : "—"}</span>
                      <span style={{ color: "var(--e-text-2)" }}>Session</span><span>{sessionAt(t.open_time)}</span>
                      <span style={{ color: "var(--e-text-2)" }}>Fees</span><span>{usdSigned(t.commission + t.swap)}</span>
                    </div>
                  </div>
                </>
              )}

              {tab === "Journal" && (
                <div style={{ borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-3)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {t.setup_valid ? <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, background: VALID_STYLE[t.setup_valid][0], color: VALID_STYLE[t.setup_valid][1] }}>{VALID_LABEL[t.setup_valid]}</span> : <span style={{ fontSize: 11, color: "var(--e-muted)" }}>Setup validity not recorded</span>}
                    {t.emotion && <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, background: "#1a282c" }}>{t.emotion}</span>}
                    {t.error && <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, background: "#4a1a18", color: "#f3b5ae" }}>{t.error}</span>}
                  </div>
                  {t.mfe != null && t.mae != null && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11.5 }}>
                      <div><span style={{ color: "var(--e-text-2)" }}>MFE (best floating)</span><div style={{ marginTop: 2 }}>{usdSigned(t.mfe as number)}</div></div>
                      <div><span style={{ color: "var(--e-text-2)" }}>MAE (worst floating)</span><div style={{ marginTop: 2 }}>{usdSigned(t.mae as number)}</div></div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 11, color: "var(--e-text-2)", marginBottom: 4 }}>Note</div>
                    <div dir="rtl" style={{ fontFamily: "Vazirmatn, sans-serif", fontSize: 12, lineHeight: 1.8, color: "var(--e-text)" }}>{t.note || "—"}</div>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--e-muted)" }}>Source: {t.source ?? "—"}</div>
                </div>
              )}

              {tab === "Edit" && (
                <div style={{ borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-3)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--e-text-2)", marginBottom: 6 }}>Setup validity</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["yes", "no", "unsure"] as const).map((v) => (
                        <div key={v} onClick={() => setNote((p) => p && { ...p, setup_valid: p.setup_valid === v ? null : v })} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: note.setup_valid === v ? VALID_STYLE[v][0] : "var(--e-panel-2)", color: note.setup_valid === v ? VALID_STYLE[v][1] : "var(--e-text-3)", border: "1px solid var(--e-border)" }}>{VALID_LABEL[v]}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--e-text-2)", marginBottom: 6 }} dir="rtl">حالت روانی</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} dir="rtl">
                      {EMOTIONS.map((em) => (
                        <div key={em} onClick={() => setNote((p) => p && { ...p, emotion: p.emotion === em ? null : em })} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: note.emotion === em ? "#1b2a2e" : "var(--e-panel-2)", color: note.emotion === em ? "var(--e-ivory)" : "var(--e-text-3)", border: `1px solid ${note.emotion === em ? "var(--e-gold-line)" : "var(--e-border)"}` }}>{em}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--e-text-2)", marginBottom: 6 }} dir="rtl">خطای اجرا</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} dir="rtl">
                      {ERRORS.map((er) => (
                        <div key={er} onClick={() => setNote((p) => p && { ...p, error: p.error === er ? null : er })} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: note.error === er ? "#4a1a18" : "var(--e-panel-2)", color: note.error === er ? "#f3b5ae" : "var(--e-text-3)", border: `1px solid ${note.error === er ? "#6e2a26" : "var(--e-border)"}` }}>{er}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--e-text-2)", marginBottom: 6 }}>Note</div>
                    <textarea dir="rtl" value={note.note ?? ""} onChange={(e) => setNote((p) => p && { ...p, note: e.target.value || null })} style={{ height: 100, resize: "vertical", width: "100%", background: "var(--e-panel-2)", border: "1px solid var(--e-border)", borderRadius: 8, color: "var(--e-text)", padding: 10, fontFamily: "Vazirmatn, sans-serif", fontSize: 12, lineHeight: 1.8, outline: 0 }} />
                  </div>
                  <div onClick={saving ? undefined : saveNote} style={{ alignSelf: "flex-end", padding: "8px 18px", borderRadius: 8, border: "1px solid var(--e-gold-line)", color: "var(--e-ivory)", fontSize: 12, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</div>
                </div>
              )}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

