import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle, Overlay, OverlayMarker, Trade } from "../lib/data";
import { fmtPrice } from "../lib/data";
import { TOOLS, TimeMap, uid, type DPoint, type Drawing, type ToolId } from "../lib/drawings";
import { INDICATOR_BY_ID, type IndicatorInstance, type IndicatorOutput } from "../lib/indicators";
import { DrawingsPrimitive } from "./DrawingsPrimitive";
import Icon from "./Icon";

const C = {
  text: "#8a93a6",
  grid: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  up: "#26a69a",
  down: "#ef5350",
  gold: "#e0b354",
};

interface Props {
  candles: Candle[];
  tfSec: number;
  trades: Trade[];
  showTrades: boolean;
  overlay: Overlay;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  tool: ToolId;
  magnet: boolean;
  color: string;
  selectedId: string | null;
  onAdd: (d: Drawing) => void;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onTool: (t: ToolId) => void;
  onUpdate: (id: string, patch: Partial<Drawing>) => void;
  onDuplicate: (id: string) => void;
  onClearDrawings: () => void;
  showVolume: boolean;
}

interface Drag { id: string; kind: "point" | "body"; idx: number; startLogical: number; startPrice: number; orig: DPoint[] }
interface Menu { x: number; y: number; id: string | null }

interface Built { key: string; series: ISeriesApi<SeriesType>[] }

