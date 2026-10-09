import { useEffect, useRef, useState } from "react";
import { ElionSidebar } from "../components/ElionChrome";

/**
 * Ported from design/elion/rules.dc.html (reference design, not final code).
 * The setup library, checklists and the annotated example charts below are the reference's own
 * content, reproduced 1:1 — this page does not read the app's own RULES list or journal yet.
 */

type Bar = { o: number; c: number; h: number; l: number; v: number };

/** the reference's keyframe-to-candles generator, seeded so the charts never move */
function series(K: [number, number][], n: number, seed: number, noise: number): Bar[] {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const at = (t: number) => {
    for (let k = 1; k < K.length; k++) {
      if (t <= K[k][0]) {
        const [a, pa] = K[k - 1], [b, pb] = K[k];
        return pa + ((pb - pa) * (t - a)) / (b - a);
      }
    }
    return K[K.length - 1][1];
  };
  let prev = at(0);
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const o = prev, c = at(i / (n - 1)) + (rnd() - 0.5) * noise;
    out.push({ o, c, h: Math.max(o, c) + rnd() * noise * 0.6, l: Math.min(o, c) - rnd() * noise * 0.6, v: 0.3 + rnd() * 0.7 });
    prev = c;
  }
  return out;
}

const MAIN_K: [number, number][] = [[0, 60], [.04, 66], [.08, 58], [.14, 40], [.2, 18], [.24, 14], [.3, 34], [.36, 52], [.4, 56], [.46, 36], [.52, 30], [.58, 28], [.64, 42], [.7, 54], [.74, 62], [.78, 72], [.82, 60], [.86, 58], [.88, 64], [.92, 75], [.96, 70], [1, 72]];
const EX_K: [number, number][][] = [
  [[0, 40], [.2, 42], [.3, 25], [.4, 20], [.5, 34], [.6, 30], [.7, 48], [.8, 60], [.9, 72], [1, 85]],
  [[0, 40], [.12, 52], [.25, 45], [.4, 60], [.5, 48], [.6, 32], [.7, 50], [.8, 64], [.9, 76], [1, 86]],
  [[0, 30], [.2, 32], [.35, 36], [.5, 42], [.62, 56], [.68, 72], [.75, 62], [.85, 54], [.92, 60], [1, 44]],
];

const SETUPS: [string, string, string, string][] = [
  ["Level Continuation", "Main Setup", "Primary Setup", "Trade in the direction of the established trend using a hidden level.\nThe level remains valid even if MACD has already crossed the zero line."],
  ["Break & Pullback", "Trend Change", "Secondary Setup", "Wait for a clean break of structure, then enter on the first pullback that holds the broken level."],
  ["Double Level", "Continuation", "Secondary Setup", "Two tests of the same level in trend direction. Enter on confirmation of the second test."],
  ["Liquidity Grab", "False Move & Entry", "Advanced Setup", "Price sweeps a visible high or low, traps breakout traders, then reverses back inside the range."],
  ["News Reaction", "High Impact", "Situational", "Trade only the confirmed direction after the first 15 minutes of a high-impact release."],
  ["Range Trading", "Sideways Market", "Situational", "Fade the edges of a well-defined range while the higher timeframe is neutral."],
  ["Reversal Setup", "Counter Trend (Rare)", "Rare Setup", "Counter-trend entries only after clear exhaustion and a confirmed structure shift on M15."],
];

