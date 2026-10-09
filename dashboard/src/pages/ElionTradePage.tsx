import { useEffect, useMemo, useRef, useState } from "react";
import Chart, { type Level } from "../components/Chart";
import { t } from "../lib/i18n";
import DrawingProps from "../components/DrawingProps";
import DrawToolbar from "../components/DrawToolbar";
import { ElionSidebar, useElionClock } from "../components/ElionChrome";
import ElionNews from "../components/ElionNews";
import Icon from "../components/Icon";
import IndicatorsBar from "../components/IndicatorsBar";
import TradingViewWidget from "../components/TradingViewWidget";
import { isClosed, net } from "../lib/analytics";
import { TIMEFRAMES, type Trade } from "../lib/data";
import { beep, getSettings, useSettings } from "../lib/elionSettings";
import { journalApi, type LivePending, type LivePosition, type LivePositions, type PriceAlert } from "../lib/journalApi";
/** Level Continuation checklist (Rules → Checklist). Every item must be ticked before an order can be sent. */
const CHECKLIST: { title: string; hint: string }[] = [
  { title: "Higher timeframe trend confirmed", hint: "H4/H1: HH/HL for buys, LL/LH for sells" },
  { title: "Valid level identified", hint: "Level from previous structure (M15)" },
  { title: "Price shows pullback to level", hint: "Pullback reached the level zone" },
  { title: "MACD confirmation (hidden divergence)", hint: "MACD 12/26/9, signal SMA 9" },
  { title: "No major news (±15 min)", hint: "Check the calendar" },
  { title: "Risk/Reward acceptable", hint: "TP set by R:R from the SL" },
  { title: "SL below/above last swing", hint: "Stop behind the pullback swing" },
  { title: "Clear entry confirmation on M5/M1", hint: "MACD crosses its signal in trade direction" },
];
import { sessionsNow } from "../lib/sessions";
import { SPEEDS } from "../lib/useReplay";
import { useApp } from "../state/AppContext";
import { useAllAccounts } from "../state/useAllAccounts";
import { useJournal } from "../state/JournalContext";
import { useLiveAccount } from "../state/useLiveAccount";

/**
 * Ported from design/elion/trade.dc.html (reference design). The chart itself is the app's real chart —
 * same <Chart>/<DrawToolbar>/<IndicatorsBar>/<TradingViewWidget> components the Persian /chart page uses,
 * with real drawing tools, indicators and a live/TradingView toggle — not a redrawn mock. Its toolbar
 * still renders in the app's base (Cherish) colors rather than Elion's gold, since re-skinning it is a
 * separate follow-up. Layout (Oct 2026): one-line market strip, watchlist · chart · order ticket, and a tabbed
 * bottom table (positions, pending, today, news, market) — the old card grid was too busy. The strip and footer are wired to the real feed and
 * journal. A few things the reference showed as if they were live data — support/resistance levels, a
 * multi-timeframe bias read, an economic news calendar — have no real detection/feed behind them in this
 * app, so rather than show made-up numbers on a live price chart, those panels say plainly that nothing
 * is connected. "Place Order" sends a real market order (MetaTrader5 order_send) to whichever MT5
 * account is picked in the panel — including live accounts, with no confirmation step or size/SL cap,
 * by explicit request.
 */

const UP = "var(--e-up)";
const DOWN = "var(--e-down-3)";
const TF_OPTIONS: { label: string; sec: number }[] = [...TIMEFRAMES, { label: "D1", sec: 86400 }];
const TV_INTERVAL: Record<number, string> = { 60: "1", 300: "5", 900: "15", 1800: "30", 3600: "60", 14400: "240", 86400: "D" };

/** real UTC session clock: minutes until the active session ends, or the next one opens */
function sessionCountdown(): { label: string; mins: number } {
  const list = sessionsNow();
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const active = list.find((s) => s.status === "Active");
  if (active) {
    const endH = Number(active.hours.split(" - ")[1].split(":")[0]);
    let diff = endH - h; if (diff < 0) diff += 24;
    return { label: `${active.name} closes in`, mins: Math.round(diff * 60) };
  }
  const next = list.find((s) => s.status === "Upcoming") ?? list[0];
  const startH = Number(next.hours.split(" - ")[0].split(":")[0]);
  let diff = startH - h; if (diff < 0) diff += 24;
  return { label: `${next.name} opens in`, mins: Math.round(diff * 60) };
}

const pnlStr = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);

