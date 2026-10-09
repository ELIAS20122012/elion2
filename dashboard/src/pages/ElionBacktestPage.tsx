import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "../components/Chart";
import { t } from "../lib/i18n";
import DrawingProps from "../components/DrawingProps";
import DrawToolbar from "../components/DrawToolbar";
import { ElionSidebar, useElionClock } from "../components/ElionChrome";
import IndicatorsBar from "../components/IndicatorsBar";
import { equityCurve, net, summarize } from "../lib/analytics";
import { asJournalTrades, runBacktest, STRATEGIES, type BacktestResult, type SimConfig } from "../lib/backtest";
import { aggregate, fmtDateTime, TIMEFRAMES, type Candle, type Trade } from "../lib/data";
import { getSettings } from "../lib/elionSettings";
import { journalApi, type NewTrade, type SetupBacktest } from "../lib/journalApi";
import RobotBacktestPanel, { robotDrawings } from "../components/RobotBacktestPanel";
import { SPEEDS } from "../lib/useReplay";
import { SYMBOL, useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";

/**
 * Real backtesting on real candles. Data comes from the MT5 broker's own history (the journal server's
 * /accounts/{id}/candles, up to 50,000 bars) or from the dashboard's own feed. Manual Replay steps
 * through those candles and trades them with real SL/TP resolution; Setup Backtest runs the strategy
 * engine in lib/backtest.ts over the whole range; Results shows the maths on whichever trade set you pick.
 * Sessions can be saved as a "backtest" account so Journal and Analytics show them like any account.
 * Assumptions (same as the engine): fills at the candle close (+ spread on buys), SL wins when SL and TP
 * both fall inside one candle, times are the broker's clock.
 */

const TFS = [...TIMEFRAMES.filter((t) => t.sec <= 14400), { label: "D1", sec: 86400 }];
const BAR_COUNTS = [2000, 5000, 10000, 20000, 50000];
const UP = "var(--e-up-2)";
const DOWN = "var(--e-down-3)";
const CARD: React.CSSProperties = { borderRadius: 8, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const BOX: React.CSSProperties = { borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)" };
const INPUT: React.CSSProperties = { height: 30, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", color: "var(--e-text)", fontSize: 12, padding: "0 8px", outline: "none", width: "100%" };
const money = (v: number) => (v >= 0 ? "+$" : "−$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STRAT_TEXT: Record<string, { name: string; desc: string; params: Record<string, string> }> = {
  "level-continuation": {
    name: "Level Continuation — Main Setup",
    desc: "Your main setup (Rules → Playbook/Checklist) as exact rules: higher-timeframe trend (HH/HL or LL/LH) → level = last swing price closed beyond → pullback to the level → MACD hidden divergence → MACD/signal cross = entry (next open). SL beyond the pullback swing, TP by R:R, London/NY only. News filter can't be tested from candles. All numbers are assumptions you can change.",
    params: { rr: "Reward : Risk", htfMin: "Trend timeframe (min, 0 = off)", swingN: "Swing: candles each side", tol: "Pullback to level (× ATR)", crossWithin: "Cross within N candles", slBuf: "SL buffer (× ATR)", hidden: "Hidden divergence required (1/0)", session: "London/NY only (1/0)", buy: "Buy (1/0)", sell: "Sell (1/0)" },
  },
  "elias-divergence": {
    name: "My System — MACD Divergence",
    desc: "Your saved rule: regular MACD divergence (same detector and settings as the chart) + MACD/signal cross. Buy on low divergence, sell on high. Entry: open of the candle after the cross. SL: beyond the 2nd high/low + buffer. TP: Reward:Risk. Entry/SL/TP are assumptions until you define them — change them here.",
    params: { rr: "Reward : Risk", slBuf: "SL buffer (× ATR)", atrN: "ATR period", buy: "Buy on low divergence (1/0)", sell: "Sell on high divergence (1/0)" },
  },
  "ema-cross": {
    name: "EMA Cross (pipeline sample)",
    desc: "A technical sample that exercises the backtest pipeline. It is not your rule set — its results have no trading value.",
    params: { fast: "Fast EMA", slow: "Slow EMA", atrN: "ATR period", atrK: "ATR × for stop loss", rr: "Reward : Risk" },
  },
};

/* ---------- manual replay simulation (pure) ---------- */
interface Open { dir: "buy" | "sell"; entry: number; sl: number | null; tp: number | null; lots: number; time: number; note: string }
interface Sim { pos: number; open: Open | null; trades: NewTrade[] }
interface Costs { contract: number; spread: number; commission: number }

function settle(sim: Sim, o: Open, exit: number, time: number, k: Costs): Sim {
  const gross = (o.dir === "buy" ? exit - o.entry : o.entry - exit) * o.lots * k.contract;
  const commission = -k.commission * o.lots;
  const t: NewTrade = {
    ticket: `bt-${sim.trades.length + 1}`, symbol: SYMBOL, direction: o.dir, volume: o.lots, open_time: o.time, open_price: +o.entry.toFixed(2),
    close_time: time, close_price: +exit.toFixed(2), sl: o.sl, tp: o.tp, commission: +commission.toFixed(2), swap: 0, profit: +gross.toFixed(2), comment: o.note || "replay",
  };
  return { ...sim, open: null, trades: [...sim.trades, t] };
}

function advance(sim: Sim, c: Candle[], to: number, k: Costs): Sim {
  let s = sim;
  const end = Math.min(to, c.length - 1);
  for (let i = s.pos + 1; i <= end; i++) {
    s = { ...s, pos: i };
    const o = s.open;
    if (!o) continue;
    const buy = o.dir === "buy";
    const hitSl = o.sl != null && (buy ? c[i].low <= o.sl : c[i].high >= o.sl);
    const hitTp = o.tp != null && (buy ? c[i].high >= o.tp : c[i].low <= o.tp);
    if (hitSl || hitTp) s = settle(s, o, hitSl ? (o.sl as number) : (o.tp as number), c[i].time, k);
  }
  return s;
}

const toChartTrades = (list: NewTrade[]): Trade[] =>
  list.map((t) => ({
    ticket: t.ticket, symbol: t.symbol, direction: t.direction, volume: t.volume, open_time: t.open_time, open_price: t.open_price,
    close_time: t.close_time, close_price: t.close_price, stop_loss: t.sl ?? null, take_profit: t.tp ?? null, profit: t.profit + t.commission, status: "closed",
  }));

function rOf(t: NewTrade): number | null {
  if (t.sl == null || t.close_price == null) return null;
  const risk = Math.abs(t.open_price - t.sl);
  if (!risk) return null;
  return ((t.direction === "buy" ? t.close_price - t.open_price : t.open_price - t.close_price) / risk);
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>{label}</span>
      <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} style={INPUT} />
    </label>
  );
}

function Sel({ value, options, onChange }: { value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT, cursor: "pointer" }}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function EquitySvg({ pts, start }: { pts: { time: number; equity: number }[]; start: number }) {
  if (pts.length < 2) return <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--e-muted)", fontSize: 11.5 }}>Equity curve appears after 2 closed trades.</div>;
  const w = 300, h = 90;
  const vals = [start, ...pts.map((p) => p.equity)];
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const X = (i: number) => (i / (pts.length - 1)) * w;
  const Y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.equity).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1].equity >= start;
  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <line x1={0} x2={w} y1={Y(start)} y2={Y(start)} stroke="rgba(224,70,63,.5)" strokeDasharray="3 3" />
        <path d={`${line} L${w},${h} L0,${h} Z`} fill={up ? "rgba(60,207,178,.15)" : "rgba(224,70,63,.15)"} />
        <path d={line} fill="none" stroke={up ? "#3ccfb2" : "#e0463f"} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: "absolute", right: 4, top: 0, fontSize: 10.5, color: "var(--e-text-3)" }}>${max.toFixed(0)}</span>
      <span style={{ position: "absolute", right: 4, bottom: 0, fontSize: 10.5, color: "var(--e-text-3)" }}>${min.toFixed(0)}</span>
    </div>
  );
}

