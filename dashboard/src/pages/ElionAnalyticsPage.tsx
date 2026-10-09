import { useEffect, useMemo, useRef, useState } from "react";
import { ElionSidebar, useElionClock } from "../components/ElionChrome";
import { dateLocale, t } from "../lib/i18n";
import { byDay, durationSec, equityCurve, isClosed, net, summarize } from "../lib/analytics";
import { journalApi, type JTrade, type LiveInfo } from "../lib/journalApi";
import { RULES } from "../lib/rules";
import { sessionAt } from "../lib/sessions";
import { useJournal } from "../state/JournalContext";

/**
 * Ported from design/elion/analytics.dc.html (reference design). Every number here is now computed from
 * the active account's real trades (useJournal()), reusing the same analytics.ts the Persian journal
 * uses. The reference's "AI Insights" panel showed specific, confident-sounding claims with nothing real
 * behind them (a made-up win-rate trend, a made-up weakest weekday, ...); rather than invent numbers on
 * a page whose whole point is trustworthy analysis, that panel now shows a short list of plainly-computed
 * observations (best/worst weekday, best session, best R-multiple bucket) and only includes one once
 * there's enough real data to say it, with no "AI" framing and no random "generate another" gimmick.
 */

const TEAL = "var(--e-up-2)";
const RED = "var(--e-down-2)";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdSigned = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct1 = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function rMultiple(t: JTrade): number | null {
  if (t.sl == null || t.close_price == null) return null;
  const risk = Math.abs(t.open_price - t.sl);
  if (!risk) return null;
  const sign = net(t) >= 0 ? 1 : -1;
  return (Math.abs(t.close_price - t.open_price) / risk) * sign;
}

const DUR_ORDER = ["<5m", "5-15m", "15-30m", "30-60m", "1-2h", "2-4h", ">4h"];
function durBucket(sec: number): string {
  const m = sec / 60;
  if (m < 5) return "<5m"; if (m < 15) return "5-15m"; if (m < 30) return "15-30m";
  if (m < 60) return "30-60m"; if (m < 120) return "1-2h"; if (m < 240) return "2-4h"; return ">4h";
}
const RR_ORDER = ["<1:1", "1:1-1:2", "1:2-1:3", "1:3-1:5", "1:5-1:10", ">1:10"];
function rrBucket(r: number): string {
  if (r < 1) return "<1:1"; if (r < 2) return "1:1-1:2"; if (r < 3) return "1:2-1:3";
  if (r < 5) return "1:3-1:5"; if (r < 10) return "1:5-1:10"; return ">1:10";
}
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Bucket { key: string; count: number; net: number; winRate: number }
function bucketize(trades: JTrade[], keyOf: (t: JTrade) => string | null, order: string[]): Bucket[] {
  const m = new Map<string, JTrade[]>();
  for (const t of trades.filter(isClosed)) {
    const k = keyOf(t);
    if (k == null) continue;
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return order.map((k) => {
    const list = m.get(k) ?? [];
    const nets = list.map(net);
    return { key: k, count: list.length, net: nets.reduce((s, n) => s + n, 0), winRate: list.length ? nets.filter((n) => n > 0).length / list.length : 0 };
  });
}
function fmtDurMin(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const CARD: React.CSSProperties = { borderRadius: 12, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const PICKER: React.CSSProperties = {
  height: 48, boxSizing: "border-box", borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-panel-2)",
  display: "flex", alignItems: "center", padding: "0 12px", gap: 8, cursor: "pointer",
};

function Tabs({ list, cur, onPick, pad }: { list: string[]; cur: string; onPick: (l: string) => void; pad: string }) {
  return (
    <div style={{ display: "flex", borderRadius: 8, background: "var(--e-panel-2)", border: "1px solid var(--e-line)", padding: 2 }}>
      {list.map((l) => (
        <div key={l} onClick={() => onPick(l)} style={{ padding: pad, borderRadius: 6, fontSize: pad === "5px 14px" ? 11.5 : 11, cursor: "pointer", background: l === cur ? "var(--e-gold-2)" : "transparent", color: l === cur ? "#1a1409" : "var(--e-text-3)", fontWeight: l === cur ? 600 : 400 }}>{l}</div>
      ))}
    </div>
  );
}

function Picker({ label, value, onChange, options, width }: { label: string; value: string; onChange: (v: string) => void; options: string[]; width: number }) {
  return (
    <label style={{ ...PICKER, width }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 10, color: "var(--e-text-2)" }}>{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} style={{ background: "transparent", border: 0, outline: 0, color: "var(--e-text)", fontSize: 13, width: "100%" }}>
          {options.map((o) => <option key={o} value={o} style={{ color: "#000" }}>{o}</option>)}
        </select>
      </div>
      <span className="e-icon" style={{ fontSize: 18, color: "var(--e-text-2)" }}>expand_more</span>
    </label>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>{label}</div>
      <div style={{ fontSize: 15, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: color === RED ? "var(--e-muted)" : color }}>{sub}</div>}
    </div>
  );
}

