import { useEffect, useMemo, useRef, useState } from "react";
import { ElionSidebar, useElionClock } from "../components/ElionChrome";
import SignalsPanel from "../components/SignalsPanel";
import { AI_PROVIDER_KEY, BIAS_COLOR, CHECK_ICON, NO_SHARE, buildAnalyzeRequest, checkImageFile, classifyAiError, pickProvider, readImageFile, type AiFailureKind } from "../lib/aiLab";
import { journalApi, type AiAnalyzeResponse, type AiImage, type AiProvider, type AiProviderId, type AiShare } from "../lib/journalApi";
import { RULES } from "../lib/rules";
import { SYMBOL } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";

/**
 * Ported from design/elion/ai-lab.dc.html (reference design, not final code).
 *
 * Chat questions go to the journal server's /ai/analyze (journal/ai.py), answered by Gemini or Claude -
 * whichever is picked in the chat header. API keys stay on the journal server (GEMINI_API_KEY,
 * ANTHROPIC_API_KEY); the browser never sees them. Only what is ticked under "Share with AI" is sent:
 * the rule book, the selected account's journal trades, its MT5 account snapshot and MT5 candles, and
 * chart images the user attached. The AI is analysis-only - it cannot place, modify or close trades.
 *
 * Everything else on this page - chart, context, lists, the first two chat messages - is still the
 * reference's seeded sample content, reproduced 1:1.
 */

type Msg = { role: "user" | "bot"; text: string; time: string; plan?: boolean; result?: AiAnalyzeResponse; fail?: AiFailureKind };

const SHARE_ITEMS: [keyof AiShare, string, string][] = [
  ["rules", "Rules", "Your rule book"],
  ["trades", "Journal", "Trades of the selected account"],
  ["mt5_account", "MT5 account", "Balance, equity, open positions"],
  ["market", "MT5 candles", "Broker history for the symbol and timeframe"],
];
const FAIL_STYLE: Record<AiFailureKind, [string, string]> = {
  unavailable: ["key_off", "#e2c089"],
  timeout: ["timer_off", "#e2c089"],
  offline: ["cloud_off", "#ef5a50"],
  error: ["error", "#ef5a50"],
};

function loadProviderPref(): string | null {
  try { return window.localStorage.getItem(AI_PROVIDER_KEY); } catch { return null; }
}
type Bar = { o: number; c: number; h: number; l: number };

function build() {
  let seed = 21;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const K: [number, number][] = [[0, 4222], [6, 4238], [12, 4252], [18, 4262], [24, 4268], [30, 4290], [36, 4302], [40, 4312], [44, 4318], [48, 4322], [52, 4331], [55, 4336], [58, 4326], [62, 4318], [66, 4306], [70, 4296], [74, 4300], [78, 4306], [82, 4312], [86, 4318], [89, 4332], [92, 4320], [95, 4314], [98, 4312], [101, 4315.6]];
  const at = (i: number) => {
    for (let k = 1; k < K.length; k++) {
      if (i <= K[k][0]) { const [a, pa] = K[k - 1], [b, pb] = K[k]; return pa + ((pb - pa) * (i - a)) / (b - a); }
    }
    return 4315.6;
  };
  let prev = 4222;
  const cs: Bar[] = [];
  for (let i = 0; i <= 101; i++) {
    const o = prev, c = at(i) + (rnd() - 0.5) * 9;
    cs.push({ o, c, h: Math.max(o, c) + rnd() * 5, l: Math.min(o, c) - rnd() * 5 });
    prev = c;
  }
  Object.assign(cs[101], { o: 4314.2, h: 4316.8, l: 4311.5, c: 4315.6 });
  const ema = (a: number[], n: number) => { const k = 2 / (n + 1); let v = a[0]; return a.map((x) => (v = x * k + v * (1 - k))); };
  const cl = cs.map((c) => c.c);
  const e26 = ema(cl, 26);
  const macd = ema(cl, 12).map((v, i) => v - e26[i]);
  const sig = ema(macd, 9);
  return { cs, macd, sig, hist: macd.map((v, i) => v - sig[i]) };
}

