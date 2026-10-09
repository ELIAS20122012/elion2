import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LANDING_ROUTES, useSettings } from "../lib/elionSettings";
import { login as signIn } from "../lib/session"; // `login` here is the state flag for the open panel

/**
 * The front door (design/elion/"Elion Welcome v3.dc.html").
 *
 * A field of 2,400 particles settles from a scatter into a sphere, then a diamond, while the name
 * fades in letter by letter. Clicking anywhere opens the sign-in card and the diamond unwinds into
 * a ring behind it. Signing in plays the field outward and hands over to the dashboard.
 *
 * The sign-in is checked by the journal server, which hands back an httpOnly cookie; this page
 * never decides who gets in.
 */

type ShapeName = "scatter" | "sphere" | "diamond" | "ring" | "out";
type Morph = (name: ShapeName, burst?: number, duration?: number) => void;

const COUNT = 2400;
const GOLD = "#e9d7b0";
const LINE = "#1f3035";
const BAD = "rgba(224,130,111,.6)";

/** When the opening finishes calibrating and the name appears, in seconds from the first frame. */
const INTRO_END = 4.3;

export default function ElionWelcomePage() {
  const [settings] = useSettings();
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pctRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const statRef = useRef<HTMLSpanElement | null>(null);
  const morphRef = useRef<Morph | null>(null);
  const leaveRef = useRef<(() => void) | null>(null);
  const mouse = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const [stage, setStage] = useState(0);
  const [login, setLogin] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const remember = false; // the session ends with the browser (see /auth/login)
  const [error, setError] = useState("");
  const [auth, setAuth] = useState(false);
  const [clock, setClock] = useState("");

  /** Someone who turned animations off, or asked the OS for less motion, gets the door already open. */
  const skipIntro =
    settings.anim === false ||
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const skipRef = useRef(skipIntro);
  skipRef.current = skipIntro;

  /**
   * The opening beats run on wall-clock timers, not on animation frames. requestAnimationFrame is
   * throttled to a crawl in a background tab, and when the beats rode on it the screen could sit
   * there forever without ever reaching "CLICK TO ENTER" - locked out of its own front door.
   */
  useEffect(() => {
    if (skipIntro) {
      setStage(2);
      return;
    }
    const a = window.setTimeout(() => setStage((v) => Math.max(v, 1)), INTRO_END * 1000);
    const b = window.setTimeout(() => setStage((v) => Math.max(v, 2)), 5300);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [skipIntro]);

  // full-bleed page: no scrollbar behind the canvas while it is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toUTCString().slice(17, 25) + " UTC");
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, []);

  const enter = useCallback(() => {
    setLogin((open) => {
      if (open) return open;
      setStage(3);
      morphRef.current?.("ring", 1.4);
      return true;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !login && stage >= 1) enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter, login, stage]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const R = Math.random;
    const mk = () => new Float32Array(COUNT * 3);
    const shapes: Record<ShapeName, Float32Array> = {
      scatter: mk(),
      sphere: mk(),
      diamond: mk(),
      ring: mk(),
      out: mk(),
    };
    const col = new Uint8Array(COUNT); // 0 gold, 1 teal, 2 white spark
    const delay = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);

    // the six octahedron vertices, and the edges between every non-opposite pair
    const V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const E: number[][][] = [];
    for (let a = 0; a < 6; a++)
      for (let b = a + 1; b < 6; b++)
        if (V[a][0] * V[b][0] + V[a][1] * V[b][1] + V[a][2] * V[b][2] === 0) E.push([V[a], V[b]]);

    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      col[i] = R() < 0.12 ? 1 : R() < 0.03 ? 2 : 0;
      delay[i] = R() * 0.55;
      size[i] = 0.6 + R() * 1.1;

      const u = R() * 6.283;
      const w = Math.acos(2 * R() - 1);
      let rr = 3 + R() * 3;
      shapes.scatter.set([Math.sin(w) * Math.cos(u) * rr, Math.cos(w) * rr, Math.sin(w) * Math.sin(u) * rr], j);
      rr = 5 + R() * 4;
      shapes.out.set([Math.sin(w) * Math.cos(u) * rr, Math.cos(w) * rr, Math.sin(w) * Math.sin(u) * rr], j);

      // Fibonacci sphere: an even spread rather than a clumpy random one
      const y = 1 - (2 * (i + 0.5)) / COUNT;
      const r = Math.sqrt(1 - y * y);
      const ph = i * 2.39996;
      shapes.sphere.set([Math.cos(ph) * r, y, Math.sin(ph) * r], j);

      const q = R();
      let p: number[];
      if (q < 0.4) {
        const [A, B] = E[i % E.length];
        const s = R();
        p = [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s];
      } else if (q < 0.9) {
        let a = R();
        let b = R();
        if (a + b > 1) {
          a = 1 - a;
          b = 1 - b;
        }
        const cc = 1 - a - b;
        p = [a * (R() < 0.5 ? -1 : 1), b * (R() < 0.5 ? -1 : 1), cc * (R() < 0.5 ? -1 : 1)];
      } else {
        const [A, B] = E[i % E.length];
        const s = R();
        p = [(A[0] + (B[0] - A[0]) * s) * 0.3, (A[1] + (B[1] - A[1]) * s) * 0.3, (A[2] + (B[2] - A[2]) * s) * 0.3];
      }
      shapes.diamond.set([p[0] * 1.05, p[1] * 1.4, p[2] * 1.05], j);

      const an = R() * 6.283;
      const band = R() < 0.8 ? 2.25 : 2.7;
      const rad = band + (R() + R() + R() - 1.5) * 0.07;
      shapes.ring.set([Math.cos(an) * rad, (R() - 0.5) * 0.05, Math.sin(an) * rad], j);
    }

    const cur = Float32Array.from(shapes.scatter);
    const from = mk();
    let target = shapes.scatter;
    let tm = 0;
    let D = 2;
    let burst = 0;
    let T = 0;
    let shape: ShapeName = "scatter";

    const morph: Morph = (name, b = 0, d = 2.2) => {
      from.set(cur);
      target = shapes[name];
      tm = T;
      D = d;
      burst = b;
      shape = name;
    };
    morphRef.current = morph;
    leaveRef.current = () => morph("out", 0.2, 1.6);

    let W = 0;
    let H = 0;
    let ry = 0;
    let rx = 0.35;
    let cy = 0.4;
    let sc = 1;
    let fadeIn = 0;
    let last = performance.now();
    let raf = 0;
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

    // visuals only; the stages that gate the UI are on timers above
    const seq: Array<[number, () => void]> = skipRef.current
      ? []
      : [
          [0.3, () => morph("sphere", 0.25, 2.6)],
          [3.1, () => morph("diamond", 0.35, 2.2)],
        ];
    if (skipRef.current) morph("diamond", 0, 0.01);

    const frame = (now: number) => {
      if (cv.clientWidth !== W || cv.clientHeight !== H) {
        const d = Math.min(devicePixelRatio || 1, 2);
        W = cv.clientWidth;
        H = cv.clientHeight;
        cv.width = W * d;
        cv.height = H * d;
        ctx.setTransform(d, 0, 0, d, 0, 0);
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      T += dt;
      while (seq.length && T >= seq[0][0]) seq.shift()![1]();

      const m = mouse.current;
      const ringMode = shape === "ring";
      m.x += (m.tx - m.x) * 0.12;
      m.y += (m.ty - m.y) * 0.12;

      const mp = Math.min(1, (T - tm) / D);
      const moving = mp < 1;
      ry += dt * ((ringMode ? 0.12 : 0.32) + (moving ? 0.5 * Math.sin(mp * Math.PI) : 0));
      rx += ((ringMode ? 1.18 : 0.32) + m.y * 1.1 - rx) * 0.1;
      cy += ((ringMode ? 0.5 : 0.4) - cy) * 0.04;
      sc += ((ringMode ? 1.25 : 1) - sc) * 0.04;
      fadeIn = Math.min(1, fadeIn + dt * 0.6);

      const pct = Math.min(100, Math.round((T / INTRO_END) * 100));
      if (pctRef.current)
        pctRef.current.textContent = String(pct).padStart(3, "0") + " · " + (pct < 100 ? "CALIBRATING" : "READY");
      if (statRef.current) statRef.current.textContent = pct < 100 ? "NODE · SYNCING" : "NODE · SECURE";
      if (dropRef.current) dropRef.current.style.top = ((T * 0.7) % 1) * 46 - 12 + "px";

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2 + m.x * -24;
      const cY = H * cy + m.y * -16;
      const S = Math.min(W, H) * 0.205 * sc;
      const cam = 4.2;
      const cr = Math.cos(ry + m.x * 2.4);
      const sr = Math.sin(ry + m.x * 2.4);
      const cX = Math.cos(rx);
      const sX = Math.sin(rx);
      const wave = ((T * 0.45) % 3.2) - 1.6;

      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < COUNT; i++) {
        const j = i * 3;
        const e = ease(
          Math.max(0, Math.min(1, (mp * D - delay[i] * Math.min(1, D)) / Math.max(0.01, D - 0.55 * Math.min(1, D)))),
        );
        let x = from[j] + (target[j] - from[j]) * e;
        let y = from[j + 1] + (target[j + 1] - from[j + 1]) * e;
        let z = from[j + 2] + (target[j + 2] - from[j + 2]) * e;
        if (burst && e > 0 && e < 1) {
          const b = Math.sin(e * Math.PI) * burst;
          const l = Math.hypot(x, y, z) || 1;
          x += (x / l) * b;
          y += (y / l) * b;
          z += (z / l) * b;
        }
        x += 0.012 * Math.sin(T * 1.7 + i * 0.37);
        y += 0.012 * Math.cos(T * 1.3 + i * 0.53);
        cur[j] = x;
        cur[j + 1] = y;
        cur[j + 2] = z;

        const X = x * cr - z * sr;
        const Z1 = x * sr + z * cr;
        const Y = y * cX - Z1 * sX;
        const Z = y * sX + Z1 * cX;
        const f = cam / (cam + Z);
        if (f <= 0) continue;
        const px = cx + X * S * f;
        const py = cY + Y * S * f;
        const depth = Math.max(0, Math.min(1, (1.6 - Z) / 3.2));
        const sh = 1 + 1.4 * Math.exp(-((y - wave) ** 2) * 18) * (ringMode ? 0 : 1);
        const a = (0.12 + 0.55 * depth) * sh * fadeIn * (col[i] === 2 ? 1.6 : 1);
        ctx.fillStyle =
          col[i] === 1 ? `rgba(110,200,188,${a})` : col[i] === 2 ? `rgba(255,248,232,${a})` : `rgba(236,210,160,${a})`;
        const s = size[i] * f * (col[i] === 2 ? 1.8 : 1) * Math.max(0.8, S / 180);
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
      ctx.globalCompositeOperation = "source-over";

      const gr = S * 2.2;
      const g = ctx.createRadialGradient(cx, cY, 0, cx, cY, gr);
      g.addColorStop(0, `rgba(233,205,150,${0.09 * fadeIn})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - gr, cY - gr, gr * 2, gr * 2);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      morphRef.current = null;
      leaveRef.current = null;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (auth) return;
    if (!user.trim() || !pass) {
      setError("Please enter your username and password.");
      return;
    }
    setAuth(true);
    const started = Date.now();
    const result = await signIn(user, pass, remember);
    if (!result.ok) {
      setAuth(false);
      setError(result.error);
      setPass("");
      return;
    }
    // The server said yes. Let the bar finish its sweep before the field breaks apart, however
    // fast the answer came back.
    const wait = Math.max(0, 900 - (Date.now() - started));
    window.setTimeout(() => {
      setLeaving(true);
      leaveRef.current?.();
    }, wait);
    window.setTimeout(() => navigate(LANDING_ROUTES[settings.landing] ?? "/elion", { replace: true }), wait + 1300);
  };

  const back = () => {
    setLogin(false);
    setLeaving(false);
    setAuth(false);
    setError("");
    morphRef.current?.("diamond", 0.6, 1.8);
  };

  const open = login && !leaving;
  const mono = "'JetBrains Mono',ui-monospace,monospace";
  const icon: React.CSSProperties = { fontFamily: "'Material Symbols Outlined'", fontSize: 20, color: "#7f8b89" };
  const field = (bad: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 48,
    padding: "0 14px",
    borderRadius: 12,
    border: `1px solid ${bad ? BAD : LINE}`,
    background: "rgba(8,15,18,.8)",
    transition: "border-color .2s",
  });
  const input: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: "100%",
    border: 0,
    outline: 0,
    background: "transparent",
    color: "#e6ebe9",
    font: "inherit",
    fontSize: 14,
  };

  return (
    <div
      className="elion-scope"
      onClick={() => stage >= 1 && enter()}
      onMouseMove={(e) => {
        mouse.current.tx = e.clientX / window.innerWidth - 0.5;
        mouse.current.ty = e.clientY / window.innerHeight - 0.5;
      }}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "radial-gradient(ellipse 80% 70% at 50% 42%,#0c171b 0%,#070d10 55%,#04080a 100%)",
        fontFamily: "Manrope, sans-serif",
        color: "#dfe5e3",
        cursor: login ? "default" : "pointer",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />

      <div
        style={{
          position: "absolute",
          left: 36,
          top: 30,
          right: 36,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: ".14em",
          color: "#6f7b79",
          opacity: stage >= 1 && !login ? 1 : 0,
          transition: "opacity 1.2s ease",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: "#aeb7b5" }}>ELION/OS 2.1</span>
          <span ref={statRef}>NODE · SYNCING</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#aeb7b5" }}>
            <span
              style={{ width: 5, height: 5, borderRadius: "50%", background: "#3ec495", boxShadow: "0 0 8px #3ec495" }}
            />
            MARKETS LIVE
          </span>
          <span>{clock}</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "calc(40vh + 29vmin)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none",
          opacity: login ? 0 : 1,
          transform: `translateY(${login ? 30 : 0}px)`,
          filter: `blur(${login ? 8 : 0}px)`,
          transition: "opacity .8s ease,transform 1s cubic-bezier(.7,0,.2,1),filter .8s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: ".42em",
            paddingLeft: ".42em",
            fontFamily: "'Cormorant Garamond',serif",
            fontWeight: 400,
            fontSize: "clamp(34px,4.6vw,64px)",
            lineHeight: 1,
            color: "#f3e6c8",
          }}
        >
          {"ELION".split("").map((c, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: stage >= 1 ? 1 : 0,
                transform: `translateY(${stage >= 1 ? 0 : 26}px)`,
                filter: `blur(${stage >= 1 ? 0 : 10}px)`,
                transition: `opacity .9s ease ${i * 90}ms,transform 1.1s cubic-bezier(.2,.8,.2,1) ${i * 90}ms,filter .9s ease ${i * 90}ms`,
              }}
            >
              {c}
            </span>
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            gap: 16,
            opacity: stage >= 1 ? 1 : 0,
            transition: "opacity 1.2s ease .4s",
          }}
        >
          <div
            style={{
              height: 1,
              width: stage >= 1 ? 64 : 0,
              background: "linear-gradient(90deg,transparent,rgba(233,215,176,.7))",
              transition: "width 1.4s cubic-bezier(.2,.8,.2,1) .4s",
            }}
          />
          <span
            style={{ fontSize: 10, letterSpacing: ".55em", paddingLeft: ".55em", color: "#aeb7b5", whiteSpace: "nowrap" }}
          >
            AI TRADING INTELLIGENCE
          </span>
          <div
            style={{
              height: 1,
              width: stage >= 1 ? 64 : 0,
              background: "linear-gradient(90deg,rgba(233,215,176,.7),transparent)",
              transition: "width 1.4s cubic-bezier(.2,.8,.2,1) .4s",
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "5vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          pointerEvents: "none",
          opacity: stage >= 2 && !login ? 1 : 0,
          transform: `translateY(${stage >= 2 ? 0 : 10}px)`,
          transition: "opacity 1s ease,transform 1s ease",
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: ".42em", paddingLeft: ".42em", color: GOLD }}>CLICK TO ENTER</div>
        <div
          style={{ position: "relative", width: 1, height: 34, background: "rgba(233,215,176,.18)", overflow: "hidden" }}
        >
          <div
            ref={dropRef}
            style={{ position: "absolute", left: 0, width: 1, height: 12, background: GOLD, boxShadow: `0 0 6px ${GOLD}` }}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "5vh",
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          opacity: stage >= 2 || login ? 0 : 1,
          transition: "opacity .6s ease",
        }}
      >
        <div ref={pctRef} style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".3em", color: "#6f7b79" }}>
          000
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          display: "flex",
          alignItems: "safe center",
          justifyContent: "center",
          padding: 24,
          boxSizing: "border-box",
          pointerEvents: login ? "auto" : "none",
          opacity: open ? 1 : 0,
          transform: `scale(${open ? 1 : 0.94})`,
          filter: `blur(${open ? 0 : 10}px)`,
          transition: `opacity .9s ease ${open ? ".7s" : "0s"},transform 1.1s cubic-bezier(.2,.8,.2,1) ${open ? ".7s" : "0s"},filter .9s ease ${open ? ".7s" : "0s"}`,
        }}
      >
        <form
          onSubmit={submit}
          onClick={(e) => e.stopPropagation()}
          style={{
            margin: "auto",
            flexShrink: 0,
            width: "100%",
            maxWidth: 380,
            boxSizing: "border-box",
            padding: "clamp(24px,5vh,38px) 34px clamp(20px,4vh,28px)",
            borderRadius: 22,
            border: "1px solid rgba(233,215,176,.2)",
            background: "linear-gradient(180deg,rgba(14,25,29,.72),rgba(7,13,16,.8))",
            backdropFilter: "blur(20px)",
            boxShadow: "0 50px 120px -40px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,245,225,.07)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            cursor: "default",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div
              style={{
                width: 22,
                height: 22,
                border: `1.5px solid ${GOLD}`,
                transform: "rotate(45deg)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <div style={{ width: 7, height: 7, background: GOLD }} />
            </div>
            <div
              style={{
                fontFamily: "'Cormorant Garamond',serif",
                fontSize: 28,
                letterSpacing: ".28em",
                paddingLeft: ".28em",
                color: "#f3e6c8",
                lineHeight: 1,
              }}
            >
              ELION
            </div>
            <div style={{ fontSize: 13, color: "#aeb7b5" }}>Sign in to your trading workspace</div>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: ".18em", color: "#aeb7b5" }}>USERNAME</span>
            <div style={field(!!error && !user.trim())}>
              <span style={icon}>person</span>
              <input
                value={user}
                onChange={(e) => {
                  setUser(e.target.value);
                  setError("");
                }}
                autoComplete="username"
                placeholder="Enter your username"
                style={input}
              />
            </div>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: ".18em", color: "#aeb7b5" }}>PASSWORD</span>
            <div style={{ ...field(!!error && !pass), padding: "0 6px 0 14px" }}>
              <span style={icon}>lock</span>
              <input
                type={show ? "text" : "password"}
                value={pass}
                onChange={(e) => {
                  setPass(e.target.value);
                  setError("");
                }}
                autoComplete="current-password"
                placeholder="Enter your password"
                style={input}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="e-ghost"
                style={{
                  width: 36,
                  height: 36,
                  border: 0,
                  background: "transparent",
                  borderRadius: 8,
                  color: "#8e9896",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: 20 }}>
                  {show ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </label>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "#aeb7b5" }}>Signs out when you close the browser</span>
            <span style={{ color: "#7f8b89" }}>Access is managed by Cloudflare</span>
          </div>

          <div style={{ minHeight: 16, fontSize: 12, color: "#e0826f", margin: "-6px 0 -8px" }}>{error}</div>

          <button
            type="submit"
            className="e-gold-btn"
            style={{
              position: "relative",
              overflow: "hidden",
              height: 50,
              border: 0,
              borderRadius: 12,
              background: "linear-gradient(180deg,#f1e2c0,#d6be8e)",
              color: "#1a1409",
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: ".24em",
              cursor: "pointer",
              boxShadow: "0 12px 34px -12px rgba(233,215,176,.55)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: auth ? "100%" : "0%",
                background: "rgba(255,255,255,.4)",
                transition: "width 1.2s cubic-bezier(.4,0,.2,1)",
              }}
            />
            <span style={{ position: "relative" }}>{auth ? "AUTHENTICATING…" : "SIGN IN"}</span>
          </button>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
              color: "#7f8b89",
              paddingTop: 6,
              borderTop: "1px solid #16252a",
            }}
          >
            <button
              type="button"
              onClick={back}
              className="e-ghost"
              style={{
                border: 0,
                background: "transparent",
                color: "#8e9896",
                font: "inherit",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 0",
              }}
            >
              <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: 16 }}>arrow_back</span>Back
            </button>
            <span>ELION/OS 2.1</span>
          </div>
        </form>
      </div>
    </div>
  );
}
