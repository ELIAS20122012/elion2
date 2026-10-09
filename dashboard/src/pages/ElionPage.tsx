import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import * as topojson from "topojson-client";
import ElionAICard from "../components/ElionAICard";
import { ElionBrand, ElionSidebar, useElionClock } from "../components/ElionChrome";
import { equityCurve, isClosed, summarize } from "../lib/analytics";
import { fmtTime, TIMEFRAMES, type Candle } from "../lib/data";
import type { JTrade } from "../lib/journalApi";
import { useMaxPerDay } from "../lib/prefs";
import { dayPressure } from "../lib/pressure";
import { RULES } from "../lib/rules";
import { CITY_COORDS, sessionsNow } from "../lib/sessions";
import { useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";
import { useLiveAccount } from "../state/useLiveAccount";

/**
 * Ported from design/elion/index.html (reference design). Wired to the site's real market feed and journal —
 * every number here is either live from MT5/the journal server, or computed from real closed trades. The few
 * tiles the reference implied an AI system for ("AI Confidence", a live "Trend"/"Momentum" call) have no such
 * system behind this app, so they were replaced with real, plainly-computed reads (win rate, price direction,
 * a simple moving-average slope) rather than invented numbers.
 */

type Level = "critical" | "warn" | "info" | "ok";
interface Alert { level: Level; text: string }
const ALERT_ICON: Record<Level, { icon: string; bg: string }> = {
  critical: { icon: "warning", bg: "#b3322c" },
  warn: { icon: "warning", bg: "#8a5a1f" },
  info: { icon: "info", bg: "#3f8fb0" },
  ok: { icon: "check_circle", bg: "#1d6b52" },
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdSigned = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function KpiBox({ label, value, valueColor, sub, subColor }: { label: string; value: string; valueColor?: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
      <div style={{ fontSize: 10, letterSpacing: ".06em", color: "var(--e-text-2)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: valueColor }}>{value}</span>
        {sub && <span style={{ fontSize: 11, color: subColor }}>{sub}</span>}
      </div>
    </div>
  );
}

function StatusBox({ label, text, on, tone }: { label: string; text: string; on: boolean; tone?: "up" | "down" | "gold" }) {
  const c = tone === "down" ? "var(--e-down)" : tone === "gold" ? "var(--e-gold)" : "var(--e-up)";
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: ".06em", color: "var(--e-text-2)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? c : "var(--e-muted-2)", boxShadow: on ? `0 0 6px ${c}` : "none" }} />{text}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, gap = 2 }: { label: string; value: ReactNode; color?: string; gap?: number }) {
  return (
    <div style={{ borderRadius: 8, border: "1px solid var(--e-line)", background: "var(--e-panel-2)", padding: "7px 9px", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>{label}</div>
      <div style={{ fontSize: 11, color, display: "flex", alignItems: "center", gap }}>{value}</div>
    </div>
  );
}

function niceTicks(min: number, max: number, n = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  return Array.from({ length: n }, (_, i) => min + (i * (max - min)) / (n - 1));
}

export default function ElionPage() {
  const clock = useElionClock();
  const app = useApp();
  const j = useJournal();
  const [cap] = useMaxPerDay();
  const rows = useAllAccounts(j.accounts, j.status === "ok", 8000);
  const myLive = useLiveAccount(j.accounts, j.status === "ok");
  const [perf, setPerf] = useState("Today");
  const [sess, setSess] = useState<string | null>(null);
  const [dark, setDark] = useState(true);
  const [topo, setTopo] = useState<any>(null);

  const sparkRef = useRef<HTMLCanvasElement>(null);
  const candleRef = useRef<HTMLCanvasElement>(null);
  const acctRef = useRef<HTMLCanvasElement>(null);
  const perfRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const landCache = useRef<{ w: number; h: number; dots: [number, number][] } | null>(null);
  const alertsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/elion/land-110m.json").then((r) => r.json()).then(setTopo).catch(() => {});
  }, []);

  const { last, change, source, mode, live } = app;
  const today = last ? Math.floor(last.time / 86400) : Math.floor(Date.now() / 86400000);
  const dayCandles = source.filter((c) => Math.floor(c.time / 86400) === today);
  const dayOpen = dayCandles[0]?.open;
  const pct = dayOpen ? (change / dayOpen) * 100 : 0;
  const hi = dayCandles.length ? Math.max(...dayCandles.map((c) => c.high)) : null;
  const lo = dayCandles.length ? Math.min(...dayCandles.map((c) => c.low)) : null;
  const bullish = change >= 0;

  const real = rows.filter((r) => r.account.kind !== "backtest");
  const trades: JTrade[] = useMemo(() => real.flatMap((r) => r.trades), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const connected = real.filter((r) => r.live?.connected).length;
  const pr = dayPressure(trades, today, cap);
  const sum = useMemo(() => summarize(trades), [trades]);
  const doneRules = RULES.filter((r) => r.status === "approved").length;

  const nowSec = Date.now() / 1000;
  const rangeCutoff = perf === "Today" ? today * 86400 : perf === "Week" ? nowSec - 7 * 86400 : perf === "Month" ? nowSec - 30 * 86400 : 0;
  const rangeTrades = useMemo(() => trades.filter((t) => (t.close_time ?? t.open_time) >= rangeCutoff), [trades, rangeCutoff]);
  const rangeSum = useMemo(() => summarize(rangeTrades), [rangeTrades]);
  const rangeCurve = useMemo(() => equityCurve(rangeTrades), [rangeTrades]);

  const acctCurve = useMemo(() => equityCurve(trades).map((p) => p.equity), [trades]);
  const spark = useMemo(() => source.slice(-30).map((c) => c.close), [source]);
  const candles = useMemo(() => app.bars.slice(-62), [app.bars]);

  const momentum = useMemo(() => {
    const closes = app.bars.slice(-24).map((c) => c.close);
    if (closes.length < 16) return "Steady";
    const older = closes.slice(0, 8), newer = closes.slice(-8);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const d = avg(newer) - avg(older);
    const eps = (Math.max(...closes) - Math.min(...closes)) * 0.05;
    return d > eps ? "Strengthening" : d < -eps ? "Weakening" : "Steady";
  }, [source]);

  const recentTrades = useMemo(
    () => [...trades].sort((a, b) => (b.close_time ?? b.open_time) - (a.close_time ?? a.open_time)).slice(0, 4),
    [trades],
  );

  const alerts: Alert[] = [];
  if (mode === "live" && live.status !== "live") alerts.push({ level: "critical", text: "Live price feed disconnected (MT5 bridge)" });
  if (j.status !== "ok") alerts.push({ level: "critical", text: "Journal server is offline" });
  real.filter((r) => !r.live?.connected).forEach((r) => alerts.push({ level: "warn", text: `Account "${r.account.name}" is not connected` }));
  if (pr.tradesToday > pr.cap) alerts.push({ level: "critical", text: `${pr.tradesToday} trades today — over your ${pr.cap}-trade cap` });
  else if (pr.tradesToday === pr.cap && pr.cap > 0) alerts.push({ level: "warn", text: `Reached today's ${pr.cap}-trade cap` });
  if (pr.peakToday > 0 && pr.givebackToday / pr.peakToday >= 0.5) alerts.push({ level: "warn", text: `Gave back half of today's peak profit (-${pr.givebackToday.toFixed(2)}$)` });
  if (pr.lossStreak >= 2) alerts.push({ level: "warn", text: `${pr.lossStreak} losing trades in a row` });
  const nextRule = RULES.find((r) => r.status !== "approved");
  if (RULES.length === 0) alerts.push({ level: "info", text: "No trading rules defined yet" });
  else if (nextRule) alerts.push({ level: "info", text: `Next rule being taught: ${nextRule.title}` });
  if (!alerts.some((a) => a.level === "critical" || a.level === "warn")) alerts.unshift({ level: "ok", text: "Everything looks normal" });

  const sessions = sessionsNow();
  const realActiveSession = sessions.find((s) => s.status === "Active")?.name ?? null;
  // "activeSess" drives the Session Activity map/list (user can pick a city there); the header's own
  // status line always reflects the real current session, independent of that pick.
  const activeSess = sess ?? realActiveSession ?? sessions[0].name;

  const prep = (el: HTMLCanvasElement | null) => {
    if (!el || !el.clientWidth) return null;
    const d = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
    if (el.width !== Math.round(w * d) || el.height !== Math.round(h * d)) {
      el.width = Math.round(w * d);
      el.height = Math.round(h * d);
    }
    const ctx = el.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  };

  const area = (ctx: CanvasRenderingContext2D, pts: number[], x0: number, y0: number, w: number, h: number, min: number, max: number, color: string, fillA: string | null) => {
    const span = max - min || 1;
    const X = (i: number) => x0 + (i / Math.max(1, pts.length - 1)) * w;
    const Y = (v: number) => y0 + h - ((v - min) / span) * h;
    ctx.beginPath();
    pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (fillA) {
      ctx.lineTo(X(pts.length - 1), y0 + h);
      ctx.lineTo(x0, y0 + h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, fillA);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fill();
    }
    return { X, Y };
  };

  const drawMap = ({ ctx, w, h }: { ctx: CanvasRenderingContext2D; w: number; h: number }) => {
    const L0 = -135, L1 = 160, A0 = 78, A1 = -52;
    const px = (lon: number) => ((lon - L0) / (L1 - L0)) * w;
    const py = (lat: number) => ((A0 - lat) / (A0 - A1)) * h;
    if (topo) {
      let cache = landCache.current;
      if (!cache || cache.w !== w || cache.h !== h) {
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const o = off.getContext("2d")!;
        const land: any = topojson.feature(topo, topo.objects.land);
        o.fillStyle = "#fff";
        o.beginPath();
        const polys: number[][][][] = land.features
          ? land.features.flatMap((f: any) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates))
          : land.geometry.type === "Polygon" ? [land.geometry.coordinates] : land.geometry.coordinates;
        polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([lo2, la]: number[], i: number) => (i ? o.lineTo(px(lo2), py(la)) : o.moveTo(px(lo2), py(la))))));
        o.fill("evenodd");
        const data = o.getImageData(0, 0, w, h).data;
        const dots: [number, number][] = [];
        for (let y = 2; y < h; y += 4.2) for (let x = 2; x < w; x += 4.2) if (data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] > 0) dots.push([x, y]);
        cache = { w, h, dots };
        landCache.current = cache;
      }
      ctx.fillStyle = "rgba(190,205,200,.32)";
      cache.dots.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 1.05, 0, 7);
        ctx.fill();
      });
    }
    const Pp = (n: string): [number, number] => [px(CITY_COORDS[n][0]), py(CITY_COORDS[n][1])];
    const arc = (a: string, b: string) => {
      const [x1, y1] = Pp(a), [x2, y2] = Pp(b);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - Math.abs(x2 - x1) * 0.28, x2, y2);
      ctx.strokeStyle = "rgba(236,220,184,.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    arc("New York", "London");
    arc("London", "Tokyo");
    Object.keys(CITY_COORDS).forEach((n) => {
      const [x, y] = Pp(n), on = n === activeSess;
      if (on) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
        g.addColorStop(0, "rgba(236,220,184,.6)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = "#ecdcb8";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, on ? 5 : 3.5, 0, 7);
      ctx.stroke();
      ctx.fillStyle = on ? "#ecdcb8" : "#0d181b";
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 7);
      ctx.fill();
    });
  };

  useEffect(() => {
    const F = "10px Manrope, sans-serif";
    let s = prep(sparkRef.current);
    if (s && spark.length > 1) area(s.ctx, spark, 2, 4, s.w - 4, s.h - 8, Math.min(...spark), Math.max(...spark), bullish ? "#3ec495" : "#e05a4e", null);

    s = prep(acctRef.current);
    if (s && acctCurve.length > 1) area(s.ctx, acctCurve, 0, 4, s.w, s.h - 6, Math.min(0, ...acctCurve), Math.max(0, ...acctCurve), "#e2cc9f", "rgba(226,204,159,.28)");

    s = prep(candleRef.current);
    if (s && candles.length > 1) {
      const { ctx, w, h } = s, R = 46, top = 6, VB = Math.round(h * 0.14), ph = h - VB - 22;
      const highs = candles.map((c: Candle) => c.high), lows = candles.map((c: Candle) => c.low);
      const pad = (Math.max(...highs) - Math.min(...lows)) * 0.08 || 1;
      const min = Math.min(...lows) - pad, max = Math.max(...highs) + pad;
      const vols = candles.map((c: Candle) => c.volume ?? 0);
      const maxVol = Math.max(1, ...vols);
      const cw = (w - R) / candles.length;
      const Y = (v: number) => top + ph - ((v - min) / (max - min)) * ph;
      ctx.font = F;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      niceTicks(min, max, 5).forEach((v) => {
        ctx.strokeStyle = "rgba(200,215,210,.06)";
        ctx.beginPath();
        ctx.moveTo(0, Y(v));
        ctx.lineTo(w - R, Y(v));
        ctx.stroke();
        ctx.fillStyle = "#8e9896";
        ctx.fillText(v.toFixed(2), w - R + 8, Y(v));
      });
      candles.forEach((c: Candle, i: number) => {
        const x = i * cw + cw / 2, up = c.close >= c.open, col = up ? "#3ec495" : "#cdb88f";
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, Y(c.high));
        ctx.lineTo(x, Y(c.low));
        ctx.stroke();
        ctx.fillStyle = col;
        const y1 = Y(Math.max(c.open, c.close));
        ctx.fillRect(x - cw * 0.32, y1, cw * 0.64, Math.max(1, Y(Math.min(c.open, c.close)) - y1));
        if (c.volume) {
          ctx.fillStyle = "rgba(62,196,149,.28)";
          const vh = (c.volume / maxVol) * VB;
          ctx.fillRect(x - cw * 0.32, h - 16 - vh, cw * 0.64, vh);
        }
      });
      if (last) {
        const ly = Y(last.close);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = "rgba(233,215,176,.5)";
        ctx.beginPath();
        ctx.moveTo(0, ly);
        ctx.lineTo(w - R, ly);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ecdcb8";
        ctx.beginPath();
        ctx.roundRect(w - R + 1, ly - 9, R - 1, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#1a1409";
        ctx.font = "600 10px Manrope, sans-serif";
        ctx.fillText(last.close.toFixed(2), w - R + 4, ly);
      }
      ctx.font = F;
      ctx.fillStyle = "#8e9896";
      ctx.textAlign = "center";
      [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
        const i = Math.min(candles.length - 1, Math.round(f * (candles.length - 1)));
        ctx.fillText(fmtTime(candles[i].time), 14 + f * (w - R - 28), h - 5);
      });
    }

    s = prep(perfRef.current);
    if (s) {
      const { ctx, w, h } = s, R = 34, B = 16, pw = w - R, ph = h - B;
      const vals = rangeCurve.map((p) => p.equity);
      const min = Math.min(0, ...vals), max = Math.max(0, ...vals) || 1;
      const Y = (v: number) => ph - ((v - min) / (max - min || 1)) * ph;
      ctx.font = F;
      ctx.textBaseline = "middle";
      niceTicks(min, max, 4).forEach((v) => {
        ctx.fillStyle = "#8e9896";
        ctx.textAlign = "left";
        ctx.fillText(v.toFixed(0), pw + 6, Y(v));
      });
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = "rgba(200,215,210,.12)";
      ctx.beginPath();
      ctx.moveTo(0, Y(0));
      ctx.lineTo(pw, Y(0));
      ctx.stroke();
      ctx.setLineDash([]);
      if (vals.length > 1) {
        const { X, Y: Y2 } = area(ctx, vals, 4, 0, pw - 4, ph, min, max, "#e2cc9f", rangeSum.net >= 0 ? "rgba(62,196,149,.3)" : "rgba(224,90,78,.25)");
        const lx = X(vals.length - 1), ly = Y2(vals[vals.length - 1]);
        ctx.fillStyle = "#ecdcb8";
        ctx.beginPath();
        ctx.arc(lx, ly, 3.5, 0, 7);
        ctx.fill();
        const tag = usdSigned(rangeSum.net);
        ctx.font = "600 10px Manrope, sans-serif";
        const tw = Math.max(40, ctx.measureText(tag).width + 12);
        ctx.beginPath();
        ctx.roundRect(lx - tw + 22, ly - 26, tw, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#1a1409";
        ctx.textAlign = "center";
        ctx.fillText(tag, lx - tw / 2 + 22, ly - 17);
      }
    }

    s = prep(mapRef.current);
    if (s) drawMap(s);
  });

  const [, forceRedraw] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      landCache.current = null;
      forceRedraw((n) => n + 1); // the draw effect above has no dep array, so any re-render redraws at the new size
    });
    [sparkRef, candleRef, acctRef, perfRef, mapRef].forEach((r) => {
      if (r.current) ro.observe(r.current);
    });
    return () => ro.disconnect();
  }, []);

  const perfTabs = ["Today", "Week", "Month", "Custom"];

  return (
    <div className="elion-scope e-root" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Home" />
      <main style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 22, height: 44 }}>
          <ElionBrand />
          <div className="e-hide-md" style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--e-text-2)" }}>DISCIPLINE BUILDS FREEDOM</div>
          <div className="e-hide-sm" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,380px)", height: 36, borderRadius: 18, border: "1px solid var(--e-field-line)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px", color: "#7f8b89" }}>
              <span className="e-icon" style={{ fontSize: 18 }}>search</span>
              <span style={{ flex: 1, fontSize: 11 }}>Search trades, charts, instruments, or ask Elion...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl K</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--e-text)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: realActiveSession ? "var(--e-up)" : "var(--e-muted-2)", boxShadow: realActiveSession ? "0 0 6px var(--e-up)" : "none" }} />
              {realActiveSession ? `${realActiveSession} Session • Live` : "No session open"}
            </div>
            <div style={{ color: "var(--e-muted)" }}>{clock}</div>
          </div>
          <div
            onClick={() => alertsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            title="Jump to Alerts & Notifications"
            style={{ position: "relative", color: "var(--e-gold)", cursor: "pointer" }}
          >
            <span className="e-icon fill" style={{ fontSize: 24 }}>notifications</span>
            {alerts.some((a) => a.level === "critical" || a.level === "warn") && (
              <span style={{ position: "absolute", top: 2, right: 1, width: 7, height: 7, borderRadius: "50%", background: "var(--e-down)" }} />
            )}
          </div>
          <Link to="/settings" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>EF</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--e-text)" }}>Elias Farahani</div>
              <div style={{ fontSize: 10, color: "var(--e-muted)" }}>Trader | Build the Edge</div>
            </div>
            <span className="e-icon" style={{ fontSize: 18, color: "var(--e-muted)" }}>expand_more</span>
          </Link>
          <div onClick={() => setDark((d) => !d)} style={{ width: 52, height: 26, borderRadius: 13, border: "1px solid var(--e-border-2)", background: "var(--e-field)", position: "relative", cursor: "pointer" }}>
            <div style={{ position: "absolute", top: 2, left: dark ? 28 : 2, width: 20, height: 20, borderRadius: "50%", background: "var(--e-gold-2)", display: "grid", placeItems: "center", transition: "left .25s" }}>
              <span className="e-icon" style={{ fontSize: 14, color: "#1a1409" }}>{dark ? "dark_mode" : "light_mode"}</span>
            </div>
          </div>
        </header>

        <div className="e-kpis" style={{ display: "grid", gridTemplateColumns: "322fr 150fr 148fr 90fr 112fr 112fr 192fr", gap: 10, height: 64 }}>
          <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #6b5634, #2b2213)", border: "1px solid rgba(233,215,176,.5)", display: "grid", placeItems: "center", color: "var(--e-gold-2)", fontSize: 10, fontWeight: 700 }}>Au</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--e-text-2)" }}>{app.mode === "replay" ? "XAUUSD (replay)" : "XAUUSD"}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>{last ? last.close.toFixed(2) : "—"}</span>
                <span style={{ fontSize: 11, color: bullish ? "var(--e-up)" : "var(--e-down)" }}>{(change >= 0 ? "+" : "") + change.toFixed(2)}</span>
                <span style={{ fontSize: 11, color: bullish ? "var(--e-up)" : "var(--e-down)" }}>{(pct >= 0 ? "+" : "") + pct.toFixed(2)}%</span>
              </div>
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 60, height: 34 }}>
              <canvas ref={sparkRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
            </div>
          </div>
          <KpiBox label="LIVE ACCOUNT" value={myLive ? usd(myLive.live.balance ?? 0) : "—"} sub={myLive && myLive.live.floating ? usdSigned(myLive.live.floating) : undefined} subColor={myLive && (myLive.live.floating ?? 0) >= 0 ? "var(--e-up)" : "var(--e-down)"} />
          <KpiBox label="DAILY P&L" value={trades.length ? usdSigned(pr.netToday) : "—"} valueColor={pr.netToday >= 0 ? "var(--e-up)" : "var(--e-down)"} />
          <KpiBox label="TRADES" value={`${pr.tradesToday} / ${pr.cap}`} />
          <StatusBox label="MT5" text={live.status === "live" ? "Connected" : live.status === "connecting" ? "Connecting…" : "Disconnected"} on={live.status === "live"} tone={live.status === "live" ? "up" : live.status === "connecting" ? "gold" : "down"} />
          <StatusBox label="JOURNAL" text={j.status === "ok" ? "Connected" : j.status === "loading" ? "Connecting…" : "Offline"} on={j.status === "ok"} tone={j.status === "ok" ? "up" : j.status === "loading" ? "gold" : "down"} />
          <Link to="/settings" title="Daily trade cap and risk settings" style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "0 14px", display: "flex", alignItems: "center", gap: 12, color: "inherit" }}>
            <span className="e-icon" style={{ fontSize: 34, color: pr.level === "high" ? "var(--e-down)" : pr.level === "watch" ? "var(--e-gold)" : "var(--e-up)" }}>verified_user</span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 10, letterSpacing: ".06em", color: "var(--e-text-2)" }}>RISK STATUS</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{pr.level === "calm" ? "Calm" : pr.level === "watch" ? "Watch" : "High"}</div>
            </div>
            <span className="e-icon" style={{ fontSize: 20, color: "var(--e-text-2)" }}>chevron_right</span>
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "282fr 520fr 365fr", gridTemplateRows: "max(460px, calc((100vw - 110px) * 0.37))", gap: 12, alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, contain: "size" }}>
            <div style={{ flex: 1.35, borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Trader State</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 10px", borderRadius: 10, background: "#15252a" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--e-up)" }} />Live
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                {(() => {
                  const discipline = Math.max(0, Math.min(100, Math.round(100 - pr.score)));
                  const giveRatio = pr.peakToday > 0 ? Math.min(1, pr.givebackToday / pr.peakToday) : 0;
                  const ruleRatio = RULES.length ? doneRules / RULES.length : 0;
                  const bars = [
                    { label: "Trades Today", value: `${pr.tradesToday} / ${pr.cap}`, w: `${Math.min(100, (pr.tradesToday / Math.max(1, pr.cap)) * 100)}%` },
                    { label: "Giveback From Peak", value: `${Math.round(giveRatio * 100)}%`, w: `${giveRatio * 100}%` },
                    { label: "Rule Compliance", value: `${doneRules} / ${RULES.length}`, w: `${ruleRatio * 100}%` },
                  ];
                  return (
                    <>
                      <div style={{ width: 104, height: 104, flexShrink: 0, borderRadius: "50%", background: `conic-gradient(#e2cc9f ${discipline * 3.6}deg, #1b2a2e 0)`, display: "grid", placeItems: "center", boxShadow: "0 0 24px rgba(233,215,176,.12)" }}>
                        <div style={{ width: 88, height: 88, borderRadius: "50%", background: "#0d181b", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                          <div style={{ fontSize: 24, fontWeight: 600 }}>{discipline}%</div>
                          <div style={{ fontSize: 9, letterSpacing: ".08em", color: "var(--e-text-2)" }}>DISCIPLINE</div>
                        </div>
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                        {bars.map((b) => (
                          <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 11, whiteSpace: "nowrap" }}>
                              <span style={{ color: "var(--e-text-3)" }}>{b.label}</span>
                              <span>{b.value}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: "#1b2a2e", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: b.w, borderRadius: 3, background: "var(--e-gold)" }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--e-border)", background: "var(--e-panel-2)" }}>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, lineHeight: 0.6, color: "var(--e-gold)", height: 14 }}>&ldquo;</span>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", fontSize: 14, color: "var(--e-text)" }}>&ldquo;Discipline today, freedom tomorrow.&rdquo;</span>
              </div>
            </div>
            <div ref={alertsRef} style={{ flex: 1, borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minHeight: 0, overflow: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>Alerts &amp; Notifications</div>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>{alerts.length}</div>
              </div>
              {alerts.map((a, i) => (
                <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--e-line-3)", padding: "6px 0" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: ALERT_ICON[a.level].bg, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <span className="e-icon fill" style={{ fontSize: 16, color: "#fff" }}>{ALERT_ICON[a.level].icon}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: "#e6ebe9" }}>{a.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ minWidth: 0, minHeight: 0, height: "100%" }}>
            <ElionAICard />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, contain: "size" }}>
            <div style={{ flex: 2.6, borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Market Intelligence</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>XAUUSD</span>
                  <div style={{ display: "flex", borderRadius: 8, background: "var(--e-panel-2)", border: "1px solid var(--e-line)", padding: 2 }}>
                    {TIMEFRAMES.map((tf) => (
                      <div key={tf.sec} onClick={() => app.setTfSec(tf.sec)} style={{ padding: "4px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: app.tfSec === tf.sec ? "var(--e-gold-2)" : "transparent", color: app.tfSec === tf.sec ? "#1a1409" : "var(--e-text-3)", fontWeight: app.tfSec === tf.sec ? 600 : 400 }}>
                        {tf.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{last ? last.close.toFixed(2) : "—"}</div>
                <div style={{ display: "flex", gap: 8, fontSize: 11, color: bullish ? "var(--e-up)" : "var(--e-down)" }}>
                  <span>{(change >= 0 ? "+" : "") + change.toFixed(2)}</span>
                  <span>{(pct >= 0 ? "+" : "") + pct.toFixed(2)}%</span>
                </div>
              </div>
              <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
                <canvas ref={candleRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
                <MiniStat label="Trend" color={bullish ? "var(--e-up)" : "var(--e-down)"} value={<><span className="e-icon" style={{ fontSize: 13 }}>{bullish ? "north_east" : "south_east"}</span>{bullish ? "Bullish" : "Bearish"}</>} />
                <MiniStat label="Momentum" value={momentum} />
                <MiniStat label="Session Extreme" value={hi != null && lo != null ? <><span className="e-icon" style={{ fontSize: 13, color: bullish ? "var(--e-up)" : "var(--e-down)" }}>{bullish ? "north_east" : "south_east"}</span>{(bullish ? hi : lo).toFixed(2)}</> : "—"} />
                <MiniStat
                  label="Win Rate"
                  gap={6}
                  value={
                    sum.count ? (
                      <>
                        <div style={{ width: 18, height: 18, borderRadius: "50%", background: `conic-gradient(#e2cc9f ${sum.winRate * 360}deg, #1b2a2e 0)`, display: "grid", placeItems: "center" }}>
                          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#0d181b" }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{Math.round(sum.winRate * 100)}%</span>
                      </>
                    ) : "—"
                  }
                />
              </div>
            </div>
            <div style={{ flex: 1, borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Account Overview</div>
              </div>
              <div style={{ flex: 1, display: "flex", gap: 12, minHeight: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Equity</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 19, fontWeight: 600 }}>{myLive ? usd(myLive.live.equity ?? myLive.live.balance ?? 0) : "—"}</span>
                  </div>
                </div>
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                  <canvas ref={acctRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
                <div><div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Balance</div><div style={{ fontSize: 12, marginTop: 3 }}>{myLive ? usd(myLive.live.balance ?? 0) : "—"}</div></div>
                <div><div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Floating</div><div style={{ fontSize: 12, marginTop: 3, color: myLive && (myLive.live.floating ?? 0) < 0 ? "var(--e-down)" : undefined }}>{myLive && myLive.live.floating != null ? usdSigned(myLive.live.floating) : "—"}</div></div>
                <div><div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Open Positions</div><div style={{ fontSize: 12, marginTop: 3 }}>{myLive?.live.open_count ?? "—"}</div></div>
                <div><div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Status</div><div style={{ fontSize: 12, marginTop: 3, color: myLive?.live.connected ? "var(--e-up)" : "var(--e-down)" }}>{myLive ? (myLive.live.connected ? "Connected" : "Disconnected") : "No live account"}</div></div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "390fr 355fr 422fr", gridTemplateRows: "228px", gap: 12, height: 228 }}>
          <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Performance</div>
              <div style={{ display: "flex", borderRadius: 8, background: "var(--e-panel-2)", border: "1px solid var(--e-line)", padding: 2 }}>
                {perfTabs.map((t) => (
                  <div key={t} onClick={() => setPerf(t)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: t === perf ? "var(--e-gold-2)" : "transparent", color: t === perf ? "#1a1409" : "var(--e-text-3)", fontWeight: t === perf ? 600 : 400 }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.1fr 1fr .8fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>P&amp;L</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: rangeSum.net >= 0 ? "var(--e-up)" : "var(--e-down)", marginTop: 3 }}>{rangeSum.count ? usdSigned(rangeSum.net) : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Win Rate</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: `conic-gradient(#e2cc9f ${rangeSum.winRate * 360}deg, #1b2a2e 0)`, display: "grid", placeItems: "center" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#0d181b" }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{rangeSum.count ? `${Math.round(rangeSum.winRate * 100)}%` : "—"}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Profit Factor</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 3 }}>{rangeSum.profitFactor != null ? rangeSum.profitFactor.toFixed(2) : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>Trades</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 3 }}>{rangeSum.count}</div>
                <div style={{ fontSize: 10, color: "var(--e-text-2)" }}>{rangeSum.wins}W / {rangeSum.losses}L</div>
              </div>
            </div>
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <canvas ref={perfRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
            </div>
          </div>

          <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Recent Trades</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: ".8fr 1.2fr 1fr 1fr 1fr 1fr", fontSize: 11, color: "var(--e-text-2)", paddingBottom: 6, borderBottom: "1px solid var(--e-line-3)" }}>
              <span>Time</span><span>Pair</span><span>Type</span><span>Entry</span><span>Exit</span><span style={{ textAlign: "right" }}>P&amp;L</span>
            </div>
            {recentTrades.length === 0 && <div style={{ fontSize: 11.5, color: "var(--e-muted)", padding: "8px 0" }}>No trades yet.</div>}
            {recentTrades.map((r) => {
              const v = isClosed(r) ? r.profit + r.commission + r.swap : r.profit;
              const t = new Date((r.close_time ?? r.open_time) * 1000);
              return (
                <div key={`${r.account_id}-${r.id}`} className="e-row" style={{ flex: 1, display: "grid", gridTemplateColumns: ".8fr 1.2fr 1fr 1fr 1fr 1fr", alignItems: "center", fontSize: 11, borderBottom: "1px solid #121f23" }}>
                  <span>{`${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`}</span>
                  <span>{r.symbol}</span>
                  <span><span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 5, fontSize: 10.5, background: r.direction === "sell" ? "#6e1f1c" : "#1d4a3b", color: r.direction === "sell" ? "#f3b5ae" : "#a9ecd0" }}>{r.direction === "sell" ? "Sell" : "Buy"}</span></span>
                  <span>{r.open_price.toFixed(2)}</span>
                  <span>{r.close_price != null ? r.close_price.toFixed(2) : "—"}</span>
                  <span style={{ textAlign: "right", fontWeight: 600, color: v >= 0 ? "var(--e-up)" : "var(--e-down)" }}>{usdSigned(v)}{!isClosed(r) && " •"}</span>
                </div>
              );
            })}
          </div>

          <div style={{ borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Session Activity</div>
              <div style={{ display: "flex", borderRadius: 8, background: "var(--e-panel-2)", border: "1px solid var(--e-line)", padding: 2 }}>
                {sessions.map((s) => (
                  <div key={s.name} onClick={() => setSess(s.name)} style={{ padding: "4px 16px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: s.name === activeSess ? "var(--e-gold-2)" : "transparent", color: s.name === activeSess ? "#1a1409" : "var(--e-text-3)", fontWeight: s.name === activeSess ? 600 : 400 }}>
                    {s.name}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0 }}>
              <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <canvas ref={mapRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
              </div>
              <div style={{ width: 150, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel-2)" }}>
                {sessions.map((s) => (
                  <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                    <div style={{ fontSize: 12, color: s.name === activeSess ? "var(--e-ivory)" : "var(--e-text)" }}>{s.name}</div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: s.status === "Active" ? "var(--e-up)" : "var(--e-muted)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", boxSizing: "border-box", border: `1px solid ${s.status === "Active" ? "var(--e-up)" : "var(--e-muted)"}`, background: s.status === "Active" ? "var(--e-up)" : "transparent" }} />
                        {s.status}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--e-muted-2)" }}>{s.hours}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ textAlign: "right", fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", fontSize: 14, color: "var(--e-text)" }}>&ldquo;Global Markets. A Larger You.&rdquo;</div>
          </div>
        </div>
      </main>
    </div>
  );
}
