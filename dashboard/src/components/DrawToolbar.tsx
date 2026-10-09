import { useEffect, useRef, useState } from "react";
import { drawState, type CursorStyle, type ToolId } from "../lib/drawings";

const COLORS = ["#e6b95a", "#4da3ff", "#26a69a", "#ef5350", "#c084fc", "#f8fafc", "#f59e0b", "#94a3b8"];

interface Props {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  magnet: boolean;
  onMagnet: () => void;
  color: string;
  onColor: (c: string) => void;
  hasSelection: boolean;
  count: number;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onClear: () => void;
}

/* ---- TradingView-like 24px stroke icons ---- */
const ICONS: Record<string, string[]> = {
  cross: ["M12 3v18", "M3 12h18"],
  dot: ["M12 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0"],
  arrow: ["M6 3l12 9-5.5 1.2L15 20l-2.3 1-2.6-6.6L6 18z"],
  eraser: ["M4 16l8-8 6 6-5 5H8z", "M10 10l6 6", "M13 21h7"],
  trend: ["M4 20L20 4", "M4 20h.01", "M20 4h.01"],
  ray: ["M5 19L19 5", "M14 5h5v5"],
  extended: ["M2 22L22 2", "M8 16h.01", "M16 8h.01"],
  infoline: ["M4 19L14 9", "M14 5h7v7h-7z"],
  angle: ["M4 19L19 6", "M4 19h16", "M11 19a7 7 0 0 0-1.8-4.7"],
  hline: ["M2 12h20", "M12 12h.01"],
  hray: ["M7 12h15", "M7 12h.01"],
  vline: ["M12 2v20", "M12 12h.01"],
  crossline: ["M12 2v20", "M2 12h20"],
  arrowline: ["M5 19L19 5", "M11 5h8v8"],
  channel: ["M3 17L17 7", "M7 21L21 11", "M3 17h.01", "M21 11h.01"],
  fib: ["M3 5h18", "M3 9.5h18", "M3 14h18", "M3 19h18", "M5 19L19 5"],
  fibext: ["M3 6h18", "M3 12h18", "M3 18h18", "M4 15l5-9 5 6"],
  abcd: ["M3 18L9 6l6 9 6-10"],
  xabcd: ["M2 14L6 5l5 10 4-6 7 9", "M6 5l9 4"],
  hs: ["M2 17l4-7 3 4 3-10 3 10 3-4 4 7", "M9 14h6"],
  elliott5: ["M2 19l4-8 3 4 5-11 3 6 5-5"],
  elliott3: ["M3 6l6 12 4-6 7 9"],
  long: ["M4 3v18", "M4 12h16", "M8 12V5h12v7z", "M8 12v6h12v-6"],
  short: ["M4 3v18", "M4 12h16", "M8 12V6h12v6z", "M8 12v7h12v-7"],
  measure: ["M4 4h16v16H4z", "M12 7v10", "M7 12h10"],
  pricerange: ["M4 5h16", "M4 19h16", "M12 7v10", "M9.5 9.5L12 7l2.5 2.5", "M9.5 14.5L12 17l2.5-2.5"],
  daterange: ["M5 4v16", "M19 4v16", "M7 12h10", "M9.5 9.5L7 12l2.5 2.5", "M14.5 9.5L17 12l-2.5 2.5"],
  rect: ["M4 6h16v12H4z"],
  circle: ["M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0"],
  ellipse: ["M12 12m-9 0a9 5.5 0 1 0 18 0a9 5.5 0 1 0 -18 0"],
  triangle: ["M12 4l9 16H3z"],
  text: ["M5 6V4h14v2", "M12 4v16", "M9 20h6"],
  callout: ["M4 4h16v11H11l-5 5v-5H4z"],
  pricelabel: ["M3 12l5-6h13v12H8z", "M8 12h.01"],
  arrowup: ["M12 3l7 8h-4v10H9V11H5z"],
  arrowdown: ["M12 21l7-8h-4V3H9v10H5z"],
  flag: ["M6 21V3", "M6 4h12l-3 4 3 4H6"],
  magnet: ["M6 3v9a6 6 0 0 0 12 0V3", "M6 8h4", "M14 8h4"],
  bell: ["M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z", "M10 20a2 2 0 0 0 4 0"],
  stay: ["M14 4l6 6L9 21H3v-6z", "M6 14l4 4", "M17 21h4"],
  lock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  unlock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 7.5-2"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  eyeoff: ["M3 3l18 18", "M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7", "M6.3 7.6A17 17 0 0 0 2 12s4 6 10 6a9.7 9.7 0 0 0 4.4-1"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  undo: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  up: ["M6 15l6-6 6 6"],
  down: ["M6 9l6 6 6-6"],
};

