import { useEffect, useMemo, useRef, useState } from "react";
import { ElionSidebar } from "../components/ElionChrome";
import { dateLocale } from "../lib/i18n";

/**
 * Ported from design/elion/tools.dc.html (reference design, not final code).
 * The three calculators do real arithmetic on what you type; the session clock is the real
 * UTC+2 time. The economic calendar, level analyzer and screenshot preview are the reference's
 * own sample content — "Apply to Trade", "Apply to Chart" and "Capture & Save" only confirm,
 * they do not reach the trade panel, the chart or the disk yet.
 */

const SYM: Record<string, { pv: number; contract: number; px: number }> = {
  XAUUSD: { pv: 1.0, contract: 100, px: 4316.1 },
  EURUSD: { pv: 0.92, contract: 100000, px: 1.0842 },
  GBPUSD: { pv: 0.92, contract: 100000, px: 1.2715 },
  US30: { pv: 0.93, contract: 1, px: 42180 },
  NAS100: { pv: 0.93, contract: 1, px: 19840 },
};
const USD_EUR = 0.922;
const PS_DEF = { bal: "1248.50", risk: "1.0", sl: "200", entry: "4316.10", sym: "XAUUSD", mode: "Gold (XAUUSD)" };

type Bar = { o: number; c: number; h: number; l: number };

function gen(): Bar[] {
  let s = 17;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const K: [number, number][] = [[0, 4332], [.08, 4318], [.2, 4300], [.3, 4292], [.4, 4304], [.5, 4298], [.62, 4306], [.72, 4316], [.8, 4310], [.9, 4322], [1, 4334]];
  const at = (t: number) => {
    for (let k = 1; k < K.length; k++) {
      if (t <= K[k][0]) { const [a, pa] = K[k - 1], [b, pb] = K[k]; return pa + ((pb - pa) * (t - a)) / (b - a); }
    }
    return 4334;
  };
  let prev = 4332;
  const out: Bar[] = [];
  for (let i = 0; i < 70; i++) {
    const o = prev, c = at(i / 69) + (r() - 0.5) * 6;
    out.push({ o, c, h: Math.max(o, c) + r() * 3, l: Math.min(o, c) - r() * 3 });
    prev = c;
  }
  return out;
}

