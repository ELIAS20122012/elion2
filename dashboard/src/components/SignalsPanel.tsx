import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyAiError } from "../lib/aiLab";
import { journalApi, type AiProvider, type Signal, type SignalGroup, type SignalStats } from "../lib/journalApi";
import { useDivParams } from "../lib/prefs";
import { RULES } from "../lib/rules";
import { scanForSignals, toCandles } from "../lib/signalScan";
import { useJournal } from "../state/JournalContext";

/**
 * AI Lab -> "Setup Detection": the robot's signal queue.
 *   1. the chart's own divergence detector scans real MT5 candles (only while this page is open)
 *   2. each new finding is stored and, if chosen, reviewed by the selected AI provider (image + candles + MACD)
 *   3. Elias approves / rejects - a RECORD only, no order is ever sent from here
 *   4. what price did afterwards is measured from real candles, so the AI's calls can be judged over time
 */

const TFS: [string, number][] = [["M1", 60], ["M5", 300], ["M15", 900], ["M30", 1800], ["H1", 3600], ["H4", 14400]];
const CARD: React.CSSProperties = { borderRadius: 8, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const TEAL = "var(--e-up-2)";
const RED = "#ef5a50";
const AMBER = "#e2c089";
const VERDICT: Record<string, [string, string]> = { valid: ["Valid", TEAL], invalid: ["Invalid", RED], unsure: ["Unsure", AMBER], not_reviewed: ["Not reviewed", "var(--e-text-3)"] };
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const fx = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const when = (t: number) => { const d = new Date(t * 1000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

function StatCard({ label, color, g }: { label: string; color: string; g: SignalGroup | undefined }) {
  return (
    <div style={{ ...CARD, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, color }}>{label}</span>
      <span style={{ fontSize: 18 }}>{g ? `${g.measured} / ${g.signals}` : "0 / 0"}<span style={{ fontSize: 10.5, color: "var(--e-text-3)" }}> measured</span></span>
      <span style={{ fontSize: 11, color: "var(--e-text-2)" }}>Favorable {pct(g?.favorable_rate ?? null)} · MFE {fx(g?.avg_mfe_atr ?? null)} / MAE {fx(g?.avg_mae_atr ?? null)} ATR</span>
    </div>
  );
}

export default function SignalsPanel({ provider }: { provider: AiProvider | null }) {
  const j = useJournal();
  const acc = j.active;
  const accountId = acc?.id ?? null;
  const [divP] = useDivParams();
  const [tf, setTf] = useState(300);
  const [review, setReview] = useState(true);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [list, setList] = useState<Signal[] | null>(null);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([journalApi.signals(accountId), journalApi.signalStats(accountId)]);
      setList(l);
      setStats(s);
    } catch (e) {
      setList([]);
      setStatus({ kind: "err", text: classifyAiError(e).message });
    }
  }, [accountId]);
  useEffect(() => { void reload(); }, [reload]);

  // AI reviews run on the server in the background: poll while any is in progress
  const reviewing = list?.some((s) => s.ai_status === "reviewing") ?? false;
  useEffect(() => {
    if (!reviewing) return;
    const iv = window.setInterval(() => void reload(), 3000);
    return () => window.clearInterval(iv);
  }, [reviewing, reload]);

  const canScan = acc != null && acc.platform === "mt5" && acc.enabled;
  const scan = useCallback(async () => {
    if (busyRef.current || !acc) return;
    if (!canScan) { setStatus({ kind: "err", text: "Pick a connected MT5 account (Connection page) - the robot reads its broker candles." }); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await journalApi.candles(acc.id, tf, 1500);
      const bars = toCandles(r.candles);
      const found = scanForSignals({ bars, tfSec: tf, symbol: r.symbol, accountId: acc.id, rule: RULES.find((x) => x.id === "divergence"), params: divP });
      let created = 0;
      let reviewErr: string | null = null;
      const withAi = review && provider?.available ? provider.id : null;
      for (const s of found) {
        try {
          const res = await journalApi.createSignal({ ...s, provider: withAi });
          if (res.created) created++;
        } catch (e) {
          reviewErr = classifyAiError(e).message;
        }
      }
      await journalApi.signalOutcomes(acc.id, r.symbol, tf, bars.slice(0, -1).map((c) => [c.time, c.open, c.high, c.low, c.close]));
      await reload();
      const t = new Date();
      setStatus(reviewErr
        ? { kind: "err", text: `Scanned ${bars.length} candles: ${created} new signal(s), but the AI review failed: ${reviewErr}` }
        : { kind: "ok", text: `Scanned ${bars.length} ${TFS.find((x) => x[1] === tf)?.[0]} candles at ${t.toLocaleTimeString()}: ${found.length} recent finding(s), ${created} new.` });
    } catch (e) {
      setStatus({ kind: "err", text: classifyAiError(e).message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [acc, canScan, tf, divP, review, provider, reload]);

  // auto-scan once per candle (at most every minute) while this page is open
  useEffect(() => {
    if (!auto) return;
    void scan();
    const iv = window.setInterval(() => void scan(), Math.max(60, tf) * 1000);
    return () => window.clearInterval(iv);
  }, [auto, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await reload(); } catch (e) { setStatus({ kind: "err", text: classifyAiError(e).message }); }
  };

  const byVerdict = stats?.by_ai_verdict ?? {};
  const decided = useMemo(() => stats?.by_decision ?? {}, [stats]);

  return (
    <div className="e-fill" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 554, minWidth: 0 }}>
      {/* controls */}
      <div style={{ ...CARD, padding: "10px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 16 }}>Robot signals</span>
        <span style={{ fontSize: 12, color: "var(--e-text-2)" }}>{acc ? `${acc.name}${acc.login ? ` · ${acc.login}` : ""}` : "No account"} · Rule: divergence (chart detector settings)</span>
        <span style={{ flex: 1 }} />
        <select aria-label="Timeframe" value={tf} onChange={(e) => setTf(Number(e.target.value))}
          style={{ height: 30, borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", color: "var(--e-text)", fontSize: 12.5, padding: "0 8px" }}>
          {TFS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: provider?.available ? 1 : 0.55 }} title={provider?.available ? "" : "No AI provider configured"}>
          <input type="checkbox" checked={review && !!provider?.available} disabled={!provider?.available} onChange={(e) => setReview(e.target.checked)} />
          AI review{provider ? ` (${provider.label})` : ""}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} title="Scans once per candle, only while this page stays open">
          <input type="checkbox" checked={auto} disabled={!canScan} onChange={(e) => setAuto(e.target.checked)} />Auto-scan
        </label>
        <button type="button" onClick={() => void scan()} disabled={busy || !canScan}
          style={{ height: 32, padding: "0 16px", borderRadius: 4, border: "1px solid var(--e-gold)", background: "#16170f", color: "var(--e-ivory)", fontSize: 13, cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 8, opacity: canScan ? 1 : 0.5 }}>
          <span className={`e-icon${busy ? " e-spin" : ""}`} style={{ fontSize: 17 }}>{busy ? "progress_activity" : "radar"}</span>{busy ? "Scanning…" : "Scan now"}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--e-text-3)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="e-icon" style={{ fontSize: 15, color: AMBER }}>shield</span>
        Signals are suggestions for you to check. Approve / Reject only records your decision - no order is sent. Trades stay on the Trade page.
        {status && <span role={status.kind === "err" ? "alert" : "status"} style={{ color: status.kind === "err" ? RED : TEAL }}>· {status.text}</span>}
      </div>

      {/* how the AI's calls played out */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {(["valid", "invalid", "unsure", "not_reviewed"] as const).map((k) => <StatCard key={k} label={`AI: ${VERDICT[k][0]}`} color={VERDICT[k][1]} g={byVerdict[k]} />)}
        <StatCard label="You approved" color={TEAL} g={decided.approved} />
      </div>
      <div style={{ fontSize: 10.5, color: "var(--e-text-3)" }}>
        Outcome = move in the divergence's reversal direction over the next {stats?.horizon ?? 20} closed candles from the formation close (MFE best / MAE worst, in ATR). An assumption until entry, stop and target rules are defined. "Favorable" = MFE ≥ MAE.
      </div>

      {/* queue */}
      <div className="e-table" style={{ ...CARD, flex: 1, minHeight: 0, overflow: "auto", ["--tw" as string]: "900px" }}>
        {list === null ? (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--e-text-2)" }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--e-text-2)" }}>No signals yet. Press "Scan now" to run the detector on the account's MT5 candles.</div>
        ) : list.map((s) => {
          const v = s.ai_verdict ? VERDICT[s.ai_verdict] : null;
          const o = s.outcome;
          const isOpen = open === s.id;
          return (
            <div key={s.id} style={{ borderBottom: "1px solid var(--e-line-3)" }}>
              <div className="e-row" style={{ display: "grid", gridTemplateColumns: "88px 1.1fr 1fr 1.3fr 1.2fr 1.3fr", gap: 10, alignItems: "center", padding: "8px 12px", fontSize: 12 }}>
                <a href={journalApi.signalChartUrl(s.id)} target="_blank" rel="noreferrer" title="The exact picture the AI saw">
                  <img src={journalApi.signalChartUrl(s.id)} alt="signal chart" loading="lazy" style={{ width: 84, height: 47, objectFit: "cover", borderRadius: 3, border: "1px solid var(--e-border)", display: "block" }} />
                </a>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{s.symbol} · {TFS.find((x) => x[1] === s.tf_sec)?.[0] ?? `${s.tf_sec}s`}</span>
                  <span style={{ color: "var(--e-text-3)", fontSize: 11 }}>formed {when(s.formed_time)} UTC · {fx(s.formed_price)}</span>
                </div>
                <span style={{ color: s.side === "high" ? "#ff9d3d" : "#2ee6a6" }}>{s.side === "high" ? "Divergence at highs (watch ↓)" : "Divergence at lows (watch ↑)"}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {s.ai_status === "reviewing" && <span style={{ color: "var(--e-text-2)", display: "flex", gap: 6, alignItems: "center" }}><span className="e-icon e-spin" style={{ fontSize: 14 }}>progress_activity</span>AI reviewing…</span>}
                  {s.ai_status === "done" && v && <span style={{ color: v[1] }}>{v[0]} <span style={{ color: "var(--e-text-3)", fontSize: 10.5 }}>· {s.ai_provider}</span></span>}
                  {s.ai_status === "error" && <span role="alert" style={{ color: RED, fontSize: 11 }} title={s.ai_error ?? ""}>AI failed: {(s.ai_error ?? "").slice(0, 60)}</span>}
                  {s.ai_status === "none" && <span style={{ color: "var(--e-text-3)" }}>Not reviewed</span>}
                  <span style={{ display: "flex", gap: 8 }}>
                    {s.ai_review && <a href="#" onClick={(e) => { e.preventDefault(); setOpen(isOpen ? null : s.id); }} style={{ fontSize: 11 }}>{isOpen ? "Hide" : "Why?"}</a>}
                    {provider?.available && s.ai_status !== "reviewing" && (
                      <a href="#" onClick={(e) => { e.preventDefault(); void act(() => journalApi.reviewSignal(s.id, provider.id)); }} style={{ fontSize: 11 }}>{s.ai_status === "none" ? "Review" : "Re-review"}</a>
                    )}
                  </span>
                </div>
                <span style={{ fontSize: 11.5 }}>
                  {o ? (
                    <span style={{ color: o.favorable ? TEAL : RED }}>{o.favorable ? "Favorable" : "Unfavorable"} <span style={{ color: "var(--e-text-2)" }}>MFE {fx(o.mfe_atr)} / MAE {fx(o.mae_atr)} ATR</span></span>
                  ) : <span style={{ color: "var(--e-text-3)" }}>Waiting for {stats?.horizon ?? 20} candles</span>}
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                  {s.decision !== "pending" && <span style={{ fontSize: 11, color: s.decision === "approved" ? TEAL : RED, marginRight: 4 }}>{s.decision === "approved" ? "Approved" : "Rejected"}</span>}
                  {(["approved", "rejected"] as const).map((d) => (
                    <button key={d} type="button" title={d === "approved" ? "Record that you agree - no order is sent" : "Record that you disagree"}
                      onClick={() => void act(() => journalApi.decideSignal(s.id, s.decision === d ? "pending" : d))}
                      style={{ height: 26, padding: "0 10px", borderRadius: 4, fontSize: 11.5, cursor: "pointer", border: `1px solid ${d === "approved" ? "#2c7a5f" : "#7a2c2c"}`,
                        background: s.decision === d ? (d === "approved" ? "#0f3a33" : "#3a1414") : "transparent", color: "var(--e-text)" }}>
                      {d === "approved" ? "Approve" : "Reject"}
                    </button>
                  ))}
                </div>
              </div>
              {isOpen && s.ai_review && (
                <div style={{ padding: "0 12px 10px 110px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12, lineHeight: 1.45 }}>
                  {s.ai_review.reasons.map((r, i) => <span key={`r${i}`}>• {r}</span>)}
                  {s.ai_review.rule_checks.map((c, i) => <span key={`c${i}`} style={{ color: "var(--e-text-2)" }}>{c.rule}: {c.status}{c.evidence ? ` — ${c.evidence}` : ""}</span>)}
                  {s.ai_review.risks.map((r, i) => <span key={`k${i}`} style={{ color: AMBER }}>Risk: {r}</span>)}
                  {s.ai_review.data_gaps.map((r, i) => <span key={`g${i}`} style={{ color: "var(--e-text-3)" }}>Missing: {r}</span>)}
                  <span style={{ fontSize: 10.5, color: "var(--e-text-3)" }}>{s.ai_model}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