export default function Chart(props: Props) {
  const { candles, tfSec, trades, showTrades, overlay, indicators, drawings, tool, showVolume, selectedId } = props;
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const primRef = useRef<DrawingsPrimitive | null>(null);
  const lineSeries = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const built = useRef<Built[]>([]);
  const prev = useRef<{ len: number; first: number; tf: number }>({ len: 0, first: 0, tf: 0 });
  const priceLines = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const [legend, setLegend] = useState<Candle | null>(null);
  const [preview, setPreview] = useState<Drawing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const pending = useRef<DPoint[]>([]);
  const drag = useRef<Drag | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const map = useMemo(() => new TimeMap(candles, tfSec), [candles, tfSec]);
  // latest values for event handlers created once
  const live = useRef({ ...props, map });
  live.current = { ...props, map };

  const visible = useMemo(() => indicators.filter((i) => i.visible), [indicators]);
  const computed = useMemo<IndicatorOutput[]>(
    () => (candles.length === 0 ? [] : visible.map((i) => INDICATOR_BY_ID[i.id].compute(candles, i.params, tfSec))),
    [candles, visible, tfSec],
  );

  /* ---- create chart once ---- */
  useEffect(() => {
    const chart = createChart(host.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.text,
        fontFamily: "Inter, Vazirmatn, sans-serif",
        attributionLogo: true,
        panes: { separatorColor: C.border, separatorHoverColor: "rgba(224,179,84,0.3)" },
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, wickUpColor: C.up, wickDownColor: C.down, borderVisible: false,
    });
    markersRef.current = createSeriesMarkers(series, []);
    const prim = new DrawingsPrimitive();
    series.attachPrimitive(prim);
    primRef.current = prim;

    const pointAt = (x: number, y: number): DPoint | null => {
      const { map: m, magnet: mg } = live.current;
      const logical = chart.timeScale().coordinateToLogical(x);
      const price = series.coordinateToPrice(y);
      if (logical == null || price == null) return null;
      if (mg) {
        const b = m.bar(logical);
        if (b) {
          const nearest = [b.open, b.high, b.low, b.close].reduce((p, c) => (Math.abs(c - price) < Math.abs(p - price) ? c : p));
          return { time: b.time, price: nearest };
        }
      }
      return { time: m.logicalToTime(logical as number), price };
    };

    chart.subscribeCrosshairMove((p) => {
      setLegend((p.seriesData.get(series) as Candle | undefined) ?? null);
      const { tool: t, color: col } = live.current;
      if (t === "cursor" || pending.current.length === 0 || !p.point) return;
      const pt = pointAt(p.point.x, p.point.y);
      if (pt) setPreview({ id: "preview", type: t, points: [...pending.current, pt], color: col });
    });

    chart.subscribeClick((p) => {
      if (!p.point) return;
      const cur = live.current;
      if (cur.tool === "cursor") {
        const W = host.current!.clientWidth;
        let best: { id: string; d: number } | null = null;
        for (const d of cur.drawings) {
          const dist = prim.distance(d, p.point.x, p.point.y, W);
          if (dist < 8 && (!best || dist < best.d)) best = { id: d.id, d: dist };
        }
        cur.onSelect(best?.id ?? null);
        return;
      }
      const pt = pointAt(p.point.x, p.point.y);
      if (!pt) return;
      const need = TOOLS.find((x) => x.id === cur.tool)!.points;
      pending.current = [...pending.current, pt];
      if (pending.current.length < need) return;
      const d: Drawing = { id: uid(), type: cur.tool as Drawing["type"], points: pending.current, color: cur.color };
      if (d.type === "text") {
        const text = window.prompt("متن:");
        if (!text) {
          pending.current = [];
          return;
        }
        d.text = text;
      }
      pending.current = [];
      setPreview(null);
      cur.onAdd(d);
      cur.onSelect(d.id);
      cur.onTool("cursor");
    });

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const cur = live.current;
      if (e.key === "Escape") {
        pending.current = [];
        setPreview(null);
        cur.onTool("cursor");
        cur.onSelect(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && cur.selectedId) {
        cur.onDelete(cur.selectedId);
      }
    };
    window.addEventListener("keydown", onKey);

    /* --- drag-to-edit: capture-phase pointer handlers so the chart doesn't pan while dragging a drawing --- */
    const el = host.current!;
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hitTest = (x: number, y: number) => {
      const cur = live.current;
      const W = el.clientWidth;
      const sel = cur.drawings.find((d) => d.id === cur.selectedId);
      if (sel) {
        const idx = prim.handleAt(sel, x, y);
        if (idx >= 0) return { d: sel, idx };
      }
      let best: { d: Drawing; dist: number } | null = null;
      for (const d of cur.drawings) {
        const dist = prim.distance(d, x, y, W);
        if (dist < 8 && (!best || dist < best.dist)) best = { d, dist };
      }
      return best ? { d: best.d, idx: -1 } : null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || live.current.tool !== "cursor") return;
      const { x, y } = local(e);
      if (x > el.clientWidth - 70) return; // price scale area
      const hit = hitTest(x, y);
      if (!hit) return;
      const logical = chart.timeScale().coordinateToLogical(x);
      const price = series.coordinateToPrice(y);
      if (logical == null || price == null) return;
      e.stopPropagation();
      e.preventDefault();
      live.current.onSelect(hit.d.id);
      drag.current = { id: hit.d.id, kind: hit.idx >= 0 ? "point" : "body", idx: hit.idx, startLogical: logical as number, startPrice: price, orig: hit.d.points.map((p) => ({ ...p })) };
      chart.applyOptions({ handleScroll: false, handleScale: false });
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      const g = drag.current;
      if (!g) {
        if (live.current.tool === "cursor") el.classList.toggle("hover-move", x <= el.clientWidth - 70 && !!hitTest(x, y));
        return;
      }
      const cur = live.current;
      const logical = chart.timeScale().coordinateToLogical(x);
      const price = series.coordinateToPrice(y);
      if (logical == null || price == null) return;
      if (g.kind === "point") {
        const pt = pointAt(x, y);
        if (pt) cur.onUpdate(g.id, { points: g.orig.map((p, i) => (i === g.idx ? pt : p)) });
      } else {
        const dl = (logical as number) - g.startLogical;
        const dp = price - g.startPrice;
        cur.onUpdate(g.id, {
          points: g.orig.map((p) => ({ time: cur.map.logicalToTime(cur.map.timeToLogical(p.time) + dl), price: p.price + dp })),
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag.current) return;
      drag.current = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const { x, y } = local(e);
      const hit = hitTest(x, y);
      if (hit) live.current.onSelect(hit.d.id);
      setMenu({ x, y, id: hit?.d.id ?? null });
    };
    const closeMenu = () => setMenu(null);
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("contextmenu", onCtx);
    window.addEventListener("pointerdown", closeMenu);

    chartRef.current = chart;
    seriesRef.current = series;
    prev.current = { len: 0, first: 0, tf: 0 };
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", closeMenu);
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("contextmenu", onCtx);
      chart.remove();
      chartRef.current = seriesRef.current = markersRef.current = primRef.current = volRef.current = null;
      lineSeries.current.clear();
      built.current = [];
    };
  }, []);

  // leaving a tool discards a half-drawn shape
  useEffect(() => {
    pending.current = [];
    setPreview(null);
  }, [tool]);

  /* ---- candles ---- */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    const p = prev.current;
    const reload = p.tf !== tfSec || p.first !== candles[0].time || candles.length < p.len || candles.length - p.len > 1;
    if (reload) {
      series.setData(candles);
      if (p.tf !== tfSec || p.len === 0) chartRef.current?.timeScale().scrollToRealTime();
    } else {
      series.update(candles[candles.length - 1]);
    }
    prev.current = { len: candles.length, first: candles[0].time, tf: tfSec };
  }, [candles, tfSec]);

  /* ---- volume (tick volume from MT5) ---- */
  const hasVolume = candles.length > 0 && candles[0].volume != null;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!showVolume || !hasVolume) {
      if (volRef.current) (chart.removeSeries(volRef.current), (volRef.current = null));
      return;
    }
    if (!volRef.current) {
      volRef.current = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    }
    volRef.current.setData(candles.map((c) => ({ time: c.time, value: c.volume ?? 0, color: c.close >= c.open ? "rgba(38,166,154,0.35)" : "rgba(239,83,80,0.35)" })));
  }, [candles, showVolume, hasVolume]);

  /* ---- drawings layer ---- */
  useEffect(() => {
    primRef.current?.set(map, drawings, preview, selectedId);
  }, [map, drawings, preview, selectedId]);

  /* ---- indicators: (re)build series when the set changes ---- */
  const structureKey = visible.map((i) => `${i.uid}:${i.id}:${JSON.stringify(i.params)}`).join("|");
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const b of built.current) for (const s of b.series) chart.removeSeries(s);
    built.current = [];
    let pane = 0;
    visible.forEach((inst, idx) => {
      const def = INDICATOR_BY_ID[inst.id];
      const out = def.compute(candles.length ? candles : [], inst.params, tfSec);
      const paneIndex = def.group === "pane" ? ++pane : 0;
      const sers: ISeriesApi<SeriesType>[] = out.series.map((s) => {
        if (s.kind === "hist") return chart.addSeries(HistogramSeries, { color: s.color, priceLineVisible: false, lastValueVisible: false }, paneIndex);
        if (s.kind === "dots")
          return chart.addSeries(LineSeries, { color: s.color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, paneIndex);
        return chart.addSeries(LineSeries, { color: s.color, lineWidth: (s.width ?? 2) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: paneIndex > 0, crosshairMarkerVisible: false }, paneIndex);
      });
      out.levels?.forEach((l) => sers[0]?.createPriceLine({ price: l.value, color: l.color ?? "rgba(255,255,255,0.25)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }));
      built.current[idx] = { key: inst.uid, series: sers };
    });
    // give the price pane most of the height
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 4 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  /* ---- indicators: feed data ---- */
  useEffect(() => {
    computed.forEach((out, idx) => {
      const b = built.current[idx];
      if (!b) return;
      out.series.forEach((s, j) => b.series[j]?.setData(s.data as never));
    });
  }, [computed, structureKey]);

  /* ---- markers: trades, rule overlays, indicator markers ---- */
  useEffect(() => {
    const first = candles[0]?.time ?? 0;
    const last = candles[candles.length - 1]?.time ?? 0;
    const snap = (t: number) => (Math.floor(t / tfSec) * tfSec) as UTCTimestamp;
    const items: OverlayMarker[] = [];
    if (showTrades) {
      for (const t of trades) {
        if (t.open_time >= first && t.open_time <= last)
          items.push({
            time: snap(t.open_time),
            position: t.direction === "buy" ? "belowBar" : "aboveBar",
            shape: t.direction === "buy" ? "arrowUp" : "arrowDown",
            color: t.direction === "buy" ? C.up : C.down,
            text: `${t.direction === "buy" ? "خرید" : "فروش"} ${fmtPrice(t.open_price)}`,
          });
        if (t.close_time && t.close_time >= first && t.close_time <= last)
          items.push({
            time: snap(t.close_time),
            position: t.direction === "buy" ? "aboveBar" : "belowBar",
            shape: "circle",
            color: (t.profit ?? 0) >= 0 ? C.up : C.down,
            text: `${(t.profit ?? 0) >= 0 ? "+" : ""}${t.profit ?? 0}$`,
          });
      }
    }
    items.push(...overlay.markers, ...computed.flatMap((o) => o.markers ?? []));
    items.sort((a, b) => a.time - b.time);
    markersRef.current?.setMarkers(items);
  }, [candles, tfSec, trades, showTrades, overlay.markers, computed]);

  /* ---- open-trade guide lines ---- */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    priceLines.current.forEach((l) => series.removePriceLine(l));
    priceLines.current = [];
    if (!showTrades) return;
    const last = candles[candles.length - 1]?.time ?? 0;
    for (const t of trades) {
      if (t.open_time > last || !(t.close_time == null || t.close_time > last)) continue;
      const tag = `#${t.ticket.slice(-4)}`;
      priceLines.current.push(series.createPriceLine({ price: t.open_price, color: C.gold, lineStyle: LineStyle.Dashed, lineWidth: 1, title: `${t.direction === "buy" ? "BUY" : "SELL"} ${tag}` }));
      if (t.stop_loss) priceLines.current.push(series.createPriceLine({ price: t.stop_loss, color: C.down, lineStyle: LineStyle.Dotted, lineWidth: 1, title: `SL ${tag}` }));
      if (t.take_profit) priceLines.current.push(series.createPriceLine({ price: t.take_profit, color: C.up, lineStyle: LineStyle.Dotted, lineWidth: 1, title: `TP ${tag}` }));
    }
  }, [candles, trades, showTrades]);

  /* ---- rule overlay lines (from taught rules) ---- */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const m = lineSeries.current;
    const keep = new Set(overlay.lines.map((l) => l.id));
    for (const [id, s] of m) if (!keep.has(id)) (chart.removeSeries(s), m.delete(id));
    for (const l of overlay.lines) {
      let s = m.get(l.id);
      if (!s) {
        s = chart.addSeries(LineSeries, { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        m.set(l.id, s);
      }
      s.applyOptions({ color: l.color, lineWidth: (l.width ?? 2) as 1 | 2 | 3 | 4, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid });
      s.setData(l.points);
    }
  }, [overlay.lines]);

  const shown = legend ?? candles[candles.length - 1];
  return (
    <div className="chart-wrap">
      <div className="legend" dir="ltr">
        {shown && (
          <>
            <span>O <b>{fmtPrice(shown.open)}</b></span>
            <span>H <b>{fmtPrice(shown.high)}</b></span>
            <span>L <b>{fmtPrice(shown.low)}</b></span>
            <span>C <b className={shown.close >= shown.open ? "up" : "down"}>{fmtPrice(shown.close)}</b></span>
          </>
        )}
      </div>
      <button className="fit" onClick={() => chartRef.current?.timeScale().scrollToRealTime()} title="برگشت به آخرین کندل" aria-label="برگشت به آخرین کندل"><Icon name="fit" size={16} /></button>
      <div ref={host} className={`chart ${tool !== "cursor" ? "drawing" : ""}`} dir="ltr" />
      {menu && (
        <ul className="ctx" style={{ left: menu.x, top: menu.y }} dir="rtl" onPointerDown={(e) => e.stopPropagation()}>
          {menu.id ? (
            <>
              <li><button onClick={() => { props.onDuplicate(menu.id!); setMenu(null); }}>تکثیر</button></li>
              <li><button className="danger" onClick={() => { props.onDelete(menu.id!); setMenu(null); }}>حذف</button></li>
            </>
          ) : (
            <>
              <li><button onClick={() => { chartRef.current?.timeScale().scrollToRealTime(); setMenu(null); }}>برگشت به آخرین کندل</button></li>
              <li><button onClick={() => { chartRef.current?.timeScale().fitContent(); setMenu(null); }}>نمایش همه‌ی کندل‌ها</button></li>
              <li><button className="danger" disabled={drawings.length === 0} onClick={() => { props.onClearDrawings(); setMenu(null); }}>پاک‌کردن همه‌ی رسم‌ها</button></li>
            </>
          )}
        </ul>
      )}
    </div>
  );
}