function SideStats({ width, rows }: { width: number; rows: [string, string, string?][] }) {
  return (
    <div style={{ width, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, paddingTop: 8 }}>
      {rows.map(([l, v, c]) => (
        <div key={l}>
          <div style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>{l}</div>
          <div style={{ fontSize: 15, marginTop: 3, color: c }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function niceTicks(min: number, max: number, n = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  return Array.from({ length: n }, (_, i) => min + (i * (max - min)) / (n - 1));
}

export default function ElionAnalyticsPage() {
  const clock = useElionClock();
  const { accounts, active, setActive, trades: allTrades, status, statusError } = useJournal();
  const [symbol, setSymbol] = useState("All");
  const [range, setRange] = useState("All Time");
  const [eqTab, setEqTab] = useState("Equity");
  // The picked account's own live feed. The journal only stores closed trades, so without this the
  // page reported a balance that ignored the broker and anything still open.
  const [live, setLive] = useState<LiveInfo | null>(null);
  // The feed can flap between terminals (one logged into another account), so a banner tied to the
  // latest poll would blink. Latch the last reason for 90s instead.
  const [feedIssue, setFeedIssue] = useState<{ msg: string; at: number } | null>(null);
  useEffect(() => {
    const id = active?.id;
    if (id == null) { setLive(null); setFeedIssue(null); return; }
    let dead = false;
    const load = () => {
      journalApi.live(id).then((l) => {
        if (dead) return;
        setLive(l);
        if (l.error) setFeedIssue({ msg: l.error, at: Date.now() });
      }).catch(() => {});
    };
    load();
    const iv = window.setInterval(load, 5000);
    return () => { dead = true; window.clearInterval(iv); };
  }, [active?.id]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const iv = window.setInterval(() => setNowMs(Date.now()), 5000); return () => window.clearInterval(iv); }, []);
  const showFeedIssue = feedIssue != null && nowMs - feedIssue.at < 90_000;
  const [dp, setDp] = useState("Calendar");

  const symbols = useMemo(() => [...new Set(allTrades.map((t) => t.symbol))], [allTrades]);
  const nowSec = Date.now() / 1000;
  const todayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const RANGE_CUTOFF: Record<string, number> = { "All Time": 0, Today: todayStart, "Last 7 Days": nowSec - 7 * 86400, "Last 30 Days": nowSec - 30 * 86400, "Last 90 Days": nowSec - 90 * 86400 };

  const trades = useMemo(
    () => allTrades.filter((t) => (symbol === "All" || t.symbol === symbol) && (t.close_time ?? t.open_time) >= RANGE_CUTOFF[range]),
    [allTrades, symbol, range], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sum = useMemo(() => summarize(trades), [trades]);
  const startBalance = active?.initial_balance ?? 0;
  const curve = useMemo(() => equityCurve(trades, startBalance), [trades, startBalance]);
  const ddPct = useMemo(() => {
    let peak = startBalance;
    return curve.map((p) => { peak = Math.max(peak, p.equity); return peak > 0 ? ((p.equity - peak) / peak) * 100 : 0; });
  }, [curve, startBalance]);
  const maxDrawdownPct = ddPct.length ? Math.min(...ddPct, 0) : 0;
  const recoveryFactor = sum.maxDrawdown > 0 ? sum.net / sum.maxDrawdown : null;
  const days = useMemo(() => byDay(trades, 999).sort((a, b) => (a.day < b.day ? -1 : 1)), [trades]); // chronological
  const doneRules = RULES.filter((r) => r.status === "approved").length;

  const setupRows = useMemo(() => {
    const rows = bucketize(trades, (t) => t.setup_id ?? "Unlabeled", [...new Set(trades.map((t) => t.setup_id ?? "Unlabeled"))]).filter((r) => r.count > 0);
    return rows.sort((a, b) => b.count - a.count);
  }, [trades]);
  const symbolRows = useMemo(() => bucketize(trades, (t) => t.symbol, [...new Set(trades.map((t) => t.symbol))]).sort((a, b) => b.count - a.count), [trades]);
  const sessionRows = useMemo(() => bucketize(trades, (t) => sessionAt(t.open_time), ["London", "New York", "Tokyo"]), [trades]);
  const directionRows = useMemo(() => bucketize(trades, (t) => t.direction, ["buy", "sell"]), [trades]);
  const durRows = useMemo(() => bucketize(trades, (t) => (isClosed(t) ? durBucket(durationSec(t)) : null), DUR_ORDER), [trades]);
  const rrTrades = useMemo(() => trades.map((t) => ({ t, r: rMultiple(t) })).filter((x): x is { t: JTrade; r: number } => x.r != null), [trades]);
  const rrRows = useMemo(() => {
    const m = new Map<string, number[]>();
    rrTrades.forEach(({ t, r }) => { const k = rrBucket(r); m.set(k, [...(m.get(k) ?? []), net(t)]); });
    return RR_ORDER.map((k) => { const nets = m.get(k) ?? []; return { key: k, count: nets.length, net: nets.reduce((s, n) => s + n, 0), winRate: nets.length ? nets.filter((n) => n > 0).length / nets.length : 0 }; });
  }, [rrTrades]);
  const avgRR = rrTrades.length ? rrTrades.reduce((s, x) => s + x.r, 0) / rrTrades.length : null;
  const weekdayRows = useMemo(() => bucketize(trades, (t) => WEEKDAY_EN[new Date((t.close_time ?? t.open_time) * 1000).getUTCDay()], WEEKDAY_EN), [trades]);

  const SETUP_COLORS = ["#3ccfb2", "#1f8f7c", "#e2cc9f", "#b08f5c", "#e0474c", "#f3e6c8", "#4aa3df", "#8a6ad0"];

  const insights = useMemo(() => {
    const list: { icon: string; bg: string; a: string; b: string }[] = [];
    const bestDay = [...weekdayRows].filter((r) => r.count >= 3).sort((a, b) => b.net - a.net)[0];
    const worstDay = [...weekdayRows].filter((r) => r.count >= 3).sort((a, b) => a.net - b.net)[0];
    if (bestDay && worstDay && bestDay.key !== worstDay.key) {
      list.push({ icon: "arrow_upward", bg: "#1d6b5e", a: `${bestDay.key} is your best day (${usdSigned(bestDay.net)} net, ${Math.round(bestDay.winRate * 100)}% win rate).`, b: `Based on ${bestDay.count} closed trades.` });
      list.push({ icon: "warning", bg: "#9c2b2f", a: `${worstDay.key} is your weakest day (${usdSigned(worstDay.net)} net).`, b: `Based on ${worstDay.count} closed trades.` });
    }
    const bestSession = [...sessionRows].filter((r) => r.count >= 3).sort((a, b) => b.net - a.net)[0];
    if (bestSession) list.push({ icon: "schedule", bg: "#6b5a2e", a: `${bestSession.key} session produces your best results (${usdSigned(bestSession.net)} net, ${Math.round(bestSession.winRate * 100)}% win rate).`, b: `Based on ${bestSession.count} closed trades.` });
    const bestRR = [...rrRows].filter((r) => r.count >= 3).sort((a, b) => b.winRate - a.winRate)[0];
    if (bestRR) list.push({ icon: "bar_chart", bg: "#2a5f9e", a: `Trades with an R-multiple of ${bestRR.key} win most often (${Math.round(bestRR.winRate * 100)}% win rate).`, b: `Based on ${bestRR.count} trades with a stop-loss set.` });
    const bestDur = [...durRows].filter((r) => r.count >= 3).sort((a, b) => b.winRate - a.winRate)[0];
    if (bestDur) list.push({ icon: "lightbulb", bg: "#5b3f9e", a: `Trades held ${bestDur.key} win most often (${Math.round(bestDur.winRate * 100)}% win rate).`, b: `Based on ${bestDur.count} closed trades.` });
    return list;
  }, [weekdayRows, sessionRows, rrRows, durRows]);

  const cv = useRef<Record<string, HTMLCanvasElement | null>>({});
  const set = (k: string) => (el: HTMLCanvasElement | null) => { cv.current[k] = el; };
  const eqTabRef = useRef(eqTab);
  eqTabRef.current = eqTab;

  useEffect(() => {
    const prep = (el: HTMLCanvasElement | null) => {
      if (!el || !el.clientWidth || !el.clientHeight) return null;
      const d = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * d) || el.height !== Math.round(h * d)) { el.width = Math.round(w * d); el.height = Math.round(h * d); }
      const ctx = el.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);
      return { ctx, w, h };
    };
    const line = (ctx: CanvasRenderingContext2D, pts: number[], X: (i: number) => number, Y: (v: number) => number) => {
      ctx.beginPath();
      pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    };
    const area = (ctx: CanvasRenderingContext2D, pts: number[], X: (i: number) => number, Y: (v: number) => number, base: number, c1: string, c2: string, stroke: string) => {
      if (pts.length < 2) return;
      line(ctx, pts, X, Y); ctx.lineTo(X(pts.length - 1), base); ctx.lineTo(X(0), base); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, base); g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; ctx.fill();
      line(ctx, pts, X, Y); ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 1;
    };
    const noData = (ctx: CanvasRenderingContext2D, w: number, h: number, text = t("Not enough data yet")) => {
      ctx.font = "12px Manrope, sans-serif"; ctx.fillStyle = "#6f7b79"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, h / 2);
    };

    const drawEq = ({ ctx, w, h }: { ctx: CanvasRenderingContext2D; w: number; h: number }) => {
      const m = eqTabRef.current, L = 52, R = m === "Equity" ? 44 : 14, T = 8, B = 20, pw = w - L - R, ph = h - T - B;
      ctx.font = "10px Manrope, sans-serif"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;
      const grid = (vals: number[], Y: (v: number) => number, fmt: (v: number) => string) =>
        vals.forEach((v) => {
          const y = Y(v);
          ctx.strokeStyle = "rgba(200,215,210,.07)"; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
          ctx.fillStyle = "#8e9896"; ctx.textAlign = "right"; ctx.fillText(fmt(v), L - 8, y);
        });

      if (m === "Daily P&L") {
        if (days.length === 0) return noData(ctx, w, h);
        const vals = days.map((d) => d.net);
        const mx = Math.max(1, ...vals.map(Math.abs));
        const Y = (v: number) => T + ph / 2 - (v / mx) * (ph / 2);
        grid([mx, mx / 2, 0, -mx / 2, -mx].map((v) => Math.round(v)), Y, (v) => "$" + v);
        const bw = pw / days.length;
        ctx.fillStyle = "#8e9896"; ctx.textAlign = "center";
        days.forEach((d, i) => {
          if (i % Math.ceil(days.length / 8 || 1) === 0) ctx.fillText(d.day.slice(5), L + i * bw + bw / 2, h - 7);
          ctx.fillStyle = d.net >= 0 ? "#3ccfb2" : "#e0474c";
          const y = Y(Math.max(d.net, 0));
          ctx.fillRect(L + i * bw + bw * 0.15, y, bw * 0.7, Math.max(1, Math.abs(Y(d.net) - Y(0))));
        });
        return;
      }

      if (curve.length < 2) return noData(ctx, w, h);
      const n = curve.length, X = (i: number) => L + (i / (n - 1)) * pw;
      ctx.fillStyle = "#8e9896"; ctx.textAlign = "center";
      for (let i = 0; i < 6; i++) {
        const idx = Math.round((i / 5) * (n - 1));
        ctx.fillText(new Date(curve[idx].time * 1000).toLocaleDateString(dateLocale(), { month: "short", day: "numeric" }), X(idx), h - 7);
      }

      if (m === "Equity") {
        const eqVals = curve.map((p) => p.equity);
        const min = Math.min(startBalance, ...eqVals), max = Math.max(startBalance, ...eqVals);
        const pad0 = (max - min) * 0.1 || 100;
        const Y = (v: number) => T + ph - ((v - (min - pad0)) / (max - min + pad0 * 2 || 1)) * ph;
        const base = Y(min - pad0);
        const ddMin = Math.min(...ddPct, 0) || -1;
        const Yd = (v: number) => base + (v / ddMin) * (base - T);
        grid(niceTicks(min - pad0, max + pad0, 5), Y, (v) => Math.round(v).toLocaleString("en-US"));
        ctx.textAlign = "left";
        niceTicks(0, ddMin, 4).forEach((v) => { ctx.fillStyle = "rgba(224,71,76,.85)"; ctx.fillText(v.toFixed(1) + "%", L + pw + 8, Yd(v)); });
        area(ctx, eqVals, X, Y, base, "rgba(60,207,178,.65)", "rgba(60,207,178,.04)", "#3ccfb2");
        area(ctx, ddPct, X, Yd, base, "rgba(224,71,76,.35)", "rgba(224,71,76,.1)", "#e0474c");
      } else if (m === "Drawdown") {
        const ddMin = Math.min(...ddPct, 0) || -1;
        const Y = (v: number) => T + (v / ddMin) * ph;
        grid(niceTicks(0, ddMin, 5), Y, (v) => v.toFixed(1) + "%");
        area(ctx, ddPct, X, Y, T, "rgba(224,71,76,.1)", "rgba(224,71,76,.4)", "#e0474c");
      } else {
        const vals = curve.map((p) => p.equity - startBalance);
        const min = Math.min(0, ...vals), max = Math.max(0, ...vals) || 1;
        const Y = (v: number) => T + ph - ((v - min) / (max - min || 1)) * ph;
        grid(niceTicks(min, max, 4), Y, (v) => "$" + Math.round(v).toLocaleString("en-US"));
        area(ctx, vals, X, Y, Y(0), "rgba(226,204,159,.45)", "rgba(226,204,159,.03)", "#e2cc9f");
      }
    };

    const hist = ({ ctx, w, h }: { ctx: CanvasRenderingContext2D; w: number; h: number }, labels: string[], counts: number[]) => {
      const max = Math.max(1, ...counts);
      if (counts.every((c) => c === 0)) return noData(ctx, w, h);
      const hi = counts.indexOf(Math.max(...counts));
      const L = 24, B = 18, T = 6, R = 4, pw = w - L - R, ph = h - T - B;
      const Y = (v: number) => T + ph - (v / max) * ph;
      const slot = pw / labels.length;
      ctx.font = "10px Manrope, sans-serif"; ctx.textBaseline = "middle";
      niceTicks(0, max, 5).forEach((v) => {
        ctx.strokeStyle = "rgba(200,215,210,.07)"; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke();
        ctx.fillStyle = "#aeb7b5"; ctx.textAlign = "right"; ctx.fillText(String(Math.round(v)), L - 8, Y(v));
      });
      counts.forEach((c, i) => {
        const x = L + i * slot + slot * 0.3, bw = slot * 0.4, y = Y(c);
        const g = ctx.createLinearGradient(0, y, 0, T + ph);
        g.addColorStop(0, i === hi ? "#3ccfb2" : "rgba(60,207,178,.55)");
        g.addColorStop(1, i === hi ? "rgba(60,207,178,.35)" : "rgba(60,207,178,.12)");
        ctx.fillStyle = g; ctx.fillRect(x, y, bw, T + ph - y);
        ctx.fillStyle = "#c8cfcd"; ctx.textAlign = "center"; ctx.fillText(labels[i], L + i * slot + slot / 2, h - 7);
      });
    };

    const spark = ({ ctx, w, h }: { ctx: CanvasRenderingContext2D; w: number; h: number }, pts: number[], red: boolean) => {
      if (pts.length < 2) return;
      const mn = Math.min(...pts), mx = Math.max(...pts);
      const X = (i: number) => 2 + (i / (pts.length - 1)) * (w - 4);
      const Y = (v: number) => 3 + ((mx - v) / (mx - mn || 1)) * (h - 6);
      line(ctx, pts, X, Y); ctx.lineTo(X(pts.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, red ? "rgba(224,71,76,.25)" : "rgba(60,207,178,.3)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fill();
      line(ctx, pts, X, Y); ctx.strokeStyle = red ? "#e0474c" : "#3ccfb2"; ctx.lineWidth = 1.3; ctx.stroke();
    };

    const cumTrades = (() => { let c = 0; return days.map((d) => (c += d.count)); })();
    const cumNet = (() => { let c = 0; return days.map((d) => (c += d.net)); })();

    const tries: Record<string, number> = {};
    const timers: number[] = [];
    const draw = (k: string) => {
      try {
        const s = prep(cv.current[k]);
        if (!s) {
          tries[k] = (tries[k] || 0) + 1;
          if (tries[k] < 40) timers.push(window.setTimeout(() => draw(k), 100));
          return;
        }
        tries[k] = 0;
        if (k === "eq") drawEq(s);
        else if (k === "dur") hist(s, DUR_ORDER, DUR_ORDER.map((k2) => durRows.find((r) => r.key === k2)?.count ?? 0));
        else if (k === "rr") hist(s, RR_ORDER, RR_ORDER.map((k2) => rrRows.find((r) => r.key === k2)?.count ?? 0));
        else if (k === "s1") spark(s, cumTrades, false);
        else if (k === "s2") spark(s, cumNet, false);
        else if (k === "s3") spark(s, ddPct, true);
      } catch (err) {
        console.warn("draw", k, err instanceof Error ? err.message : err);
      }
    };

    const keys = ["eq", "dur", "rr", "s1", "s2", "s3"];
    const ros = keys.map((k) => {
      const el = cv.current[k];
      if (!el) return null;
      const ro = new ResizeObserver(() => draw(k));
      ro.observe(el);
      return ro;
    });
    keys.forEach(draw);
    timers.push(window.setTimeout(() => keys.forEach(draw), 300));
    return () => { timers.forEach(window.clearTimeout); ros.forEach((r) => r && r.disconnect()); };
  }, [trades, eqTab, curve, ddPct, days, durRows, rrRows, startBalance]);

  const heat = dp === "Heatmap";
  const dayNet = useMemo(() => new Map(days.map((d) => [d.day, d.net])), [days]);
  const maxPos = Math.max(1, ...days.map((d) => d.net).filter((v) => v > 0));
  const maxNeg = Math.max(1, ...days.map((d) => -d.net).filter((v) => v > 0));
  const fmt = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(v).toFixed(2);
  const cellColor = (v: number | undefined) => {
    if (v == null) return "#142226";
    if (heat) return v >= 0 ? `rgba(60,207,178,${(0.15 + (0.85 * v) / maxPos).toFixed(2)})` : `rgba(239,74,80,${(0.15 + (0.85 * -v) / maxNeg).toFixed(2)})`;
    const p = v >= 0 ? v / maxPos : v / maxNeg;
    return v === 0 ? "#1f5f55" : v > 0 ? (p > 0.66 ? "#3ccfb2" : p > 0.33 ? "#2a9483" : "#1f5f55") : (p < -0.66 ? "#ef4a50" : p < -0.33 ? "#b8373d" : "#7a2c30");
  };

  const months = useMemo(() => {
    const now = new Date();
    const list: [number, number][] = [[now.getFullYear(), now.getMonth() - 1], [now.getFullYear(), now.getMonth()]];
    return list.map(([y, mo]) => {
      const label = new Date(y, mo, 1).toLocaleDateString(dateLocale(), { month: "short", year: "numeric" });
      const cells: { bg: string; tip: string }[] = [];
      const first = new Date(y, mo, 1);
      const start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7));
      for (const wk = new Date(start); wk <= new Date(y, mo + 1, 0); wk.setDate(wk.getDate() + 7)) {
        let any = false;
        const col: { bg: string; tip: string }[] = [];
        for (let i = 0; i < 5; i++) {
          const dt = new Date(wk);
          dt.setDate(wk.getDate() + i);
          const inM = dt.getMonth() === mo;
          if (inM) any = true;
          const iso = dt.toISOString().slice(0, 10);
          const v = inM ? dayNet.get(iso) : undefined;
          col.push(inM ? { bg: cellColor(v), tip: dt.toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "2-digit", year: "numeric" }) + (v != null ? " · " + fmt(v) : "") } : { bg: "transparent", tip: "" });
        }
        if (any) cells.push(...col);
      }
      return { label, cells };
    });
  }, [dayNet, heat]); // eslint-disable-line react-hooks/exhaustive-deps

  const recentDays = [...days].reverse().slice(0, 6).map((d) => ({ date: d.day, p: fmt(d.net), pc: d.net >= 0 ? TEAL : RED }));

  const exportCsv = () => {
    const header = ["ticket", "symbol", "direction", "volume", "open_time", "open_price", "close_time", "close_price", "sl", "tp", "profit", "commission", "swap"];
    const rows = trades.map((t) => [t.ticket, t.symbol, t.direction, t.volume, t.open_time, t.open_price, t.close_time ?? "", t.close_price ?? "", t.sl ?? "", t.tp ?? "", t.profit, t.commission, t.swap].join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `elion-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const avgDurLabel = sum.count ? fmtDurMin(sum.avgDurationSec) : "—";
  const bestDur = [...durRows].sort((a, b) => b.net - a.net)[0];
  const bestRRBucket = [...rrRows].sort((a, b) => b.net - a.net)[0];
  const bestDayRow = [...days].sort((a, b) => b.net - a.net)[0];
  const worstDayRow = [...days].sort((a, b) => a.net - b.net)[0];
  const profitableDaysPct = days.length ? Math.round((days.filter((d) => d.net > 0).length / days.length) * 100) : 0;

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Analytics" />
      <main style={{ padding: "10px 16px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 26, height: 52, borderBottom: "1px solid #132226", margin: "0 -16px", padding: "0 16px 8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, letterSpacing: ".22em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 10, letterSpacing: ".42em", color: "var(--e-text-2)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--e-text-2)" }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,430px)", height: 38, borderRadius: 10, border: "1px solid var(--e-field-line)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px", color: "var(--e-muted)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12 }}>Search trades, setups, performance, or ask Elion...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl K</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: live?.connected ? TEAL : "var(--e-muted)", boxShadow: live?.connected ? `0 0 6px ${TEAL}` : "none" }} />
              {trades.length} trades in view · {live?.connected ? `live${live.open_count ? ` · ${live.open_count} open` : ""}` : "feed offline"}
            </div>
            <div style={{ color: "var(--e-text-2)" }}>{clock}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--e-gold-2)", color: "#1a1409", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14 }}>EF</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Elias Farahani</div>
              <div style={{ fontSize: 11, color: "var(--e-text-2)" }}>Trader | Build the Edge</div>
            </div>
          </div>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".24em", color: "var(--e-ivory)", lineHeight: 1 }}>ANALYTICS</div>
            <div style={{ fontSize: 13, letterSpacing: ".16em", color: "var(--e-text-3)" }}>DEEPER INSIGHTS. STRONGER DECISIONS.</div>
          </div>
          <Picker label="Account" value={active?.name ?? ""} onChange={(name) => { const a = accounts.find((x) => x.name === name); if (a) setActive(a.id); }} options={accounts.map((a) => a.name)} width={170} />
          <Picker label="Symbol" value={symbol} onChange={setSymbol} options={["All", ...symbols]} width={150} />
          <Picker label="Time Range" value={range} onChange={setRange} options={Object.keys(RANGE_CUTOFF)} width={190} />
          <div onClick={exportCsv} style={{ height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderRadius: 9, border: "1px solid #33454a", background: "#111e22", color: "var(--e-ivory)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            <span className="e-icon" style={{ fontSize: 18 }}>download</span>Export CSV
          </div>
        </div>

        {/* ---- KPI strip ---- */}
        {status !== "ok" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, border: "1px solid #6e2a26", background: "#2a1414", fontSize: 12.5 }}>
            <span className="e-icon" style={{ fontSize: 20, color: "#f3b5ae" }}>error</span>
            <span style={{ flex: 1 }} dir="auto">{statusError ?? "Journal server is offline — everything below is stale or empty."}</span>
          </div>
        )}
        {live?.engine_off && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, border: "1px solid #8a6a2a", background: "#2a2412", fontSize: 12.5 }}>
            <span className="e-icon" style={{ fontSize: 20, color: "#f0c56a" }}>power_off</span>
            <span style={{ flex: 1 }}>This account's MetaTrader switch is off, so live balance/positions aren't updating. Stored trades below are still shown.</span>
            <a href="#/account" style={{ color: "var(--e-gold)", whiteSpace: "nowrap" }}>Switch it on in Connection →</a>
          </div>
        )}
        {showFeedIssue && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, border: "1px solid #8a6a2a", background: "#2a2412", fontSize: 12.5 }}>
            <span className="e-icon" style={{ fontSize: 20, color: "#f0c56a" }}>warning</span>
            <span style={{ flex: 1 }} dir="auto">{feedIssue!.msg}</span>
            <span style={{ color: "var(--e-text-2)", whiteSpace: "nowrap" }}>
              {live?.connected ? "Live balance keeps dropping in and out" : "Balance below is from stored trades only"}
            </span>
          </div>
        )}

        <div className="e-kpis" style={{ display: "grid", gridTemplateColumns: "205fr 222fr 216fr 196fr 170fr 227fr 262fr", gap: 12, height: 76 }}>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>TOTAL TRADES</div>
              <div style={{ fontSize: 21, fontWeight: 600 }}>{trades.length}</div>
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 0, marginTop: 10 }}><canvas ref={set("s1")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
          </div>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>NET P&amp;L</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: sum.net >= 0 ? TEAL : RED, whiteSpace: "nowrap" }}>{sum.count ? usdSigned(sum.net) : "—"}</div>
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 40, marginTop: 10 }}><canvas ref={set("s2")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
          </div>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>WIN RATE</div>
              <div style={{ fontSize: 21, fontWeight: 600 }}>{sum.count ? `${Math.round(sum.winRate * 100)}%` : "—"}</div>
            </div>
            <div style={{ width: 50, height: 50, borderRadius: "50%", background: `conic-gradient(#3ccfb2 ${sum.winRate * 360}deg, #1b2a2e 0)`, display: "grid", placeItems: "center" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--e-panel-2)", display: "grid", placeItems: "center", color: TEAL }}><span className="e-icon fill" style={{ fontSize: 18 }}>target</span></div>
            </div>
          </div>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>PROFIT FACTOR</div>
              <div style={{ fontSize: 21, fontWeight: 600, color: TEAL }}>{sum.profitFactor != null ? sum.profitFactor.toFixed(2) : "—"}</div>
            </div>
          </div>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>AVG R:R</div>
              <div style={{ fontSize: 21, fontWeight: 600 }}>{avgRR != null ? `${avgRR >= 0 ? "+" : ""}${avgRR.toFixed(2)}R` : "—"}</div>
            </div>
          </div>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>MAX DRAWDOWN</div>
              <div style={{ fontSize: 21, fontWeight: 600 }}>{ddPct.length ? `${maxDrawdownPct.toFixed(1)}%` : "—"}</div>
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 0, marginTop: 10 }}><canvas ref={set("s3")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
          </div>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".05em", color: "var(--e-text-3)" }}>RULE COMPLIANCE</div>
              <div style={{ fontSize: 21, fontWeight: 600, color: TEAL }}>{RULES.length ? `${Math.round((doneRules / RULES.length) * 100)}%` : "—"}</div>
            </div>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: `conic-gradient(#3ccfb2 ${RULES.length ? (doneRules / RULES.length) * 360 : 0}deg, #1b2a2e 0)`, display: "grid", placeItems: "center" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--e-panel-2)", display: "grid", placeItems: "center", color: TEAL }}><span className="e-icon fill" style={{ fontSize: 18 }}>verified_user</span></div>
            </div>
          </div>
        </div>

        {/* ---- equity / setups / symbols row ---- */}
        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "730fr 378fr 437fr", gridTemplateRows: "minmax(400px,1fr)", gap: 12 }}>
          <div style={{ ...CARD, padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Equity &amp; Drawdown</div>
              <div style={{ flex: 1 }} />
              <Tabs list={["Equity", "Drawdown", "Daily P&L", "Cumulative P&L"]} cur={eqTab} onPick={setEqTab} pad="5px 14px" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", padding: "0 8px" }}>
              <Stat label="Starting Balance" value={usd(startBalance)} />
              <Stat
                label={live?.connected ? "Balance (live)" : "Ending Balance"}
                value={live?.connected && live.balance != null ? usd(live.balance) : usd(curve.length ? curve[curve.length - 1].equity : startBalance)}
                sub={live?.connected && live.equity != null ? `Equity ${usd(live.equity)}` : undefined}
              />
              <div style={{ borderLeft: "1px solid var(--e-line)", paddingLeft: 14 }}><Stat label="Net P&L" value={sum.count ? usdSigned(sum.net) : "—"} sub={startBalance ? pct1((sum.net / startBalance) * 100) : undefined} color={TEAL} /></div>
              <div style={{ borderLeft: "1px solid var(--e-line)", paddingLeft: 14 }}><Stat label="Max Drawdown" value={ddPct.length ? `${maxDrawdownPct.toFixed(1)}%` : "—"} sub={sum.maxDrawdown ? `(-${usd(sum.maxDrawdown)})` : undefined} color={RED} /></div>
              <div style={{ borderLeft: "1px solid var(--e-line)", paddingLeft: 14 }}><Stat label="Recovery Factor" value={recoveryFactor != null ? recoveryFactor.toFixed(1) : "—"} /></div>
              <div style={{ borderLeft: "1px solid var(--e-line)", paddingLeft: 14 }}><Stat label="Expectancy" value={sum.count ? usd(sum.expectancy) : "—"} color={TEAL} /></div>
            </div>
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}><canvas ref={set("eq")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 40, fontSize: 11, color: "var(--e-text-3)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 4, borderRadius: 2, background: TEAL }} />Equity</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 4, borderRadius: 2, background: RED }} />Drawdown</span>
            </div>
          </div>

          <div style={{ ...CARD, padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Performance by Setup</div>
            {setupRows.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--e-muted)", fontSize: 11.5, textAlign: "center", padding: "0 10px" }}>No trades have a setup tagged yet.</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 22, padding: "0 6px" }}>
                  <div style={{ width: 128, height: 128, flexShrink: 0, borderRadius: "50%", background: `conic-gradient(${(() => { let acc = 0; return setupRows.map((r, i) => { const from = acc, to = acc + (r.count / trades.length) * 100; acc = to; return `${SETUP_COLORS[i % SETUP_COLORS.length]} ${from}% ${to}%`; }).join(", "); })()})`, display: "grid", placeItems: "center" }}>
                    <div style={{ width: 96, height: 96, borderRadius: "50%", background: "var(--e-panel-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                      <div style={{ fontSize: 22, fontWeight: 600 }}>{trades.length}</div>
                      <div style={{ fontSize: 11, color: "var(--e-text-2)" }}>Trades</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    {setupRows.slice(0, 6).map((r, i) => (
                      <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: SETUP_COLORS[i % SETUP_COLORS.length] }} />
                        <span style={{ flex: 1, color: "var(--e-text)" }}>{r.key}</span>
                        <span style={{ color: "var(--e-text-3)" }}>{Math.round((r.count / trades.length) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, borderTop: "1px solid var(--e-line-3)", paddingTop: 6, overflow: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.6fr .7fr .8fr 1fr", fontSize: 10.5, color: "var(--e-text-2)", padding: "4px 4px" }}>
                    <span>Setup</span><span style={{ textAlign: "right" }}>Trades</span><span style={{ textAlign: "right" }}>Win Rate</span><span style={{ textAlign: "right" }}>Net P&amp;L</span>
                  </div>
                  {setupRows.map((r) => (
                    <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.6fr .7fr .8fr 1fr", alignItems: "center", fontSize: 11, padding: "3px 4px" }}>
                      <span>{r.key}</span><span style={{ textAlign: "right" }}>{r.count}</span><span style={{ textAlign: "right" }}>{Math.round(r.winRate * 100)}%</span>
                      <span style={{ textAlign: "right", color: r.net >= 0 ? TEAL : RED }}>{usdSigned(r.net)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0 }}>
            <div style={{ ...CARD, flex: 1.25, padding: "12px 14px 8px", display: "flex", flexDirection: "column", gap: 4, minHeight: 0, overflow: "hidden" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Performance by Symbol</div>
              <div style={{ display: "grid", gridTemplateColumns: "22px 1.1fr .6fr .7fr 1fr 1.3fr", gap: 6, fontSize: 10.5, color: "var(--e-text-2)", padding: "2px 0", whiteSpace: "nowrap" }}>
                <span /><span>Symbol</span><span style={{ textAlign: "center" }}>Trades</span><span style={{ textAlign: "center" }}>Win Rate</span><span>Net P&amp;L</span><span />
              </div>
              {symbolRows.length === 0 && <div style={{ fontSize: 11.5, color: "var(--e-muted)", padding: "8px 0" }}>No trades yet.</div>}
              {symbolRows.map((s) => {
                const maxAbs = Math.max(1, ...symbolRows.map((r) => Math.abs(r.net)));
                return (
                  <div key={s.key} style={{ flex: 1, display: "grid", gridTemplateColumns: "22px 1.1fr .6fr .7fr 1fr 1.3fr", gap: 6, alignItems: "center", fontSize: 11 }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--e-border-2)", color: "var(--e-ivory)", fontSize: 7.5, fontWeight: 700, display: "grid", placeItems: "center" }}>{s.key.slice(0, 2)}</span>
                    <span>{s.key}</span><span style={{ textAlign: "center" }}>{s.count}</span><span style={{ textAlign: "center" }}>{Math.round(s.winRate * 100)}%</span>
                    <span style={{ color: s.net >= 0 ? TEAL : RED }}>{usdSigned(s.net)}</span>
                    <span style={{ height: 6, borderRadius: 3, background: "#1b2a2e", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", borderRadius: 3, width: `${Math.min(100, (Math.abs(s.net) / maxAbs) * 100)}%`, background: s.net >= 0 ? TEAL : RED }} />
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ ...CARD, flex: 1, padding: "12px 14px 8px", display: "flex", flexDirection: "column", gap: 4, minHeight: 0, overflow: "hidden" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Session Performance</div>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr .6fr .8fr 1.1fr", gap: 6, fontSize: 10.5, color: "var(--e-text-2)", padding: "4px 0 2px" }}>
                <span style={{ paddingLeft: 24 }}>Session</span><span style={{ textAlign: "center" }}>Trades</span><span style={{ textAlign: "center" }}>Win Rate</span><span style={{ textAlign: "center" }}>Net P&amp;L</span>
              </div>
              {sessionRows.map((s) => (
                <div key={s.key} style={{ flex: 1, display: "grid", gridTemplateColumns: "1.3fr .6fr .8fr 1.1fr", gap: 6, alignItems: "center", fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--e-border-2)", display: "grid", placeItems: "center", color: "#e2cc9f" }}><span className="e-icon" style={{ fontSize: 11 }}>{s.key === "London" ? "account_balance" : s.key === "New York" ? "location_city" : "temple_buddhist"}</span></span>{s.key}
                  </span>
                  <span style={{ textAlign: "center" }}>{s.count}</span><span style={{ textAlign: "center" }}>{s.count ? `${Math.round(s.winRate * 100)}%` : "—"}</span>
                  <span style={{ textAlign: "center", color: s.net >= 0 ? TEAL : RED }}>{s.count ? usdSigned(s.net) : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ---- bottom two rows ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "505fr 485fr 555fr", gridTemplateRows: "162px 184px", gap: 12 }}>
          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 14, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Trade Duration Analysis</div>
              <div style={{ position: "relative", flex: 1, minHeight: 0 }}><canvas ref={set("dur")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
            </div>
            <SideStats width={112} rows={[["Average Duration", avgDurLabel], ["Best Duration (P&L)", bestDur && bestDur.count ? bestDur.key : "—", "#e2cc9f"], ["Its Win Rate", bestDur && bestDur.count ? `${Math.round(bestDur.winRate * 100)}%` : "—", TEAL]]} />
          </div>

          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 14, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>R:R Distribution</div>
              <div style={{ position: "relative", flex: 1, minHeight: 0 }}><canvas ref={set("rr")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /></div>
            </div>
            <SideStats width={100} rows={[["Average R:R", avgRR != null ? `${avgRR.toFixed(2)}R` : "—"], ["Best R:R (P&L)", bestRRBucket && bestRRBucket.count ? bestRRBucket.key : "—", "#e2cc9f"], ["Its Win Rate", bestRRBucket && bestRRBucket.count ? `${Math.round(bestRRBucket.winRate * 100)}%` : "—", TEAL]]} />
          </div>

          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 14, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Daily Performance</div>
                <Tabs list={["Calendar", "Heatmap", "Table"]} cur={dp} onPick={setDp} pad="4px 12px" />
              </div>
              {days.length === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--e-muted)", fontSize: 11.5 }}>No closed trades yet.</div>
              ) : dp !== "Table" ? (
                <div style={{ flex: 1, display: "flex", gap: 14, minHeight: 0 }}>
                  <div style={{ display: "grid", gridTemplateRows: "12px repeat(5,minmax(0,1fr))", gap: 3, fontSize: 10.5, color: "var(--e-text-3)" }}>
                    <span />{["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => <span key={d}>{d}</span>)}
                  </div>
                  {months.map((m) => (
                    <div key={m.label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <div style={{ height: 12, fontSize: 10, color: "var(--e-text-2)", textAlign: "center" }}>{m.label}</div>
                      <div style={{ flex: 1, display: "grid", gridTemplateRows: "repeat(5,minmax(0,1fr))", gridAutoFlow: "column", gridAutoColumns: "minmax(0,1fr)", gap: 3 }}>
                        {m.cells.map((c, i) => <div key={i} title={c.tip} style={{ borderRadius: 3, background: c.bg }} />)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  {recentDays.map((d) => (
                    <div key={d.date} style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, borderBottom: "1px solid var(--e-line-3)" }}>
                      <span style={{ color: "var(--e-text-3)" }}>{d.date}</span><span style={{ color: d.pc }}>{d.p}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ width: 108, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, borderLeft: "1px solid var(--e-line)", paddingLeft: 12 }}>
              {([["Best Day", bestDayRow ? fmt(bestDayRow.net) : "—", TEAL], ["Worst Day", worstDayRow ? fmt(worstDayRow.net) : "—", RED], ["Avg Daily P&L", days.length ? fmt(sum.net / days.length) : "—", TEAL], ["Profitable Days", days.length ? `${profitableDaysPct}%` : "—", TEAL]] as [string, string, string][]).map(([l, v, c]) => (
                <div key={l}>
                  <div style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>{l}</div>
                  <div style={{ fontSize: 13, marginTop: 2, color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...CARD, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Trade Direction Analysis</div>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 22, minHeight: 0 }}>
              <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: "50%", background: trades.length ? `conic-gradient(#3ccfb2 0 ${((directionRows[0]?.count ?? 0) / trades.length) * 100}%, #e2cc9f 0)` : "#1b2a2e", display: "grid", placeItems: "center" }}>
                <div style={{ width: 76, height: 76, borderRadius: "50%", background: "var(--e-panel-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{trades.length}</div>
                  <div style={{ fontSize: 10.5, color: "var(--e-text-2)" }}>Trades</div>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr .7fr .8fr 1.9fr", gap: 8, fontSize: 10.5, color: "var(--e-text-2)" }}>
                  <span>Direction</span><span style={{ textAlign: "center" }}>Trades</span><span style={{ textAlign: "center" }}>Win Rate</span><span style={{ textAlign: "right" }}>Net P&amp;L</span>
                </div>
                {directionRows.map((r, i) => {
                  const maxAbs = Math.max(1, ...directionRows.map((x) => Math.abs(x.net)));
                  const c = i === 0 ? "#3ccfb2" : "#e2cc9f";
                  return (
                    <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.2fr .7fr .8fr 1.9fr", gap: 8, alignItems: "center", fontSize: 12 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />{r.key === "buy" ? "Buy" : "Sell"}</span>
                      <span style={{ textAlign: "center" }}>{r.count}</span><span style={{ textAlign: "center" }}>{r.count ? `${Math.round(r.winRate * 100)}%` : "—"}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span style={{ flex: 1, maxWidth: 60, height: 6, borderRadius: 3, background: "#1b2a2e", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.min(100, (Math.abs(r.net) / maxAbs) * 100)}%`, background: c }} /></span>
                        <span style={{ color: r.net >= 0 ? TEAL : RED }}>{r.count ? usdSigned(r.net) : "—"}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ ...CARD, padding: "12px 14px", display: "flex", gap: 18, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Trade Outcomes</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 26px 34px minmax(0,1fr)", gap: "6px 10px", alignItems: "center", fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, background: TEAL }} />Win</span>
                <span>{sum.wins}</span><span>{sum.count ? `${Math.round((sum.wins / sum.count) * 100)}%` : "—"}</span>
                <span style={{ height: 9, borderRadius: 5, background: "#1b2a2e", overflow: "hidden" }}><span style={{ display: "block", width: sum.count ? `${(sum.wins / sum.count) * 100}%` : "0%", height: "100%", borderRadius: 5, background: TEAL }} /></span>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, background: RED }} />Loss</span>
                <span>{sum.losses}</span><span>{sum.count ? `${Math.round((sum.losses / sum.count) * 100)}%` : "—"}</span>
                <span style={{ height: 9, borderRadius: 5, background: "#1b2a2e", overflow: "hidden" }}><span style={{ display: "block", width: sum.count ? `${(sum.losses / sum.count) * 100}%` : "0%", height: "100%", borderRadius: 5, background: RED }} /></span>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "6px 12px", fontSize: 11, alignItems: "center" }}>
                <span style={{ color: "var(--e-text-2)" }}>Average Win</span><span style={{ color: TEAL }}>{sum.wins ? usd(sum.avgWin) : "—"}</span>
                <span style={{ color: "var(--e-text-2)" }}>Average Loss</span><span style={{ color: RED }}>{sum.losses ? usdSigned(sum.avgLoss) : "—"}</span>
                <span style={{ color: "var(--e-text-2)" }}>Largest Win</span><span style={{ color: TEAL }}>{sum.count ? usd(sum.bestTrade) : "—"}</span>
                <span style={{ color: "var(--e-text-2)" }}>Largest Loss</span><span style={{ color: RED }}>{sum.count ? usdSigned(sum.worstTrade) : "—"}</span>
              </div>
            </div>
            <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 10, borderLeft: "1px solid var(--e-line)", paddingLeft: 14 }}>
              <div style={{ fontSize: 11, color: "#e2cc9f" }}>Streaks</div>
              {([["emoji_events", "#e2cc9f", "Max Win Streak", String(sum.maxWinStreak)], ["local_fire_department", RED, "Max Loss Streak", String(sum.maxLossStreak)]] as [string, string, string, string][]).map(([ic, c, l, v]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="e-icon fill" style={{ fontSize: 26, color: c }}>{ic}</span>
                  <div><div style={{ fontSize: 10, color: "var(--e-text-2)" }}>{l}</div><div style={{ fontSize: 14, marginTop: 2 }}>{v}</div></div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...CARD, padding: "12px 14px 8px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Insights</div>
            </div>
            {insights.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--e-muted)", fontSize: 11.5, textAlign: "center", padding: "0 16px" }}>Not enough closed trades yet for a reliable pattern (need at least 3 in a bucket).</div>
            ) : insights.map((i, k) => (
              <div key={k} className="e-insight" style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid #142327" }}>
                <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, background: i.bg, display: "grid", placeItems: "center", color: "#fff" }}>
                  <span className="e-icon fill" style={{ fontSize: 16 }}>{i.icon}</span>
                </span>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  <div style={{ fontSize: 11, color: "#e6ebe9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.a}</div>
                  <div style={{ fontSize: 10.5, color: "var(--e-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.b}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