function calc(bal: string, riskPct: string | number, riskAbs: number | null, sl: string, sym: string) {
  const S = SYM[sym] || SYM.XAUUSD;
  const b = parseFloat(bal), sp = parseFloat(sl);
  const risk = riskAbs != null ? riskAbs : (b * parseFloat(String(riskPct))) / 100;
  const lot = isFinite(risk) && sp > 0 ? Math.max(0, Math.floor((risk / (sp * S.pv)) * 100) / 100) : 0;
  const posVal = lot * S.contract * S.px * (sym.endsWith("USD") || sym === "US30" || sym === "NAS100" ? USD_EUR : 1);
  const eur = (v: number) => (isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—");
  return { lot: lot.toFixed(2), riskAmt: eur(risk), pv: eur(S.pv), posVal: eur(posVal), lotN: lot };
}

const SESS_DEFS: [string, number, number, string][] = [["Tokyo", 1, 10, "#f5d99a"], ["London", 9, 18, "#5ec8e0"], ["New York", 14, 23, "#ef6b6b"]];
const ALL_EVENTS: [string, string, string, string, number, string, string, string][][] = [
  [["15:30", "US", "USD", "Core Retail Sales m/m", 3, "0.2 %", "0.3 %", "0.1 %"], ["15:30", "US", "USD", "Retail Sales m/m", 3, "0.4 %", "0.5 %", "0.0 %"], ["17:00", "US", "USD", "FOMC Member Speech", 3, "—", "—", "—"], ["17:30", "US", "USD", "Crude Oil Inventories", 2, "—", "—", "—"], ["19:00", "US", "USD", "10-Year Note Auction", 2, "—", "—", "—"], ["21:00", "US", "USD", "Fed Press Conference", 3, "—", "—", "—"], ["10:00", "EU", "EUR", "German Ifo Business Climate", 2, "87.4", "87.0", "86.6"], ["11:00", "EU", "EUR", "CPI Flash Estimate y/y", 3, "2.1 %", "2.2 %", "2.2 %"], ["14:00", "XAU", "Gold", "SPDR Gold Holdings", 1, "—", "—", "—"]],
  [["09:00", "EU", "EUR", "German Manufacturing PMI", 3, "—", "48.9", "48.6"], ["14:30", "US", "USD", "Initial Jobless Claims", 3, "—", "224K", "229K"], ["16:00", "US", "USD", "New Home Sales", 2, "—", "690K", "652K"], ["18:30", "XAU", "Gold", "COMEX Gold Inventories", 1, "—", "—", "—"]],
  [["14:30", "US", "USD", "Core PCE Price Index m/m", 3, "0.2 %", "0.2 %", "0.3 %"], ["16:00", "US", "USD", "UoM Consumer Sentiment", 2, "58.9", "59.1", "58.2"], ["10:00", "EU", "EUR", "ECB Economic Bulletin", 1, "—", "—", "—"]],
];
const LV: Record<string, [string, string, string?][]> = {
  "Level Metrics": [["Level Price", "4310.50"], ["Current Price", "4316.10"], ["Distance", "56 points", "#3ccfb2"], ["Candles from Cross", "4"], ["Candles to Level", "8"], ["MACD Slope", "0.42"], ["MA 40", "4312.80"], ["MA 60", "4311.20"], ["Session", "London"]],
  Statistics: [["Touches", "5"], ["Holds", "4 (80%)", "#3ccfb2"], ["Breaks", "1", "#ef5a50"], ["Avg Bounce", "38 points"], ["Avg Time at Level", "22 min"], ["Best Session", "London"], ["Best TF", "M15"], ["Hidden Div.", "3 of 5"], ["Confidence", "High", "#3ccfb2"]],
};
const TABS: [string, string][] = [["calculate", "Risk Calculator"], ["add_circle", "Position Size"], ["center_focus_weak", "R:R Calculator"], ["public", "Trading Sessions"], ["calendar_month", "Economic Calendar"], ["alt_route", "Level Analyzer"], ["screenshot_monitor", "Screenshot Tool"], ["more_horiz", "More"]];
const INCLUDES = ["Symbol & TF", "Indicators", "Drawing Objects", "Current Price Line", "Account Info"];

/** the tab strip picks one tool; each keeps the width it was designed at, not the whole page */
const ROW1 = ["Risk Calculator", "Position Size", "R:R Calculator", "Trading Sessions"];
const ROW2 = ["Economic Calendar", "Level Analyzer", "Screenshot Tool"];
const TOOL_W: Record<string, number> = {
  "Risk Calculator": 470, "Position Size": 470, "R:R Calculator": 470, "Trading Sessions": 560,
  "Economic Calendar": 900, "Level Analyzer": 760, "Screenshot Tool": 470,
};

const CARD: React.CSSProperties = { borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const CTL: React.CSSProperties = { borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", color: "var(--e-text)", outline: "none" };
const STAT: React.CSSProperties = { border: "1px solid var(--e-line)", borderRadius: 4, background: "var(--e-panel-2)" };
const TEAL = "var(--e-up-2)";
const pad = (n: number) => String(n).padStart(2, "0");
const seg = (a: boolean) => (a
  ? { background: "linear-gradient(180deg,#3a3220,#231f15)", color: "var(--e-ivory)", borderColor: "rgba(233,215,176,.7)" }
  : { background: "var(--e-panel-2)", color: "var(--e-text)", borderColor: "transparent" });

function Inp({ value, onChange, h = 28, fs = 13 }: { value: string; onChange: (v: string) => void; h?: number; fs?: number }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...CTL, height: h, boxSizing: "border-box", fontSize: fs, padding: "0 10px", width: "100%", minWidth: 0 }} />;
}
function Sel({ value, options, onChange, h = 28, fs = 13, w = "100%" }: { value: string; options: string[]; onChange: (v: string) => void; h?: number; fs?: number; w?: string }) {
  return (
    <div style={{ position: "relative", width: w }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...CTL, appearance: "none", WebkitAppearance: "none", width: "100%", height: h, fontSize: fs, padding: "0 24px 0 10px", cursor: "pointer" }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="e-icon" style={{ position: "absolute", right: 6, top: h === 26 ? 5 : 6, fontSize: 17, pointerEvents: "none" }}>expand_more</span>
    </div>
  );
}
function Cell({ label, value, first, color }: { label: string; value: string; first?: boolean; color?: string }) {
  return (
    <div style={{ padding: "6px 12px", display: "flex", flexDirection: "column", gap: 4, borderLeft: first ? undefined : "1px solid var(--e-line)" }}>
      <span style={{ fontSize: 11, color: "var(--e-text-3)" }}>{label}</span>
      <span style={{ fontSize: 14, color }}>{value}</span>
    </div>
  );
}

export default function ElionToolsPage() {
  const series = useMemo(gen, []);
  const [tab, setTab] = useState("Risk Calculator");
  const [toast, setToast] = useState("");
  const [rc, setRc] = useState({ mode: "By Risk %", bal: "1248.50", risk: "1.0", sl: "200", sym: "XAUUSD" });
  const [ps, setPs] = useState({ ...PS_DEF });
  const [rr, setRr] = useState({ entry: "4316.10", sl: "4312.20", tp: "4328.50" });
  const [sessMode, setSessMode] = useState("Live");
  const [now, setNow] = useState(() => new Date());
  const [calOffset, setCalOffset] = useState(0);
  const [calTab, setCalTab] = useState("All");
  const [alertBefore, setAlertBefore] = useState("15 minutes before");
  const [importance, setImportance] = useState("High + Medium");
  const [laTab, setLaTab] = useState("Level Metrics");
  const [saved, setSaved] = useState<{ t: string; p: string }[]>([]);
  const [capMode, setCapMode] = useState("Full Chart");
  const [inc, setInc] = useState([1, 1, 1, 1, 0]);
  const [saveTo, setSaveTo] = useState("Journal");

  const levelRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<HTMLCanvasElement>(null);
  const tt = useRef(0);

  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 30000);
    return () => { window.clearInterval(iv); window.clearTimeout(tt.current); };
  }, []);

  const flash = (m: string) => {
    window.clearTimeout(tt.current);
    setToast(m);
    tt.current = window.setTimeout(() => setToast(""), 2400);
  };

  /* ---- canvases ---- */
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
    const candles = (ctx: CanvasRenderingContext2D, cs: Bar[], x0: number, w: number, Y: (v: number) => number) => {
      const cw = w / cs.length;
      cs.forEach((c, i) => {
        const x = x0 + (i + 0.5) * cw, col = c.c >= c.o ? "#26b58d" : "#e0463f";
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
        const y1 = Y(Math.max(c.o, c.c));
        ctx.fillStyle = col; ctx.fillRect(x - cw * 0.32, y1, cw * 0.64, Math.max(1, Y(Math.min(c.o, c.c)) - y1));
      });
      return cw;
    };
    const drawAll = () => {
      try {
        const a = prep(levelRef.current);
        if (a) {
          const { ctx, w, h } = a, cs = series;
          const mainH = h * 0.72;
          const Y = (v: number) => 6 + ((4340 - v) / 54) * (mainH - 12);
          const cw = candles(ctx, cs, 0, w, Y);
          ctx.fillStyle = "rgba(200,180,190,.28)"; ctx.fillRect(cw * 8, Y(4312), cw * 38, Y(4309) - Y(4312));
          ctx.strokeStyle = "rgba(220,200,210,.5)"; ctx.strokeRect(cw * 8, Y(4312), cw * 38, Y(4309) - Y(4312));
          ctx.fillStyle = "#eef1f0"; ctx.font = "12px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Level", cw * 22, Y(4312) - 10);
          ctx.strokeStyle = "rgba(230,235,232,.7)"; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(cw * 58, Y(4316)); ctx.lineTo(cw * 58, Y(4310.5)); ctx.stroke(); ctx.setLineDash([]);
          const mt = mainH + 6, mh = h - mt - 2;
          const MY = (v: number) => mt + mh / 2 - (v * mh) / 2;
          cs.forEach((_, i) => {
            const v = Math.sin(i / 7) * 0.7 - (i < 30 ? 0.3 : -0.1);
            ctx.fillStyle = v >= 0 ? "#3ccfb2" : "#e0463f";
            ctx.globalAlpha = 0.75;
            ctx.fillRect(i * cw + cw * 0.18, Math.min(MY(0), MY(v)), cw * 0.64, Math.abs(MY(v) - MY(0)));
          });
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#3b82f6"; ctx.beginPath();
          cs.forEach((_, i) => { const y = MY(Math.sin(i / 7 - 0.4) * 0.6); i ? ctx.lineTo((i + 0.5) * cw, y) : ctx.moveTo(cw / 2, y); });
          ctx.stroke();
          ctx.strokeStyle = "rgba(200,215,210,.5)"; ctx.beginPath(); ctx.moveTo(0, Y(4332)); ctx.lineTo(cw * 22, Y(4300)); ctx.stroke();
        }
        const b = prep(shotRef.current);
        if (b) {
          const { ctx, w, h } = b;
          const crop = capMode === "Custom" ? series.slice(30, 60) : series;
          const Y = (v: number) => 18 + ((4340 - v) / 54) * (h * 0.66);
          candles(ctx, crop, 4, w - (inc[3] ? 34 : 8), Y);
          ctx.font = "8px Manrope, sans-serif"; ctx.fillStyle = "#dfe5e3"; ctx.textAlign = "left";
          if (inc[0]) ctx.fillText("XAUUSD · M5", 4, 10);
          if (inc[1]) {
            ctx.strokeStyle = "#4aa3df"; ctx.beginPath();
            crop.forEach((c, i) => { const x = 4 + ((i + 0.5) * (w - 38)) / crop.length, y = Y((c.o + c.c) / 2 + 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.stroke();
          }
          if (inc[2]) { ctx.strokeStyle = "rgba(230,235,232,.7)"; ctx.beginPath(); ctx.moveTo(w * 0.15, Y(4300)); ctx.lineTo(w * 0.7, Y(4316)); ctx.stroke(); }
          if (inc[3]) { ctx.fillStyle = "#1f9c7a"; ctx.fillRect(w - 30, Y(4316) - 6, 30, 12); ctx.fillStyle = "#fff"; ctx.fillText("4316.1", w - 28, Y(4316) + 3); }
          if (inc[4]) { ctx.fillStyle = "#c8cfcd"; ctx.fillText("MT5 · 12345678", 4, h - 26); }
          const bt = h * 0.8;
          crop.forEach((_, i) => {
            const x = 4 + (i * (w - 38)) / crop.length;
            ctx.fillStyle = "rgba(200,210,220,.5)";
            ctx.fillRect(x, bt + (i % 5) * 1.5, ((w - 38) / crop.length) * 0.6, h - bt - (i % 5) * 1.5 - 4);
          });
        }
      } catch (err) { console.warn("draw", err instanceof Error ? err.message : err); }
    };
    const ros = [levelRef.current, shotRef.current].map((el) => {
      if (!el) return null;
      const ro = new ResizeObserver(drawAll);
      ro.observe(el);
      return ro;
    });
    const timers = [0, 80, 400].map((t) => window.setTimeout(drawAll, t));
    drawAll();
    return () => { timers.forEach(window.clearTimeout); ros.forEach((r) => r?.disconnect()); };
  }, [series, inc, capMode, laTab]);

  /* ---- derived ---- */
  const bal = parseFloat(rc.bal);
  const rcRes = rc.mode === "By Amount" ? calc(rc.bal, 0, parseFloat(rc.risk), rc.sl, rc.sym)
    : rc.mode === "By Balance" ? calc(rc.bal, 0, bal * 0.02 * parseFloat(rc.risk), rc.sl, rc.sym)
      : calc(rc.bal, rc.risk, null, rc.sl, rc.sym);
  const psRes = calc(ps.bal, ps.risk, null, ps.sl, ps.sym);
  const e = parseFloat(rr.entry), slv = parseFloat(rr.sl), tp = parseFloat(rr.tp);
  const rp = Math.abs(e - slv), wp = Math.abs(tp - e), ratio = rp > 0 ? wp / rp : 0;
  const rrLot = rcRes.lotN || 0.05;
  const amt = (pts: number) => pts * 100 * rrLot * USD_EUR;
  const vh = (now.getUTCHours() + 2 + now.getUTCMinutes() / 60) % 24;
  const next24 = sessMode === "Next 24h";
  const dayName = new Date(2026, 8, 23 + calOffset);
  const minImp = importance === "High only" ? 3 : importance === "High + Medium" ? 2 : 1;
  const evs = ALL_EVENTS[((calOffset % 3) + 3) % 3]
    .filter((x) => x[4] >= minImp && (calTab === "All" || (calTab === "High Impact" ? x[4] === 3 : x[2] === calTab)))
    .sort((a, b) => a[0].localeCompare(b[0])).slice(0, 6);
  const savedRows: [string, string, string?][] = saved.length ? saved.map((x, i) => [`#${i + 1}  ${x.t}`, x.p]) : [["No saved levels yet", ""]];
  const laRows = laTab === "Saved Levels" ? savedRows : LV[laTab];

  const sessions = SESS_DEFS.map(([name, a, b, c]) => {
    const on = vh >= a && vh < b, soon = !on && ((a - vh + 24) % 24) < 3;
    const status = next24 ? (on ? "Active" : `in ${Math.round((a - vh + 24) % 24)}h`) : on ? "Active" : soon ? "Opens soon" : "Closed";
    const good = status === "Active";
    return { name, c, hours: `${pad(a)}:00 – ${pad(b)}:00`, status,
      stBg: good ? "#0f2a26" : status === "Closed" ? "#3a1614" : "#2a2412",
      stBd: good ? "#2c7a5f" : status === "Closed" ? "#8a2a26" : "#8a6a2a",
      stFg: good ? "#9ff0d9" : status === "Closed" ? "#f08a82" : "#f0c56a" };
  });

  const Seg = ({ list, cur, onPick, h = 26 }: { list: string[]; cur: string; onPick: (l: string) => void; h?: number }) => (
    <>
      {list.map((l) => (
        <div key={l} onClick={() => onPick(l)} style={{ height: h, display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer", border: "1px solid", ...seg(l === cur) }}>{l}</div>
      ))}
    </>
  );

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Tools" />

      <main style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 30, height: 52 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".5em", color: "var(--e-gold)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 14 }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,448px)", height: 38, borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 14px", color: "var(--e-text-3)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>Search tools, symbols, or ask ELION...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl  K</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3ccfb2", boxShadow: "0 0 6px #3ccfb2" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span>Live Account</span><span style={{ color: "var(--e-text-3)", fontSize: 12 }}>MT5  |  ICMarkets</span>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <span className="e-icon" style={{ fontSize: 26 }}>notifications</span>
            <span style={{ position: "absolute", top: -4, right: -4, minWidth: 14, height: 14, borderRadius: 7, background: "var(--e-down-3)", color: "#fff", fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center" }}>3</span>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingLeft: 4 }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, letterSpacing: ".18em", color: "var(--e-ivory)", lineHeight: 1 }}>TOOLS</div>
          <div style={{ fontSize: 12.5, letterSpacing: ".24em" }}>PRACTICAL TOOLS. REAL ADVANTAGE.</div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {TABS.map(([icon, label]) => {
            const a = label === tab;
            return (
              <div key={label} onClick={() => setTab(label)} style={{ height: 42, padding: "0 20px", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, fontSize: 13, whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${a ? "rgba(233,215,176,.7)" : "var(--e-line)"}`, background: a ? "linear-gradient(180deg,#3a3220,#231f15)" : "var(--e-panel-2)", color: a ? "var(--e-ivory)" : "var(--e-text)" }}>
                <span className="e-icon" style={{ fontSize: 19 }}>{icon}</span>{label}
              </div>
            );
          })}
        </div>

        {/* ---- calculators ---- */}
        {ROW1.includes(tab) && (
        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: `${TOOL_W[tab]}px`, gridTemplateRows: "minmax(412px,1fr)", gap: 14, minHeight: 412 }}>
          {/* risk calculator */}
          {tab === "Risk Calculator" && (
          <div style={{ ...CARD, padding: "12px 14px 12px", display: "flex", flexDirection: "column", gap: 7, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="e-icon" style={{ fontSize: 24 }}>percent</span><span style={{ fontSize: 16 }}>Risk Calculator</span>
              <span className="e-icon" style={{ fontSize: 17, color: "var(--e-text-2)" }}>info</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", border: "1px solid var(--e-border)", borderRadius: 4, overflow: "hidden" }}>
              <Seg list={["By Risk %", "By Amount", "By Balance"]} cur={rc.mode} onPick={(l) => setRc((s) => ({ ...s, mode: l, risk: l === "By Amount" ? "12.49" : l === "By Balance" ? "0.5" : "1.0" }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 6, alignItems: "center", fontSize: 12.5 }}>
              <span>Account Balance (€)</span><Inp value={rc.bal} onChange={(v) => setRc((s) => ({ ...s, bal: v }))} />
              <span>{rc.mode === "By Amount" ? "Risk Amount" : rc.mode === "By Balance" ? "Balance Fraction" : "Risk Per Trade"}</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 4 }}>
                <Inp value={rc.risk} onChange={(v) => setRc((s) => ({ ...s, risk: v }))} />
                <div style={{ ...CTL, height: 28, display: "grid", placeItems: "center", fontSize: 12.5 }}>{rc.mode === "By Amount" ? "€" : rc.mode === "By Balance" ? "× 2%" : "%"}</div>
              </div>
              <span>Stop Loss (points)</span><Inp value={rc.sl} onChange={(v) => setRc((s) => ({ ...s, sl: v }))} />
              <span>Symbol</span><Sel value={rc.sym} options={Object.keys(SYM)} onChange={(v) => setRc((s) => ({ ...s, sym: v }))} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 40, padding: "2px 0" }}>
              <span style={{ fontSize: 14 }}>Lot Size (Calculated)</span><span style={{ fontSize: 26, color: TEAL, lineHeight: 1.1 }}>{rcRes.lot}</span>
            </div>
            <div style={{ ...STAT, display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
              <Cell first label="Risk Amount" value={rcRes.riskAmt} />
              <Cell label="Point Value (1 lot)" value={rcRes.pv} />
              <Cell label="Position Value" value={rcRes.posVal} />
            </div>
            <div onClick={() => flash(`Lot ${rcRes.lot} ${rc.sym} sent to Trade panel.`)} style={{ marginTop: "auto", flexShrink: 0, height: 32, borderRadius: 4, border: "1px solid var(--e-gold)", background: "linear-gradient(180deg,#3a3220,#231f15)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--e-ivory)", cursor: "pointer" }}>
              <span className="e-icon" style={{ fontSize: 17 }}>send</span>Apply to Trade
            </div>
          </div>
          )}

          {/* position size */}
          {tab === "Position Size" && (
          <div style={{ ...CARD, padding: 12, display: "flex", flexDirection: "column", gap: 7, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="e-icon" style={{ fontSize: 24 }}>tune</span><span style={{ fontSize: 16 }}>Position Size Calculator</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--e-border)", borderRadius: 4, overflow: "hidden" }}>
              <Seg list={["Forex", "Gold (XAUUSD)"]} cur={ps.mode} onPick={(l) => setPs((s) => ({ ...s, mode: l, sym: l === "Forex" ? "EURUSD" : "XAUUSD", entry: l === "Forex" ? "1.0842" : "4316.10", sl: l === "Forex" ? "20" : "200" }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.05fr", rowGap: 5, alignItems: "center", fontSize: 12.5 }}>
              <span>Account Balance (€)</span><Inp value={ps.bal} onChange={(v) => setPs((s) => ({ ...s, bal: v }))} h={26} fs={12.5} />
              <span>Risk Per Trade (%)</span><Inp value={ps.risk} onChange={(v) => setPs((s) => ({ ...s, risk: v }))} h={26} fs={12.5} />
              <span>Stop Loss (points)</span><Inp value={ps.sl} onChange={(v) => setPs((s) => ({ ...s, sl: v }))} h={26} fs={12.5} />
              <span>Entry Price</span><Inp value={ps.entry} onChange={(v) => setPs((s) => ({ ...s, entry: v }))} h={26} fs={12.5} />
              <span>Symbol</span><Sel value={ps.sym} options={ps.mode === "Forex" ? ["EURUSD", "GBPUSD"] : ["XAUUSD"]} onChange={(v) => setPs((s) => ({ ...s, sym: v }))} h={26} fs={12.5} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 44, padding: "2px 0" }}>
              <span style={{ fontSize: 14 }}>Recommended Lot</span><span style={{ fontSize: 24, color: TEAL, lineHeight: 1.1 }}>{psRes.lot}</span>
            </div>
            <div style={{ ...STAT, display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
              <Cell first label="Value per Point (1 lot)" value={psRes.pv} />
              <Cell label="Risk Amount" value={psRes.riskAmt} />
              <Cell label="Position Value" value={psRes.posVal} />
            </div>
            <div className="e-btn" onClick={() => setPs({ ...PS_DEF })} style={{ marginTop: "auto", flexShrink: 0, height: 30, borderRadius: 4, border: "1px solid var(--e-border-2)", background: "var(--e-panel-2)", display: "grid", placeItems: "center", fontSize: 13, cursor: "pointer" }}>Reset</div>
          </div>
          )}

          {/* r:r */}
          {tab === "R:R Calculator" && (
          <div style={{ ...CARD, padding: 12, display: "flex", flexDirection: "column", gap: 6, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <span className="e-icon" style={{ fontSize: 26 }}>balance</span><span style={{ fontSize: 16 }}>Risk : Reward Calculator</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 108px", rowGap: 7, alignItems: "center", fontSize: 12.5 }}>
              <span>Entry Price</span><Inp value={rr.entry} onChange={(v) => setRr((s) => ({ ...s, entry: v }))} />
              <span>Stop Loss</span><Inp value={rr.sl} onChange={(v) => setRr((s) => ({ ...s, sl: v }))} />
              <span>Take Profit</span><Inp value={rr.tp} onChange={(v) => setRr((s) => ({ ...s, tp: v }))} />
              <span style={{ padding: "3px 0" }}>Risk (Points)</span><span style={{ paddingLeft: 10 }}>{isFinite(rp) ? rp.toFixed(2) : "—"}</span>
              <span style={{ padding: "3px 0" }}>Reward (Points)</span><span style={{ paddingLeft: 10 }}>{isFinite(wp) ? wp.toFixed(2) : "—"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--e-line)", padding: "5px 0 2px" }}>
              <span style={{ fontSize: 13 }}>Risk : Reward</span>
              <span style={{ fontSize: 22, color: ratio >= 3 ? TEAL : ratio >= 1.5 ? "#e9c77a" : "#ef5a50", paddingRight: 10 }}>{ratio ? "1 : " + ratio.toFixed(1) : "—"}</span>
            </div>
            <div style={{ display: "flex", height: 22, borderRadius: 3, overflow: "hidden", fontSize: 12, color: "#fff" }}>
              <div style={{ width: ratio ? `${Math.max(12, 100 / (1 + ratio))}%` : "50%", background: "#c9302c", display: "grid", placeItems: "center", whiteSpace: "nowrap", overflow: "hidden" }}>Risk</div>
              <div style={{ flex: 1, background: "linear-gradient(90deg,#1b8f78,#3ccfb2)", display: "grid", placeItems: "center" }}>Reward</div>
            </div>
            <div style={{ ...STAT, display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: 2 }}>
              <Cell first label={`Risk Amount (${rrLot.toFixed(2)})`} value={isFinite(rp) ? amt(rp).toFixed(2) + " €" : "—"} />
              <Cell label={`Reward Amount (${rrLot.toFixed(2)})`} value={isFinite(wp) ? amt(wp).toFixed(2) + " €" : "—"} color={TEAL} />
            </div>
            <div onClick={() => flash(`Entry ${rr.entry} · SL ${rr.sl} · TP ${rr.tp} drawn on chart.`)} style={{ marginTop: "auto", flexShrink: 0, height: 30, borderRadius: 4, border: "1px solid #3ccfb2", background: "#0f2a26", display: "grid", placeItems: "center", fontSize: 13, cursor: "pointer" }}>Apply to Chart</div>
          </div>
          )}

          {/* sessions */}
          {tab === "Trading Sessions" && (
          <div style={{ ...CARD, padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="e-icon" style={{ fontSize: 26 }}>schedule</span><span style={{ fontSize: 16 }}>Trading Sessions</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--e-border)", borderRadius: 4, overflow: "hidden" }}>
              <Seg list={["Live", "Next 24h"]} cur={sessMode} onPick={setSessMode} />
            </div>
            {sessions.map((s) => (
              <div key={s.name} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1.2fr 70px", alignItems: "center", fontSize: 13.5, height: 28 }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: s.c }} />
                <span>{s.name}</span><span>{s.hours}</span>
                <span style={{ height: 22, borderRadius: 3, display: "grid", placeItems: "center", fontSize: 12, background: s.stBg, border: `1px solid ${s.stBd}`, color: s.stFg }}>{s.status}</span>
              </div>
            ))}
            <div style={{ flex: 1, minHeight: 150, position: "relative", margin: "4px 4px 0", borderRadius: 4, background: "radial-gradient(ellipse at 50% 40%,#10232a,#0a1417 75%)" }}>
              {SESS_DEFS.map(([name, a, b, c], i) => (
                <div key={name} style={{ position: "absolute", left: `${(a / 24) * 100}%`, width: `${((b - a) / 24) * 100}%`, top: 30 + i * 38, height: 34, borderRadius: 3, background: c + "33", border: `1px solid ${c}88`, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden" }}>{name}</div>
              ))}
              <div style={{ position: "absolute", left: `${((vh / 24) * 100).toFixed(2)}%`, top: 18, bottom: 24, width: 0, borderLeft: "1px dashed var(--e-gold)" }} />
              <div style={{ position: "absolute", left: `${((vh / 24) * 100).toFixed(2)}%`, top: 0, transform: "translateX(-50%)", padding: "2px 6px", borderRadius: 3, border: "1px solid var(--e-gold)", background: "#1c1b13", fontSize: 11, whiteSpace: "nowrap" }}>Vienna {pad(Math.floor(vh))}:{pad(now.getUTCMinutes())}</div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, borderTop: "1px solid #3a5a66" }} />
              {[0, 4, 8, 12, 16, 20, 24].map((hh) => (
                <span key={hh} style={{ position: "absolute", left: `calc(${(hh / 24) * 100}% + ${hh === 0 ? 8 : hh === 24 ? -8 : 0}px)`, bottom: 2, transform: "translateX(-50%)", fontSize: 11 }}>{pad(hh)}</span>
              ))}
            </div>
          </div>
          )}
        </div>
        )}

        {/* ---- calendar / analyzer / screenshot ---- */}
        {ROW2.includes(tab) && (
        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: `${TOOL_W[tab]}px`, gridTemplateRows: "minmax(336px,1fr)", gap: 14, minHeight: 336 }}>
          {tab === "Economic Calendar" && (
          <div style={{ ...CARD, padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="e-icon" style={{ fontSize: 26 }}>calendar_month</span>
              <span style={{ flex: 1, fontSize: 16 }}>Economic Calendar</span>
              <span style={{ fontSize: 12 }}>Today: {dayName.toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: "numeric" })}</span>
              <span className="e-icon" onClick={() => setCalOffset((s) => s - 1)} style={{ width: 32, height: 30, marginLeft: 20, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 18, cursor: "pointer" }}>chevron_left</span>
              <span className="e-icon" onClick={() => setCalOffset((s) => s + 1)} style={{ width: 32, height: 30, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 18, cursor: "pointer" }}>chevron_right</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["All", "High Impact", "USD", "EUR", "Gold"].map((l) => (
                <div key={l} onClick={() => setCalTab(l)} style={{ height: 28, padding: "0 22px", borderRadius: 3, display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer", border: "1px solid", ...seg(l === calTab), borderColor: l === calTab ? "rgba(233,215,176,.7)" : "var(--e-line)" }}>{l}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: ".55fr .7fr 2fr .8fr .8fr .8fr .8fr", fontSize: 11, padding: "4px 2px" }}>
              <span>Time</span><span>Currency</span><span>Event</span><span>Impact</span><span>Actual</span><span>Forecast</span><span>Previous</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {evs.map(([t, flag, cur, ev, imp, a, f, p], i) => (
                <div key={i} style={{ height: 28, flexShrink: 0, display: "grid", gridTemplateColumns: ".55fr .7fr 2fr .8fr .8fr .8fr .8fr", alignItems: "center", fontSize: 12, padding: "0 2px", borderTop: "1px solid var(--e-line-2)" }}>
                  <span>{t}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 10, padding: "1px 3px", borderRadius: 2, background: "#1b2a2e" }}>{flag}</span>{cur}</span>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev}</span>
                  <span style={{ display: "flex", gap: 2 }}>
                    {[0, 1, 2].map((k) => <span key={k} style={{ width: 6, height: 9, background: k < imp ? (imp === 3 ? "#e0463f" : imp === 2 ? "#e9c77a" : "#8e9896") : "#2a3a3f" }} />)}
                  </span>
                  <span>{a}</span><span>{f}</span><span>{p}</span>
                </div>
              ))}
              {evs.length === 0 && <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 12.5, color: "var(--e-text-2)" }}>No events match this filter.</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid var(--e-line)", paddingTop: 8 }}>
              <span className="e-icon" style={{ fontSize: 22 }}>notifications</span><span style={{ fontSize: 13 }}>Set Alert</span>
              <Sel value={alertBefore} options={["5 minutes before", "15 minutes before", "30 minutes before", "1 hour before"]} onChange={(v) => { setAlertBefore(v); flash(`Alerts set ${v} each event.`); }} h={30} fs={12} w="150px" />
              <span style={{ flex: 1 }} /><span style={{ fontSize: 12 }}>Filter by Importance</span>
              <Sel value={importance} options={["All", "High + Medium", "High only"]} onChange={setImportance} h={30} fs={12} w="150px" />
            </div>
          </div>
          )}

          {tab === "Level Analyzer" && (
          <div style={{ ...CARD, padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="e-icon" style={{ fontSize: 26 }}>query_stats</span><span style={{ fontSize: 16 }}>Level Analyzer / Research</span>
            </div>
            <div style={{ display: "flex" }}>
              {["Level Metrics", "Statistics", "Saved Levels"].map((l) => (
                <div key={l} onClick={() => setLaTab(l)} style={{ height: 30, padding: "0 18px", display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer", border: "1px solid", ...seg(l === laTab), borderColor: l === laTab ? "rgba(233,215,176,.7)" : "var(--e-line)" }}>{l}</div>
              ))}
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 176px", gap: 12, minHeight: 0 }}>
              <div style={{ position: "relative", minHeight: 0 }}>
                <canvas ref={levelRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                {laRows.map(([k, v, c], i) => (
                  <div key={i} style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                    <span>{k}</span><span style={{ color: c || "var(--e-text)" }}>{v}</span>
                  </div>
                ))}
                <div onClick={() => { const t = new Date(); setSaved((s) => [...s, { t: `${pad(t.getHours())}:${pad(t.getMinutes())}`, p: "4310.50" }].slice(-9)); flash("Level 4310.50 saved."); }} style={{ height: 30, marginTop: 6, flexShrink: 0, borderRadius: 4, border: "1px solid #3ccfb2", background: "#0f2a26", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                  <span className="e-icon" style={{ fontSize: 16 }}>add_photo_alternate</span>Save Level
                </div>
              </div>
            </div>
          </div>
          )}

          {tab === "Screenshot Tool" && (
          <div style={{ ...CARD, padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="e-icon" style={{ fontSize: 26 }}>photo_camera</span><span style={{ fontSize: 16 }}>Screenshot Tool</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>Capture Area</span>
              {["Full Chart", "Custom"].map((l) => {
                const a = l === capMode;
                return <div key={l} onClick={() => setCapMode(l)} style={{ width: 84, height: 30, boxSizing: "border-box", borderRadius: 3, display: "grid", placeItems: "center", fontSize: 12.5, cursor: "pointer", border: `1px solid ${a ? "#3ccfb2" : "var(--e-border-2)"}`, background: a ? "#0f2a26" : "var(--e-panel-2)" }}>{l}</div>;
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12.5, marginBottom: 2 }}>Include</span>
                {INCLUDES.map((label, i) => {
                  const on = !!inc[i];
                  return (
                    <div key={label} onClick={() => setInc((s) => s.map((v, k) => (k === i ? (v ? 0 : 1) : v)))} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      <span style={{ width: 15, height: 15, borderRadius: 3, boxSizing: "border-box", border: `1.5px solid ${on ? "#3ccfb2" : "#8e9896"}`, background: on ? "#3ccfb2" : "transparent", display: "grid", placeItems: "center" }}>
                        <span className="e-icon" style={{ fontSize: 13, color: "#081013", opacity: on ? 1 : 0 }}>check</span>
                      </span>{label}
                    </div>
                  );
                })}
              </div>
              <div style={{ position: "relative", height: 118, marginTop: 14, borderRadius: 3, border: "1px solid var(--e-border)", background: "#0a1417", overflow: "hidden" }}>
                <canvas ref={shotRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>Save to</span>
              <Sel value={saveTo} options={["Journal", "Downloads", "Cloud Backup"]} onChange={setSaveTo} h={30} fs={12} w="128px" />
              <span className="e-icon" style={{ width: 34, height: 30, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-gold)", display: "grid", placeItems: "center", fontSize: 18, color: "var(--e-gold)" }}>folder_open</span>
            </div>
            <div onClick={() => flash(`Screenshot saved to ${saveTo}.`)} style={{ marginTop: "auto", height: 36, borderRadius: 4, border: "1px solid var(--e-gold)", background: "linear-gradient(180deg,#3a3220,#231f15)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--e-ivory)", cursor: "pointer" }}>
              <span className="e-icon fill" style={{ fontSize: 18 }}>photo_camera</span>Capture &amp; Save
            </div>
          </div>
          )}
        </div>
        )}

        {tab === "More" && (
          <div className="e-fill" style={{ ...CARD, maxWidth: 900, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 30 }}>
              <span className="e-icon" style={{ fontSize: 24 }}>more_horiz</span><span style={{ fontSize: 16 }}>More</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--e-text-3)" }}>No further tools are built yet. Related things that already exist elsewhere:</div>
            {([
              ["Replay a setup candle by candle", "Backtest", "#/backtest"],
              ["Review past trades and screenshots", "Journal", "#/journal"],
              ["The setup rules these tools assume", "Rules", "#/rules"],
              ["Position size while placing a trade", "Trade panel", "#/chart"],
            ] as [string, string, string][]).map(([what, where, href]) => (
              <a key={where} href={href} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, borderTop: "1px solid var(--e-line-2)", paddingTop: 8, color: "var(--e-text)" }}>
                <span className="e-icon" style={{ fontSize: 15, color: "var(--e-text-2)" }}>radio_button_checked</span>
                <span style={{ flex: 1 }}>{what}</span>
                <span style={{ color: "var(--e-gold)" }}>{where}</span>
                <span className="e-icon" style={{ fontSize: 16, color: "var(--e-gold)" }}>arrow_forward</span>
              </a>
            ))}
          </div>
        )}

        <div style={{ height: 46, borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel-4)", display: "flex", alignItems: "center", gap: 18, padding: "0 18px" }}>
          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 44, lineHeight: 1, color: "var(--e-gold)", height: 26 }}>&ldquo;</span>
          <span style={{ flex: 1, fontSize: 13.5 }}>Better tools. Better decisions. Better trading.</span>
          <span style={{ fontSize: 13, letterSpacing: ".04em" }}>— ELION</span>
        </div>
      </main>

      {toast && (
        <div style={{ position: "fixed", right: 24, bottom: 24, padding: "10px 14px", borderRadius: 6, background: "#0f2a26", border: "1px solid #2c7a5f", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, zIndex: 10 }}>
          <span className="e-icon" style={{ fontSize: 18 }}>check_circle</span>{toast}
        </div>
      )}
    </div>
  );
}

