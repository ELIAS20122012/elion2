import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { aggregate, loadJson, type Candle, type Overlay, type Trade } from "../lib/data";
import { loadDrawings, saveDrawings, uid, type Drawing, type ToolId } from "../lib/drawings";
import type { IndicatorInstance } from "../lib/indicators";
import { useLive } from "../lib/useLive";
import { useReplay } from "../lib/useReplay";

export const SYMBOL = "XAUUSD";
const IND_KEY = "rt.indicators.v1";
const EMPTY_OVERLAY: Overlay = { lines: [], markers: [] };

function loadIndicators(): IndicatorInstance[] {
  try {
    return JSON.parse(localStorage.getItem(IND_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** One place for everything the pages share: market data, chart settings and the user's drawings. */
function useAppState() {
  const [all, setAll] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tfSec, setTfSec] = useState<number>(60);
  const [layers, setLayers] = useState<Record<string, boolean>>({ trades: true });
  const [mode, setModeRaw] = useState<"live" | "replay">("live");
  const [indicators, setIndicators] = useState<IndicatorInstance[]>(loadIndicators);
  const [drawings, setDrawings] = useState<Drawing[]>(() => loadDrawings(SYMBOL));
  const [tool, setTool] = useState<ToolId>("cursor");
  const [magnet, setMagnet] = useState(true);
  const [color, setColor] = useState("#e0b354");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVolume, setShowVolume] = useState(true);

  useEffect(() => saveDrawings(SYMBOL, drawings), [drawings]);
  useEffect(() => {
    try {
      localStorage.setItem(IND_KEY, JSON.stringify(indicators));
    } catch {
      /* not persisted */
    }
  }, [indicators]);

  useEffect(() => {
    Promise.all([loadJson<Candle[]>("xauusd_m1.json"), loadJson<Trade[]>("trades.json")])
      .then(([c, t]) => {
        setAll(c);
        // drop leftover test trades whose price is nowhere near the recorded market
        const lo = Math.min(...c.map((x) => x.low)) * 0.99;
        const hi = Math.max(...c.map((x) => x.high)) * 1.01;
        setTrades(t.filter((x) => x.open_price >= lo && x.open_price <= hi));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const replay = useReplay(all);
  const live = useLive(mode === "live");
  const source = mode === "live" ? live.candles : replay.candles;
  const bars = useMemo(() => aggregate(source.map((c) => ({ ...c })), tfSec), [source, tfSec]);

  const setMode = (m: "live" | "replay") => {
    if (m === "live" && replay.playing) replay.toggle();
    setModeRaw(m);
  };

  const last = source[source.length - 1];
  const dayOpen = last ? source.find((c) => Math.floor(c.time / 86400) === Math.floor(last.time / 86400))?.open : undefined;
  const change = last && dayOpen ? last.close - dayOpen : 0;

  const visibleTrades = useMemo(
    () => (last ? trades.filter((t) => t.open_time >= source[0].time && t.open_time <= last.time) : []),
    [trades, last, source],
  );
  const closed = useMemo(() => visibleTrades.filter((t) => t.close_time && t.close_time <= (last?.time ?? 0)), [visibleTrades, last]);
  const wins = closed.filter((t) => (t.profit ?? 0) > 0).length;
  const net = closed.reduce((s, t) => s + (t.profit ?? 0), 0);

  const removeDrawing = (id: string) => {
    setDrawings((d) => d.filter((x) => x.id !== id));
    setSelectedId(null);
  };
  const updateDrawing = (id: string, patch: Partial<Drawing>) => setDrawings((l) => l.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const duplicateDrawing = (id: string) => {
    const src = drawings.find((d) => d.id === id);
    if (!src) return;
    const copy: Drawing = { ...src, id: uid(), points: src.points.map((p) => ({ time: p.time + tfSec * 3, price: p.price })) };
    setDrawings((l) => [...l, copy]);
    setSelectedId(copy.id);
  };

  return {
    error, all, trades, tfSec, setTfSec, layers, setLayers, mode, setMode,
    indicators, setIndicators, drawings, setDrawings, tool, setTool, magnet, setMagnet, color, setColor,
    selectedId, setSelectedId, showVolume, setShowVolume,
    replay, live, source, bars, last, change, visibleTrades, closed, wins, net,
    removeDrawing, updateDrawing, duplicateDrawing,
    selected: drawings.find((d) => d.id === selectedId) ?? null,
    overlay: EMPTY_OVERLAY,
  };
}

export type AppState = ReturnType<typeof useAppState>;
const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <AppProvider>");
  return v;
}