const CHECK_T = ["Higher timeframe trend confirmed", "Valid level identified", "Price shows pullback to level", "MACD confirmation (hidden divergence)", "No major news", "Risk/Reward ≥ 1:5", "SL below/above last swing", "Clear entry confirmation on M5/M1"];
const CONDITIONS: [string, string][] = [["schedule", "London or New York Session"], ["calendar_month", "No major news (±15 min)"], ["bar_chart", "Clear higher timeframe context"], ["tune", "Spread acceptable"], ["wifi", "Stable connection"]];
const KEY_POINTS = ["Established trend (HH/HL or LL/LH)", "Valid level from previous structure", "Pullback to level", "Entry with confirmation", "Targets: 1R, 1.5R, 2R"];
const TF_USAGE: [string, string][] = [["H4 / H1", "Trend & context"], ["M15", "Structure & level"], ["M5", "Setup confirmation"], ["M1", "Entry (optional)"]];
const MISTAKES = ["Entering before confirmation", "Wrong level (no clear structure)", "Trading against higher timeframe trend", "Ignoring news", "Moving SL after entry", "Closing too early"];
const VIOLATIONS: [string, number, string][] = [["Wrong Entry", 5, "#e05a55"], ["No News Check", 3, "#e05a55"], ["Against Trend", 2, "#e2c089"], ["Poor R:R", 2, "#3ccfb2"]];
const EXAMPLES = [
  { label: "Valid Example", color: "#3ccfb2", icon: "check", caption: "Clean level continuation with MACD hidden divergence." },
  { label: "Valid Example", color: "#3ccfb2", icon: "check", caption: "Pullback to level, strong continuation." },
  { label: "Invalid Example", color: "#e0463f", icon: "close", caption: "No clear structure, choppy market." },
];

const CARD: React.CSSProperties = { borderRadius: 10, border: "1px solid var(--e-line)", background: "var(--e-panel)" };
const TEAL = "var(--e-up-2)";
const RED = "var(--e-down-3)";

const tick = (on: boolean) => ({ bg: on ? "#3ccfb2" : "transparent", bd: on ? "#3ccfb2" : "#56625f", op: on ? 1 : 0 });

function Tabs({ list, cur, onPick, style }: { list: string[]; cur: string; onPick: (l: string) => void; style: React.CSSProperties }) {
  return (
    <>
      {list.map((l) => {
        const on = l === cur;
        return (
          <div key={l} onClick={() => onPick(l)} style={{
            ...style, cursor: "pointer",
            background: on ? "linear-gradient(180deg,#2a2618,#1c1b13)" : "var(--e-panel-2)",
            color: on ? "var(--e-ivory)" : "var(--e-text)",
            border: `1px solid ${on ? "rgba(233,215,176,.6)" : "var(--e-line)"}`,
          }}>{l}</div>
        );
      })}
    </>
  );
}

function Picker({ label, value, width }: { label: string; value: string; width: number }) {
  return (
    <div style={{ width, height: 50, boxSizing: "border-box", borderRadius: 8, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "flex", alignItems: "center", padding: "0 12px", gap: 8, cursor: "pointer" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 11, color: "var(--e-text-2)" }}>{label}</span>
        <span style={{ fontSize: 15 }}>{value}</span>
      </div>
      <span className="e-icon" style={{ fontSize: 18, color: "var(--e-text-2)" }}>expand_more</span>
    </div>
  );
}