const TABS = ["Chat & Analysis", "Setup Detection", "Chart Analysis", "Market Context", "Strategy Coach", "Idea Generator", "Rule Validation"];
const CHIPS = ["Analyze this chart", "Is this a valid setup?", "Explain the rule", "Find next opportunities", "Check my trade", "Market context"];
const DRAW_TOOLS = ["edit", "crop_free", "draw", "horizontal_rule", "more_horiz", "straighten"];
const TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const TOOL_PROMPTS = ["Analyze the current XAUUSD H1 chart structure.", "Detect any valid setups on XAUUSD right now.", "Summarize the market context: news, sessions and bias.", "Validate my trade: buy 4314, SL 4294, TP 4340.", "Coach me: how can I improve my edge this week?", "Give me a new trade idea with a different perspective."];
const TOOLS: [string, string, string, string, number][] = [
  ["add_photo_alternate", "Chart Analysis", "Upload or capture", "#5aa9e6", 0],
  ["track_changes", "Setup Detection", "Find valid setups", "#e9b560", 0],
  ["language", "Market Context", "News, sessions, bias", "#5aa9e6", 0],
  ["check_box", "Rule Validation", "Check your trade", "#3ccfb2", 1],
  ["bar_chart", "Strategy Coach", "Improve your edge", "#3ccfb2", 1],
  ["lightbulb", "Idea Generator", "New perspectives", "#e9b560", 0],
];
const BIAS: [string, string][] = [["D1", "Bullish"], ["H4", "Bullish"], ["H1", "Bullish"], ["M15", "Neutral"], ["M5", "Neutral"]];
const INSIGHTS = [
  "Your win rate increased by 6% this month due to better level selection.",
  "Most of your losing trades are during news (avoid 30 min before).",
  "Best performance: London session (62% win rate).",
  "Consider reducing position size on Mondays.",
  "Your average R:R improved from  1:3.9 to 1:4.8.",
];
const SAVED: [string, string, string, string][] = [
  ["analytics", "XAUUSD - Level Continuation", "Valid setup, London session", "Yesterday"],
  ["query_stats", "EURUSD - Double Level", "Good structure, waiting for entry", "2 days ago"],
  ["insights", "Market Outlook (Weekly)", "Bias: Bullish, key levels and scenarios", "3 days ago"],
  ["feed", "News Impact Analysis", "FOMC - high volatility expected", "5 days ago"],
];
const RECENT: [string, string, string, string, string, string, number][] = [
  ["person", "XAUUSD H1", "Level Continuation", "High Confidence", "10:15", "hi", 1],
  ["support_agent", "EURUSD M15", "Break & Pullback", "Medium", "09:42", "med", 1],
  ["support_agent", "GBPUSD H4", "Trend Change", "Low", "08:28", "low", 0],
];

const spark = (seed: number, up: number) => {
  let s = seed, v = 18;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 26 }, (_, i) => {
    v += (r() - 0.5) * 6 + (up ? -0.55 : 0.5);
    v = Math.max(4, Math.min(32, v));
    return (i * 3).toFixed(0) + "," + v.toFixed(1);
  }).join(" ");
};

const CARD: React.CSSProperties = { borderRadius: 8, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const TEAL = "var(--e-up-2)";
const pad2 = (n: number) => String(n).padStart(2, "0");
const selStyle = (a: boolean) => a
  ? { background: "linear-gradient(180deg,#2a2618,#1c1b13)", color: "var(--e-ivory)", border: "1px solid rgba(233,215,176,.6)" }
  : { background: "var(--e-panel-2)", color: "var(--e-text)", border: "1px solid var(--e-line)" };

function Picker({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ width: 136, height: 42, boxSizing: "border-box", borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "flex", alignItems: "center", padding: "0 10px", gap: 6 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 10.5, color: "var(--e-text-3)" }}>{label}</span>
        <span style={{ fontSize: 13 }}>{value}</span>
      </div>
      <span className="e-icon" style={{ fontSize: 18 }}>expand_more</span>
    </div>
  );
}

function List({ title, items, color }: { title: string; items: string[]; color?: string }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: color ?? "var(--e-text-3)", letterSpacing: ".04em" }}>{title}</span>
      {items.map((t, i) => <span key={i} style={{ fontSize: 12, lineHeight: 1.4 }}>• {t}</span>)}
    </div>
  );
}

/** The structured answer from /ai/analyze. Shows exactly what came back - no invented scores. */
function AnalysisView({ r }: { r: AiAnalyzeResponse }) {
  const a = r.analysis;
  const used = r.context_used;
  const shared = [used.rules && `${used.rules} rule${used.rules > 1 ? "s" : ""}`, used.trades && `${used.trades} trades`, used.mt5_account && "MT5 account",
    used.market_candles && `${used.market_candles} candles`, used.images && `${used.images} image${used.images > 1 ? "s" : ""}`].filter(Boolean).join(" · ") || "no data shared";
  return (
    <div style={{ borderRadius: 6, border: "1px solid #243236", background: "var(--e-panel-2)", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12 }}>Bias: <span style={{ color: BIAS_COLOR[a.market_bias] ?? "var(--e-text)", textTransform: "capitalize" }}>{a.market_bias}</span></span>
        <span style={{ fontSize: 10.5, color: "var(--e-text-3)" }}>{r.provider === "gemini" ? "Gemini" : "Claude"} · {r.model} · {(r.elapsed_ms / 1000).toFixed(1)} s</span>
      </div>
      {a.rule_checks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--e-text-3)", letterSpacing: ".04em" }}>Rule checks</span>
          {a.rule_checks.map((c, i) => {
            const [ic, col] = CHECK_ICON[c.status] ?? ["help", "var(--e-text-3)"];
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", gap: 6, fontSize: 12, lineHeight: 1.4 }}>
                <span className="e-icon" style={{ fontSize: 15, color: col }}>{ic}</span>
                <span><span style={{ color: "var(--e-ivory)" }}>{c.rule}</span>{c.evidence ? ` — ${c.evidence}` : ""}</span>
              </div>
            );
          })}
        </div>
      )}
      <List title="Observations" items={a.observations} />
      <List title="Risks" items={a.risks} color="#e2c089" />
      <List title="Next steps (for you to verify — nothing is executed)" items={a.next_steps} />
      <List title="Missing data" items={[...a.data_gaps, ...r.notes]} />
      <span style={{ fontSize: 10.5, color: "var(--e-text-3)" }}>Sent: {shared}</span>
    </div>
  );
}