const CARD: React.CSSProperties = { borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const FIELD: React.CSSProperties = { borderRadius: 6, border: "1px solid var(--e-border)", background: "var(--e-panel-2)" };
const pad2 = (n: number) => String(n).padStart(2, "0");

function Tabs({ list, cur, onPick, on, off, style }: {
  list: string[]; cur: string; onPick: (l: string) => void;
  on: React.CSSProperties; off: React.CSSProperties; style: React.CSSProperties;
}) {
  return (
    <>
      {list.map((l) => (
        <div key={l} onClick={() => onPick(l)} style={{ ...style, cursor: "pointer", ...(l === cur ? on : off) }}>{l}</div>
      ))}
    </>
  );
}

export default function ElionTradePage() {
  const clock = useElionClock();
  const app = useApp();
  const j = useJournal();
  const myLive = useLiveAccount(j.accounts, j.status === "ok");
  const acctRows = useAllAccounts(j.accounts, j.status === "ok", 8000);

  const [view, setView] = useState<"bot" | "tv">("bot");
  const [side, setSide] = useState("SELL");
  const [cfg, setCfg] = useSettings();
  const [lot, setLot] = useState(() => Math.max(0.01, Number(getSettings().lot) || 0.05));
  const [risk, setRisk] = useState(() => Math.max(0.1, Number(getSettings().risk) || 1.0));
  const [slInput, setSlInput] = useState("");
  const [tpInput, setTpInput] = useState("");
  const [orderAccountId, setOrderAccountId] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderMsg, setOrderMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [entryInput, setEntryInput] = useState("");
  const [bottomTab, setBottomTab] = useState("Positions");
  const [showChecklist, setShowChecklist] = useState(false);
  const [showWatch, setShowWatch] = useState(() => { try { return localStorage.getItem("elion.trade.watch") !== "0"; } catch { return true; } });
  const [closeAllAsk, setCloseAllAsk] = useState(false);
  // bottom panel (positions / pending / today / news / market): open-closed + height, remembered
  const [bottomOpen, setBottomOpen] = useState(() => { try { return localStorage.getItem("elion.trade.bottom") !== "0"; } catch { return true; } });
  const [bottomH, setBottomH] = useState(() => { try { return Math.min(600, Math.max(140, Number(localStorage.getItem("elion.trade.bottomH")) || 236)); } catch { return 236; } });
  const setBottom = (open: boolean) => { setBottomOpen(open); try { localStorage.setItem("elion.trade.bottom", open ? "1" : "0"); } catch { /* private mode */ } };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = bottomOpen ? bottomH : 40;
    let last = h0;
    const move = (ev: PointerEvent) => {
      last = Math.min(600, Math.max(40, h0 + (y0 - ev.clientY)));
      if (last < 100) { setBottomOpen(false); } else { setBottomOpen(true); setBottomH(last); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { localStorage.setItem("elion.trade.bottom", last < 100 ? "0" : "1"); if (last >= 100) localStorage.setItem("elion.trade.bottomH", String(Math.round(last))); } catch { /* private mode */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [checks, setChecks] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const checklistDone = checks.every(Boolean);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const chartPanelRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const iv = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === chartPanelRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // works for both chart views (MT5 and TradingView) since it fullscreens the whole panel, not the canvas
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else chartPanelRef.current?.requestFullscreen();
  };

  const { last, change, source, tfSec, setTfSec, all } = app;
  const sym = app.symbol;
  const tf = TF_OPTIONS.find((o) => o.sec === tfSec)?.label ?? "M5";
  const bullish = change >= 0;

  // real positions: every connected account's own trades while live, the recorded ones while replaying —
  // same source ChartPage.tsx uses for its candlestick markers.
  const liveRows = useAllAccounts(j.accounts, j.status === "ok" && app.mode === "live", 4000);
  const chartTrades = useMemo<Trade[]>(
    () =>
      app.mode === "live"
        ? liveRows
            .filter((r) => r.account.kind !== "backtest")
            .flatMap((r) => r.trades)
            .filter((t) => t.symbol === sym)
            .map((t) => ({
              ticket: t.ticket, symbol: t.symbol, direction: t.direction, volume: t.volume,
              open_time: t.open_time, open_price: t.open_price, close_time: t.close_time, close_price: t.close_price,
              stop_loss: t.sl, take_profit: t.tp, profit: +(t.profit + t.commission + t.swap).toFixed(2), status: t.close_time ? "closed" : "open",
            }))
        : app.trades,
    [app.mode, liveRows, app.trades, sym],
  );

  const today = last ? Math.floor(last.time / 86400) : Math.floor(Date.now() / 86400000);
  const dayCandles = source.filter((c) => Math.floor(c.time / 86400) === today);
  const dayHigh = dayCandles.length ? Math.max(...dayCandles.map((c) => c.high)) : null;
  const dayLow = dayCandles.length ? Math.min(...dayCandles.map((c) => c.low)) : null;
  const adr14 = useMemo(() => {
    const byDay = new Map<number, { hi: number; lo: number }>();
    for (const c of all) {
      const d = Math.floor(c.time / 86400);
      const cur = byDay.get(d);
      if (!cur) byDay.set(d, { hi: c.high, lo: c.low });
      else { cur.hi = Math.max(cur.hi, c.high); cur.lo = Math.min(cur.lo, c.low); }
    }
    const days = [...byDay.entries()].sort((a, b) => b[0] - a[0]).slice(1, 15); // skip today (still forming)
    if (!days.length) return null;
    return days.reduce((s, [, v]) => s + (v.hi - v.lo), 0) / days.length;
  }, [all]);


  const closeInfo = sessionCountdown();
  const activeSessName = sessionsNow().find((s) => s.status === "Active")?.name ?? null;
  const sel = side === "SELL";
  const mt5Accounts = j.accounts.filter((a) => (a.platform === "mt4" || a.platform === "mt5") && a.kind !== "backtest"); // MT4 orders run through RobotTradingEA
  const orderAccount = mt5Accounts.find((a) => a.id === orderAccountId) ?? mt5Accounts.find((a) => a.id === j.activeId) ?? mt5Accounts[0] ?? null;
  const slNum = slInput.trim() ? Number(slInput) : null;
  const tpNum = tpInput.trim() ? Number(tpInput) : null;
  const entryNum = entryInput.trim() ? Number(entryInput) : null;
  // filled in once the EA's quotes arrive (see `xq` below); until then the last candle close
  const [quoteRef, setQuoteRef] = useState<{ bid: number; ask: number } | null>(null);
  const marketRef = quoteRef ? (side === "SELL" ? quoteRef.bid : quoteRef.ask) : (last?.close ?? null);
  const entryRef = orderType === "market" ? marketRef : entryNum;
  const riskDist = slNum != null && entryRef != null ? Math.abs(entryRef - slNum) : null;
  const rewardDist = tpNum != null && entryRef != null ? Math.abs(entryRef - tpNum) : null;

  const orderRow = acctRows.find((r) => r.account.id === orderAccount?.id);
  const openTrades = (orderRow?.trades ?? []).filter((t) => t.close_time == null);
  const dir = side === "SELL" ? "sell" : "buy";
  const balance = orderRow?.live?.balance ?? null;
  const riskMoney = balance != null ? (cfg.riskU === "$" ? risk : (balance * risk) / 100) : null;
  const slPts = Number(cfg.slPts) || 0, tpPts = Number(cfg.tpPts) || 0;
  const fillDefaults = () => {
    if (entryRef == null) return;
    const sign = dir === "buy" ? 1 : -1;
    if (slPts > 0) setSlInput((entryRef - sign * slPts * 10 ** -dg).toFixed(dg));
    if (tpPts > 0) setTpInput((entryRef + sign * tpPts * 10 ** -dg).toFixed(dg));
  };

  const placeOrder = async () => {
    if (!orderAccount) return;
    if (cfg.checklistReq && !checklistDone) {
      beep(false);
      return setOrderMsg({ ok: false, text: `Checklist incomplete (${checks.filter(Boolean).length}/${CHECKLIST.length}) — tick every item in Setup & Checklist before sending an order.` });
    }
    const maxOpen = cfg.maxPos === "Unlimited" ? Infinity : Number(cfg.maxPos);
    if (openTrades.length >= maxOpen) {
      beep(false);
      return setOrderMsg({ ok: false, text: `Max open positions (${cfg.maxPos}) reached on ${orderAccount.name} — change it in Settings → Trading.` });
    }
    if (!cfg.hedge && openTrades.some((t) => t.direction !== dir)) {
      beep(false);
      return setOrderMsg({ ok: false, text: "Hedging is off: an opposite-direction position is still open. Turn Allow Hedging on in Settings → Trading." });
    }
    if (orderType !== "market" && (entryNum == null || !Number.isFinite(entryNum) || entryNum <= 0)) {
      beep(false);
      return setOrderMsg({ ok: false, text: `Set the ${orderType} price first (type it, or drag the ENTRY line on the chart).` });
    }
    setPlacing(true);
    setOrderMsg(null);
    try {
      const r = await journalApi.placeOrder(orderAccount.id, {
        symbol: sym,
        direction: side === "SELL" ? "sell" : "buy",
        order_type: orderType,
        price: orderType === "market" ? null : entryNum,
        volume: lot,
        sl: slNum,
        tp: tpNum,
      });
      setOrderMsg({ ok: true, text: orderType === "market"
        ? `${side} ${lot.toFixed(2)} ${sym} filled @ ${Number(r.price).toFixed(dg)} · #${r.ticket}`
        : `${side} ${orderType.toUpperCase()} ${lot.toFixed(2)} @ ${entryNum!.toFixed(dg)} placed · #${r.ticket}` });
      if (orderType !== "market") setEntryInput("");
      setChecks(CHECKLIST.map(() => false)); // the next trade needs its own checklist
      beep(true);
    } catch (e) {
      setOrderMsg({ ok: false, text: (e as Error).message });
      beep(false);
    }
    setPlacing(false);
  };

  /* ---- live MT4 positions: P&L every 2s, SL/TP dragged on the chart or typed in the panel ---- */
  const posAccId = orderAccount?.platform === "mt4" ? orderAccount.id : null;
  const [pos, setPos] = useState<LivePositions | null>(null);
  const [posOverride, setPosOverride] = useState<Record<string, { sl: number | null; tp: number | null }>>({});
  const [posMsg, setPosMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [posBusy, setPosBusy] = useState<string | null>(null);
  const [closeAsk, setCloseAsk] = useState<string | null>(null);
  const [posEdit, setPosEdit] = useState<Record<string, { sl: string; tp: string }>>({});
  useEffect(() => {
    if (posAccId == null) { setPos(null); return; }
    let alive = true;
    const tick = () => journalApi.positions(posAccId).then((r) => alive && setPos(r)).catch(() => alive && setPos(null));
    tick();
    const h = window.setInterval(tick, 2000);
    return () => { alive = false; window.clearInterval(h); };
  }, [posAccId]);
  const livePos = useMemo<LivePosition[]>(
    () => (pos?.positions ?? []).map((p) => (posOverride[p.ticket] ? { ...p, ...posOverride[p.ticket] } : p)),
    [pos, posOverride],
  );
  const quotes = pos?.quotes ?? [];
  const xq = quotes.find((q) => q.symbol === sym) ?? null;
  /** price decimals: from MT4 when known, else guessed from the price (gold 2, JPY 3, FX 5) */
  const digitsOf = (s: string, ref?: number | null) => quotes.find((q) => q.symbol === s)?.digits ?? (ref == null ? 2 : ref >= 500 ? 2 : ref >= 20 ? 3 : 5);
  const dg = xq?.digits ?? digitsOf(sym, last?.close);
  const fx = (s: string, v: number | null | undefined) => (v == null ? "—" : v.toFixed(digitsOf(s, v)));
  useEffect(() => { setQuoteRef(xq ? { bid: xq.bid, ask: xq.ask } : null); }, [xq?.bid, xq?.ask]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending: LivePending[] = pos?.pending ?? [];

  /* ---- price alerts (server-side; Telegram fires them even with the dashboard closed) ---- */
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const loadAlerts = () => journalApi.alerts(sym).then(setAlerts).catch(() => undefined);
  useEffect(() => {
    loadAlerts();
    const h = window.setInterval(loadAlerts, 5000);
    return () => window.clearInterval(h);
  }, [sym]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowPrice = () => xq?.bid ?? last?.close ?? null;
  const addAlert = (price: number) => {
    const pr = Number(price.toFixed(dg));
    journalApi.addAlert(sym, pr, nowPrice())
      .then(() => { setPosMsg({ ok: true, text: `🔔 Alert set: ${sym} ${pr.toFixed(dg)} — Telegram will tell you when it's reached` }); loadAlerts(); })
      .catch((e) => setPosMsg({ ok: false, text: (e as Error).message }));
  };
  const removeAlert = (a: PriceAlert) => journalApi.deleteAlert(a.id).then(loadAlerts).catch((e) => setPosMsg({ ok: false, text: (e as Error).message }));
  const armedAlerts = alerts.filter((a) => a.triggered_at == null);
  const cancelPending = async (o: LivePending) => {
    if (posAccId == null) return;
    setPosBusy(o.ticket);
    setPosMsg(null);
    try {
      await journalApi.cancelOrder(posAccId, o.ticket);
      setPosMsg({ ok: true, text: `#${o.ticket} cancelled` });
      beep(true);
    } catch (e) {
      setPosMsg({ ok: false, text: `#${o.ticket}: ${(e as Error).message}` });
      beep(false);
    }
    setPosBusy(null);
  };
  const closeAll = async () => {
    setCloseAllAsk(false);
    for (const p of livePos) await closePos(p);
  };
  /** account money per 1.00 price move per lot, learned from MT4's own profit (works for cent accounts too) */
  const moneyPerPoint = (p: LivePosition) => {
    const mv = p.price != null ? (p.direction === "buy" ? p.price - p.open_price : p.open_price - p.price) : 0;
    return Math.abs(mv) > 0.05 && p.profit !== 0 ? p.profit / (mv * p.volume) : 100;
  };
  const pnlAt = (p: LivePosition) => (price: number) =>
    (p.direction === "buy" ? price - p.open_price : p.open_price - price) * p.volume * moneyPerPoint(p);

  const modifyPos = async (p: LivePosition, sl: number | null, tp: number | null) => {
    if (posAccId == null) return;
    setPosOverride((o) => ({ ...o, [p.ticket]: { sl, tp } }));
    setPosBusy(p.ticket);
    setPosMsg(null);
    try {
      await journalApi.modifyPosition(posAccId, p.ticket, sl, tp);
      setPosMsg({ ok: true, text: `#${p.ticket}: SL ${fx(p.symbol, sl)} · TP ${fx(p.symbol, tp)} set in MT4` });
      beep(true);
      window.setTimeout(() => setPosOverride((o) => { const n = { ...o }; delete n[p.ticket]; return n; }), 4000);
    } catch (e) {
      setPosOverride((o) => { const n = { ...o }; delete n[p.ticket]; return n; });
      setPosMsg({ ok: false, text: `#${p.ticket}: ${(e as Error).message}` });
      beep(false);
    }
    setPosBusy(null);
  };
  const closePos = async (p: LivePosition) => {
    if (posAccId == null) return;
    setCloseAsk(null);
    setPosBusy(p.ticket);
    setPosMsg(null);
    try {
      const r = await journalApi.closePosition(posAccId, p.ticket);
      setPosMsg({ ok: true, text: `#${p.ticket} closed @ ${fx(p.symbol, Number(r.price))}` });
      beep(true);
    } catch (e) {
      setPosMsg({ ok: false, text: `#${p.ticket}: ${(e as Error).message}` });
      beep(false);
    }
    setPosBusy(null);
  };
  const savePosEdit = (p: LivePosition) => {
    const e = posEdit[p.ticket];
    if (!e) return;
    const num = (v: string) => (v.trim() ? Number(v) : null);
    const sl = num(e.sl), tp = num(e.tp);
    if ((sl != null && !Number.isFinite(sl)) || (tp != null && !Number.isFinite(tp))) return setPosMsg({ ok: false, text: "SL/TP must be prices" });
    setPosEdit((m) => { const n = { ...m }; delete n[p.ticket]; return n; });
    void modifyPos(p, sl, tp);
  };

  const chartLevels = useMemo<Level[]>(() => {
    const out: Level[] = [];
    for (const p of livePos) {
      if (p.symbol !== sym) continue;
      const tag = `#${p.ticket.slice(-4)}`;
      const at = pnlAt(p);
      out.push({ id: `${p.ticket}:entry`, price: p.open_price, color: "#e0b354", dashed: true, draggable: true,
        label: `${p.direction.toUpperCase()} ${p.volume.toFixed(2)} ${tag} ${p.profit >= 0 ? "+" : ""}${(p.profit + p.swap + p.commission).toFixed(2)}$ ·`, });
      if (p.sl != null) out.push({ id: `${p.ticket}:sl`, price: p.sl, color: "#ef5350", draggable: true, label: `SL ${tag}`, pnlAt: at });
      if (p.tp != null) out.push({ id: `${p.ticket}:tp`, price: p.tp, color: "#26a69a", draggable: true, label: `TP ${tag}`, pnlAt: at });
    }
    for (const o of pending) {
      if (o.symbol !== sym) continue;
      out.push({ id: `pend:${o.ticket}`, price: o.price, color: "#8fa3ad", dashed: true, label: `${o.type.replace("_", " ").toUpperCase()} ${o.volume.toFixed(2)} #${o.ticket.slice(-4)}` });
    }
    for (const a of armedAlerts) out.push({ id: `alert:${a.id}`, price: a.price, color: "#f59e0b", dashed: true, draggable: true, label: `🔔 ${a.direction === "above" ? "▲" : "▼"}` });
    if (orderType !== "market" && entryNum != null && Number.isFinite(entryNum)) out.push({ id: "new:entry", price: entryNum, color: "#e0b354", dashed: true, draggable: true, label: `${side} ${orderType.toUpperCase()} (new)` });
    if (slNum != null && Number.isFinite(slNum)) out.push({ id: "new:sl", price: slNum, color: "#ef5350", dashed: true, draggable: true, label: "SL (new)" });
    if (tpNum != null && Number.isFinite(tpNum)) out.push({ id: "new:tp", price: tpNum, color: "#26a69a", dashed: true, draggable: true, label: "TP (new)" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePos, pending, slNum, tpNum, orderType, entryNum, side, alerts]);

  const onLevelMove = (id: string, price: number) => {
    const [ticket, kind] = id.split(":");
    if (ticket === "alert") {
      journalApi.moveAlert(Number(kind), Number(price.toFixed(dg)), nowPrice()).then(loadAlerts).catch((e) => setPosMsg({ ok: false, text: (e as Error).message }));
      return;
    }
    if (ticket === "new") return kind === "sl" ? setSlInput(price.toFixed(dg)) : kind === "tp" ? setTpInput(price.toFixed(dg)) : setEntryInput(price.toFixed(dg));
    const p = livePos.find((x) => x.ticket === ticket);
    if (!p) return;
    if (kind === "sl") return void modifyPos(p, price, p.tp);
    if (kind === "tp") return void modifyPos(p, p.sl, price);
    // dragged from the entry line, like MT4: the losing side makes an SL, the winning side a TP
    const losing = p.direction === "buy" ? price < p.open_price : price > p.open_price;
    void modifyPos(p, losing ? price : p.sl, losing ? p.tp : price);
  };
  const drawDraft = () => {
    if (orderType !== "market" && entryNum == null && marketRef != null) {
      // a limit sits on the better side of the price, a stop on the breakout side
      const away = marketRef * 0.0007 * ((side === "BUY") === (orderType === "limit") ? -1 : 1);
      setEntryInput((marketRef + away).toFixed(dg));
      return;
    }
    if (entryRef == null) return;
    const sign = dir === "buy" ? 1 : -1;
    const u = entryRef * 0.0012; // ~5 on gold, ~13 pips on EURUSD
    if (!slInput.trim()) setSlInput((entryRef - sign * u).toFixed(dg));
    if (!tpInput.trim()) setTpInput((entryRef + sign * u * 2).toFixed(dg));
  };

  const todayClosed = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const from = start.getTime() / 1000;
    return (orderRow?.trades ?? []).filter((t) => isClosed(t) && (t.close_time ?? 0) >= from).sort((a, b) => (b.close_time ?? 0) - (a.close_time ?? 0));
  }, [orderRow]);
  const todayPnl = todayClosed.reduce((s2, t) => s2 + net(t), 0);
  // money per 1.00 move per lot, learned from a live position (cent accounts included), else gold's 100 oz/lot
  const samePos = livePos.find((p) => p.symbol === sym);
  const perLot = samePos ? moneyPerPoint(samePos) : xq?.pv ?? (sym.startsWith("XAU") ? 100 : 100000);
  const suggestedLot = riskMoney != null && riskDist ? Math.max(0.01, Math.floor((riskMoney / (riskDist * perLot)) * 100) / 100) : null;
  const accBal = pos?.balance ?? balance;
  const riskUsd = riskDist != null ? riskDist * lot * perLot : null;
  const rewardUsd = rewardDist != null ? rewardDist * lot * perLot : null;
  const toggleWatch = () => setShowWatch((v) => { try { localStorage.setItem("elion.trade.watch", v ? "0" : "1"); } catch { /* private mode */ } return !v; });

  const stepper = (up: () => void, dn: () => void) => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="e-icon" onClick={up} style={{ fontSize: 16, lineHeight: "14px", cursor: "pointer" }}>expand_less</span>
      <span className="e-icon" onClick={dn} style={{ fontSize: 16, lineHeight: "14px", cursor: "pointer" }}>expand_more</span>
    </div>
  );

  const th: React.CSSProperties = { fontSize: 11, color: "var(--e-text-2)", fontWeight: 400, textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--e-line-2)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 12, padding: "5px 8px", borderBottom: "1px solid var(--e-line-2)", whiteSpace: "nowrap" };
  const cellIn: React.CSSProperties = { ...FIELD, height: 24, width: 78, padding: "0 6px", fontSize: 12, color: "var(--e-text)", outline: 0 };
  const btn = (color: string): React.CSSProperties => ({ padding: "3px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: `1px solid ${color}`, color, display: "inline-block" });
  const stat = (label: string, value: React.ReactNode, color?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 14px", borderLeft: "1px solid var(--e-line-2)" }}>
      <span style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>{label}</span>
      <span style={{ fontSize: 13.5, color }}>{value}</span>
    </div>
  );
  const ticked = checks.filter(Boolean).length;
  const gateOk = !cfg.checklistReq || checklistDone;
  const pendDist = (o: LivePending) => { const q = quotes.find((x) => x.symbol === o.symbol); return q ? Math.abs((o.type.startsWith("buy") ? q.ask : q.bid) - o.price) : null; };

  return (
    <div className="elion-scope e-root e-inner" style={{ height: "100vh", overflow: "hidden", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", gridTemplateRows: "minmax(0,1fr) 34px", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Trade" spanRows />

      <main style={{ padding: "8px 14px 10px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 24, height: 52 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".46em", color: "var(--e-text-2)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 12, letterSpacing: ".06em", color: "var(--e-text-2)" }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,420px)", height: 38, borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 14px", color: "var(--e-muted)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12 }}>Search symbols, setups, or ask ELION...</span>
              <span style={{ fontSize: 11, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 7px" }}>Ctrl K</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: activeSessName ? UP : "var(--e-muted-2)", boxShadow: activeSessName ? `0 0 6px ${UP}` : "none" }} />{activeSessName ?? "No session"} {activeSessName && "· Live"}
            </div>
            <div style={{ color: "var(--e-text-2)", fontSize: 11 }}>{clock}</div>
          </div>
          <div style={{ position: "relative", color: "var(--e-text-2)" }}>
            <span className="e-icon" style={{ fontSize: 26 }}>notifications</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>EF</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Elias Farahani</div>
              <div style={{ fontSize: 11, color: "var(--e-muted)" }}>Trader | Build the Edge</div>
            </div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#16242a", display: "grid", placeItems: "center" }}>
            <span className="e-icon fill" style={{ fontSize: 22, color: "var(--e-ivory)" }}>dark_mode</span>
          </div>
        </header>

        {/* ---- one-line market strip ---- */}
        <div style={{ ...CARD, height: 46, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 6px 0 14px", overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, paddingRight: 14 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{sym}</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{xq ? xq.bid.toFixed(dg) : last ? last.close.toFixed(dg) : "—"}</span>
            <span style={{ fontSize: 12, color: bullish ? UP : DOWN }}>{pnlStr(change)} ({change && last ? ((change / (last.close - change)) * 100).toFixed(2) : "0.00"}%)</span>
          </div>
          {stat("Session", <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: activeSessName ? UP : "var(--e-muted-2)" }} />{activeSessName ?? "Closed"}</span>)}
          {stat(closeInfo.label, `${Math.floor(closeInfo.mins / 60)}h ${closeInfo.mins % 60}m`)}
          {stat("Day High", dayHigh != null ? dayHigh.toFixed(dg) : "—")}
          {stat("Day Low", dayLow != null ? dayLow.toFixed(dg) : "—", DOWN)}
          {stat("Range", dayHigh != null && dayLow != null ? (dayHigh - dayLow).toFixed(dg) : "—")}
          {stat("ADR (14)", adr14 != null ? adr14.toFixed(Math.max(1, dg - 1)) : "—")}
          {stat("Spread", xq ? (xq.ask - xq.bid).toFixed(dg) : "—")}
          <div style={{ flex: 1 }} />
          {pos?.live && stat("Equity", pos.equity?.toFixed(2) ?? "—")}
          {pos?.live && stat("Floating", pnlStr(pos.floating ?? 0), (pos.floating ?? 0) >= 0 ? UP : DOWN)}
          {stat("Today", pnlStr(todayPnl), todayPnl >= 0 ? UP : DOWN)}
        </div>

        {/* ---- watchlist · chart · order ticket ---- */}
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `${showWatch ? "200px " : ""}minmax(0,1fr) 330px`, gap: 10 }}>
          {showWatch && (
            <div style={{ ...CARD, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px" }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Watchlist</span>
                <span className="e-icon" onClick={toggleWatch} style={{ fontSize: 18, cursor: "pointer", color: "var(--e-text-3)" }}>close</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, padding: "0 12px 4px", fontSize: 10.5, color: "var(--e-text-2)" }}>
                <span>Symbol</span><span>Bid</span><span style={{ width: 46, textAlign: "right" }}>Chg</span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {quotes.length === 0 && <div style={{ padding: 12, fontSize: 11.5, color: "var(--e-muted)" }}>Prices come from MT4's Market Watch once RobotTradingEA v1.4 runs.</div>}
                {quotes.map((q) => (
                  <div key={q.symbol} onClick={() => { app.setSymbol(q.symbol); setSlInput(""); setTpInput(""); setEntryInput(""); }} title={`Show ${q.symbol}`}
                    style={{ cursor: "pointer", display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, alignItems: "center", padding: "6px 12px", fontSize: 12, borderTop: "1px solid var(--e-line-2)", borderLeft: `2px solid ${q === xq ? "var(--e-gold)" : "transparent"}`, background: q === xq ? "rgba(224,179,84,.08)" : "transparent" }}>
                    <span style={{ fontWeight: q === xq ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis" }}>{q.symbol}</span>
                    <span>{q.bid.toFixed(q.digits ?? (q.bid >= 100 ? 2 : 5))}</span>
                    <span style={{ width: 46, textAlign: "right", color: q.change == null ? "var(--e-muted)" : q.change >= 0 ? UP : DOWN }}>{q.change == null ? "—" : `${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}%`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div ref={chartPanelRef} style={{ minHeight: 0, borderRadius: isFullscreen ? 0 : 12, border: "1px solid var(--e-line)", background: "#0a1417", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 44, flexShrink: 0, borderBottom: "1px solid var(--e-line-3)", flexWrap: "wrap" }}>
              <div onClick={toggleWatch} title={showWatch ? "Hide watchlist" : "Show watchlist"} style={{ display: "flex", alignItems: "center", cursor: "pointer", color: "var(--e-text-3)", marginRight: 4 }}>
                <span className="e-icon" style={{ fontSize: 20 }}>{showWatch ? "left_panel_close" : "left_panel_open"}</span>
              </div>
              <Tabs list={TF_OPTIONS.map((o) => o.label)} cur={tf} onPick={(l) => setTfSec(TF_OPTIONS.find((o) => o.label === l)!.sec)}
                style={{ height: 28, padding: "0 10px", borderRadius: 6, display: "grid", placeItems: "center", fontSize: 12 }}
                on={{ background: "#2a2518", color: "var(--e-ivory)", border: "1px solid rgba(233,215,176,.55)" }}
                off={{ background: "#0f1b1f", color: "var(--e-text)", border: "1px solid var(--e-border)" }} />
              <div style={{ width: 1, height: 22, background: "var(--e-border)", margin: "0 6px" }} />
              <Tabs list={["MT4", "TradingView"]} cur={view === "bot" ? "MT4" : "TradingView"} onPick={(l) => setView(l === "MT4" ? "bot" : "tv")}
                style={{ height: 28, padding: "0 10px", borderRadius: 6, display: "grid", placeItems: "center", fontSize: 12 }}
                on={{ background: "#2a2518", color: "var(--e-ivory)", border: "1px solid rgba(233,215,176,.55)" }}
                off={{ background: "#0f1b1f", color: "var(--e-text)", border: "1px solid var(--e-border)" }} />
              {view === "bot" && (
                <div
                  onClick={() => (app.mode === "replay" ? app.replay.toggle() : app.setMode("replay"))}
                  title={app.mode === "replay" ? (app.replay.playing ? "Pause replay" : "Resume replay") : "Switch to replay mode"}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: app.mode === "replay" ? "var(--e-gold)" : "var(--e-text)", padding: "0 6px", cursor: "pointer" }}
                >
                  <span className="e-icon">{app.mode === "replay" && app.replay.playing ? "pause" : "fast_rewind"}</span>
                  {app.mode === "replay" ? (app.replay.playing ? "Pause" : "Resume") : "Replay"}
                </div>
              )}
              <div style={{ flex: 1 }} />
              {/* eToro-style quote buttons: pick the side in the ticket */}
              <div onClick={() => setSide("SELL")} title="Sell side (bid)" style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 14, cursor: "pointer", fontSize: 12, border: "1px solid #e0463f", background: sel ? "#e0463f" : "transparent", color: sel ? "#fff" : "#f3b5ae" }}>
                <b>S</b><span>{xq ? xq.bid.toFixed(dg) : "—"}</span>
              </div>
              <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>{xq ? (xq.ask - xq.bid).toFixed(dg) : ""}</span>
              <div onClick={() => setSide("BUY")} title="Buy side (ask)" style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 14, cursor: "pointer", fontSize: 12, border: "1px solid #26b58d", background: !sel ? "#26b58d" : "transparent", color: !sel ? "#fff" : "#9fe3cf" }}>
                <b>B</b><span>{xq ? xq.ask.toFixed(dg) : "—"}</span>
              </div>
              <span style={{ fontSize: 12, color: "var(--e-text-2)", marginLeft: 6 }}>{new Date(nowTick).toUTCString().slice(17, 25)} UTC</span>
              {view === "tv" && <span style={{ fontSize: 11, color: "var(--e-muted)" }}>Price from TradingView (OANDA), not your broker</span>}
              <div onClick={toggleFullscreen} title={isFullscreen ? "Exit full screen" : "Full screen"} style={{ display: "flex", alignItems: "center", padding: "0 6px", cursor: "pointer", color: "var(--e-text-3)" }}>
                <span className="e-icon" style={{ fontSize: 20 }}>{isFullscreen ? "fullscreen_exit" : "fullscreen"}</span>
              </div>
            </div>

            {view === "tv" ? (
              <div className="chart-area tv" style={{ flex: 1, minHeight: 0 }}>
                <TradingViewWidget key={`${sym}-${TV_INTERVAL[tfSec] ?? "1"}`} symbol={`OANDA:${sym.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}`} interval={TV_INTERVAL[tfSec] ?? "1"} />
              </div>
            ) : (
              <>
                <IndicatorsBar items={app.indicators} onChange={app.setIndicators} volume={app.showVolume} hasVolume={source[0]?.volume != null} onVolume={() => app.setShowVolume((v) => !v)} />
                <div className="chart-area" style={{ flex: 1, minHeight: 0 }}>
                  {app.selected && (
                    <DrawingProps
                      drawing={app.selected}
                      onChange={(p) => app.updateDrawing(app.selected!.id, p)}
                      onDuplicate={() => app.duplicateDrawing(app.selected!.id)}
                      onDelete={() => app.removeDrawing(app.selected!.id)}
                    />
                  )}
                  <DrawToolbar
                    tool={app.tool}
                    onTool={app.setTool}
                    magnet={app.magnet}
                    onMagnet={() => app.setMagnet((m) => !m)}
                    color={app.color}
                    onColor={app.setColor}
                    hasSelection={!!app.selectedId}
                    count={app.drawings.length}
                    onDeleteSelected={() => app.selectedId && app.removeDrawing(app.selectedId)}
                    onUndo={() => app.setDrawings((d) => d.slice(0, -1))}
                    onClear={() => app.setDrawings([])} /* the toolbar asks first */
                  />
                  {source.length === 0 ? (
                    <div className="loading">
                      {app.mode === "live"
                        ? app.live.status === "live" ? "Loading candles…" : `Loading ${sym} from MT4… (RobotTradingEA v1.5 streams any Market Watch symbol)`
                        : "Loading…"}
                    </div>
                  ) : (
                    <Chart
                      candles={app.bars}
                      tfSec={app.tfSec}
                      trades={chartTrades}
                      showTrades={false} /* no buy/sell markers on the Trade chart; live positions are drawn as lines */
                      overlay={app.overlay}
                      shift={false}
                      indicators={app.indicators}
                      drawings={app.drawings}
                      tool={app.tool}
                      magnet={app.magnet}
                      color={app.color}
                      selectedId={app.selectedId}
                      onAdd={(d) => (d.type === "alert" ? addAlert(d.points[0].price) : app.setDrawings((l) => [...l, d]))}
                      onSelect={app.setSelectedId}
                      onDelete={app.removeDrawing}
                      onTool={app.setTool}
                      onUpdate={app.updateDrawing}
                      onDuplicate={app.duplicateDrawing}
                      onClearDrawings={() => app.setDrawings([])}
                      showVolume={app.showVolume}
                      showGrid={cfg.showGrid}
                      levels={app.mode === "live" ? chartLevels : undefined}
                      precision={dg}
                      onLevelMove={onLevelMove}
                      hideTradeLines={app.mode === "live" && !!pos?.live}
                    />
                  )}
                </div>
                {app.mode === "replay" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderTop: "1px solid var(--e-line-3)", flexShrink: 0, flexWrap: "wrap" }}>
                    <div onClick={app.replay.toggle} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 6, background: "var(--e-gold-2)", color: "#1a1409", fontSize: 12, cursor: "pointer" }}>
                      <Icon name={app.replay.done ? "reset" : app.replay.playing ? "pause" : "play"} size={14} />
                      {app.replay.done ? "Restart" : app.replay.playing ? "Pause" : "Play"}
                    </div>
                    <div onClick={app.replay.stepCandle} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--e-border)", fontSize: 12, cursor: app.replay.done ? "not-allowed" : "pointer", opacity: app.replay.done ? 0.5 : 1 }}>
                      <Icon name="step" size={14} />Next candle
                    </div>
                    <div onClick={app.replay.reset} title="Restart" style={{ display: "flex", alignItems: "center", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--e-border)", cursor: "pointer" }}>
                      <Icon name="reset" size={14} />
                    </div>
                    <div style={{ display: "flex", gap: 2 }}>
                      {SPEEDS.map((v) => (
                        <div key={v} onClick={() => app.replay.setSpeed(v)} style={{ padding: "4px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer", background: app.replay.speed === v ? "var(--e-gold-2)" : "transparent", color: app.replay.speed === v ? "#1a1409" : "var(--e-text-3)", border: "1px solid var(--e-border)" }}>{v}x</div>
                      ))}
                    </div>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--e-panel-2)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${app.replay.progress * 100}%`, background: "var(--e-gold)" }} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---- order ticket ---- */}
          <div style={{ ...CARD, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Order Ticket · {sym}</div>
              <div style={{ fontSize: 11, color: "var(--e-text-2)" }}>{xq ? `Bid ${xq.bid.toFixed(dg)} · Ask ${xq.ask.toFixed(dg)}` : ""}</div>
            </div>
            {mt5Accounts.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "var(--e-muted)" }}>No MT4/MT5 account connected — add one on the Connection page to place real orders.</div>
            ) : (
              <select value={orderAccount?.id ?? ""} onChange={(e) => setOrderAccountId(Number(e.target.value))} style={{ ...FIELD, height: 32, fontSize: 12, padding: "0 8px", width: "100%" }}>
                {mt5Accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.platform.toUpperCase()}{a.is_live ? " (Live)" : " (Demo)"}</option>)}
              </select>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div onClick={() => setSide("SELL")} style={{ height: 44, borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", background: sel ? "#e0463f" : "#16242a", color: sel ? "#fff" : "var(--e-text)", border: `1px solid ${sel ? "#e0463f" : "var(--e-border)"}` }}>
                <span style={{ fontSize: 14, letterSpacing: ".04em" }}>SELL</span><span style={{ fontSize: 11, opacity: .85 }}>{xq ? xq.bid.toFixed(dg) : ""}</span>
              </div>
              <div onClick={() => setSide("BUY")} style={{ height: 44, borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", background: sel ? "#16242a" : "#26b58d", color: sel ? "var(--e-text)" : "#fff", border: `1px solid ${sel ? "var(--e-border)" : "#26b58d"}` }}>
                <span style={{ fontSize: 14, letterSpacing: ".04em" }}>BUY</span><span style={{ fontSize: 11, opacity: .85 }}>{xq ? xq.ask.toFixed(dg) : ""}</span>
              </div>
            </div>
            <div style={{ display: "flex", borderRadius: 7, border: "1px solid var(--e-border)", padding: 2 }}>
              {(["market", "limit", "stop"] as const).map((k) => (
                <div key={k} onClick={() => setOrderType(k)} style={{ flex: 1, textAlign: "center", padding: "5px 0", borderRadius: 5, fontSize: 12, cursor: "pointer", background: orderType === k ? "#2a2518" : "transparent", color: orderType === k ? "var(--e-ivory)" : "var(--e-text-2)" }}>
                  {k === "market" ? "Market" : k === "limit" ? "Limit" : "Stop"}
                </div>
              ))}
            </div>
            {orderType !== "market" && (
              <div style={{ ...FIELD, height: 46, padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
                <span style={{ fontSize: 11, color: "var(--e-text-2)" }}>{side === "BUY" ? "Buy" : "Sell"} {orderType} price {orderType === "limit" ? (side === "BUY" ? "(below market)" : "(above market)") : (side === "BUY" ? "(above market)" : "(below market)")}</span>
                <input value={entryInput} onChange={(e) => setEntryInput(e.target.value)} placeholder={marketRef != null ? marketRef.toFixed(dg) : "price"} inputMode="decimal" style={{ background: "transparent", border: 0, outline: 0, color: "var(--e-text)", fontSize: 15, width: "100%", padding: 0 }} />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 11, color: "var(--e-text-2)", paddingLeft: 4 }}>Lot Size</div>
                <div style={{ ...FIELD, height: 36, display: "flex", alignItems: "center", padding: "0 6px 0 10px" }}>
                  <span style={{ flex: 1, fontSize: 15 }}>{lot.toFixed(2)}</span>
                  {stepper(() => setLot((s) => Math.min(5, Math.round((s + 0.01) * 100) / 100)), () => setLot((s) => Math.max(0.01, Math.round((s - 0.01) * 100) / 100)))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 11, color: "var(--e-text-2)", paddingLeft: 4 }}>Risk {cfg.riskU === "$" ? "$" : "%"}</div>
                <div style={{ ...FIELD, height: 36, display: "flex", alignItems: "center", padding: "0 6px 0 10px" }}>
                  <span style={{ flex: 1, fontSize: 15 }}>{risk.toFixed(1)}</span>
                  {stepper(() => setRisk((s) => Math.min(5, Math.round((s + 0.1) * 10) / 10)), () => setRisk((s) => Math.max(0.1, Math.round((s - 0.1) * 10) / 10)))}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ ...FIELD, height: 46, padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
                <span style={{ fontSize: 11, color: DOWN }}>Stop Loss</span>
                <input value={slInput} onChange={(e) => setSlInput(e.target.value)} placeholder="none" inputMode="decimal" style={{ background: "transparent", border: 0, outline: 0, color: "var(--e-text)", fontSize: 15, width: "100%", padding: 0 }} />
              </div>
              <div style={{ ...FIELD, height: 46, padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
                <span style={{ fontSize: 11, color: UP }}>Take Profit</span>
                <input value={tpInput} onChange={(e) => setTpInput(e.target.value)} placeholder="none" inputMode="decimal" style={{ background: "transparent", border: 0, outline: 0, color: "var(--e-text)", fontSize: 15, width: "100%", padding: 0 }} />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 11.5 }}>
              {(((!slInput.trim() || !tpInput.trim()) && entryRef != null) || (orderType !== "market" && entryNum == null)) && (
                <span onClick={drawDraft} style={{ color: "var(--e-gold)", cursor: "pointer" }}>{orderType !== "market" && entryNum == null ? "Draw ENTRY line on chart" : "Draw SL/TP lines on chart"}</span>
              )}
              {(slPts > 0 || tpPts > 0) && <span onClick={fillDefaults} style={{ color: "var(--e-gold)", cursor: "pointer" }}>Defaults ({slPts || "–"}/{tpPts || "–"} pts)</span>}
              {cfg.autoSize && suggestedLot != null && <span onClick={() => setLot(Math.min(5, suggestedLot))} style={{ color: "var(--e-gold)", cursor: "pointer" }}>Suggested lot {suggestedLot.toFixed(2)}</span>}
            </div>
            {/* risk / reward in money, before sending */}
            <div style={{ ...FIELD, padding: "8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr .6fr", gap: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>If SL hits</span>
                <span style={{ fontSize: 14, color: DOWN }}>{riskUsd != null ? `−${riskUsd.toFixed(2)}` : "—"}</span>
                <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>{riskUsd != null && accBal ? `${((riskUsd / accBal) * 100).toFixed(2)}% of balance` : "no SL"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>If TP hits</span>
                <span style={{ fontSize: 14, color: UP }}>{rewardUsd != null ? `+${rewardUsd.toFixed(2)}` : "—"}</span>
                <span style={{ fontSize: 10.5, color: "var(--e-muted)" }}>{rewardUsd != null && accBal ? `${((rewardUsd / accBal) * 100).toFixed(2)}%` : "no TP"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>R:R</span>
                <span style={{ fontSize: 14 }}>{riskDist && rewardDist ? `1:${(rewardDist / riskDist).toFixed(1)}` : "—"}</span>
              </div>
            </div>
            {/* the discipline gate, folded into one line */}
            <div style={{ ...FIELD, overflow: "hidden" }}>
              <div onClick={() => setShowChecklist((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", fontSize: 12.5 }}>
                <span className="e-icon" style={{ fontSize: 18, color: checklistDone ? UP : "var(--e-gold)" }}>{checklistDone ? "task_alt" : "checklist"}</span>
                <span style={{ flex: 1 }}>Checklist {ticked}/{CHECKLIST.length}</span>
                {/* required ↔ optional, same switch as Settings → Trading */}
                <span onClick={(e) => { e.stopPropagation(); setCfg({ checklistReq: !cfg.checklistReq }); }}
                  title={cfg.checklistReq ? "Orders are blocked until every item is ticked — click to make the checklist optional" : "Checklist is optional — click to require it before every order"}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: cfg.checklistReq ? "var(--e-gold)" : "var(--e-muted)" }}>
                  {cfg.checklistReq ? "Required" : "Optional"}
                  <span style={{ width: 26, height: 14, borderRadius: 7, background: cfg.checklistReq ? "var(--e-gold-2)" : "#2a3439", position: "relative", display: "inline-block" }}>
                    <span style={{ position: "absolute", top: 2, left: cfg.checklistReq ? 14 : 2, width: 10, height: 10, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
                  </span>
                </span>
                <span className="e-icon" style={{ fontSize: 18, color: "var(--e-text-3)" }}>{showChecklist ? "expand_less" : "expand_more"}</span>
              </div>
              {showChecklist && CHECKLIST.map((rule, i) => (
                <div key={rule.title} title={rule.hint} onClick={() => setChecks((c) => c.map((v, k) => (k === i ? !v : v)))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderTop: "1px solid var(--e-line-2)", cursor: "pointer", fontSize: 12 }}>
                  <span style={{ width: 15, height: 15, borderRadius: 3, flexShrink: 0, boxSizing: "border-box", border: `1.5px solid ${checks[i] ? "#3ec495" : "#56625f"}`, background: checks[i] ? "#3ec495" : "transparent", display: "grid", placeItems: "center" }}>
                    <span className="e-icon" style={{ fontSize: 13, color: "#081013", opacity: checks[i] ? 1 : 0 }}>check</span>
                  </span>
                  <span style={{ flex: 1 }}>{rule.title}</span>
                </div>
              ))}
            </div>
            <div
              onClick={!orderAccount || placing ? undefined : placeOrder}
              title={orderAccount ? `Sends a REAL ${side} ${orderType} order for ${lot.toFixed(2)} ${sym} to "${orderAccount.name}" — no confirmation step.` : "No MT4/MT5 account to send to"}
              style={{ height: 42, flexShrink: 0, borderRadius: 6, background: !orderAccount || !gateOk ? "var(--e-panel-2)" : sel ? "#e0463f" : "#26b58d", border: orderAccount && gateOk ? "none" : "1px solid var(--e-border)", color: orderAccount && gateOk ? "#fff" : "var(--e-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 14.5, fontWeight: 500, cursor: !orderAccount || placing ? "default" : "pointer", opacity: placing ? 0.6 : 1 }}
            >
              <span className="e-icon" style={{ fontSize: 19 }}>{placing ? "sync" : "send"}</span>
              {placing ? "Sending…" : !orderAccount ? "No Account" : !gateOk ? `Checklist ${ticked}/${CHECKLIST.length}` : `${side} ${lot.toFixed(2)} ${orderType === "market" ? "Market" : `${orderType === "limit" ? "Limit" : "Stop"} @ ${entryNum != null ? entryNum.toFixed(dg) : "—"}`}`}
            </div>
            {orderMsg && (
              <div style={{ fontSize: 11.5, padding: "6px 8px", borderRadius: 6, background: orderMsg.ok ? "#0f2a26" : "#2a1414", border: `1px solid ${orderMsg.ok ? "#2c7a5f" : "#8a2a26"}`, color: orderMsg.ok ? UP : "#f3b5ae" }}>
                {orderMsg.text}
              </div>
            )}
          </div>
        </div>

        {/* ---- bottom: positions / pending / today / news / market ---- */}
        <div style={{ ...CARD, height: bottomOpen ? bottomH : 40, transition: "height .2s ease", flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, position: "relative", overflow: "hidden" }}>
          {/* drag the top edge to resize, like TradingView's bottom panel */}
          <div onPointerDown={startResize} title="Drag to resize" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, cursor: "ns-resize", zIndex: 2 }} />
          <div onDoubleClick={() => setBottom(!bottomOpen)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 10px", borderBottom: bottomOpen ? "1px solid var(--e-line-2)" : "none", height: 40, flexShrink: 0 }}>
            {[
              ["Positions", `Positions (${livePos.length})`],
              ["Pending", `Pending (${pending.length})`],
              ["Today", `Today (${todayClosed.length})`],
              ["Alerts", `Alerts (${armedAlerts.length})`],
              ["News", "News"],
              ["Market", "Market"],
            ].map(([k, label]) => (
              <div key={k} onClick={() => { if (bottomOpen && bottomTab === k) setBottom(false); else { setBottomTab(k); setBottom(true); } }} style={{ padding: "0 12px", height: 40, display: "flex", alignItems: "center", fontSize: 12.5, cursor: "pointer", color: bottomTab === k ? "var(--e-ivory)" : "var(--e-text-2)", borderBottom: `2px solid ${bottomOpen && bottomTab === k ? "var(--e-gold)" : "transparent"}` }}>{label}</div>
            ))}
            <div style={{ flex: 1 }} />
            {posMsg && <span style={{ fontSize: 11.5, color: posMsg.ok ? UP : "#f3b5ae", marginRight: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>{posMsg.text}</span>}
            {bottomTab === "Positions" && pos?.live && (
              <>
                <span style={{ fontSize: 12, color: "var(--e-text-2)", marginRight: 10 }}>Floating <b style={{ color: (pos.floating ?? 0) >= 0 ? UP : DOWN }}>{pnlStr(pos.floating ?? 0)}</b> · Equity {pos.equity?.toFixed(2) ?? "—"}</span>
                {livePos.length > 0 && (
                  <span onClick={() => (closeAllAsk ? closeAll() : setCloseAllAsk(true))} style={{ ...btn("#e0463f"), background: closeAllAsk ? "#8a2a26" : "transparent", color: closeAllAsk ? "#fff" : "#f3b5ae" }}>{closeAllAsk ? "Confirm close all" : "Close All"}</span>
                )}
              </>
            )}
            {bottomTab === "Today" && <span style={{ fontSize: 12, color: "var(--e-text-2)" }}>Today <b style={{ color: todayPnl >= 0 ? UP : DOWN }}>{pnlStr(todayPnl)}</b></span>}
            <span onClick={() => setBottom(!bottomOpen)} title={bottomOpen ? "Collapse panel (chart gets taller)" : "Expand panel"}
              style={{ marginLeft: 10, width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--e-text-2)", border: "1px solid var(--e-border)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>{bottomOpen ? "keyboard_arrow_down" : "keyboard_arrow_up"}</span>
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: bottomOpen ? "block" : "none" }}>
            {bottomTab === "Positions" && (
              posAccId == null ? <div style={{ padding: 16, fontSize: 12, color: "var(--e-muted)" }}>Pick an MT4 account in the order ticket.</div>
              : !pos?.live ? <div style={{ padding: 16, fontSize: 12, color: "var(--e-muted)" }}>Waiting for RobotTradingEA in MT4…</div>
              : livePos.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: "var(--e-muted)" }}>No open positions.</div>
              : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Symbol", "Side", "Lot", "Entry", "Price", "Stop Loss", "Take Profit", "P&L", "%", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {livePos.map((p) => {
                      const v = p.profit + p.swap + p.commission;
                      const ed = posEdit[p.ticket] ?? { sl: p.sl != null ? fx(p.symbol, p.sl) : "", tp: p.tp != null ? fx(p.symbol, p.tp) : "" };
                      const edit = (k: "sl" | "tp", val: string) => setPosEdit((m) => ({ ...m, [p.ticket]: { ...ed, [k]: val } }));
                      const busy = posBusy === p.ticket;
                      return (
                        <tr key={p.ticket} style={{ opacity: busy ? 0.55 : 1 }}>
                          <td style={td}>{p.symbol} <span style={{ color: "var(--e-muted)", fontSize: 10.5 }}>#{p.ticket}</span></td>
                          <td style={{ ...td, color: p.direction === "buy" ? UP : DOWN, fontWeight: 600 }}>{p.direction === "buy" ? "BUY" : "SELL"}</td>
                          <td style={td}>{p.volume.toFixed(2)}</td>
                          <td style={td}>{fx(p.symbol, p.open_price)}</td>
                          <td style={td}>{fx(p.symbol, p.price)}</td>
                          <td style={td}><input value={ed.sl} placeholder="none" inputMode="decimal" onChange={(e) => edit("sl", e.target.value)} onKeyDown={(e) => e.key === "Enter" && savePosEdit(p)} style={cellIn} /></td>
                          <td style={td}><input value={ed.tp} placeholder="none" inputMode="decimal" onChange={(e) => edit("tp", e.target.value)} onKeyDown={(e) => e.key === "Enter" && savePosEdit(p)} style={cellIn} /></td>
                          <td style={{ ...td, fontWeight: 600, color: v >= 0 ? UP : DOWN }}>{pnlStr(v)}</td>
                          <td style={{ ...td, color: v >= 0 ? UP : DOWN }}>{accBal ? `${((v / accBal) * 100).toFixed(2)}%` : "—"}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            {posEdit[p.ticket] && <span onClick={busy ? undefined : () => savePosEdit(p)} style={{ ...btn("var(--e-gold)"), marginRight: 6 }}>Set SL/TP</span>}
                            <span onClick={busy ? undefined : () => (closeAsk === p.ticket ? closePos(p) : setCloseAsk(p.ticket))} style={{ ...btn("#e0463f"), background: closeAsk === p.ticket ? "#8a2a26" : "transparent", color: closeAsk === p.ticket ? "#fff" : "#f3b5ae" }}>{busy ? "…" : closeAsk === p.ticket ? "Confirm" : "Close"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
            {bottomTab === "Pending" && (
              pending.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: "var(--e-muted)" }}>No pending orders. Pick Limit or Stop in the order ticket to place one.</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Symbol", "Type", "Lot", "Price", "Distance", "Stop Loss", "Take Profit", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {pending.map((o) => {
                      const d = pendDist(o);
                      return (
                        <tr key={o.ticket} style={{ opacity: posBusy === o.ticket ? 0.55 : 1 }}>
                          <td style={td}>{o.symbol} <span style={{ color: "var(--e-muted)", fontSize: 10.5 }}>#{o.ticket}</span></td>
                          <td style={{ ...td, color: o.type.startsWith("buy") ? UP : DOWN, fontWeight: 600 }}>{o.type.replace("_", " ").toUpperCase()}</td>
                          <td style={td}>{o.volume.toFixed(2)}</td>
                          <td style={td}>{fx(o.symbol, o.price)}</td>
                          <td style={td}>{d != null ? d.toFixed(digitsOf(o.symbol, o.price)) : "—"}</td>
                          <td style={td}>{fx(o.symbol, o.sl)}</td>
                          <td style={td}>{fx(o.symbol, o.tp)}</td>
                          <td style={{ ...td, textAlign: "right" }}><span onClick={posBusy === o.ticket ? undefined : () => cancelPending(o)} style={btn("#e0463f")}>Cancel</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
            {bottomTab === "Today" && (
              todayClosed.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: "var(--e-muted)" }}>No closed trades today.</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Closed", "Symbol", "Side", "Lot", "Entry", "Exit", "P&L"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {todayClosed.map((r) => {
                      const tt = new Date((r.close_time ?? 0) * 1000);
                      const v = net(r);
                      return (
                        <tr key={r.id}>
                          <td style={td}>{`${pad2(tt.getHours())}:${pad2(tt.getMinutes())}`}</td>
                          <td style={td}>{r.symbol}</td>
                          <td style={{ ...td, color: r.direction === "buy" ? UP : DOWN }}>{r.direction === "buy" ? "BUY" : "SELL"}</td>
                          <td style={td}>{r.volume.toFixed(2)}</td>
                          <td style={td}>{fx(r.symbol, r.open_price)}</td>
                          <td style={td}>{fx(r.symbol, r.close_price)}</td>
                          <td style={{ ...td, fontWeight: 600, color: v >= 0 ? UP : DOWN }}>{pnlStr(v)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
            {bottomTab === "Alerts" && (
              alerts.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: "var(--e-muted)" }}>No alerts on {sym}. Pick the 🔔 tool on the chart toolbar (Alt+A) and click a price — Telegram tells you when it's reached.</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Symbol", "When price goes", "Price", "Distance", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {alerts.map((a) => {
                      const now = nowPrice();
                      return (
                        <tr key={a.id} style={{ opacity: a.triggered_at ? 0.6 : 1 }}>
                          <td style={td}>{a.symbol}</td>
                          <td style={td}>{a.direction === "above" ? "▲ above" : "▼ below"}</td>
                          <td style={td}>{fx(a.symbol, a.price)}</td>
                          <td style={td}>{now != null && !a.triggered_at ? Math.abs(now - a.price).toFixed(dg) : "—"}</td>
                          <td style={{ ...td, color: a.triggered_at ? UP : "var(--e-gold)" }}>{a.triggered_at ? `Reached ${new Date(a.triggered_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} @ ${fx(a.symbol, a.triggered_price)}` : "Armed"}</td>
                          <td style={{ ...td, textAlign: "right" }}><span onClick={() => removeAlert(a)} style={btn("#e0463f")}>Delete</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
            {bottomTab === "News" && <div style={{ padding: "6px 12px" }}><ElionNews rows={8} /></div>}
            {bottomTab === "Market" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Session", "Status", "Hours (UTC)"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {sessionsNow().map((s2) => (
                    <tr key={s2.name}>
                      <td style={td}>{s2.name}</td>
                      <td style={{ ...td, color: s2.status === "Active" ? UP : s2.status === "Upcoming" ? "#e9c77a" : "var(--e-muted)" }}>{s2.status}</td>
                      <td style={td}>{s2.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      <footer style={{ borderTop: "1px solid var(--e-line-2)", display: "flex", alignItems: "center", gap: 28, padding: "0 20px", fontSize: 11, color: "var(--e-text-2)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: app.live.status === "live" ? UP : DOWN }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: app.live.status === "live" ? UP : DOWN }} />
          {app.live.status === "live" ? "MT4 Connected" : app.live.status === "connecting" ? "MT4 Connecting…" : "MT4 Disconnected"}
        </span>
        <span>Account: {myLive ? (myLive.account.login ?? myLive.account.name) : "—"}</span>
        <span>Server: {myLive?.live.server ?? "—"}</span>
        <span>{myLive?.live.last_seen_ago != null ? `Updated ${Math.round(myLive.live.last_seen_ago)}s ago` : "No live account"}</span>
        <span style={{ flex: 1 }} />
        <span>ELION TRADING  v1.0.0</span>
        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", fontSize: 13, color: "var(--e-text-3)" }}>Trade Mindfully</span>
      </footer>
    </div>
  );
}
