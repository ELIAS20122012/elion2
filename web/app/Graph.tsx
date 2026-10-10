"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export interface GNode { id: string; label: string; group: string; hub?: boolean; href?: string }
export interface GLink { a: string; b: string }

type N = GNode & { x: number; y: number; vx: number; vy: number; r: number; deg: number };

export const GROUP_COLOR: Record<string, string> = {
  core: "#f5d0fe", agents: "#38bdf8", tasks: "#a78bfa", calendar: "#f59e0b", memory: "#c084fc",
  skills: "#22d3ee", lab: "#f472b6", schedules: "#34d399", approvals: "#fb7185",
};

/** Live knowledge graph of Elion (Obsidian-style): force layout, hover shows a node and its links, drag to move, click a hub to open it. */
export function Graph({ nodes, links, busy = false }: { nodes: GNode[]; links: GLink[]; busy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const state = useRef({ nodes: new Map<string, N>(), links: [] as { a: N; b: N }[], heat: 1, busy });
  state.current.busy = busy;

  // merge new data, keeping positions of nodes that already exist
  useEffect(() => {
    const s = state.current;
    const cv = ref.current;
    const w = cv?.clientWidth || 800, h = cv?.clientHeight || 600;
    const next = new Map<string, N>();
    for (const g of nodes) {
      const old = s.nodes.get(g.id);
      const parent = links.find((l) => l.b === g.id)?.a;
      const p = parent ? s.nodes.get(parent) ?? next.get(parent) : undefined;
      const a = Math.random() * 6.28;
      next.set(g.id, old ? Object.assign(old, g) : {
        ...g, vx: 0, vy: 0, deg: 0, r: 0,
        x: (p?.x ?? w / 2) + Math.cos(a) * (g.hub ? 140 : 40),
        y: (p?.y ?? h / 2) + Math.sin(a) * (g.hub ? 110 : 40),
      });
    }
    for (const n of next.values()) n.deg = 0;
    const ls = links.map((l) => ({ a: next.get(l.a)!, b: next.get(l.b)! })).filter((l) => l.a && l.b);
    for (const l of ls) { l.a.deg++; l.b.deg++; }
    for (const n of next.values()) n.r = n.group === "core" ? 22 : n.hub ? 7 + Math.min(5, Math.sqrt(n.deg)) : 2.6;
    const changed = next.size !== s.nodes.size || [...next.keys()].some((k) => !s.nodes.has(k));
    s.nodes = next;
    s.links = ls;
    if (changed) s.heat = Math.max(s.heat, 0.6);
  }, [nodes, links]);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const s = state.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, t = 0;
    let hover: N | null = null, drag: N | null = null, moved = false;

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.heat = Math.max(s.heat, 0.4);
    };
    const step = () => {
      const ns = [...s.nodes.values()];
      const k = s.heat;
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i]!;
        for (let j = i + 1; j < ns.length; j++) {
          const b = ns[j]!;
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
          if (d2 > 40000) continue;
          const f = ((a.hub || a.group === "core" ? 4 : 1) * (b.hub || b.group === "core" ? 4 : 1) * 22) / d2;
          const fx = dx * f, fy = dy * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const { a, b } of s.links) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const want = a.group === "core" ? Math.min(w * 0.7, h) * 0.24 : b.group === a.group ? 26 + Math.min(18, a.deg) : 60;
        const f = (d - want) * 0.03;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      const sx = w / Math.max(w, h), sy = h / Math.max(w, h); // keep the cloud oval like the stage
      for (const n of ns) {
        if (!still) { n.vx += Math.cos(t + n.x * 0.01) * 0.04; n.vy += Math.sin(t * 1.3 + n.y * 0.01) * 0.04; }
        if (n === drag) { n.vx = n.vy = 0; continue; }
        if (n.group === "core") { n.vx += (w / 2 - n.x) * 0.08; n.vy += (h / 2 - n.y) * 0.08; }
        n.vx += (w / 2 - n.x) * 0.004 / sx; n.vy += (h / 2 - n.y) * 0.004 / sy;
        n.vx *= 0.8; n.vy *= 0.8;
        const v = Math.hypot(n.vx, n.vy);
        if (v > 6) { n.vx *= 6 / v; n.vy *= 6 / v; }
        n.x += n.vx * k; n.y += n.vy * k;
        // keep the graph inside a central oval (the module cards live around it)
        const rx = w * (w > 980 ? 0.3 : 0.46), ry = h * (w > 980 ? 0.36 : 0.44);
        const ex = (n.x - w / 2) / rx, ey = (n.y - h / 2) / ry, e = Math.hypot(ex, ey);
        if (e > 1) { n.x = w / 2 + (ex / e) * rx; n.y = h / 2 + (ey / e) * ry; }
      }
      s.heat = Math.max(0.15, s.heat * 0.996);
    };
    const near = (x: number, y: number) => {
      let best: N | null = null, bd = 14 * 14;
      for (const n of s.nodes.values()) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < Math.max(bd, (n.r + 4) ** 2) && (!best || d < bd)) { best = n; bd = d; }
      }
      return best;
    };
    const draw = () => {
      t += still ? 0 : s.busy ? 0.05 : 0.02;
      if (!still || s.heat > 0.1) step();
      ctx.clearRect(0, 0, w, h);
      const focus = hover ?? drag;
      const linked = new Set<N>();
      if (focus) for (const l of s.links) { if (l.a === focus) linked.add(l.b); if (l.b === focus) linked.add(l.a); }
      // links
      for (const { a, b } of s.links) {
        const on = focus && (a === focus || b === focus);
        ctx.strokeStyle = on ? hexA(GROUP_COLOR[b.group] ?? "#b266ff", 0.9) : `rgba(178, 102, 255, ${focus ? 0.08 : a.group === "core" ? 0.35 : 0.22})`;
        ctx.lineWidth = on ? 1.4 : a.group === "core" ? 1 : 0.7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // travelling pulses along core links while working
      if (s.busy) for (const { a, b } of s.links) {
        if (a.group !== "core") continue;
        const p = (t * 0.6 + (b.x % 1)) % 1;
        ctx.fillStyle = "rgba(240, 200, 255, .9)";
        ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, 1.8, 0, 6.29); ctx.fill();
      }
      // nodes
      for (const n of s.nodes.values()) {
        const c = GROUP_COLOR[n.group] ?? "#c084fc";
        const dim = focus && n !== focus && !linked.has(n);
        const pulse = n.group === "core" ? 1 + Math.sin(t * 2) * 0.08 : 1;
        if (n.hub || n.group === "core") {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3.2 * pulse);
          g.addColorStop(0, hexA(c, dim ? 0.1 : 0.45)); g.addColorStop(1, hexA(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3.2 * pulse, 0, 6.29); ctx.fill();
        }
        ctx.fillStyle = hexA(c, dim ? 0.25 : 1);
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * pulse, 0, 6.29); ctx.fill();
      }
      // labels: core + hubs always, leaves when focused
      ctx.textAlign = "center";
      for (const n of s.nodes.values()) {
        const show = n.group === "core" || n.hub || n === focus || linked.has(n);
        if (!show) continue;
        const dim = focus && n !== focus && !linked.has(n);
        if (n.group === "core") {
          ctx.font = "700 11px Orbitron, Vazirmatn, sans-serif";
          ctx.fillStyle = "#1a0b24";
          ctx.fillText("ELION", n.x, n.y + 4);
          continue;
        }
        ctx.font = `${n.hub ? 600 : 400} ${n.hub ? 12.5 : 11.5}px Vazirmatn, sans-serif`;
        const text = n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label;
        const y = n.y + n.r + 14;
        if (n === focus || (!n.hub && linked.has(n))) {
          const tw = ctx.measureText(text).width + 12;
          ctx.fillStyle = "rgba(10, 11, 17, .85)";
          ctx.fillRect(n.x - tw / 2, y - 12, tw, 17);
        }
        ctx.fillStyle = dim ? "rgba(230, 232, 240, .25)" : n.hub ? "#e8eaf0" : "#c9cddb";
        ctx.fillText(text, n.x, y);
      }
      raf = requestAnimationFrame(draw);
    };
    const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const down = (e: PointerEvent) => { const [x, y] = pos(e); drag = near(x, y); moved = false; if (drag) cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      const [x, y] = pos(e);
      if (drag) { drag.x = x; drag.y = y; moved = true; s.heat = Math.max(s.heat, 0.3); }
      else hover = near(x, y);
      cv.style.cursor = drag ? "grabbing" : hover ? (hover.href ? "pointer" : "grab") : "default";
    };
    const up = () => { if (drag && !moved && drag.href) router.push(drag.href); drag = null; };
    const leave = () => { hover = null; };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointerleave", leave);
    size();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const vis = () => { cancelAnimationFrame(raf); if (document.visibilityState === "visible") raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", vis);
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up); cv.removeEventListener("pointerleave", leave);
    };
  }, [router]);

  return <canvas ref={ref} className="net graph" aria-label="گراف دانش Elion" role="img" />;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
