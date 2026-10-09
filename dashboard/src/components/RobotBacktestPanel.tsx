/**
 * ELION Robot inside the Backtest page: run the server robot (Level Continuation) on the stored MT4 M1
 * history with trial parameters, list every trade, draw each one on the chart (entry, SL, TP, the level,
 * the two pullback lows of the hidden divergence) and show the live suggestions. Nothing here trades.
 */
import { useEffect, useState } from "react";
import type { Drawing } from "../lib/drawings";
import { journalApi, type Setup, type SetupBacktest, type SetupTrade } from "../lib/journalApi";

const UP = "var(--e-up)";
const DOWN = "var(--e-down-3)";

export const ROBOT_PARAMS: { key: string; label: string; step: number }[] = [
  { key: "rr", label: "R:R", step: 0.5 },
  { key: "htfMin", label: "Trend TF (min)", step: 5 },
  { key: "swingN", label: "Swing (candles each side)", step: 1 },
  { key: "tol", label: "Pullback to level (× ATR)", step: 0.1 },
  { key: "crossWithin", label: "MACD cross within (bars)", step: 1 },
  { key: "slBuf", label: "SL buffer (× ATR)", step: 0.1 },
  { key: "hidden", label: "Hidden divergence (1/0)", step: 1 },
  { key: "session", label: "07–20 UTC only (1/0)", step: 1 },
  { key: "buy", label: "Buy (1/0)", step: 1 },
  { key: "sell", label: "Sell (1/0)", step: 1 },
];

const FUNNEL: Record<string, string> = {
  "1 crosses": "MACD crosses checked",
  "2 x trend": "✗ against / no M5 trend",
  "3 x session": "✗ outside 07–20 UTC",
  "4 x no pullback": "✗ no pullback swing yet",
  "4 x pullback too old": "✗ pullback too old",
  "5 x no level": "✗ no broken level",
  "6 x pullback off level": "✗ pullback didn't reach level",
  "7 x no hidden divergence": "✗ no hidden divergence",
  "8 x same pullback": "✗ same pullback again",
  "9 = signals": "= signals",
};

const fl = (t: number, tf: number) => Math.floor(t / tf) * tf;
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");

/** chart drawings for one result: position box (entry→exit), level, divergence lows, R label */
export function robotDrawings(r: SetupBacktest | null, tfSec: number, selected: number | null): Drawing[] {
  if (!r) return [];
  const out: Drawing[] = [];
  r.trades.forEach((t, k) => {
    const long = t.direction === "buy";
    const end = Math.max(fl(t.exit_time, tfSec), fl(t.entry_time, tfSec) + tfSec * 3);
    const sel = selected === k;
    out.push({ id: `rb:${k}:pos`, type: long ? "long" : "short", color: "#9aa6ad",
      points: [{ time: fl(t.entry_time, tfSec), price: t.entry }, { time: end, price: t.tp }, { time: end, price: t.sl }] });
    out.push({ id: `rb:${k}:lvl`, type: "trend", color: "#f0b429", dashed: true, width: sel ? 2 : 1,
      points: [{ time: fl(t.level_time, tfSec), price: t.level }, { time: end, price: t.level }] });
    out.push({ id: `rb:${k}:div`, type: "trend", color: "#4fc3f7", width: sel ? 2 : 1,
      points: [{ time: fl(t.prev_pb_time, tfSec), price: t.prev_pb }, { time: fl(t.pb_time, tfSec), price: t.pb }] });
    const res = t.r == null ? "open" : `${t.r > 0 ? "+" : ""}${t.r}R`;
    out.push({ id: `rb:${k}:txt`, type: "text", color: t.r == null ? "#cfd8dc" : t.r > 0 ? "#26a69a" : "#ef5350",
      text: `#${k + 1} ${res}`, points: [{ time: end, price: long ? Math.max(t.tp, t.entry) : Math.min(t.tp, t.entry) }] });
  });
  return out;
}