function Svg({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {(ICONS[name] ?? ICONS.trend).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

type Item = { id: string; label: string; icon: string; key?: string; section?: string };
type Group = { id: string; title: string; items: Item[] };

/** Everything TradingView's left toolbar has that this chart can draw, grouped the same way. */
const GROUPS: Group[] = [
  {
    id: "cursors", title: "Cursors", items: [
      { id: "cur:cross", label: "Cross", icon: "cross" },
      { id: "cur:dot", label: "Dot", icon: "dot" },
      { id: "cur:arrow", label: "Arrow", icon: "arrow" },
      { id: "eraser", label: "Eraser", icon: "eraser" },
    ],
  },
  {
    id: "lines", title: "Trend line tools", items: [
      { id: "trend", label: "Trend Line", icon: "trend", key: "Alt+T", section: "Lines" },
      { id: "ray", label: "Ray", icon: "ray" },
      { id: "infoline", label: "Info Line", icon: "infoline" },
      { id: "extended", label: "Extended Line", icon: "extended" },
      { id: "angle", label: "Trend Angle", icon: "angle" },
      { id: "hline", label: "Horizontal Line", icon: "hline", key: "Alt+H" },
      { id: "hray", label: "Horizontal Ray", icon: "hray", key: "Alt+J" },
      { id: "vline", label: "Vertical Line", icon: "vline", key: "Alt+V" },
      { id: "crossline", label: "Cross Line", icon: "crossline", key: "Alt+C" },
      { id: "arrow", label: "Arrow", icon: "arrowline" },
      { id: "channel", label: "Parallel Channel", icon: "channel", section: "Channels" },
    ],
  },
  {
    id: "fib", title: "Gann and Fibonacci tools", items: [
      { id: "fib", label: "Fib Retracement", icon: "fib", key: "Alt+F" },
      { id: "fibext", label: "Trend-Based Fib Extension", icon: "fibext" },
    ],
  },
  {
    id: "patterns", title: "Patterns", items: [
      { id: "xabcd", label: "XABCD Pattern", icon: "xabcd", section: "Chart patterns" },
      { id: "abcd", label: "ABCD Pattern", icon: "abcd" },
      { id: "hs", label: "Head and Shoulders", icon: "hs" },
      { id: "elliott5", label: "Elliott Impulse Wave (12345)", icon: "elliott5", section: "Elliott waves" },
      { id: "elliott3", label: "Elliott Correction Wave (ABC)", icon: "elliott3" },
    ],
  },
  {
    id: "forecast", title: "Forecasting and measurement tools", items: [
      { id: "long", label: "Long Position", icon: "long", section: "Forecasting" },
      { id: "short", label: "Short Position", icon: "short" },
      { id: "pricerange", label: "Price Range", icon: "pricerange", section: "Measurers" },
      { id: "daterange", label: "Date Range", icon: "daterange" },
      { id: "measure", label: "Date and Price Range", icon: "measure" },
    ],
  },
  {
    id: "shapes", title: "Geometric shapes", items: [
      { id: "rect", label: "Rectangle", icon: "rect" },
      { id: "circle", label: "Circle", icon: "circle" },
      { id: "ellipse", label: "Ellipse", icon: "ellipse" },
      { id: "triangle", label: "Triangle", icon: "triangle" },
    ],
  },
  {
    id: "annot", title: "Annotation tools", items: [
      { id: "text", label: "Text", icon: "text" },
      { id: "callout", label: "Callout", icon: "callout" },
      { id: "pricelabel", label: "Price Label", icon: "pricelabel" },
      { id: "arrowup", label: "Arrow Mark Up", icon: "arrowup", section: "Marks" },
      { id: "arrowdown", label: "Arrow Mark Down", icon: "arrowdown" },
      { id: "flag", label: "Flag Mark", icon: "flag" },
    ],
  },
];

const HOTKEYS: Record<string, ToolId> = { t: "trend", h: "hline", j: "hray", v: "vline", c: "crossline", f: "fib", a: "alert" };

const CSS = `
.tvbar{flex:none;align-self:stretch;width:48px;display:flex;flex-direction:column;align-items:center;background:#0d171b;border-right:1px solid rgba(255,255,255,.06);position:relative;z-index:6;user-select:none}
.tvbar.closed{position:absolute;left:6px;top:30px;align-self:auto;width:40px;height:auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.tvbar .body{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;transition:max-height .25s ease,opacity .2s;max-height:2000px;opacity:1}
.tvbar.closed .body{max-height:0;opacity:0;pointer-events:none}
.tvbar .tb{position:relative;width:40px;height:36px;border-radius:6px;display:grid;place-items:center;color:#9aa6ad;cursor:pointer;border:0;background:transparent;flex:none}
.tvbar .tb:hover:not(:disabled){background:rgba(255,255,255,.07);color:#e7edf0}
.tvbar .tb.on{color:#e0b354;background:rgba(224,179,84,.13)}
.tvbar .tb:disabled{opacity:.35;cursor:default}
.tvbar .tb .more{position:absolute;right:0;top:0;bottom:0;width:12px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px;border-radius:0 6px 6px 0;color:#6d7a80;opacity:.55}
.tvbar .tb:hover .more,.tvbar .tb .more.open{opacity:1}
.tvbar .tb .more:hover{color:#e7edf0;background:rgba(255,255,255,.12)}
.tvbar .toggle{width:40px;height:26px;margin:4px 0 2px;border-radius:6px;display:grid;place-items:center;color:#9aa6ad;cursor:pointer;flex:none}
.tvbar .toggle:hover{background:rgba(255,255,255,.07);color:#e7edf0}
.tvbar .sep{width:28px;height:1px;background:rgba(255,255,255,.08);margin:4px 0;flex:none}
.tvbar .fly{position:fixed;min-width:240px;max-height:70vh;overflow:auto;background:#131f24;border:1px solid rgba(255,255,255,.1);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:5px;z-index:1000}
.tvbar .fly .row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:5px;color:#d5dde1;font-size:12.5px;cursor:pointer;white-space:nowrap}
.tvbar .fly .row:hover{background:rgba(255,255,255,.07)}
.tvbar .fly .row.on{color:#e0b354}
.tvbar .fly .row .k{margin-left:auto;color:#6d7a80;font-size:11px}
.tvbar .fly .title{font-size:10.5px;color:#6d7a80;padding:8px 10px 4px;text-transform:uppercase;letter-spacing:.06em}
.tvbar .sw{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer}
.tvbar .sw.on{border-color:#fff}
.tvbar .swatch{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.25)}
`;

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function DrawToolbar(p: Props) {
  const [lastPick, setLastPick] = useState<Record<string, string>>(() => { try { return JSON.parse(load("elion.tv.last", "{}")); } catch { return {}; } });
  const [open, setOpen] = useState<{ id: string; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(() => load("elion.tv.collapsed", "0") === "1");
  const [, force] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const onTool = useRef(p.onTool);
  onTool.current = p.onTool;

  useEffect(() => {
    const f = () => force((v) => v + 1);
    drawState.subs.add(f);
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (e.key === "Escape") { setOpen(null); return; }
      const hk = HOTKEYS[e.key.toLowerCase()];
      if (e.altKey && hk) { e.preventDefault(); onTool.current(hk); }
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { drawState.subs.delete(f); window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, []);

  const isOn = (id: string) => (id.startsWith("cur:") ? p.tool === "cursor" && drawState.cursor === id.slice(4) : p.tool === id);
  const activate = (gid: string, id: string) => {
    setLastPick((l) => { const n = { ...l, [gid]: id }; save("elion.tv.last", JSON.stringify(n)); return n; });
    if (id.startsWith("cur:")) { drawState.set({ cursor: id.slice(4) as CursorStyle }); p.onTool("cursor"); }
    else p.onTool(id as ToolId);
    setOpen(null);
  };
  const openFly = (id: string, el: HTMLElement) => {
    if (open?.id === id) return setOpen(null);
    const r = el.getBoundingClientRect();
    setOpen({ id, x: r.right + 6, y: Math.min(r.top, window.innerHeight - 320) });
  };
  const toggleCollapsed = () => setCollapsed((c) => { save("elion.tv.collapsed", c ? "0" : "1"); setOpen(null); return !c; });

  const flyGroup = GROUPS.find((g) => g.id === open?.id);

  return (
    <div className={`tvbar ${collapsed ? "closed" : ""}`} ref={ref} role="toolbar" aria-label="Drawing tools">
      <style>{CSS}</style>
      <div className="toggle" onClick={toggleCollapsed} title={collapsed ? "Show drawing toolbar" : "Hide drawing toolbar"}>
        <Svg name={collapsed ? "down" : "up"} size={18} />
      </div>
      <div className="body">
        {GROUPS.map((g) => {
          const active = g.items.find((i) => isOn(i.id));
          const cur = active ?? g.items.find((i) => i.id === lastPick[g.id]) ?? g.items[0];
          return (
            <button key={g.id} className={`tb ${active ? "on" : ""}`} title={`${cur.label}${cur.key ? ` (${cur.key})` : ""}`} aria-label={cur.label}
              onClick={() => activate(g.id, cur.id)}
              onContextMenu={(e) => { e.preventDefault(); openFly(g.id, e.currentTarget); }}>
              <Svg name={cur.icon} />
              {g.items.length > 1 && (
                <span className={`more ${open?.id === g.id ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); openFly(g.id, e.currentTarget.parentElement as HTMLElement); }}>
                  <svg width="7" height="7" viewBox="0 0 7 7"><path d="M1 2l2.5 3L6 2" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                </span>
              )}
            </button>
          );
        })}

        <div className="sep" />
        <button className={`tb ${p.tool === "alert" ? "on" : ""}`} onClick={() => p.onTool(p.tool === "alert" ? "cursor" : "alert")} title="Add Price Alert (Alt+A) — click a price on the chart; Telegram tells you when it's reached"><Svg name="bell" /></button>
        <button className={`tb ${p.magnet ? "on" : ""}`} onClick={p.onMagnet} title="Magnet Mode: snap to Open/High/Low/Close"><Svg name="magnet" /></button>
        <button className={`tb ${drawState.stay ? "on" : ""}`} onClick={() => drawState.set({ stay: !drawState.stay })} title="Stay in Drawing Mode"><Svg name="stay" /></button>
        <button className={`tb ${drawState.locked ? "on" : ""}`} onClick={() => drawState.set({ locked: !drawState.locked })} title={drawState.locked ? "Unlock All Drawings" : "Lock All Drawings"}><Svg name={drawState.locked ? "lock" : "unlock"} /></button>
        <button className={`tb ${drawState.hidden ? "on" : ""}`} onClick={() => drawState.set({ hidden: !drawState.hidden })} title={drawState.hidden ? "Show All Drawings" : "Hide All Drawings"}><Svg name={drawState.hidden ? "eyeoff" : "eye"} /></button>
        <button className="tb" onClick={(e) => openFly("color", e.currentTarget)} title="Drawing color"><span className="swatch" style={{ background: p.color }} /></button>

        <div style={{ flex: 1, minHeight: 6 }} />
        <button className="tb" onClick={p.onUndo} disabled={p.count === 0} title="Undo last drawing"><Svg name="undo" size={18} /></button>
        <button className="tb" onClick={(e) => openFly("remove", e.currentTarget)} disabled={p.count === 0 && !p.hasSelection} title="Remove objects"><Svg name="trash" size={18} /></button>
        <div style={{ height: 6, flex: "none" }} />
      </div>

      {open && flyGroup && (
        <div className="fly" style={{ left: open.x, top: open.y }}>
          {flyGroup.items.map((i, k) => (
            <div key={i.id}>
              {(k === 0 || i.section) && <div className="title">{i.section ?? flyGroup.title}</div>}
              <div className={`row ${isOn(i.id) ? "on" : ""}`} onClick={() => activate(flyGroup.id, i.id)}>
                <Svg name={i.icon} size={18} />{i.label}{i.key && <span className="k">{i.key}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {open?.id === "color" && (
        <div className="fly" style={{ left: open.x, top: open.y, minWidth: 0, width: 150 }}>
          <div className="title">Color</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 20px)", gap: 10, padding: "2px 10px 8px" }}>
            {COLORS.map((c) => <span key={c} className={`sw ${p.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => { p.onColor(c); setOpen(null); }} />)}
          </div>
        </div>
      )}
      {open?.id === "remove" && (
        <div className="fly" style={{ left: open.x, top: Math.max(8, open.y - 60) }}>
          <div className="title">Remove objects</div>
          {p.hasSelection && <div className="row" onClick={() => { p.onDeleteSelected(); setOpen(null); }}><Svg name="trash" size={16} />Remove selected drawing</div>}
          {p.count > 0 && <div className="row" onClick={() => { p.onClear(); setOpen(null); }}><Svg name="trash" size={16} />Remove {p.count} drawing{p.count === 1 ? "" : "s"}</div>}
        </div>
      )}
    </div>
  );
}
