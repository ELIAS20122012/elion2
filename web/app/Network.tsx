"use client";
import { useEffect, useRef } from "react";

/** Animated "brain" behind the dashboard: a drifting cloud of linked nodes. `busy` speeds it up and brightens it. */
export function Network({ busy = false }: { busy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, t = 0;
    type N = { x: number; y: number; vx: number; vy: number; r: number; big: boolean; ph: number; hx: number; hy: number };
    let nodes: N[] = [];

    const seed = () => {
      const count = Math.round(Math.min(170, Math.max(70, (w * h) / 4500)));
      const rx = Math.min(w * 0.3, 380), ry = Math.min(h * 0.34, 250);
      nodes = Array.from({ length: count }, (_, i) => {
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 0.6);
        const x = w / 2 + Math.cos(a) * rx * d, y = h / 2 + Math.sin(a) * ry * d;
        return { x, y, hx: x, hy: y, vx: 0, vy: 0, r: i % 11 === 0 ? 3.2 + Math.random() * 2 : 0.8 + Math.random() * 1.4, big: i % 11 === 0, ph: Math.random() * 6.28 };
      });
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };
    const draw = () => {
      const b = busyRef.current;
      t += still ? 0 : b ? 0.02 : 0.008;
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        n.x = n.hx + Math.cos(t + n.ph) * (b ? 10 : 6);
        n.y = n.hy + Math.sin(t * 1.3 + n.ph) * (b ? 8 : 5);
      }
      const max = Math.min(105, w / 8);
      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const c = nodes[j]!;
          const dx = a.x - c.x, dy = a.y - c.y, d = Math.hypot(dx, dy);
          if (d > max) continue;
          ctx.strokeStyle = `rgba(178, 102, 255, ${(1 - d / max) * (b ? 0.42 : 0.28)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        }
      }
      for (const n of nodes) {
        const pulse = n.big ? 1 + Math.sin(t * 3 + n.ph) * 0.25 : 1;
        if (n.big) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5 * pulse);
          g.addColorStop(0, "rgba(220, 140, 255, .55)"); g.addColorStop(1, "rgba(220, 140, 255, 0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 5 * pulse, 0, 6.29); ctx.fill();
        }
        ctx.fillStyle = n.big ? "#e9b6ff" : "rgba(200, 140, 255, .85)";
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * pulse, 0, 6.29); ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    size();
    draw();
    const ro = new ResizeObserver(() => { size(); if (still) draw(); });
    ro.observe(cv);
    const vis = () => { cancelAnimationFrame(raf); if (document.visibilityState === "visible" && !still) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  return <canvas ref={ref} className="net" aria-hidden />;
}