export default function ElionAiLabPage() {
  const clock = useElionClock();
  const data = useMemo(build, []);
  const [tab, setTab] = useState("Chat & Analysis");
  const [tf, setTf] = useState("H1");
  const [biasSel, setBiasSel] = useState(4);
  const [tool, setTool] = useState(-1);
  const [recentSel, setRecentSel] = useState(0);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const j = useJournal();
  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [providersDown, setProvidersDown] = useState<string | null>(null);
  const [provider, setProviderRaw] = useState<AiProviderId | null>(null);
  const [share, setShare] = useState<AiShare>(NO_SHARE);
  const [images, setImages] = useState<AiImage[]>([]);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "user", text: "Analyze this chart. Is there a valid Level Continuation setup? Give me entry, SL, TP and reasoning.", time: "10:14" },
    { role: "bot", text: "Yes, there is a valid Level Continuation setup on XAUUSD (H1).\n\nThe price pulled back to a previously established level, MACD shows hidden divergence, and the higher timeframe trend remains bullish. This aligns with your rules.", time: "10:15", plan: true },
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;

  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking]);

  const hhmm = () => { const d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };

  /* ---- AI providers (keys are checked server-side; this only learns whether each one is configured) ---- */
  const loadProviders = () => {
    setProvidersDown(null);
    journalApi.aiProviders()
      .then((list) => { setProviders(list); setProviderRaw((cur) => pickProvider(list, cur ?? loadProviderPref())); })
      .catch((e) => { setProviders([]); setProviderRaw(null); setProvidersDown(classifyAiError(e).message); });
  };
  useEffect(loadProviders, []);
  const setProvider = (id: AiProviderId) => {
    setProviderRaw(id);
    try { window.localStorage.setItem(AI_PROVIDER_KEY, id); } catch { /* private mode: just not remembered */ }
  };
  const current = providers?.find((p) => p.id === provider) ?? null;

  const attach = async (files: FileList | null) => {
    setAttachErr(null);
    const picked = Array.from(files ?? []);
    let count = images.length;
    const next: AiImage[] = [];
    for (const f of picked) {
      const err = checkImageFile(f, count);
      if (err) { setAttachErr(err); break; }
      try { next.push(await readImageFile(f)); count++; } catch (e) { setAttachErr(e instanceof Error ? e.message : "Could not read the image."); break; }
    }
    if (next.length) setImages((cur) => [...cur, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const ask = async (text: string) => {
    const t = (text || "").trim();
    if (!t || thinkingRef.current) return;
    setMsgs((m) => [...m, { role: "user", text: t, time: hhmm() }]);
    setDraft("");
    if (!provider) {
      const why = providersDown
        ? `AI is unavailable: ${providersDown}`
        : "No AI provider is configured. Set GEMINI_API_KEY (or ANTHROPIC_API_KEY) on the PC that runs the journal server and restart it.";
      setMsgs((m) => [...m, { role: "bot", text: why, time: hhmm(), fail: providersDown ? "offline" : "unavailable" }]);
      return;
    }
    setThinking(true);
    try {
      const req = buildAnalyzeRequest({ provider, question: t, share, accountId: j.active?.id ?? null, rules: RULES, images, symbol: SYMBOL, timeframe: tf });
      const res = await journalApi.aiAnalyze(req);
      setMsgs((m) => [...m, { role: "bot", text: res.analysis.summary, time: hhmm(), result: res }]);
      setImages([]); // images are approved per question
    } catch (e) {
      const f = classifyAiError(e);
      setMsgs((m) => [...m, { role: "bot", text: f.message, time: hhmm(), fail: f.kind }]);
      if (f.kind === "unavailable") loadProviders(); // e.g. the key was removed since the page loaded
    } finally {
      setThinking(false);
    }
  };

  /* ---- chart ---- */
  useEffect(() => {
    const draw = () => {
      try {
        const el = chartRef.current;
        if (!el || !el.clientWidth || !el.clientHeight) return;
        const d = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
        if (el.width !== Math.round(w * d) || el.height !== Math.round(h * d)) { el.width = Math.round(w * d); el.height = Math.round(h * d); }
        const ctx = el.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const RA = 56, B = 26, pw = w - RA, macdH = Math.round(h * 0.3), mainH = h - B - macdH, N = 128, cw = pw / N;
        const min = 4216, max = 4392;
        const Y = (v: number) => 28 + ((max - v) / (max - min)) * (mainH - 34);
        const X = (i: number) => (i + 0.5) * cw;
        ctx.font = "11px Manrope, sans-serif"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;
        [4220, 4240, 4260, 4280, 4300, 4340, 4360, 4380].forEach((v) => { ctx.fillStyle = "#dfe5e3"; ctx.textAlign = "left"; ctx.fillText(v.toFixed(2), pw + 6, Y(v)); });
        ctx.strokeStyle = "#1a2a2f"; ctx.beginPath();
        ctx.moveTo(pw + 0.5, 0); ctx.lineTo(pw + 0.5, h);
        ctx.moveTo(0, mainH + 0.5); ctx.lineTo(w, mainH + 0.5);
        ctx.moveTo(0, h - B + 0.5); ctx.lineTo(pw, h - B + 0.5); ctx.stroke();
        ([[8, "17"], [30, "18"], [50, "19"], [72, "22"], [94, "23"], [118, "24"]] as [number, string][])
          .forEach(([i, t]) => { ctx.fillStyle = "#dfe5e3"; ctx.textAlign = "center"; ctx.fillText(t, X(i), h - B / 2); });
        ctx.fillStyle = "rgba(200,190,180,.28)"; ctx.fillRect(X(46), Y(4337), X(92) - X(46), Y(4331) - Y(4337));
        ctx.strokeStyle = "rgba(220,210,200,.4)"; ctx.strokeRect(X(46), Y(4337), X(92) - X(46), Y(4331) - Y(4337));
        ctx.fillStyle = "rgba(70,140,190,.22)"; ctx.fillRect(X(31), Y(4284), X(111) - X(31), Y(4273) - Y(4284));
        ctx.strokeStyle = "rgba(90,160,210,.5)"; ctx.strokeRect(X(31), Y(4284), X(111) - X(31), Y(4273) - Y(4284));
        ctx.strokeStyle = "rgba(200,215,225,.55)"; ctx.beginPath(); ctx.moveTo(X(0), Y(4224)); ctx.lineTo(X(105), Y(4296)); ctx.stroke();
        data.cs.forEach((c, i) => {
          const x = X(i), col = c.c >= c.o ? "#26b58d" : "#e0463f";
          ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(c.h)); ctx.lineTo(Math.round(x) + 0.5, Y(c.l)); ctx.stroke();
          const y1 = Y(Math.max(c.o, c.c));
          ctx.fillStyle = col; ctx.fillRect(x - cw * 0.34, y1, cw * 0.68, Math.max(1, Y(Math.min(c.o, c.c)) - y1));
        });
        const lvl = (v: number, col: string, dash: number[], txt: string, x0: number) => {
          ctx.setLineDash(dash); ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(X(x0), Y(v)); ctx.lineTo(pw - 20, Y(v)); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = col === "#e0463f" ? "#ef5a50" : "#fff";
          ctx.font = "12px Manrope, sans-serif"; ctx.textAlign = "right"; ctx.fillText(txt, pw - 24, Y(v) - 10);
        };
        lvl(4375, "#3ccfb2", [4, 3], "TP2  4375.00", 92);
        lvl(4340, "#3ccfb2", [4, 3], "TP1  4340.00", 92);
        lvl(4312, "rgba(230,235,232,.7)", [], "Entry 4312 – 4316", 100);
        lvl(4294, "#e0463f", [4, 3], "SL 4294.00", 100);
        ctx.strokeStyle = "#3ccfb2"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(X(104), Y(4318)); ctx.lineTo(X(110), Y(4337)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(110) - 5, Y(4337) + 5); ctx.lineTo(X(110), Y(4337)); ctx.lineTo(X(110) + 2, Y(4337) + 7); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]); ctx.strokeStyle = "rgba(60,207,178,.35)";
        ctx.beginPath(); ctx.moveTo(0, Y(4315.6)); ctx.lineTo(pw, Y(4315.6)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#1f9c7a"; ctx.fillRect(pw, Y(4315.6) - 9, RA, 18);
        ctx.fillStyle = "#fff"; ctx.font = "600 11px Manrope, sans-serif"; ctx.textAlign = "left"; ctx.fillText("4315.60", pw + 6, Y(4315.6));
        const mt = mainH + 16, mh = macdH - 24;
        const MY = (v: number) => mt + mh / 2 - (v / 22) * (mh / 2);
        ctx.font = "11.5px Manrope, sans-serif"; ctx.fillStyle = "#dfe5e3"; ctx.fillText("MACD (12, 26, 9)", 12, mainH + 16);
        ([[20, "20.00"], [0, "0.00"], [-20, "−20.00"]] as [number, string][]).forEach(([v, t]) => { ctx.fillStyle = "#dfe5e3"; ctx.fillText(t, pw + 6, MY(v)); });
        data.hist.forEach((v, i) => {
          const hv = v * 2.2, y0 = MY(0), y1 = MY(hv);
          ctx.fillStyle = hv >= 0 ? "rgba(60,207,178,.8)" : "rgba(224,70,63,.8)";
          ctx.fillRect(X(i) - cw * 0.34, Math.min(y0, y1), cw * 0.68, Math.abs(y1 - y0));
        });
        const ln = (a: number[], col: string) => {
          ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath();
          a.forEach((v, i) => (i ? ctx.lineTo(X(i), MY(v)) : ctx.moveTo(X(i), MY(v))));
          ctx.stroke(); ctx.lineWidth = 1;
        };
        ln(data.macd, "#3b82f6"); ln(data.sig, "#ef4444");
        ctx.strokeStyle = "#3ccfb2"; ctx.beginPath(); ctx.moveTo(X(70), MY(-8.5)); ctx.lineTo(X(88), MY(-3)); ctx.stroke();
        ctx.fillStyle = "#3ccfb2"; ctx.font = "11px Manrope, sans-serif"; ctx.textAlign = "left"; ctx.fillText("Hidden Divergence", X(86), MY(-9.5));
      } catch (err) { console.warn("chart", err instanceof Error ? err.message : err); }
    };
    const el = chartRef.current;
    const ro = el ? new ResizeObserver(draw) : null;
    if (ro && el) ro.observe(el);
    const timers = [0, 80, 400].map((t) => window.setTimeout(draw, t));
    draw();
    return () => { timers.forEach(window.clearTimeout); ro?.disconnect(); };
  }, [data]);

  const lEnd = new Date(now); lEnd.setHours(13, 0, 0, 0);
  let ls = Math.max(0, Math.floor((lEnd.getTime() - now.getTime()) / 1000));
  if (!ls) ls = 9792;
  const newsT = new Date(now); newsT.setHours(10, 59, 0, 0);
  let nm = Math.ceil((newsT.getTime() - now.getTime()) / 60000);
  if (nm <= 0) nm = 43;

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="AI Lab" />

      <main style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 30, height: 52 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".5em", color: "var(--e-gold)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 14, color: "var(--e-text)" }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,418px)", height: 38, borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 14px", color: "var(--e-text-3)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>Search symbols, setups, or ask ELION...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl  K</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: TEAL }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: TEAL, boxShadow: `0 0 6px ${TEAL}` }} />London Session • Live
            </div>
            <div style={{ color: "var(--e-text)", fontSize: 12 }}>{clock}</div>
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

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, paddingLeft: 6 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, letterSpacing: ".18em", color: "var(--e-ivory)", lineHeight: 1 }}>AI LAB</div>
            <div style={{ fontSize: 12.5, letterSpacing: ".24em", color: "var(--e-text)" }}>YOUR TRADING INTELLIGENCE PARTNER.</div>
          </div>
          <Picker label="Symbol" value="XAUUSD" />
          <Picker label="Timeframe" value="H1" />
          <Picker label="Session" value="London" />
          <div className="e-ghost" onClick={() => ask("Run a fresh analysis on XAUUSD H1 and tell me if the Level Continuation setup is still valid.")} style={{ height: 40, padding: "0 22px", borderRadius: 4, border: "1px solid var(--e-gold)", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--e-ivory)", cursor: "pointer", marginLeft: 2, whiteSpace: "nowrap" }}>
            <span className="e-icon" style={{ fontSize: 19 }}>auto_fix_high</span>New Analysis
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {TABS.map((l) => (
            <div key={l} onClick={() => setTab(l)} style={{ height: 36, padding: "0 18px", borderRadius: 4, display: "grid", placeItems: "center", fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer", ...selStyle(l === tab) }}>{l}</div>
          ))}
        </div>

        {tab === "Setup Detection" ? <SignalsPanel provider={current} /> : (<>
        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "386fr 604fr 400px", gap: 14, minHeight: 554 }}>
          {/* ---- chat ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0 }}>
            <div style={{ ...CARD, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 4px" }}>
                <span style={{ fontSize: 16 }}>Chat with ELION</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span title={current ? `${current.label} · ${current.model}` : providersDown ?? "No AI provider configured"} style={{ width: 9, height: 9, borderRadius: "50%", background: providers === null ? "var(--e-text-3)" : current ? TEAL : "#e2c089" }} />
                  <select aria-label="AI provider" value={provider ?? ""} disabled={!providers?.length} onChange={(e) => setProvider(e.target.value as AiProviderId)}
                    style={{ height: 26, borderRadius: 4, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", color: "var(--e-text)", fontSize: 12, padding: "0 6px" }}>
                    {providers === null && <option value="">Checking…</option>}
                    {providers !== null && !provider && <option value="">{providersDown ? "AI offline" : "Not configured"}</option>}
                    {(providers ?? []).map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? "" : " (no key)"}</option>
                    ))}
                  </select>
                </span>
              </div>
              <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
                {msgs.map((m, i) => m.role === "user" ? (
                  <div key={i} style={{ alignSelf: "flex-end", maxWidth: "84%", boxSizing: "border-box", padding: "8px 12px 6px", borderRadius: 6, background: "#132f3f", border: "1px solid #1f4a60", fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                    {m.text}
                    <div style={{ textAlign: "right", fontSize: 10, color: "var(--e-text-2)", marginTop: 2 }}>{m.time}</div>
                  </div>
                ) : (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#2a2518", border: "1px solid rgba(233,215,176,.5)", display: "grid", placeItems: "center" }}>
                      <div style={{ width: 9, height: 9, border: "1.2px solid var(--e-gold)", transform: "rotate(45deg)" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
                        <span style={{ fontSize: 14 }}>ELION</span><span style={{ fontSize: 10, color: "var(--e-text-2)" }}>{m.time}</span>
                      </div>
                      {m.fail ? (
                        <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.45, color: FAIL_STYLE[m.fail][1] }}>
                          <span className="e-icon" style={{ fontSize: 16 }}>{FAIL_STYLE[m.fail][0]}</span><span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--e-text)", whiteSpace: "pre-wrap", textWrap: "pretty" }}>{m.text}</div>
                      )}
                      {m.result && <AnalysisView r={m.result} />}
                      {m.plan && (
                        <div style={{ borderRadius: 6, border: "1px solid #243236", background: "var(--e-panel-2)", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>Trade Plan</span>
                            <span style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 3, background: "#0f3a33", border: "1px solid #2c7a5f", color: "#9ff0d9", fontSize: 10.5 }}>
                              <span className="e-icon" style={{ fontSize: 11 }}>bolt</span>High Confidence
                            </span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", rowGap: 6, fontSize: 12 }}>
                            <span>Direction</span><span style={{ color: TEAL }}>BUY</span>
                            <span>Entry</span><span>4312 – 4316</span>
                            <span>Stop Loss</span><span style={{ color: "#ef5a50" }}>4294.00</span>
                            <span>Take Profit</span><span style={{ color: TEAL }}>4340.00 / 4375.00</span>
                            <span>Risk : Reward</span><span>1:5.2</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--e-text-2)", paddingLeft: 40 }}>
                    <span className="e-icon e-spin" style={{ fontSize: 16, color: "var(--e-gold)" }}>progress_activity</span>{current?.label ?? "ELION"} is analyzing…
                  </div>
                )}
              </div>
              <div style={{ padding: "6px 8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, fontSize: 11 }}>
                  <span style={{ color: "var(--e-text-3)", marginRight: 2 }}>Share with AI:</span>
                  {SHARE_ITEMS.map(([k, label, hint]) => (
                    <label key={k} title={hint} style={{ display: "flex", alignItems: "center", gap: 4, height: 22, padding: "0 6px", borderRadius: 3, cursor: "pointer", ...selStyle(share[k]) }}>
                      <input type="checkbox" checked={share[k]} onChange={(e) => setShare((s) => ({ ...s, [k]: e.target.checked }))} style={{ margin: 0, width: 12, height: 12, accentColor: "#e9d7b0" }} />{label}
                    </label>
                  ))}
                </div>
                {(images.length > 0 || attachErr) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {images.map((im, i) => (
                      <span key={i} style={{ position: "relative", width: 44, height: 32, borderRadius: 3, overflow: "hidden", border: "1px solid var(--e-border)" }} title={im.label}>
                        <img src={`data:${im.mime};base64,${im.data}`} alt={im.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <span className="e-icon" aria-label="Remove image" onClick={() => setImages((cur) => cur.filter((_, x) => x !== i))} style={{ position: "absolute", top: 0, right: 0, fontSize: 13, background: "rgba(0,0,0,.6)", cursor: "pointer" }}>close</span>
                      </span>
                    ))}
                    {attachErr && <span style={{ fontSize: 11, color: "#ef5a50" }}>{attachErr}</span>}
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => attach(e.target.files)} />
                <div style={{ height: 40, borderRadius: 5, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "flex", alignItems: "center", gap: 6, padding: "0 4px 0 12px" }}>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(draft); } }} placeholder="Ask ELION anything..." style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "var(--e-text)", fontSize: 13 }} />
                  <span className="e-icon" role="button" aria-label="Attach chart image" title="Attach a chart image (sent with your next question)" onClick={() => fileRef.current?.click()} style={{ width: 30, height: 30, borderRadius: 4, border: "1px solid var(--e-border)", display: "grid", placeItems: "center", fontSize: 17, color: images.length ? "var(--e-gold)" : "var(--e-text-3)", cursor: "pointer" }}>attach_file</span>
                  <span className="e-icon" role="button" aria-label="Send" aria-disabled={thinking} onClick={() => ask(draft)} style={{ width: 32, height: 30, borderRadius: 4, background: "#f0cf8e", color: "#1a1409", display: "grid", placeItems: "center", fontSize: 18, cursor: thinking ? "wait" : "pointer", opacity: thinking ? 0.5 : 1 }}>send</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {CHIPS.map((l) => (
                <div key={l} className="e-chip" onClick={() => ask(l)} style={{ height: 26, padding: "0 7px", borderRadius: 3, border: "1px solid #243236", background: "var(--e-panel-2)", display: "grid", placeItems: "center", fontSize: 11, whiteSpace: "nowrap", cursor: "pointer" }}>{l}</div>
              ))}
            </div>
          </div>

          {/* ---- chart ---- */}
          <div style={{ borderRadius: 8, border: "1px solid var(--e-line)", background: "#0a1417", display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div style={{ height: 48, display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 18px", borderBottom: "1px solid var(--e-line-3)" }}>
              <span style={{ flex: 1, fontSize: 17 }}>Chart Analysis</span>
              <div role="button" title="Attach a chart image to your next AI question" onClick={() => fileRef.current?.click()} style={{ height: 28, padding: "0 10px", borderRadius: 4, border: "1px solid var(--e-border-2)", display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <span className="e-icon" style={{ fontSize: 16 }}>upload</span>Upload Chart
              </div>
              {["center_focus_weak", "photo_camera"].map((ic) => (
                <span key={ic} className="e-icon" style={{ width: 30, height: 28, borderRadius: 4, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 17 }}>{ic}</span>
              ))}
            </div>
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <canvas ref={chartRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
              <div style={{ position: "absolute", left: 12, top: 10, display: "flex", gap: 6, fontSize: 12, pointerEvents: "none" }}>
                XAUUSD · H1 <span style={{ marginLeft: 6 }}>O<span style={{ color: TEAL }}>4314.20</span></span>
                <span>H<span style={{ color: TEAL }}>4316.80</span></span><span>L<span style={{ color: TEAL }}>4311.50</span></span>
                <span>C<span style={{ color: TEAL }}>4315.60</span></span><span style={{ color: TEAL }}>+1.40 (+0.03%)</span>
              </div>
            </div>
            <div style={{ height: 40, display: "flex", alignItems: "center", gap: 4, padding: "0 10px", borderTop: "1px solid var(--e-line-3)" }}>
              {DRAW_TOOLS.map((d) => <span key={d} className="e-icon" style={{ width: 28, height: 26, display: "grid", placeItems: "center", fontSize: 17, color: "var(--e-text-3)", cursor: "pointer" }}>{d}</span>)}
              <div style={{ width: 1, height: 22, background: "var(--e-border)", margin: "0 10px" }} />
              {TFS.map((l) => (
                <div key={l} onClick={() => setTf(l)} style={{ padding: "4px 7px", borderRadius: 4, fontSize: 11.5, cursor: "pointer", background: l === tf ? "#2a2618" : "transparent", border: `1px solid ${l === tf ? "rgba(233,215,176,.6)" : "transparent"}` }}>{l}</div>
              ))}
              <div style={{ flex: 1 }} />
              <span className="e-icon" style={{ fontSize: 17, color: "var(--e-text-3)", padding: "0 8px" }}>settings</span>
              <span className="e-icon" style={{ fontSize: 17, color: "var(--e-text-3)" }}>camera</span>
            </div>
          </div>

          {/* ---- tools + context ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ ...CARD, padding: "14px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 17, paddingLeft: 4 }}>AI Tools</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {TOOLS.map(([icon, title, sub, color, fill], i) => (
                  <div key={title} className="e-tool" onClick={() => { setTool(i); ask(TOOL_PROMPTS[i]); }} style={{ height: 60, boxSizing: "border-box", borderRadius: 5, border: `1px solid ${tool === i ? "rgba(233,215,176,.6)" : "var(--e-line)"}`, background: "var(--e-panel-2)", display: "flex", alignItems: "center", gap: 10, padding: "0 10px", cursor: "pointer", minWidth: 0 }}>
                    <span className={`e-icon${fill ? " fill" : ""}`} style={{ fontSize: 26, color }}>{icon}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
                      <span style={{ fontSize: 11, color: "var(--e-text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ ...CARD, flex: 1, padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, whiteSpace: "nowrap" }}>Market Context (XAUUSD)</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEAL }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: TEAL }} />Bullish Bias</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6 }}>
                {BIAS.map(([btf, v], i) => {
                  const a = i === biasSel;
                  return (
                    <div key={btf} onClick={() => setBiasSel(i)} style={{ height: 52, borderRadius: 4, border: `1px solid ${a ? "rgba(233,215,176,.6)" : "var(--e-line)"}`, background: a ? "linear-gradient(180deg,#2a2618,#1c1b13)" : v === "Bullish" ? "#0e1f24" : "#141a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer" }}>
                      <span style={{ fontSize: 12.5 }}>{btf}</span>
                      <span style={{ fontSize: 12.5, color: v === "Bullish" ? TEAL : "#e9c77a" }}>{v}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "24px 98px 1fr auto", alignItems: "center", fontSize: 12.5, borderBottom: "1px solid var(--e-line-3)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: TEAL }} /><span>London Session</span>
                  <span style={{ color: TEAL }}>Active</span><span>{pad2(Math.floor(ls / 3600))}:{pad2(Math.floor((ls % 3600) / 60))}:{pad2(ls % 60)}</span>
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "24px 98px 1fr auto", alignItems: "center", fontSize: 12.5, borderBottom: "1px solid var(--e-line-3)" }}>
                  <span className="e-icon" style={{ fontSize: 17 }}>calendar_month</span><span>Next News</span>
                  <span>FOMC Member Speaks</span><span>{nm} min</span>
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "24px 98px 1fr auto", alignItems: "center", fontSize: 12.5, borderBottom: "1px solid var(--e-line-3)" }}>
                  <span className="e-icon" style={{ fontSize: 17, color: TEAL }}>signal_cellular_alt</span><span>Volatility</span><span>Medium</span><span />
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "24px 98px 1fr auto", alignItems: "center", fontSize: 12.5 }}>
                  <span className="e-icon" style={{ fontSize: 17 }}>target</span><span>Key Levels</span>
                  <span>R: 4340 / 4375</span><span style={{ paddingRight: 4, whiteSpace: "nowrap" }}>S: 4294 / 4260</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- bottom row ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "458fr 534fr 400px", gap: 14, height: 204 }}>
          <div style={{ ...CARD, padding: "12px 8px 8px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 15, padding: "0 4px 4px" }}>Recent Analyses</div>
            {RECENT.map(([icon, pair, setup, tagText, time, lvl, up], i) => {
              const a = i === recentSel;
              const tagBg = lvl === "hi" ? "#0f3a33" : lvl === "med" ? "#3a2f14" : "#3a1614";
              const tagBd = lvl === "hi" ? "#2c7a5f" : lvl === "med" ? "#8a6a2a" : "#8a2a26";
              const tagFg = lvl === "hi" ? "#9ff0d9" : lvl === "med" ? "#f0c56a" : "#f08a82";
              return (
                <div key={pair} onClick={() => setRecentSel(i)} style={{ flex: 1, display: "grid", gridTemplateColumns: "36px 1fr 96px 44px 76px", gap: 8, alignItems: "center", padding: "0 8px", borderRadius: 5, border: `1px solid ${a ? "rgba(233,215,176,.45)" : "transparent"}`, background: a ? "linear-gradient(90deg,#1f1d14,#0f1618)" : "transparent", cursor: "pointer" }}>
                  <span className="e-icon fill" style={{ width: 26, height: 26, borderRadius: "50%", background: "#1b2a2e", border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 15 }}>{icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5 }}>{pair}</div>
                    <div style={{ fontSize: 11.5, color: "var(--e-text-3)", marginTop: 3 }}>{setup}</div>
                  </div>
                  <span style={{ justifySelf: "start", padding: "3px 7px", borderRadius: 3, fontSize: 10.5, whiteSpace: "nowrap", background: tagBg, border: `1px solid ${tagBd}`, color: tagFg }}>
                    {(lvl === "med" ? "⚡ " : lvl === "low" ? "⊘ " : "") + tagText}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--e-text-3)" }}>{time}</span>
                  <svg viewBox="0 0 76 36" preserveAspectRatio="none" style={{ width: 76, height: 38, border: "1px solid var(--e-border)", borderRadius: 3, background: "#0a1417", boxSizing: "border-box" }}>
                    <polyline points={spark(7 + i * 13, up)} fill="none" stroke="#e05a55" strokeWidth={1} />
                  </svg>
                </div>
              );
            })}
          </div>

          <div style={{ ...CARD, padding: "12px 12px 6px", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontSize: 15, padding: "0 0 6px" }}>Key Insights from ELION</div>
            {INSIGHTS.map((t, i) => (
              <div key={i} className="e-insight" onClick={() => ask("Explain this insight and what I should do about it: " + t)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid var(--e-line-2)", cursor: "pointer", padding: "0 4px" }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--e-gold)", color: "#1a1409", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 12.5 }}>{t}</span>
                <span className="e-icon" style={{ fontSize: 18 }}>chevron_right</span>
              </div>
            ))}
          </div>

          <div style={{ ...CARD, padding: "12px 12px 8px", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 4 }}>
              <span style={{ fontSize: 15 }}>Saved Analyses</span>
              <div style={{ height: 28, padding: "0 12px", borderRadius: 4, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer" }}>View All</div>
            </div>
            {SAVED.map(([icon, title, sub, when]) => (
              <div key={title} style={{ flex: 1, display: "grid", gridTemplateColumns: "34px 1fr auto", gap: 6, alignItems: "center" }}>
                <span className="e-icon" style={{ width: 22, height: 22, borderRadius: 4, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 14 }}>{icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12 }}>{title}</div>
                  <div style={{ fontSize: 11, color: "var(--e-text-3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                </div>
                <span style={{ fontSize: 11, color: "var(--e-text-3)", alignSelf: "start", paddingTop: 4 }}>{when}</span>
              </div>
            ))}
          </div>
        </div>
        </>)}
      </main>
    </div>
  );
}
