import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

/**
 * Ported from design/elion/ElionAICard.dc.html (reference design, not final code).
 * Animated "ELION AI" card: particle/network canvas over a parallaxed portrait, plus a
 * small idle waveform canvas in the status pill.
 */

interface ElionAICardProps {
  intensity?: number;
  stepSeconds?: number;
  parallax?: boolean;
}

const STEPS: [string, string][] = [
  ["SCANNING", "MARKETS"],
  ["ANALYZING", "PATTERNS"],
  ["DETECTING", "OPPORTUNITIES"],
  ["VALIDATING", "SETUPS"],
];
const STATUSES = ["Scanning XAUUSD, M5…", "Analyzing market structure…", "Detecting liquidity zones…", "Validating setup…"];

export default function ElionAICard({ intensity = 1, stepSeconds = 2.4, parallax = true }: ElionAICardProps) {
  const rootRef = useRef<HTMLElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [step, setStep] = useState(0);
  const [si, setSi] = useState(0);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setStep((s) => (s + 1) % 4);
      setSi((s) => (s + 1) % 4);
    }, stepSeconds * 1000);
    return () => window.clearInterval(iv);
  }, [stepSeconds]);

  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const IW = 1536, IH = 1024;
    let W = 0, H = 0;
    let map = { s: 1, ox: 0, oy: 0 };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = c.clientWidth; H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = Math.max(W / IW, H / IH) * 1.08;
      map = { s, ox: W * 0.52 - IW * s * 0.52, oy: H * 0.4 - IH * s * 0.4 };
    };
    const P = (x: number, y: number): [number, number] => [map.ox + x * map.s, map.oy + y * map.s];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const nodes = Array.from({ length: 34 }, () => ({ x: rnd(450, 1150), y: rnd(0, IH), vx: rnd(-0.12, 0.12), vy: rnd(-0.12, 0.12), p: rnd(0, 6.28) }));
    const stars = ([[830, 238, 1], [558, 478, 0.6], [1068, 145, 0.7], [715, 350, 0.4]] as [number, number, number][]).map(([x, y, r]) => ({ x, y, r, p: rnd(0, 6.28) }));
    const glyphs = "01ABCDEF{}[]<>#$%&*+=/|";
    const cols = Array.from({ length: 24 }, (_, i) => ({ x: 800 + i * 14, y: rnd(-IH, IH), v: rnd(35, 95), len: Math.floor(rnd(6, 16)), gold: Math.random() < 0.7 }));
    const t0 = performance.now();
    let last = t0;
    let raf = 0;
    let cancelled = false;
    const next = (f: (n: number) => void) => (document.hidden ? window.setTimeout(() => f(performance.now()), 50) : requestAnimationFrame(f));
    const frame = (now: number) => {
      if (cancelled) return;
      if (c.clientWidth && (c.clientWidth !== W || c.clientHeight !== H)) resize();
      const t = (now - t0) / 1000;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const k = intensity;
      const m = mouse.current;
      m.x += (m.tx - m.x) * 0.05;
      m.y += (m.ty - m.y) * 0.05;
      img.style.transform = `translate(${m.x * -10}px,${m.y * -7}px) scale(${1 + 0.03 * Math.sin(t * 0.2)})`;
      if (W) {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(m.x * -18, m.y * -12);
        ctx.lineWidth = 0.5;
        for (const n of nodes) {
          n.x += n.vx; n.y += n.vy;
          if (n.x < 450 || n.x > 1150) n.vx *= -1;
          if (n.y < 0 || n.y > IH) n.vy *= -1;
        }
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 170) {
              const [x1, y1] = P(a.x, a.y), [x2, y2] = P(b.x, b.y);
              ctx.strokeStyle = `rgba(233,215,176,${(1 - d / 170) * 0.18 * k})`;
              ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            }
          }
        }
        for (const n of nodes) {
          const [x, y] = P(n.x, n.y);
          ctx.fillStyle = `rgba(240,225,190,${(0.4 + 0.4 * Math.sin(t * 2 + n.p)) * k})`;
          ctx.beginPath(); ctx.arc(x, y, 1.1, 0, 7); ctx.fill();
        }
        const fs = Math.max(8, 11 * map.s);
        ctx.font = `${fs}px ui-monospace,monospace`;
        ctx.textAlign = "center";
        for (const col of cols) {
          col.y += col.v * dt;
          if (col.y - col.len * 14 > IH) { col.y = rnd(-200, 0); col.gold = Math.random() < 0.7; }
          for (let q = 0; q < col.len; q++) {
            const gy = col.y - q * 14;
            if (gy < 0 || gy > IH) continue;
            const [x, y] = P(col.x, gy);
            const a = (1 - q / col.len) * 0.7 * k;
            ctx.fillStyle = q === 0 ? `rgba(255,245,225,${a})` : col.gold ? `rgba(225,195,140,${a})` : `rgba(110,190,180,${a})`;
            ctx.fillText(glyphs[Math.floor(t * 8 + q * 7 + col.x) % glyphs.length], x, y);
          }
        }
        for (const s of stars) {
          const [x, y] = P(s.x, s.y);
          const f = (0.5 + 0.5 * Math.sin(t * 1.5 + s.p)) * k;
          const r = 34 * s.r * map.s;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(255,215,150,${f * 0.9})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        }
        const sy = (((t * 0.1) % 1.3) - 0.15) * H;
        const g = ctx.createLinearGradient(0, sy - 50, 0, sy + 50);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.5, `rgba(233,215,176,${0.08 * k})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(W * 0.3, sy - 50, W * 0.5, 100);
        ctx.restore();
      }
      const w = waveRef.current;
      if (w && w.clientWidth) {
        const ww = w.clientWidth, wh = w.clientHeight;
        if (w.width !== ww * 2) { w.width = ww * 2; w.height = wh * 2; }
        const x2 = w.getContext("2d");
        if (x2) {
          x2.setTransform(2, 0, 0, 2, 0, 0);
          x2.clearRect(0, 0, ww, wh);
          x2.strokeStyle = "#e9d7b0"; x2.lineWidth = 1; x2.beginPath();
          for (let i = 0; i <= ww; i++) {
            const u = i / ww, env = Math.sin(u * Math.PI) ** 2;
            const y = wh / 2 + env * wh * 0.42 * Math.sin(u * 22 + t * 7) * (0.6 + 0.4 * Math.sin(u * 5 - t * 3));
            if (i) x2.lineTo(i, y); else x2.moveTo(i, y);
          }
          x2.stroke();
        }
      }
      raf = next(frame);
    };
    raf = next(frame);
    return () => { cancelled = true; cancelAnimationFrame(raf); window.clearTimeout(raf); };
  }, [intensity]);

  const onMove = (e: MouseEvent<HTMLElement>) => {
    if (!parallax) return;
    const r = (rootRef.current ?? e.currentTarget).getBoundingClientRect();
    mouse.current.tx = (e.clientX - r.left) / r.width - 0.5;
    mouse.current.ty = (e.clientY - r.top) / r.height - 0.5;
  };
  const onLeave = () => { mouse.current.tx = 0; mouse.current.ty = 0; };

  const lineH = `${step * 8.4}cqw`;

  return (
    <section
      ref={rootRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        position: "relative", width: "100%", height: "100%", boxSizing: "border-box",
        containerType: "inline-size" as CSSProperties["containerType"], overflow: "hidden", borderRadius: 16,
        background: "#070d10", border: "1px solid rgba(233,215,176,.16)",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.4), 0 20px 60px -20px rgba(0,0,0,.8)",
        fontFamily: "Manrope, sans-serif", color: "#cfd6d4",
      }}
    >
      <img
        ref={imgRef}
        src="/elion/face.png"
        alt=""
        style={{
          position: "absolute", inset: "-4%", width: "108%", height: "108%", objectFit: "cover",
          objectPosition: "52% 40%", willChange: "transform", transformOrigin: "52% 45%",
          filter: "saturate(.55) sepia(.25) brightness(.9) contrast(1.05)",
        }}
      />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "screen" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(90deg,rgba(7,13,16,.92) 0%,rgba(7,13,16,.55) 26%,transparent 44%,transparent 72%,rgba(7,13,16,.6) 100%)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 52% 45%,transparent 50%,rgba(4,8,10,.75) 100%)" }} />

      <div style={{ position: "absolute", left: "4.5cqw", top: "13.5cqw", display: "flex", flexDirection: "column", gap: "1.6cqw" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 500, fontSize: "4.4cqw", letterSpacing: ".14em", color: "#e9d7b0" }}>ELION AI</div>
        <div style={{ fontSize: "2.05cqw", lineHeight: 1.45, letterSpacing: ".06em", color: "#c8cfcd" }}>MARKET INTELLIGENCE<br />REAL PERSPECTIVE<br />DISCIPLINED EXECUTION</div>
      </div>

      <div style={{ position: "absolute", left: "4.2cqw", top: "32cqw", display: "flex", flexDirection: "column", gap: "3cqw" }}>
        <div style={{ position: "absolute", left: "1cqw", top: "1.5cqw", bottom: "6.5cqw", width: 1, background: "rgba(233,215,176,.25)" }} />
        <div style={{ position: "absolute", left: "1cqw", top: "1.5cqw", width: 1, height: lineH, background: "#e9d7b0", transition: "height .6s ease" }} />
        {STEPS.map(([a, b], i) => {
          const dot = i === step ? "#e9d7b0" : i < step ? "rgba(233,215,176,.45)" : "#0b1417";
          const glow = i === step ? "0 0 1.6cqw rgba(233,215,176,.7)" : "none";
          const color = i === step ? "#f3e6c8" : i < step ? "#c8cfcd" : "#8e9896";
          return (
            <div key={a} style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: "3.2cqw" }}>
              <div style={{ width: "2.1cqw", height: "2.1cqw", borderRadius: "50%", boxSizing: "border-box", marginTop: ".2cqw", border: "1px solid rgba(233,215,176,.6)", background: dot, boxShadow: glow, transition: "all .4s" }} />
              <div style={{ fontSize: "2.05cqw", lineHeight: 1.35, letterSpacing: ".06em", color, transition: "color .4s" }}>{a}<br />{b}</div>
            </div>
          );
        })}
      </div>

      <div style={{ position: "absolute", left: "4.5cqw", bottom: "4.5cqw", fontSize: "2.05cqw", lineHeight: 1.45, letterSpacing: ".06em", color: "#aeb7b5" }}>
        HUMAN DISCIPLINE<br />ARTIFICIAL INTELLIGENCE<br />A SHARPER TOMORROW
      </div>

      <div style={{ position: "absolute", right: "5cqw", top: "36cqw", display: "flex", flexDirection: "column", gap: "3cqw" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", fontSize: "3.3cqw", lineHeight: 1.3, color: "#e9d7b0" }}>&ldquo;Same<br />Charts.<br />A Smarter<br />You.&rdquo;</div>
        <div style={{ width: "5.5cqw", height: 1, background: "rgba(233,215,176,.5)" }} />
      </div>

      <div style={{ position: "absolute", right: "1.6cqw", bottom: "2.4cqw", display: "flex", alignItems: "center", gap: "2cqw", padding: "1.4cqw 2.4cqw 1.4cqw 1.4cqw", borderRadius: "3cqw", background: "rgba(8,16,19,.78)", border: "1px solid rgba(233,215,176,.35)", backdropFilter: "blur(6px)" }}>
        <div style={{ width: "7cqw", height: "7cqw", borderRadius: "50%", border: "1px solid rgba(233,215,176,.25)", display: "grid", placeItems: "center", background: "rgba(20,32,36,.8)" }}>
          <canvas ref={waveRef} style={{ width: "5cqw", height: "3cqw" }} />
        </div>
        <div style={{ fontSize: "1.75cqw", color: "#dfe4e2", minWidth: "24cqw" }}>{STATUSES[si]}</div>
        <div style={{ fontSize: "2.8cqw", color: "#e9d7b0", lineHeight: 1 }}>&rarr;</div>
      </div>
    </section>
  );
}