export default function ElionRulesPage() {
  const [top, setTop] = useState("Playbook");
  const [sub, setSub] = useState("Overview");
  const [sel, setSel] = useState(0);
  const [fav, setFav] = useState(false);
  const [checks, setChecks] = useState<boolean[]>(() => CHECK_T.map(() => true));
  const [conds, setConds] = useState<boolean[]>(() => CONDITIONS.map(() => true));

  const cv = useRef<Record<string, HTMLCanvasElement | null>>({});
  const set = (k: string) => (el: HTMLCanvasElement | null) => { cv.current[k] = el; };
  const cache = useRef<{ main?: Bar[]; ex: Record<number, Bar[]> }>({ ex: {} });

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
    const candles = (ctx: CanvasRenderingContext2D, cs: Bar[], x0: number, w: number, Y: (v: number) => number, volTop: number, volH: number) => {
      const cw = w / cs.length;
      cs.forEach((c, i) => {
        const x = x0 + (i + 0.5) * cw, col = c.c >= c.o ? "#2fbf94" : "#e0463f";
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
        const y1 = Y(Math.max(c.o, c.c));
        ctx.fillStyle = col; ctx.fillRect(x - cw * 0.32, y1, cw * 0.64, Math.max(1, Y(Math.min(c.o, c.c)) - y1));
        if (volH) {
          ctx.fillStyle = "rgba(120,150,200,.35)";
          const vh = c.v * volH;
          ctx.fillRect(x - cw * 0.35, volTop + volH - vh, cw * 0.7, vh);
        }
      });
    };

    const draw = (k: string) => {
      try {
        const s = prep(cv.current[k]);
        if (!s) return;
        const { ctx, w, h } = s;
        if (k === "main") {
          cache.current.main = cache.current.main || series(MAIN_K, 118, 5, 5);
          const top0 = 20, ph = h - 70, pw = w * 0.87;
          const Y = (v: number) => top0 + ((100 - v) / 100) * ph;
          candles(ctx, cache.current.main, 6, pw, Y, h - 32, 20);
          const X = (t: number) => 6 + t * pw;
          ctx.strokeStyle = "rgba(240,240,235,.9)"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(X(0.34), Y(55)); ctx.lineTo(X(0.96), Y(55)); ctx.stroke();
          ctx.font = "12px Manrope, sans-serif"; ctx.fillStyle = "#eef1f0"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          const lbl = (t: number, v: number, s2: string) => ctx.fillText(s2, X(t), Y(v));
          lbl(0.1, 12, "1. Trend"); lbl(0.44, 60, "2. Level"); lbl(0.66, 76, "3. Pullback");
          lbl(0.64, 4, "3. Pullback"); lbl(0.84, 46, "4. Entry"); lbl(0.99, 92, "5. Target");
          ctx.fillStyle = "#eef1f0"; ctx.fillText("+", X(0.85), Y(51.5));
          ctx.strokeStyle = "#2fe0b0"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(X(0.9), Y(62)); ctx.quadraticCurveTo(X(0.95), Y(66), X(0.98), Y(84)); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X(0.98) - 5, Y(84) + 6); ctx.lineTo(X(0.98), Y(84)); ctx.lineTo(X(0.98) + 5, Y(84) + 7); ctx.stroke();
          ctx.setLineDash([2, 3]); ctx.strokeStyle = "rgba(240,240,235,.6)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(X(0.76), Y(70)); ctx.lineTo(X(0.8), Y(56)); ctx.stroke(); ctx.setLineDash([]);
        } else {
          const i = +k[1];
          cache.current.ex[i] = cache.current.ex[i] || series(EX_K[i], 64, 20 + i * 7, i === 2 ? 7 : 5);
          const top0 = 30, ph = h - 70;
          const Y = (v: number) => top0 + ((100 - v) / 100) * ph;
          candles(ctx, cache.current.ex[i], 2, w - 4, Y, h - 32, 18);
          ctx.font = "12px Manrope, sans-serif"; ctx.fillStyle = "#eef1f0"; ctx.textAlign = "center";
          const circ = (t: number, v: number) => {
            ctx.strokeStyle = "rgba(240,240,235,.85)"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(2 + t * (w - 4), Y(v), 16, 0, 7); ctx.stroke();
          };
          if (i === 0) { circ(0.34, 22); circ(0.5, 30); ctx.fillText("2. Level", w * 0.46, h - 36); }
          if (i === 1) { circ(0.53, 34); ctx.fillText("3. Pullback", w * 0.53, h - 36); }
          if (i === 2) { ctx.strokeStyle = "rgba(224,70,63,.7)"; ctx.beginPath(); ctx.moveTo(w * 0.6, Y(76)); ctx.lineTo(w * 0.82, Y(76)); ctx.stroke(); }
        }
      } catch (err) {
        console.warn("draw", k, err instanceof Error ? err.message : err);
      }
    };

    const keys = ["main", "e0", "e1", "e2"];
    const ros = keys.map((k) => {
      const el = cv.current[k];
      if (!el) return null;
      const ro = new ResizeObserver(() => draw(k));
      ro.observe(el);
      return ro;
    });
    const timers = [0, 60, 300].map((t) => window.setTimeout(() => keys.forEach(draw), t));
    return () => { timers.forEach(window.clearTimeout); ros.forEach((r) => r?.disconnect()); };
  }, []);

  const cs = SETUPS[sel];
  const done = checks.filter(Boolean).length;

  return (
    <div className="elion-scope e-root e-inner" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, var(--e-bg-2) 0%, var(--e-bg) 70%)", display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", fontFamily: "Manrope, sans-serif", color: "var(--e-text)", fontSize: 13 }}>
      <ElionSidebar active="Rules" />

      <main style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 30, height: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
            <div style={{ fontSize: 9, letterSpacing: ".5em", color: "var(--e-gold)" }}>TRADING</div>
          </div>
          <div style={{ fontSize: 14, letterSpacing: ".04em", color: "var(--e-text-3)" }}>DISCIPLINE BUILDS FREEDOM.</div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "min(100%,450px)", height: 40, borderRadius: 9, border: "1px solid var(--e-border)", background: "var(--e-field)", display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 14px", color: "var(--e-text-2)" }}>
              <span className="e-icon" style={{ fontSize: 20 }}>search</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>Search rules, setups, or ask ELION...</span>
              <span style={{ fontSize: 10, border: "1px solid var(--e-border-2)", borderRadius: 5, padding: "2px 6px" }}>Ctrl  K</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--e-up)", boxShadow: "0 0 6px var(--e-up)" }} />Live Account
            </div>
            <div style={{ color: "var(--e-text-2)" }}>MT5  |  ICMarkets</div>
          </div>
          <div style={{ position: "relative", color: "var(--e-text)" }}>
            <span className="e-icon" style={{ fontSize: 26 }}>notifications</span>
            <span style={{ position: "absolute", top: -4, right: -4, minWidth: 14, height: 14, borderRadius: 7, background: RED, color: "#fff", fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center" }}>3</span>
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, paddingLeft: 6 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 36, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>RULES</div>
            <div style={{ fontSize: 13, letterSpacing: ".22em", color: "var(--e-text-3)" }}>A CLEAR SYSTEM. A HIGHER PROBABILITY YOU.</div>
          </div>
          <Picker label="System Version" value="v1.2" width={156} />
          <div style={{ width: 170, height: 50, boxSizing: "border-box", borderRadius: 8, border: "1px solid var(--e-border)", background: "var(--e-panel-2)", display: "flex", alignItems: "center", padding: "0 14px", gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--e-up)", marginTop: 12 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: "var(--e-text-2)" }}>Active Rules</span>
              <span style={{ fontSize: 15 }}>{conds.filter(Boolean).length + 7} / 12</span>
            </div>
          </div>
          <div className="e-ghost" style={{ height: 44, padding: "0 30px", borderRadius: 6, border: "1px solid var(--e-gold)", display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--e-ivory)", cursor: "pointer", margin: "0 8px" }}>
            <span className="e-icon" style={{ fontSize: 18 }}>edit</span>Edit Rules
          </div>
          <div style={{ width: 50, height: 44, borderRadius: 6, border: "1px solid var(--e-border)", display: "grid", placeItems: "center", cursor: "pointer" }}>
            <span className="e-icon" style={{ fontSize: 22 }}>more_horiz</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <Tabs list={["Playbook", "Setup Rules", "Entry Rules", "Risk & Management", "Exit Rules", "Filters", "Examples", "Rule Builder"]} cur={top} onPick={setTop}
            style={{ height: 38, padding: "0 18px", borderRadius: 5, display: "grid", placeItems: "center", fontSize: 13, whiteSpace: "nowrap" }} />
        </div>

        <div className="e-fill" style={{ display: "grid", gridTemplateColumns: "256px minmax(0,1fr) 376px", gap: 14 }}>
          {/* ---- left column ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ ...CARD, padding: "14px 8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 6px 8px" }}>
                <div style={{ fontSize: 17, fontWeight: 500 }}>Setup Library</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {["view_agenda", "list"].map((ic) => (
                    <span key={ic} className="e-icon" style={{ width: 22, height: 24, borderRadius: 4, border: "1px solid var(--e-border)", display: "grid", placeItems: "center", fontSize: 14 }}>{ic}</span>
                  ))}
                </div>
              </div>
              {SETUPS.map(([name, subtitle], i) => {
                const a = i === sel;
                return (
                  <div key={name} className="e-row" onClick={() => setSel(i)} style={{
                    height: 52, borderRadius: 6, display: "flex", alignItems: "center", gap: 16, padding: "0 10px", cursor: "pointer",
                    border: `1px solid ${a ? "rgba(233,215,176,.6)" : "transparent"}`,
                    background: a ? "linear-gradient(90deg,#26241a,#15191a)" : "transparent",
                    borderBottomColor: a ? "rgba(233,215,176,.6)" : "var(--e-line-3)",
                  }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#1b2a2e", display: "grid", placeItems: "center", fontSize: 16, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>{name}</div>
                      <div style={{ fontSize: 11.5, color: a ? "var(--e-gold)" : "var(--e-text-2)", marginTop: 3 }}>{subtitle}</div>
                    </div>
                    <span className="e-icon" style={{ fontSize: 20, opacity: a ? 1 : 0 }}>arrow_forward</span>
                  </div>
                );
              })}
            </div>
            <div style={{ ...CARD, flex: 1, padding: "14px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Trading Conditions</div>
              {CONDITIONS.map(([icon, label], i) => {
                const t = tick(conds[i]);
                return (
                  <div key={label} onClick={() => setConds((s) => s.map((v, k) => (k === i ? !v : v)))} style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, cursor: "pointer", minHeight: 36 }}>
                    <span className="e-icon" style={{ fontSize: 20, width: 20 }}>{icon}</span>
                    <span style={{ flex: 1, fontSize: 12.5 }}>{label}</span>
                    <span style={{ width: 18, height: 18, borderRadius: 3, boxSizing: "border-box", border: `1.5px solid ${t.bd}`, background: t.bg, display: "grid", placeItems: "center" }}>
                      <span className="e-icon" style={{ fontSize: 15, color: "#081013", opacity: t.op }}>check</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- centre column ---- */}
          <div style={{ borderRadius: 10, border: "1px solid #243236", background: "var(--e-panel)", padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 25, fontWeight: 500 }}>{cs[0]}</div>
              <span style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid rgba(233,215,176,.5)", background: "#1f1d14", color: "var(--e-gold)", fontSize: 12 }}>{cs[2]}</span>
              <div style={{ flex: 1 }} />
              <div onClick={() => setFav((f) => !f)} style={{ whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 5, border: "1px solid var(--e-border-2)", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <span className={`e-icon${fav ? " fill" : ""}`} style={{ fontSize: 18, color: "var(--e-gold)" }}>star</span>{fav ? "Favorited" : "Mark as Favorite"}
              </div>
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--e-text)", maxWidth: 640, textWrap: "pretty" }}>{cs[3]}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Tabs list={["Overview", "Conditions", "Step by Step", "MACD Logic", "Checklist", "Examples"]} cur={sub} onPick={setSub}
                style={{ height: 32, padding: "0 12px", borderRadius: 5, display: "grid", placeItems: "center", fontSize: 12.5, whiteSpace: "nowrap" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 250px", gap: 12, height: 326 }}>
              <div style={{ position: "relative", borderRadius: 6, border: "1px solid var(--e-line)", background: "#0a1417", overflow: "hidden" }}>
                <canvas ref={set("main")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
                <div style={{ borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel-2)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Key Points</div>
                  {KEY_POINTS.map((t, i) => (
                    <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, whiteSpace: "nowrap" }}>
                      <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#2a2a1f", color: "var(--e-gold)", display: "grid", placeItems: "center", fontSize: 10.5, flexShrink: 0 }}>{i + 1}</span>{t}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, borderRadius: 6, border: "1px solid var(--e-line)", background: "var(--e-panel-2)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Timeframe Usage</div>
                  {TF_USAGE.map(([tfl, use]) => (
                    <div key={tfl} style={{ flex: 1, display: "grid", gridTemplateColumns: "70px 1fr", alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "#8fc4e0" }}>{tfl}</span><span>{use}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
              {EXAMPLES.map((e, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                  <div style={{ height: 174, borderRadius: 5, border: "1px solid #243236", background: "#0a1417", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 8, top: 8, zIndex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: e.color }}>
                      <span className="e-icon" style={{ width: 14, height: 14, borderRadius: 3, background: e.color, display: "grid", placeItems: "center", color: "#081013", fontSize: 13 }}>{e.icon}</span>{e.label}
                    </div>
                    <canvas ref={set(`e${i}`)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--e-text)" }}>{e.caption}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- right column ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>Rule Checklist ({cs[0]})</div>
                <div style={{ fontSize: 15 }}>{done} / 8</div>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "#1b2a2e", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(done / 8) * 100}%`, borderRadius: 3, background: TEAL, transition: "width .3s" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {CHECK_T.map((t, i) => {
                  const k = tick(checks[i]);
                  return (
                    <div key={t} onClick={() => setChecks((s) => s.map((v, x) => (x === i ? !v : v)))} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, cursor: "pointer" }}>
                      <span style={{ width: 18, height: 18, borderRadius: 3, boxSizing: "border-box", border: `1.5px solid ${k.bd}`, background: k.bg, display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <span className="e-icon" style={{ fontSize: 15, color: "#081013", opacity: k.op }}>check</span>
                      </span>{i + 1}. {t}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 500 }}>
                  <span className="e-icon" style={{ fontSize: 18, color: RED }}>cancel_presentation</span>Common Mistakes
                </div>
                <div style={{ height: 30, padding: "0 12px", borderRadius: 5, border: "1px solid var(--e-border-2)", display: "grid", placeItems: "center", fontSize: 12.5, cursor: "pointer" }}>View All</div>
              </div>
              {MISTAKES.map((m) => (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 13, paddingLeft: 4 }}>
                  <span className="e-icon" style={{ width: 16, height: 16, borderRadius: "50%", background: "#4a1c1a", border: `1px solid ${RED}`, display: "grid", placeItems: "center", color: "#f08a82", fontSize: 12 }}>close</span>{m}
                </div>
              ))}
            </div>

            <div style={{ ...CARD, flex: 1, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 500 }}>Rule Violations (Last 100 Trades)</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 30, paddingLeft: 4 }}>
                <div style={{ width: 124, height: 124, flexShrink: 0, borderRadius: "50%", background: "conic-gradient(#e05a55 0 41.6%, #1b2a2e 41.6% 42.4%, #3ccfb2 42.4% 66%, #1b2a2e 66% 66.8%, #e2c089 66.8% 99.2%, #1b2a2e 99.2%)", display: "grid", placeItems: "center" }}>
                  <div style={{ width: 98, height: 98, borderRadius: "50%", background: "var(--e-panel-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    <div style={{ fontSize: 21 }}>12%</div>
                    <div style={{ fontSize: 12, color: "var(--e-text-3)" }}>Violations</div>
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  {VIOLATIONS.map(([n, v, c]) => (
                    <div key={n} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />
                      <span style={{ flex: 1 }}>{n}</span><span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <a href="#/journal" style={{ height: 32, borderRadius: 5, border: `1px solid ${TEAL}`, background: "#0f2a26", color: "var(--e-text)", display: "grid", placeItems: "center", fontSize: 13 }}>View Related Trades</a>
            </div>
          </div>
        </div>

        <div className="e-fullw" style={{ width: "calc(100% - 390px)", boxSizing: "border-box", height: 50, borderRadius: 8, border: "1px solid var(--e-line)", background: "var(--e-panel-4)", display: "flex", alignItems: "center", gap: 18, padding: "0 18px" }}>
          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 44, lineHeight: 1, color: "var(--e-gold)", height: 26 }}>&ldquo;</span>
          <span style={{ flex: 1, fontSize: 14 }}>A rule is not a limitation. It is a filter for a better you.</span>
          <span style={{ fontSize: 13, color: "var(--e-text-3)", letterSpacing: ".06em" }}>— ELION</span>
        </div>
      </main>
    </div>
  );
}