export default function ElionBacktestPage() {
  const clock = useElionClock();
  const app = useApp();
  const j = useJournal();
  const mt5 = j.accounts.filter((a) => a.platform === "mt5" && a.enabled);

  const [mode, setMode] = useState(0);
  const [srcKind, setSrcKind] = useState<"mt5" | "dash" | "mt4">("mt5");
  // ELION Robot on the MT4 history the EA streamed (server backtest, drawn on the chart)
  const [robotSym, setRobotSym] = useState(() => app.symbol || SYMBOL);
  const [robotSyms, setRobotSyms] = useState<{ symbol: string; bars: number }[]>([]);
  const [robotRes, setRobotRes] = useState<SetupBacktest | null>(null);
  const [robotSel, setRobotSel] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ time: number; nonce: number } | null>(null);
  const focusAt = (time: number) => setFocus({ time, nonce: Date.now() });
  useEffect(() => { if (srcKind === "mt4") journalApi.robotSymbols().then(setRobotSyms).catch(() => undefined); }, [srcKind]);
  const [acctId, setAcctId] = useState<number | null>(null);
  const [tfSec, setTfSec] = useState(300);
  const [count, setCount] = useState(5000);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [startPct, setStartPct] = useState(70);
  const [hideFuture, setHideFuture] = useState(true);
  const [pauseOnClose, setPauseOnClose] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(5);
  const [sim, setSim] = useState<Sim>({ pos: 0, open: null, trades: [] });

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [lots, setLots] = useState(() => String(getSettings().lot || "0.05"));
  const [slIn, setSlIn] = useState("");
  const [tpIn, setTpIn] = useState("");
  const [note, setNote] = useState("");

  const [balance, setBalance] = useState(1000);
  const [riskPct, setRiskPct] = useState(1);
  const [spread, setSpread] = useState(0.3);
  const [commission, setCommission] = useState(7);
  const [contract, setContract] = useState(100);

  const [sid, setSid] = useState(STRATEGIES[0].id);
  const [params, setParams] = useState<Record<string, number>>(() => Object.fromEntries(STRATEGIES.flatMap((s) => s.params.map((p) => [`${s.id}.${p.key}`, p.def]))));
  const [auto, setAuto] = useState<{ r: BacktestResult; label: string } | null>(null);
  const [view, setView] = useState<"manual" | "auto">("manual");

  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const toastT = useRef(0);
  const [saving, setSaving] = useState(false);
  const flash = (text: string, ok = true) => {
    window.clearTimeout(toastT.current);
    setToast({ ok, text });
    toastT.current = window.setTimeout(() => setToast(null), 4000);
  };

  const costs: Costs = { contract, spread, commission };
  const costsRef = useRef(costs);
  costsRef.current = costs;

  useEffect(() => { if (acctId == null && mt5.length > 0) setAcctId(mt5[0].id); }, [mt5.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- load candles ---- */
  useEffect(() => {
    let dead = false;
    setPlaying(false);
    const done = (c: Candle[]) => {
      if (dead) return;
      setCandles(c);
      setSim({ pos: Math.max(0, Math.floor((c.length - 1) * (startPct / 100))), open: null, trades: [] });
      setAuto(null); setView("manual"); setLoading(false);
    };
    if (srcKind === "mt4") {
      setLoading(true); setLoadErr(null);
      journalApi.robotCandles(robotSym, 20000)
        .then((r) => {
          const m1 = r.candles.map((c) => ({ ...c, time: c.time as Candle["time"], volume: c.volume ?? undefined }));
          if (m1.length === 0) setLoadErr(`No MT4 history for ${robotSym} yet — open it in the Trade page watchlist so the EA streams it.`);
          done(aggregate(m1, tfSec));
        })
        .catch((e: Error) => { if (!dead) { setLoadErr(e.message); setCandles([]); setLoading(false); } });
      return () => { dead = true; };
    }
    if (srcKind === "dash") {
      setLoadErr(null);
      done(aggregate(app.source.map((c) => ({ ...c })), tfSec));
      return () => { dead = true; };
    }
    if (acctId == null) { setCandles([]); setLoadErr(mt5.length === 0 ? "No connected MT5 account — add or connect one on the Connection page, or switch the data source." : null); return; }
    setLoading(true); setLoadErr(null);
    journalApi.candles(acctId, tfSec, count)
      .then((r) => done(r.candles.map(([time, open, high, low, close, volume]) => ({ time: time as Candle["time"], open, high, low, close, volume }))))
      .catch((e: Error) => { if (!dead) { setLoadErr(e.message); setCandles([]); setLoading(false); } });
    return () => { dead = true; };
  }, [srcKind, acctId, tfSec, count, reload, robotSym]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = candles.length - 1;
  const cur = candles[sim.pos];

  /* ---- playback ---- */
  useEffect(() => {
    if (!playing || candles.length === 0) return;
    const iv = window.setInterval(() => setSim((s) => (s.pos >= last ? s : advance(s, candles, s.pos + 1, costsRef.current))), Math.max(40, 900 / speed));
    return () => window.clearInterval(iv);
  }, [playing, speed, candles, last]);
  useEffect(() => { if (playing && sim.pos >= last && last > 0) setPlaying(false); }, [sim.pos, playing, last]);
  const tradeCount = useRef(0);
  useEffect(() => {
    if (sim.trades.length > tradeCount.current && pauseOnClose && playing) setPlaying(false);
    tradeCount.current = sim.trades.length;
  }, [sim.trades.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (n: number) => { setPlaying(false); setSim((s) => advance(s, candles, s.pos + n, costs)); };
  const startReplay = () => {
    if (candles.length < 2) return;
    if (sim.trades.length > 0 && !window.confirm(t("Restarting clears this session's replay trades. Continue?"))) return;
    setSim({ pos: Math.floor(last * (startPct / 100)), open: null, trades: [] });
    setView("manual"); setPlaying(true);
  };
  const scrub = (to: number) => { setPlaying(false); setSim((s) => (to > s.pos ? advance(s, candles, to, costs) : s)); };

  /* ---- manual trade ---- */
  const lotsN = Number(lots), slN = slIn.trim() ? Number(slIn) : null, tpN = tpIn.trim() ? Number(tpIn) : null;
  const buy = side === "buy";
  const entryPx = cur ? cur.close + (buy ? spread : 0) : null;
  const openTrade = () => {
    if (!cur || entryPx == null) return flash("No candle data loaded.", false);
    if (sim.open) return flash("A position is already open — close it first.", false);
    if (!(lotsN > 0)) return flash("Enter a lot size above 0.", false);
    if ((slN != null && !Number.isFinite(slN)) || (tpN != null && !Number.isFinite(tpN))) return flash("SL/TP must be numbers.", false);
    if (slN != null && (buy ? !(slN < entryPx) : !(slN > entryPx))) return flash(buy ? "Long needs the SL below the entry." : "Short needs the SL above the entry.", false);
    if (tpN != null && (buy ? !(tpN > entryPx) : !(tpN < entryPx))) return flash(buy ? "Long needs the TP above the entry." : "Short needs the TP below the entry.", false);
    setSim((s) => ({ ...s, open: { dir: side, entry: entryPx, sl: slN, tp: tpN, lots: lotsN, time: cur.time, note: note.trim() } }));
    setView("manual");
    flash(`${buy ? "Long" : "Short"} ${lotsN} opened @ ${entryPx.toFixed(2)}.`);
  };
  const closeNow = () => {
    if (!sim.open || !cur) return;
    setSim((s) => (s.open ? settle(s, s.open, cur.close, cur.time, costs) : s));
    setPlaying(false);
  };
  const floating = sim.open && cur ? (sim.open.dir === "buy" ? cur.close - sim.open.entry : sim.open.entry - cur.close) * sim.open.lots * contract : 0;

  /* ---- automated run ---- */
  const strat = STRATEGIES.find((s) => s.id === sid)!;
  const txt = STRAT_TEXT[sid];
  const pv = (k: string) => params[`${sid}.${k}`];
  const runAuto = () => {
    if (candles.length < 60) return flash("Need at least 60 candles.", false);
    const cfg: SimConfig = { symbol: SYMBOL, initialBalance: balance, riskPct, contractSize: contract, spread, commissionPerLot: commission };
    const r = runBacktest(candles, strat, Object.fromEntries(strat.params.map((p) => [p.key, pv(p.key)])), cfg);
    setAuto({ r, label: `${txt?.name ?? strat.name} · ${TFS.find((t) => t.sec === tfSec)?.label} · ${candles.length} bars` });
    setView("auto");
    flash(r.trades.length ? `${r.trades.length} trades simulated (${r.skipped} signals skipped while a trade was open).` : "No signals in this data.", r.trades.length > 0);
  };

  /* ---- results on the chosen set ---- */
  const activeTrades: NewTrade[] = view === "auto" && auto ? auto.r.trades : sim.trades;
  const jt = useMemo(() => asJournalTrades(activeTrades), [activeTrades]);
  const sum = useMemo(() => summarize(jt), [jt]);
  const curve = useMemo(() => equityCurve(jt, balance), [jt, balance]);
  const rs = activeTrades.map(rOf).filter((v): v is number => v != null);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  let streak = 0, lastWin = false;
  { const nets = jt.map(net); lastWin = nets.length ? nets[nets.length - 1] > 0 : false; for (let i = nets.length - 1; i >= 0 && (nets[i] > 0) === lastWin; i--) streak++; }
  const chartTrades = useMemo(() => {
    const list = toChartTrades(activeTrades);
    if (view === "manual" && sim.open) list.push({ ticket: "open", symbol: SYMBOL, direction: sim.open.dir, volume: sim.open.lots, open_time: sim.open.time, open_price: sim.open.entry, close_time: null, close_price: null, stop_loss: sim.open.sl, take_profit: sim.open.tp, profit: null, status: "open" });
    return list;
  }, [activeTrades, sim.open, view]);

  const saveAccount = async () => {
    if (activeTrades.length === 0) return flash("Nothing to save yet — no closed trades.", false);
    setSaving(true);
    try {
      const label = view === "auto" && auto ? auto.label : `Manual replay · ${TFS.find((t) => t.sec === tfSec)?.label}`;
      const acc = await journalApi.createAccount({ name: `Backtest — ${label}`.slice(0, 80), platform: "other", kind: "backtest", initial_balance: balance, note: `${candles.length} bars, spread ${spread}, commission ${commission}/lot` });
      await journalApi.addTrades(acc.id, activeTrades);
      await j.refreshAccounts();
      flash(`Saved as backtest account "${acc.name}" — view it in Journal / Analytics.`);
    } catch (e) {
      flash((e as Error).message, false);
    }
    setSaving(false);
  };

  const shown = useMemo(() => (mode === 3 || !hideFuture ? candles : candles.slice(0, sim.pos + 1)), [candles, hideFuture, sim.pos, mode]);
  const symShown = srcKind === "mt4" ? robotSym : SYMBOL;
  const digits = (v: number) => (v >= 500 ? 2 : v >= 20 ? 3 : 5);
  const prec = candles.length ? digits(candles[candles.length - 1].close) : 2;
  const fmtPx = (v: number) => v.toFixed(v < 1 ? 5 : prec);
  const chartDrawings = useMemo(() => (mode === 3 && robotRes?.symbol === robotSym ? [...app.drawings, ...robotDrawings(robotRes, tfSec, robotSel)] : app.drawings),
    [mode, robotRes, robotSym, tfSec, robotSel, app.drawings]);
  const openMode = (i: number) => {
    setMode(i);
    if (i === 3 && srcKind !== "mt4") { setSrcKind("mt4"); setTfSec(60); }
  };
  const range = candles.length ? `${fmtDateTime(candles[0].time)} → ${fmtDateTime(candles[last].time)}` : "—";
  const tfLabel = TFS.find((t) => t.sec === tfSec)?.label ?? "M5";
  const MODES: [string, string, string][] = [["monitoring", "Manual Replay", "Candle by candle practice"], ["photo_camera", "Setup Backtest", "Run a strategy on all bars"], ["settings", "Results & Insights", "Statistics and analysis"], ["smart_toy", "ELION Robot", "Robot on MT4 history"]];
  const canSave = activeTrades.length > 0 && j.status === "ok";

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Backtest" />

      <main style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 30, height: 52 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".5em", color: "var(--e-gold)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 14 }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: candles.length ? "var(--e-up)" : "var(--e-muted)", boxShadow: candles.length ? "0 0 6px var(--e-up)" : "none" }} />
              {loading ? "Loading candles…" : candles.length ? `${candles.length.toLocaleString()} ${tfLabel} candles loaded` : "No data"}
            </div>
            <div style={{ color: "var(--e-text-2)", fontSize: 11 }}>{clock}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 15 }}>EF</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Elias Farahani</div>
              <div style={{ fontSize: 11, color: "var(--e-text-2)" }}>Trader | Build the Edge</div>
            </div>
          </div>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 296, display: "flex", flexDirection: "column", gap: 7, paddingLeft: 6 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, letterSpacing: ".18em", color: "var(--e-ivory)", lineHeight: 1 }}>BACKTEST</div>
            <div style={{ fontSize: 13, letterSpacing: ".22em" }}>PRACTICE. RESEARCH. IMPROVE.</div>
          </div>
          {MODES.map(([icon, title, sub], i) => {
            const a = i === mode;
            return (
              <div key={title} onClick={() => openMode(i)} style={{ width: 236, height: 50, boxSizing: "border-box", borderRadius: 6, border: `1px solid ${a ? "rgba(233,215,176,.6)" : "var(--e-line)"}`, background: a ? "linear-gradient(90deg,#2a2618,#171a15)" : "var(--e-panel-2)", display: "flex", alignItems: "center", gap: 14, padding: "0 16px", cursor: "pointer" }}>
                <span className="e-icon" style={{ width: 32, height: 32, borderRadius: 6, background: a ? "#3a3320" : "transparent", display: "grid", placeItems: "center", fontSize: 20, color: "var(--e-gold)" }}>{icon}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 13, color: a ? "var(--e-ivory)" : "var(--e-text)" }}>{title}</span>
                  <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>{sub}</span>
                </div>
              </div>
            );
          })}
          <div style={{ flex: 1 }} />
          <div onClick={canSave && !saving ? saveAccount : undefined} title="Saves the trades in view as a 'backtest' account that Journal and Analytics can open" style={{ height: 38, padding: "0 14px", borderRadius: 6, border: "1px solid rgba(233,215,176,.6)", background: "#1c1b13", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--e-ivory)", cursor: canSave && !saving ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.5 }}>
            <span className="e-icon" style={{ fontSize: 18 }}>save</span>{saving ? "Saving…" : "Save as Backtest Account"}
          </div>
        </div>

        {/* ---- workspace ---- */}
        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "276px minmax(0,1fr) 292px", gap: 14, minHeight: 560 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}>
            <div style={{ ...CARD, padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 15 }}>1.  Select Data</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>Data source</span>
                <Sel value={srcKind} onChange={(v) => setSrcKind(v as "mt5" | "dash" | "mt4")} options={[{ v: "mt4", l: "MT4 history (robot feed)" }, { v: "mt5", l: "MT5 broker history" }, { v: "dash", l: "Dashboard feed (short)" }]} />
              </div>
              {srcKind === "mt5" && mt5.length > 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>MT5 account</span>
                  <Sel value={String(acctId ?? "")} onChange={(v) => setAcctId(Number(v))} options={mt5.map((a) => ({ v: String(a.id), l: a.name }))} />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>Symbol</span>
                  {srcKind === "mt4" ? (
                    <Sel value={robotSym} onChange={(v) => { setRobotSym(v); setRobotRes(null); setRobotSel(null); }} options={(robotSyms.some((s) => s.symbol === robotSym) ? robotSyms : [{ symbol: robotSym, bars: 0 }, ...robotSyms]).map((s) => ({ v: s.symbol, l: s.symbol }))} />
                  ) : <div style={{ ...BOX, height: 30, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 12 }}>{SYMBOL}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>Timeframe</span>
                  <Sel value={String(tfSec)} onChange={(v) => setTfSec(Number(v))} options={TFS.map((t) => ({ v: String(t.sec), l: t.label }))} />
                </div>
              </div>
              {srcKind === "mt5" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>Bars to load (latest)</span>
                  <Sel value={String(count)} onChange={(v) => setCount(Number(v))} options={BAR_COUNTS.map((n) => ({ v: String(n), l: `${n.toLocaleString()} bars` }))} />
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--e-text-2)", lineHeight: 1.5 }}>Range (broker time)<br />{range}</div>
              {loadErr && <div style={{ fontSize: 11.5, color: "#f3b5ae" }} dir="auto">{loadErr} <span onClick={() => setReload((n) => n + 1)} style={{ color: "var(--e-gold)", cursor: "pointer" }}>Retry</span></div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>Start replay at {startPct}% of the range</span>
                <input type="range" min={5} max={95} value={startPct} onChange={(e) => setStartPct(Number(e.target.value))} style={{ accentColor: "var(--e-gold)" }} />
              </div>
              <div onClick={() => setHideFuture((x) => !x)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12 }}>Hide Future Candles</div>
                  <div style={{ fontSize: 11, color: "var(--e-text-2)", marginTop: 2 }}>Only show candles up to the current bar</div>
                </div>
                <div style={{ width: 38, height: 22, borderRadius: 11, background: hideFuture ? "#3ccfb2" : "var(--e-border-2)", position: "relative" }}>
                  <div style={{ position: "absolute", top: 2, left: hideFuture ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                </div>
              </div>
              <div onClick={startReplay} style={{ height: 40, borderRadius: 5, background: candles.length ? "#f0cf8e" : "var(--e-panel-2)", color: candles.length ? "#1a1409" : "var(--e-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 14, fontWeight: 500, cursor: candles.length ? "pointer" : "not-allowed" }}>
                <span className="e-icon fill" style={{ fontSize: 22 }}>play_arrow</span>Start Replay
              </div>
            </div>

            <div style={{ ...CARD, padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 15 }}>2.  Simulation Costs</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Num label="Start balance ($)" value={balance} onChange={setBalance} />
                <Num label="Risk per trade (%)" value={riskPct} step={0.1} onChange={setRiskPct} />
                <Num label="Spread (price)" value={spread} step={0.05} onChange={setSpread} />
                <Num label="Commission / lot ($)" value={commission} step={0.5} onChange={setCommission} />
                <Num label="Contract (units/lot)" value={contract} onChange={setContract} />
              </div>
              <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>Spread is paid on long entries; commission per lot on every trade. Risk % is used by the automated run.</span>
            </div>
          </div>

          {/* chart */}
          <div style={{ borderRadius: 8, border: "1px solid var(--e-line)", background: "#0a1417", display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div style={{ height: 40, display: "flex", alignItems: "center", gap: 10, padding: "0 10px", borderBottom: "1px solid var(--e-line-3)", fontSize: 12.5 }}>
              <span style={{ fontSize: 14 }}>{symShown} · {tfLabel}</span>
              {cur && (
                <span style={{ color: "var(--e-text-2)" }}>
                  Replay: {fmtDateTime(cur.time)} · O {cur.open.toFixed(2)} H {cur.high.toFixed(2)} L {cur.low.toFixed(2)} C <span style={{ color: cur.close >= cur.open ? "#3ec495" : "#ef5a50" }}>{cur.close.toFixed(2)}</span>
                </span>
              )}
              <div style={{ flex: 1 }} />
              {view === "auto" && auto && <span style={{ color: "var(--e-gold)", fontSize: 11.5 }}>Showing automated run markers</span>}
            </div>
            <IndicatorsBar items={app.indicators} onChange={app.setIndicators} volume={app.showVolume} hasVolume={candles[0]?.volume != null} onVolume={() => app.setShowVolume((v) => !v)} />
            <div className="chart-area" style={{ flex: 1, minHeight: 0, position: "relative" }}>
              {app.selected && (
                <DrawingProps drawing={app.selected} onChange={(p) => app.updateDrawing(app.selected!.id, p)} onDuplicate={() => app.duplicateDrawing(app.selected!.id)} onDelete={() => app.removeDrawing(app.selected!.id)} />
              )}
              <DrawToolbar
                tool={app.tool} onTool={app.setTool} magnet={app.magnet} onMagnet={() => app.setMagnet((m) => !m)} color={app.color} onColor={app.setColor}
                hasSelection={!!app.selectedId} count={app.drawings.length} onDeleteSelected={() => app.selectedId && app.removeDrawing(app.selectedId)}
                onUndo={() => app.setDrawings((d) => d.slice(0, -1))} onClear={() => { if (window.confirm(t("Clear all drawings?"))) app.setDrawings([]); }}
              />
              {shown.length === 0 ? (
                <div className="loading">{loading ? "Loading candles…" : loadErr ? "No data — see the message on the left." : "No candles."}</div>
              ) : (
                <Chart
                  candles={shown} tfSec={tfSec} trades={mode === 3 ? [] : chartTrades} showTrades={mode !== 3} overlay={app.overlay} shift={false} indicators={app.indicators} drawings={chartDrawings}
                  focus={focus} precision={prec}
                  tool={app.tool} magnet={app.magnet} color={app.color} selectedId={app.selectedId}
                  onAdd={(d) => app.setDrawings((l) => [...l, d])} onSelect={app.setSelectedId} onDelete={app.removeDrawing} onTool={app.setTool}
                  onUpdate={app.updateDrawing} onDuplicate={app.duplicateDrawing} onClearDrawings={() => app.setDrawings([])} showVolume={app.showVolume}
                />
              )}
            </div>
          </div>

          {/* right column */}
          <div style={{ ...CARD, padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 9, minHeight: 0, overflow: "auto" }}>
            {mode === 0 && (
              <>
                <span style={{ fontSize: 15 }}>Current Trade (Replay)</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div onClick={() => setSide("buy")} style={{ height: 34, borderRadius: 4, display: "grid", placeItems: "center", fontSize: 13, cursor: "pointer", background: buy ? "#0f3a33" : "var(--e-panel-2)", border: `1px solid ${buy ? "#3ccfb2" : "var(--e-border)"}`, color: buy ? "#bff3e6" : "var(--e-text)" }}>Long</div>
                  <div onClick={() => setSide("sell")} style={{ height: 34, borderRadius: 4, display: "grid", placeItems: "center", fontSize: 13, cursor: "pointer", background: !buy ? "#3a1614" : "var(--e-panel-2)", border: `1px solid ${!buy ? "#e0463f" : "var(--e-border)"}`, color: !buy ? "#f7c6c1" : "var(--e-text)" }}>Short</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "86px 1fr", gap: "8px 6px", alignItems: "center" }}>
                  <span style={{ fontSize: 12 }}>Entry</span>
                  <div style={{ ...BOX, height: 30, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 12 }}>{entryPx != null ? `${entryPx.toFixed(2)} (market)` : "—"}</div>
                  <span style={{ fontSize: 12 }}>Stop Loss</span>
                  <input value={slIn} onChange={(e) => setSlIn(e.target.value)} placeholder="optional" style={INPUT} />
                  <span style={{ fontSize: 12 }}>Take Profit</span>
                  <input value={tpIn} onChange={(e) => setTpIn(e.target.value)} placeholder="optional" style={INPUT} />
                  <span style={{ fontSize: 12 }}>Lot size</span>
                  <input value={lots} onChange={(e) => setLots(e.target.value)} style={INPUT} />
                </div>
                {entryPx != null && slN != null && tpN != null && Number.isFinite(slN) && Number.isFinite(tpN) && Math.abs(entryPx - slN) > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--e-text-2)" }}>R:R 1:{(Math.abs(tpN - entryPx) / Math.abs(entryPx - slN)).toFixed(1)}</div>
                )}
                {sim.open ? (
                  <>
                    <div style={{ ...BOX, padding: 10, display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
                      <span>{sim.open.dir === "buy" ? "Long" : "Short"} {sim.open.lots} @ {sim.open.entry.toFixed(2)}</span>
                      <span style={{ color: floating >= 0 ? UP : DOWN }}>Floating {money(floating)}</span>
                      <span style={{ color: "var(--e-text-2)" }}>SL {sim.open.sl ?? "—"} · TP {sim.open.tp ?? "—"}</span>
                    </div>
                    <div onClick={closeNow} style={{ height: 34, borderRadius: 4, border: "1px solid #8a2a26", background: "#3a1614", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer" }}>Close at market</div>
                  </>
                ) : (
                  <div onClick={openTrade} style={{ height: 34, borderRadius: 4, border: "1px solid rgba(233,215,176,.7)", background: "#16170f", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--e-ivory)", cursor: cur ? "pointer" : "not-allowed" }}>
                    <span className="e-icon" style={{ fontSize: 18 }}>add</span>Open Trade
                  </div>
                )}
                <span style={{ fontSize: 13 }}>Trade note</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Reasoning (saved with the trade)…" style={{ ...BOX, minHeight: 60, flex: 1, resize: "none", color: "var(--e-text)", fontSize: 11.5, padding: 8, outline: "none" }} />
                <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>Step or play the replay: the open position closes by itself when a later candle touches its SL or TP.</span>
              </>
            )}

            {mode === 1 && (
              <>
                <span style={{ fontSize: 15 }}>Strategy</span>
                <Sel value={sid} onChange={setSid} options={STRATEGIES.map((s) => ({ v: s.id, l: STRAT_TEXT[s.id]?.name ?? s.name }))} />
                <span style={{ fontSize: 11, color: "var(--e-text-2)", lineHeight: 1.5 }}>{txt?.desc ?? strat.description}</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {strat.params.map((p) => (
                    <Num key={p.key} label={txt?.params[p.key] ?? p.label} value={pv(p.key)} step={p.step ?? 1} onChange={(v) => setParams((o) => ({ ...o, [`${sid}.${p.key}`]: v }))} />
                  ))}
                </div>
                <div onClick={runAuto} style={{ height: 38, borderRadius: 5, background: candles.length >= 60 ? "#f0cf8e" : "var(--e-panel-2)", color: candles.length >= 60 ? "#1a1409" : "var(--e-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 14, fontWeight: 500, cursor: candles.length >= 60 ? "pointer" : "not-allowed" }}>
                  <span className="e-icon fill" style={{ fontSize: 20 }}>play_arrow</span>Run Backtest
                </div>
                {auto && <div style={{ fontSize: 11.5, color: "var(--e-text-2)", lineHeight: 1.5 }}>Last run: {auto.r.trades.length} trades from {auto.r.signals} signals ({auto.r.skipped} skipped). End balance ${auto.r.endBalance.toFixed(2)}.</div>}
                <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>Entries at the next candle's open (+ spread on buys). Costs and risk come from the panel on the left. Short history means the result only compares setups — it doesn't prove profitability.</span>
              </>
            )}

            {mode === 3 && (
              <RobotBacktestPanel
                symbol={robotSym} symbols={robotSyms} onSymbol={(v) => { setRobotSym(v); setRobotRes(null); setRobotSel(null); }}
                result={robotRes} onResult={(r) => { setRobotRes(r); setRobotSel(null); }}
                selected={robotSel} onSelect={(k, time) => { setRobotSel(k); focusAt(time); }} onFocusTime={focusAt} fmt={fmtPx}
              />
            )}

            {mode === 2 && (
              <>
                <span style={{ fontSize: 15 }}>Insights</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["manual", "auto"] as const).map((v) => (
                    <div key={v} onClick={() => setView(v)} style={{ flex: 1, height: 30, borderRadius: 4, display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer", border: `1px solid ${view === v ? "rgba(233,215,176,.6)" : "var(--e-border)"}`, background: view === v ? "#2a2518" : "var(--e-panel-2)", color: view === v ? "var(--e-ivory)" : "var(--e-text)" }}>{v === "manual" ? `Manual (${sim.trades.length})` : `Automated (${auto?.r.trades.length ?? 0})`}</div>
                  ))}
                </div>
                {sum.count === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--e-muted)", lineHeight: 1.5 }}>No closed trades in this set yet — replay some trades or run a strategy.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                    {([
                      ["Best trade", money(sum.bestTrade), UP], ["Worst trade", money(sum.worstTrade), DOWN],
                      ["Average win", money(sum.avgWin), UP], ["Average loss", money(-Math.abs(sum.avgLoss)), DOWN],
                      ["Payoff (avg win / avg loss)", sum.payoff != null ? sum.payoff.toFixed(2) : "—", undefined],
                      ["Longest win streak", String(sum.maxWinStreak), undefined], ["Longest losing streak", String(sum.maxLossStreak), undefined],
                      ["Average hold", `${Math.round(sum.avgDurationSec / 60)} min`, undefined],
                      ["Commission paid", money(sum.commission), undefined],
                    ] as [string, string, string | undefined][]).map(([l, v, c]) => (
                      <div key={l} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--e-line-2)", paddingTop: 6 }}>
                        <span style={{ color: "var(--e-text-2)" }}>{l}</span><span style={{ color: c }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {toast && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: toast.ok ? "#0f2a26" : "#2a1414", border: `1px solid ${toast.ok ? "#2c7a5f" : "#8a2a26"}`, fontSize: 12.5 }} dir="auto">{toast.text}</div>
        )}

        {/* ---- bottom row ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "246fr 416fr 408fr 312fr", gap: 14, height: 250 }}>
          <div style={{ ...CARD, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ fontSize: 15 }}>Replay Controls</div>
            <div style={{ display: "grid", gridTemplateColumns: "44px 64px 44px 44px", justifyContent: "space-between" }}>
              {([
                ["fast_rewind", () => { setPlaying(false); setSim((s) => ({ ...s, pos: Math.floor(last * (startPct / 100)), open: null })); }, false, "Back to the start position (drops the open position)"],
                [playing ? "pause" : "play_arrow", () => (sim.pos >= last ? undefined : setPlaying((p) => !p)), true, playing ? "Pause" : "Play"],
                ["fast_forward", () => step(1), false, "Next candle"],
                ["skip_next", () => step(10), false, "+10 candles"],
              ] as [string, () => void, boolean, string][]).map(([ic, fn, main, tip], i) => (
                <div key={i} title={tip} onClick={fn} style={{ height: 42, borderRadius: 5, border: `1px solid ${main ? "rgba(233,215,176,.6)" : "var(--e-border-2)"}`, background: main ? "#1a1d17" : "var(--e-panel-2)", display: "grid", placeItems: "center", cursor: "pointer" }}>
                  <span className="e-icon fill" style={{ fontSize: main ? 30 : 22 }}>{ic}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="range" min={0} max={SPEEDS.length - 1} step={1} value={Math.max(0, SPEEDS.indexOf(speed as (typeof SPEEDS)[number]))} onChange={(e) => setSpeed(SPEEDS[Number(e.target.value)])} style={{ flex: 1, accentColor: "var(--e-gold)", cursor: "pointer" }} />
              <span style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>Speed: {speed}x</span>
            </div>
            <div onClick={() => setPauseOnClose((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, cursor: "pointer" }}>
              <span style={{ width: 16, height: 16, borderRadius: 3, boxSizing: "border-box", border: `1.5px solid ${pauseOnClose ? "#3ccfb2" : "var(--e-muted)"}`, background: pauseOnClose ? "#3ccfb2" : "transparent", display: "grid", placeItems: "center" }}>
                <span className="e-icon" style={{ fontSize: 14, color: "#081013", opacity: pauseOnClose ? 1 : 0 }}>check</span>
              </span>Pause when a trade closes
            </div>
            <input type="range" min={0} max={Math.max(0, last)} value={sim.pos} onChange={(e) => scrub(Number(e.target.value))} style={{ accentColor: "var(--e-gold)", cursor: "pointer" }} title="Drag forward to jump ahead (open positions are resolved candle by candle)" />
          </div>

          <div style={{ ...CARD, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ fontSize: 15 }}>{view === "auto" ? "Automated Run" : "Session Progress"}</div>
            <div style={{ display: "grid", gridTemplateColumns: ".9fr .9fr 1.2fr 1.2fr", gap: 6 }}>
              {([
                ["Trades", String(sum.count), undefined],
                ["Win Rate", sum.count ? `${(sum.winRate * 100).toFixed(1)}%` : "—", undefined],
                ["Current Streak", sum.count ? `${streak} ${lastWin ? "Win" : "Loss"}` : "—", sum.count ? (lastWin ? UP : DOWN) : undefined],
                ["Net P&L", sum.count ? money(sum.net) : "—", sum.net >= 0 ? UP : DOWN],
              ] as [string, string, string | undefined][]).map(([l, v, col]) => (
                <div key={l} style={{ height: 58, borderRadius: 5, border: "1px solid var(--e-line)", background: "var(--e-panel-2)", padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: "var(--e-text-3)" }}>{l}</span>
                  <span style={{ fontSize: 15, color: col }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "#1b2a2e", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${last > 0 ? (sim.pos / last) * 100 : 0}%`, borderRadius: 4, background: UP }} />
              </div>
              <span style={{ fontSize: 12 }}>{`${sim.pos.toLocaleString()} / ${Math.max(0, last).toLocaleString()} candles`}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--e-text-2)" }}>
              {sim.open ? `Open: ${sim.open.dir === "buy" ? "Long" : "Short"} ${sim.open.lots} — floating ${money(floating)}` : "No open position."}
              {cur && ` · Replay time ${fmtDateTime(cur.time)}`}
            </div>
          </div>

          <div style={{ ...CARD, padding: "14px 12px 8px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 15 }}>Quick Stats ({view === "auto" ? "Automated" : "Manual"})</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
              {([
                ["Avg. R", avgR != null ? `${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R` : "—", undefined],
                ["Expectancy", sum.count ? money(sum.expectancy) : "—", sum.expectancy >= 0 ? UP : DOWN],
                ["Max Drawdown", sum.count ? money(-sum.maxDrawdown) : "—", sum.count ? DOWN : undefined],
                ["Profit Factor", sum.profitFactor != null ? sum.profitFactor.toFixed(2) : "—", undefined],
              ] as [string, string, string | undefined][]).map(([l, v, col]) => (
                <div key={l} style={{ height: 54, borderRadius: 5, border: "1px solid var(--e-line)", background: "var(--e-panel-2)", padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--e-text-3)" }}>{l}</span>
                  <span style={{ fontSize: 14, color: col }}>{v}</span>
                </div>
              ))}
            </div>
            <EquitySvg pts={curve} start={balance} />
          </div>

          <div style={{ ...CARD, padding: "14px 10px 10px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 15, marginBottom: 8 }}>Recent Trades</div>
            <div style={{ display: "grid", gridTemplateColumns: "34px 1fr 1fr 1fr .7fr", fontSize: 11, padding: "0 2px 4px" }}>
              <span>#</span><span>Entry</span><span>Exit</span><span>P&amp;L</span><span style={{ textAlign: "center" }}>Result</span>
            </div>
            {activeTrades.length === 0 && <div style={{ fontSize: 11.5, color: "var(--e-muted)", padding: "8px 2px" }}>No closed trades yet.</div>}
            {activeTrades.slice(-5).reverse().map((t) => {
              const p = t.profit + t.commission, w = p > 0;
              return (
                <div key={t.ticket} style={{ flex: 1, display: "grid", gridTemplateColumns: "34px 1fr 1fr 1fr .7fr", alignItems: "center", fontSize: 11, padding: "0 2px", borderTop: "1px solid var(--e-line-2)" }}>
                  <span>{t.ticket.replace("bt-", "")}</span><span>{t.open_price.toFixed(2)}</span><span>{t.close_price?.toFixed(2) ?? "—"}</span>
                  <span style={{ color: w ? UP : DOWN }}>{money(p)}</span>
                  <span style={{ textAlign: "center", color: w ? UP : DOWN }}>{t.direction === "buy" ? "L" : "S"} {w ? "✓" : "✕"}</span>
                </div>
              );
            })}
            <a href="#/journal" style={{ height: 30, marginTop: 6, borderRadius: 4, border: "1px solid var(--e-border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "var(--e-text)" }}>
              Open Journal<span className="e-icon" style={{ fontSize: 16 }}>arrow_forward</span>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