interface Props {
  symbol: string;
  symbols: { symbol: string; bars: number }[];
  onSymbol: (s: string) => void;
  result: SetupBacktest | null;
  onResult: (r: SetupBacktest | null) => void;
  selected: number | null;
  onSelect: (k: number, time: number) => void;
  onFocusTime: (time: number) => void;
  fmt: (v: number) => string;
}

const BOX: React.CSSProperties = { border: "1px solid var(--e-border)", borderRadius: 4, background: "var(--e-panel-2)" };
const btn = (color: string): React.CSSProperties => ({ padding: "3px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: `1px solid ${color}`, color, display: "inline-block" });

export default function RobotBacktestPanel({ symbol, symbols, onSymbol, result, onResult, selected, onSelect, onFocusTime, fmt }: Props) {
  const [params, setParams] = useState<Record<string, number> | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [live, setLive] = useState<Setup[]>([]);

  useEffect(() => {
    journalApi.setupSettings().then((s) => { setParams(s.params); setEnabled(s.enabled); }).catch((e) => setMsg((e as Error).message));
    const load = () => journalApi.setups().then(setLive).catch(() => undefined);
    load();
    const h = window.setInterval(load, 15000);
    return () => window.clearInterval(h);
  }, []);

  const run = () => {
    if (!params) return;
    setBusy(true); setMsg(null);
    journalApi.setupBacktestRun(symbol, params)
      .then((r) => { onResult(r); setMsg(r.trades.length ? null : "No trades with these rules on this history."); })
      .catch((e) => setMsg((e as Error).message))
      .finally(() => setBusy(false));
  };
  const saveLive = () => params && journalApi.saveSetupSettings({ params }).then(() => setMsg("Saved — the live robot now uses these rules.")).catch((e) => setMsg((e as Error).message));
  const toggle = () => enabled != null && journalApi.saveSetupSettings({ enabled: !enabled }).then((s) => setEnabled(s.enabled)).catch(() => undefined);

  const r = result;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, flex: 1 }}>ELION Robot</span>
        <span onClick={toggle} style={btn(enabled ? "#26a69a" : "#8fa3ad")} title="Live robot: scans every closed M1 candle and sends suggestions (never orders)">{enabled == null ? "…" : enabled ? "● Live ON" : "○ Live OFF"}</span>
      </div>
      <span style={{ fontSize: 11, color: "var(--e-text-2)", lineHeight: 1.5 }}>
        Level Continuation on MT4 M1 history: M5 trend → broken level → pullback to it → hidden MACD divergence → MACD cross = entry. Every trade is drawn on the chart: green/red box = TP/SL, orange = level, blue = the two pullback lows.
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>Symbol (MT4 history)</span>
        <select value={symbol} onChange={(e) => onSymbol(e.target.value)} style={{ ...BOX, height: 30, color: "var(--e-text)", fontSize: 12, padding: "0 6px" }}>
          {(symbols.some((s) => s.symbol === symbol) ? symbols : [{ symbol, bars: 0 }, ...symbols]).map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}{s.bars ? ` · ${s.bars} bars` : ""}</option>)}
        </select>
      </div>
      {params && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {ROBOT_PARAMS.map((p) => (
            <label key={p.key} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--e-text-3)" }}>
              {p.label}
              <input type="number" step={p.step} value={params[p.key] ?? 0} onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })}
                style={{ ...BOX, height: 26, color: "var(--e-text)", fontSize: 12, padding: "0 6px", outline: "none" }} />
            </label>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
        <div onClick={busy ? undefined : run} style={{ height: 36, borderRadius: 5, background: "#f0cf8e", color: "#1a1409", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13.5, fontWeight: 500, cursor: busy ? "wait" : "pointer" }}>
          <span className="e-icon fill" style={{ fontSize: 19 }}>play_arrow</span>{busy ? "Running…" : "Run Robot"}
        </div>
        <div onClick={saveLive} title="Use these rules for the live robot too" style={{ ...BOX, height: 36, padding: "0 10px", display: "flex", alignItems: "center", fontSize: 11.5, cursor: "pointer" }}>Save to live</div>
      </div>
      {msg && <span style={{ fontSize: 11.5, color: "var(--e-text-2)" }}>{msg}</span>}

      {r && (
        <>
          <div style={{ ...BOX, padding: 8, display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <span>{r.closed} trades · win {r.winrate ?? "—"}% · <b style={{ color: r.total_r >= 0 ? UP : DOWN }}>{r.total_r >= 0 ? "+" : ""}{r.total_r}R</b>{r.open ? ` · ${r.open} open` : ""}</span>
            <span style={{ color: "var(--e-text-3)", fontSize: 11 }}>{r.bars} M1 bars · spread {fmt(r.spread)} paid · {r.skipped.length} signals skipped (a trade was open)</span>
          </div>
          <details>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--e-text-2)" }}>Why signals were rejected</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
              {Object.entries(r.funnel).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: k.startsWith("9") ? UP : "var(--e-text-2)" }}><span>{FUNNEL[k] ?? k}</span><span>{v}</span></div>
              ))}
            </div>
          </details>
          <span style={{ fontSize: 12 }}>Trades — click to show on the chart</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {r.trades.map((t: SetupTrade, k) => (
              <div key={k} onClick={() => onSelect(k, t.entry_time)} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 6, padding: "5px 4px", fontSize: 11.5, cursor: "pointer", borderTop: "1px solid var(--e-line-2)", background: selected === k ? "#2a2518" : "transparent" }}>
                <span style={{ color: "var(--e-text-3)" }}>#{k + 1}</span>
                <span><span style={{ color: t.direction === "buy" ? UP : DOWN }}>{t.direction.toUpperCase()}</span> {hhmm(t.entry_time)} · {fmt(t.entry)}<br />
                  <span style={{ color: "var(--e-text-3)" }}>SL {fmt(t.sl)} · TP {fmt(t.tp)} · {t.bars} bars · spread {Math.round(t.spread_r * 100)}% of risk</span></span>
                <b style={{ color: t.r == null ? "var(--e-text-2)" : t.r > 0 ? UP : DOWN }}>{t.r == null ? "open" : `${t.r > 0 ? "+" : ""}${t.r}R`}</b>
              </div>
            ))}
          </div>
        </>
      )}

      <span style={{ fontSize: 12, marginTop: 6 }}>Live suggestions ({live.length})</span>
      {live.length === 0 ? <span style={{ fontSize: 11, color: "var(--e-muted)" }}>None yet — they appear here and on Telegram when the market is open.</span> : live.slice(0, 30).map((x) => (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, borderTop: "1px solid var(--e-line-2)", padding: "4px 0", opacity: x.status === "dismissed" ? 0.5 : 1 }}>
          <span style={{ color: x.direction === "buy" ? UP : DOWN, width: 34 }}>{x.direction.toUpperCase()}</span>
          <span style={{ flex: 1 }}>{x.symbol} {hhmm(x.bar_time)}<br /><span style={{ color: "var(--e-text-3)" }}>{fmt(x.entry)} · SL {fmt(x.sl)} · TP {fmt(x.tp)}</span></span>
          <span onClick={() => { if (x.symbol !== symbol) onSymbol(x.symbol); onFocusTime(x.bar_time); }} style={btn("var(--e-gold)")}>Show</span>
          {x.status === "new" && <span onClick={() => journalApi.setupStatus(x.id, "dismissed").then(() => journalApi.setups().then(setLive))} style={btn("#8fa3ad")}>Skip</span>}
        </div>
      ))}
      <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>Entry = next candle's open (buys pay the spread). SL and TP inside one candle counts as SL. Times are MT4 server time. Suggestions only — the robot never places orders.</span>
    </>
  );
}
