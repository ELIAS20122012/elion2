import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { FIB_EXT_LEVELS, FIB_LEVELS, TimeMap, drawState, type Drawing, type DPoint } from "../lib/drawings";

interface XY { x: number; y: number }

/** Canvas layer that renders user drawings on top of the candles and answers hit-tests. */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private requestUpdate: (() => void) | null = null;
  private map = new TimeMap([], 60);
  drawings: Drawing[] = [];
  preview: Drawing | null = null;
  selectedId: string | null = null;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<"Candlestick">;
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  set(map: TimeMap, drawings: Drawing[], preview: Drawing | null, selectedId: string | null) {
    this.map = map;
    this.drawings = drawings;
    this.preview = preview;
    this.selectedId = selectedId;
    this.requestUpdate?.();
  }

  paneViews(): IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    return [{ zOrder: () => "top", renderer: () => renderer }];
  }

  toXY(p: DPoint): XY | null {
    if (!this.chart || !this.series) return null;
    const x = this.chart.timeScale().logicalToCoordinate(this.map.timeToLogical(p.time) as never);
    const y = this.series.priceToCoordinate(p.price);
    return x == null || y == null ? null : { x, y };
  }

  private draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const list = drawState.hidden ? (this.preview ? [this.preview] : []) : this.preview ? [...this.drawings, this.preview] : this.drawings;
      for (const d of list) this.drawOne(ctx, d, mediaSize.width, mediaSize.height, d.id === this.selectedId, d === this.preview);
    });
  }

  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, W: number, H: number, selected: boolean, isPreview: boolean) {
    const pts = d.points.map((p) => this.toXY(p));
    if (pts.some((p) => p == null)) return;
    const [a, b, c] = pts as XY[];
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = (d.width ?? 1.6) + (selected ? 0.9 : 0);
    ctx.font = "12px Inter, Vazirmatn, sans-serif";
    if (isPreview) ctx.globalAlpha = 0.75;
    if (d.dashed) ctx.setLineDash([7, 5]);

    switch (d.type) {
      case "hray":
        line(ctx, a, { x: W, y: a.y });
        tag(ctx, d.color, d.points[0].price.toFixed(2), W - 4, a.y, "right");
        break;
      case "channel": {
        if (!b) break;
        line(ctx, a, b);
        if (c) {
          const dx = b.x - a.x;
          const yl = dx === 0 ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / dx;
          const off = c.y - yl;
          const a2 = { x: a.x, y: a.y + off };
          const b2 = { x: b.x, y: b.y + off };
          line(ctx, a2, b2);
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.08;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.6;
          ctx.setLineDash([4, 4]);
          line(ctx, { x: a.x, y: a.y + off / 2 }, { x: b.x, y: b.y + off / 2 });
        }
        break;
      }
      case "trend":
        if (b) line(ctx, a, b);
        break;
      case "ray":
        if (b) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const k = dx === 0 ? 0 : (W + 2000 - a.x) / dx;
          line(ctx, a, dx === 0 ? b : { x: a.x + dx * k, y: a.y + dy * k });
        }
        break;
      case "hline": {
        line(ctx, { x: 0, y: a.y }, { x: W, y: a.y });
        tag(ctx, d.color, d.points[0].price.toFixed(2), W - 4, a.y, "right");
        break;
      }
      case "vline":
        line(ctx, { x: a.x, y: 0 }, { x: a.x, y: H });
        break;
      case "rect":
        if (b) {
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.14;
          ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.globalAlpha = isPreview ? 0.75 : 1;
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        }
        break;
      case "fib":
        if (b) {
          const [p1, p2] = d.points;
          const x1 = Math.min(a.x, b.x);
          const x2 = Math.max(a.x, b.x);
          let prevY: number | null = null;
          FIB_LEVELS.forEach((lv, i) => {
            const price = p2.price + (p1.price - p2.price) * lv;
            const y = this.series!.priceToCoordinate(price);
            if (y == null) return;
            if (prevY != null && i % 2 === 1) {
              ctx.globalAlpha = 0.07;
              ctx.fillRect(x1, Math.min(y, prevY), x2 - x1, Math.abs(y - prevY));
              ctx.globalAlpha = isPreview ? 0.75 : 1;
            }
            prevY = y;
            ctx.setLineDash(lv === 0 || lv === 1 ? [] : [4, 4]);
            line(ctx, { x: x1, y }, { x: x2, y });
            ctx.setLineDash([]);
            ctx.textAlign = "left";
            ctx.fillText(`${lv} (${price.toFixed(2)})`, x1 + 4, y - 3);
          });
          ctx.setLineDash([3, 4]);
          ctx.globalAlpha = 0.5;
          line(ctx, a, b);
        }
        break;
      case "measure":
        if (b) {
          const [p1, p2] = d.points;
          const dp = p2.price - p1.price;
          const bars = Math.round(this.map.timeToLogical(p2.time) - this.map.timeToLogical(p1.time));
          const col = dp >= 0 ? "#26a69a" : "#ef5350";
          ctx.fillStyle = col;
          ctx.strokeStyle = col;
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.15;
          ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.globalAlpha = isPreview ? 0.75 : 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.setLineDash([]);
          const pct = (dp / p1.price) * 100;
          tag(ctx, col, `${dp >= 0 ? "+" : ""}${dp.toFixed(2)} (${pct.toFixed(2)}%) · ${bars} bars`, (a.x + b.x) / 2, dp >= 0 ? Math.min(a.y, b.y) - 12 : Math.max(a.y, b.y) + 12, "center");
        }
        break;
      case "extended":
        if (b) {
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx === 0) line(ctx, { x: a.x, y: 0 }, { x: a.x, y: H });
          else { const k = (W + 2000) / Math.abs(dx); line(ctx, { x: a.x - dx * k, y: a.y - dy * k }, { x: a.x + dx * k, y: a.y + dy * k }); }
        }
        break;
      case "infoline":
      case "angle":
        if (b) {
          line(ctx, a, b);
          const [p1, p2] = d.points;
          const dp = p2.price - p1.price;
          const bars = Math.round(this.map.timeToLogical(p2.time) - this.map.timeToLogical(p1.time));
          const deg = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
          if (d.type === "angle") {
            ctx.setLineDash([3, 3]);
            line(ctx, a, { x: a.x + 60, y: a.y });
            ctx.beginPath();
            ctx.arc(a.x, a.y, 34, Math.min(0, -deg * Math.PI / 180), Math.max(0, -deg * Math.PI / 180));
            ctx.stroke();
            ctx.setLineDash([]);
            tag(ctx, d.color, `${deg.toFixed(1)}°`, a.x + 40, a.y - (deg >= 0 ? 12 : -12), "left");
          } else {
            tag(ctx, d.color, `${dp >= 0 ? "+" : ""}${dp.toFixed(2)} (${((dp / p1.price) * 100).toFixed(2)}%) · ${bars} bars · ${deg.toFixed(0)}°`, b.x + 8, b.y, "left");
          }
        }
        break;
      case "crossline":
        line(ctx, { x: 0, y: a.y }, { x: W, y: a.y });
        line(ctx, { x: a.x, y: 0 }, { x: a.x, y: H });
        tag(ctx, d.color, d.points[0].price.toFixed(2), W - 4, a.y, "right");
        break;
      case "arrow":
        if (b) {
          line(ctx, a, b);
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - 12 * Math.cos(ang - 0.4), b.y - 12 * Math.sin(ang - 0.4));
          ctx.lineTo(b.x - 12 * Math.cos(ang + 0.4), b.y - 12 * Math.sin(ang + 0.4));
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "fibext":
        if (c) {
          const [p1, p2, p3] = d.points;
          const move = p2.price - p1.price;
          ctx.setLineDash([3, 4]);
          ctx.globalAlpha = 0.5;
          line(ctx, a, b);
          line(ctx, b, c);
          ctx.globalAlpha = isPreview ? 0.75 : 1;
          const x1 = c.x, x2 = Math.max(c.x + 120, b.x + (c.x - a.x));
          for (const lv of FIB_EXT_LEVELS) {
            const price = p3.price + move * lv;
            const y = this.series!.priceToCoordinate(price);
            if (y == null) continue;
            ctx.setLineDash(lv === 0 || lv === 1 ? [] : [4, 4]);
            line(ctx, { x: x1, y }, { x: x2, y });
            ctx.setLineDash([]);
            ctx.textAlign = "left";
            ctx.fillText(`${lv} (${price.toFixed(2)})`, x1 + 4, y - 3);
          }
        } else if (b) line(ctx, a, b);
        break;
      case "abcd":
      case "xabcd":
      case "hs":
      case "elliott5":
      case "elliott3": {
        const P = pts as XY[];
        const names = d.type === "abcd" ? ["A", "B", "C", "D"] : d.type === "xabcd" ? ["X", "A", "B", "C", "D"]
          : d.type === "hs" ? ["", "LS", "", "Head", "", "RS", ""] : d.type === "elliott5" ? ["(0)", "(1)", "(2)", "(3)", "(4)", "(5)"] : ["(0)", "(A)", "(B)", "(C)"];
        if (d.type === "xabcd" || d.type === "abcd") {
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.12;
          for (let i = 0; i + 2 < P.length; i += 2) {
            ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[i + 1].x, P[i + 1].y); ctx.lineTo(P[i + 2].x, P[i + 2].y); ctx.closePath(); ctx.fill();
          }
          ctx.globalAlpha = isPreview ? 0.75 : 1;
        }
        ctx.beginPath();
        P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
        if (d.type === "hs" && P.length >= 7) { ctx.setLineDash([5, 4]); line(ctx, P[2], P[4]); ctx.setLineDash([]); }
        ctx.font = "600 12px Inter, sans-serif";
        ctx.textAlign = "center";
        P.forEach((q, i) => {
          if (!names[i]) return;
          const up = i === 0 ? q.y <= (P[1]?.y ?? q.y) : q.y <= P[i - 1].y;
          ctx.fillText(names[i], q.x, up ? q.y - 8 : q.y + 16);
        });
        break;
      }
      case "long":
      case "short":
        if (c) {
          const [pe, pt, ps] = d.points;
          const xe = a.x, x2 = Math.max(b.x, c.x, a.x + 20);
          const yt = b.y, ys = c.y;
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.22;
          ctx.fillStyle = "#26a69a"; ctx.fillRect(xe, Math.min(a.y, yt), x2 - xe, Math.abs(yt - a.y));
          ctx.fillStyle = "#ef5350"; ctx.fillRect(xe, Math.min(a.y, ys), x2 - xe, Math.abs(ys - a.y));
          ctx.globalAlpha = isPreview ? 0.75 : 1;
          ctx.strokeStyle = "#9aa6ad"; ctx.lineWidth = 1;
          line(ctx, { x: xe, y: a.y }, { x: x2, y: a.y });
          const tgt = Math.abs(pt.price - pe.price), stp = Math.abs(ps.price - pe.price);
          const mid = (xe + x2) / 2;
          tag(ctx, "#26a69a", `Target ${pt.price.toFixed(2)} (${tgt.toFixed(2)}, ${((tgt / pe.price) * 100).toFixed(2)}%)`, mid, yt + (d.type === "long" ? -12 : 12), "center");
          tag(ctx, "#ef5350", `Stop ${ps.price.toFixed(2)} (${stp.toFixed(2)}, ${((stp / pe.price) * 100).toFixed(2)}%)`, mid, ys + (d.type === "long" ? 12 : -12), "center");
          tag(ctx, "#cfd8dc", `${d.type === "long" ? "Long" : "Short"} ${pe.price.toFixed(2)} · R:R ${stp ? (tgt / stp).toFixed(2) : "—"}`, mid, a.y, "center");
        }
        break;
      case "pricerange":
      case "daterange":
        if (b) {
          const [p1, p2] = d.points;
          const dp = p2.price - p1.price;
          const bars = Math.round(this.map.timeToLogical(p2.time) - this.map.timeToLogical(p1.time));
          const col = "#4da3ff";
          ctx.fillStyle = col; ctx.strokeStyle = col;
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.15;
          ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.globalAlpha = isPreview ? 0.75 : 1;
          if (d.type === "pricerange") {
            line(ctx, { x: a.x, y: a.y }, { x: b.x, y: a.y }); line(ctx, { x: a.x, y: b.y }, { x: b.x, y: b.y });
            arrowV(ctx, (a.x + b.x) / 2, a.y, b.y);
            tag(ctx, col, `${dp >= 0 ? "+" : ""}${dp.toFixed(2)} (${((dp / p1.price) * 100).toFixed(2)}%)`, (a.x + b.x) / 2, Math.min(a.y, b.y) - 12, "center");
          } else {
            line(ctx, { x: a.x, y: a.y }, { x: a.x, y: b.y }); line(ctx, { x: b.x, y: a.y }, { x: b.x, y: b.y });
            const secs = Math.abs(p2.time - p1.time);
            const span = secs >= 86400 ? `${(secs / 86400).toFixed(1)}d` : secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m` : `${Math.round(secs / 60)}m`;
            tag(ctx, col, `${bars} bars · ${span}`, (a.x + b.x) / 2, Math.max(a.y, b.y) + 12, "center");
          }
        }
        break;
      case "circle":
        if (b) {
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.12; ctx.fill(); ctx.globalAlpha = isPreview ? 0.75 : 1; ctx.stroke();
        }
        break;
      case "ellipse":
        if (b) {
          ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
          ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.12; ctx.fill(); ctx.globalAlpha = isPreview ? 0.75 : 1; ctx.stroke();
        }
        break;
      case "triangle": {
        const P = pts as XY[];
        ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); if (P.length === 3) ctx.closePath();
        if (P.length === 3) { ctx.globalAlpha = (isPreview ? 0.75 : 1) * 0.12; ctx.fill(); ctx.globalAlpha = isPreview ? 0.75 : 1; }
        ctx.stroke();
        break;
      }
      case "callout":
        if (b) {
          line(ctx, a, b);
          ctx.font = "600 13px Inter, Vazirmatn, sans-serif";
          const txt = d.text ?? "";
          const w = ctx.measureText(txt).width + 16;
          ctx.fillStyle = d.color; ctx.fillRect(b.x - w / 2, b.y - 14, w, 28);
          ctx.fillStyle = "#0a0d13"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, b.x, b.y);
        }
        break;
      case "pricelabel":
        tag(ctx, d.color, d.points[0].price.toFixed(2), a.x + 6, a.y - 14, "left");
        ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
        break;
      case "arrowup":
      case "arrowdown": {
        const s = d.type === "arrowup" ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - 9, a.y + 12 * s); ctx.lineTo(a.x - 4, a.y + 12 * s); ctx.lineTo(a.x - 4, a.y + 24 * s);
        ctx.lineTo(a.x + 4, a.y + 24 * s); ctx.lineTo(a.x + 4, a.y + 12 * s); ctx.lineTo(a.x + 9, a.y + 12 * s); ctx.closePath();
        ctx.fill();
        break;
      }
      case "flag":
        ctx.lineWidth = 2;
        line(ctx, { x: a.x, y: a.y }, { x: a.x, y: a.y - 30 });
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 30); ctx.lineTo(a.x + 18, a.y - 24); ctx.lineTo(a.x, a.y - 18); ctx.closePath(); ctx.fill();
        break;
      case "text":
        ctx.font = "600 14px Inter, Vazirmatn, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(d.text ?? "", a.x, a.y);
        break;
    }
    if (selected) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      for (const p of pts as XY[]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Index of the control point within `r` px of (x, y), or -1. */
  handleAt(d: Drawing, x: number, y: number, r = 9): number {
    return d.points.findIndex((p) => {
      const q = this.toXY(p);
      return q != null && Math.hypot(q.x - x, q.y - y) <= r;
    });
  }

  /** Distance in px from (x, y) to the drawing, or Infinity. */
  distance(d: Drawing, x: number, y: number, W: number): number {
    const pts = d.points.map((p) => this.toXY(p));
    if (pts.some((p) => p == null)) return Infinity;
    const [a, b, c] = pts as XY[];
    switch (d.type) {
      case "hray": return x >= a.x - 6 ? Math.abs(y - a.y) : Infinity;
      case "channel": {
        if (!b) return Infinity;
        const d1 = segDist(x, y, a, b);
        if (!c) return d1;
        const dx = b.x - a.x;
        const yl = dx === 0 ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / dx;
        const off = c.y - yl;
        return Math.min(d1, segDist(x, y, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }));
      }
      case "trend": return segDist(x, y, a, b);
      case "ray": {
        const dx = b.x - a.x;
        const k = dx === 0 ? 0 : (W + 2000 - a.x) / dx;
        return segDist(x, y, a, dx === 0 ? b : { x: a.x + dx * k, y: a.y + (b.y - a.y) * k });
      }
      case "hline": return Math.abs(y - a.y);
      case "vline": return Math.abs(x - a.x);
      case "rect":
      case "measure":
      case "fib": {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        if (d.type !== "fib") {
          const inside = x >= x1 && x <= x2 && y >= y1 && y <= y2;
          return inside ? 0 : Math.min(segDist(x, y, { x: x1, y: y1 }, { x: x2, y: y1 }), segDist(x, y, { x: x1, y: y2 }, { x: x2, y: y2 }), segDist(x, y, { x: x1, y: y1 }, { x: x1, y: y2 }), segDist(x, y, { x: x2, y: y1 }, { x: x2, y: y2 }));
        }
        const [p1, p2] = d.points;
        let best = Infinity;
        for (const lv of FIB_LEVELS) {
          const yy = this.series!.priceToCoordinate(p2.price + (p1.price - p2.price) * lv);
          if (yy != null && x >= x1 - 6 && x <= x2 + 6) best = Math.min(best, Math.abs(y - yy));
        }
        return best;
      }
      case "text": return Math.hypot(x - a.x, y - a.y) < 40 ? 0 : Infinity;
      case "extended": {
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx === 0) return Math.abs(x - a.x);
        const k = (W + 2000) / Math.abs(dx);
        return segDist(x, y, { x: a.x - dx * k, y: a.y - dy * k }, { x: a.x + dx * k, y: a.y + dy * k });
      }
      case "crossline": return Math.min(Math.abs(y - a.y), Math.abs(x - a.x));
      case "circle": return Math.abs(Math.hypot(x - a.x, y - a.y) - Math.hypot(b.x - a.x, b.y - a.y));
      case "long":
      case "short": {
        const x2 = Math.max(b.x, c.x, a.x + 20), y1 = Math.min(b.y, c.y), y2 = Math.max(b.y, c.y);
        return x >= a.x && x <= x2 && y >= y1 && y <= y2 ? 0 : Infinity;
      }
      case "ellipse":
      case "pricerange":
      case "daterange": {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        return x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4 ? 0 : Infinity;
      }
      case "pricelabel":
      case "arrowup":
      case "arrowdown":
      case "flag": return Math.hypot(x - a.x, y - (d.type === "arrowdown" ? a.y - 12 : d.type === "pricelabel" ? a.y : a.y + (d.type === "flag" ? -15 : 12))) < 22 ? 0 : Infinity;
      case "callout": return Math.min(segDist(x, y, a, b), Math.hypot(x - b.x, y - b.y) < 30 ? 0 : Infinity);
      default: {
        // polylines: trend-like tools, patterns, waves, triangle, arrow, info/angle lines, fib extension legs
        const P = pts as XY[];
        let best = Infinity;
        for (let i = 0; i + 1 < P.length; i++) best = Math.min(best, segDist(x, y, P[i], P[i + 1]));
        if (d.type === "triangle" && P.length === 3) best = Math.min(best, segDist(x, y, P[2], P[0]));
        return best;
      }
    }
  }
}

function line(ctx: CanvasRenderingContext2D, a: XY, b: XY) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function tag(ctx: CanvasRenderingContext2D, color: string, text: string, x: number, y: number, align: CanvasTextAlign) {
  ctx.font = "12px Inter, Vazirmatn, sans-serif";
  const w = ctx.measureText(text).width + 12;
  const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  ctx.fillStyle = color;
  ctx.fillRect(left, y - 10, w, 20);
  ctx.fillStyle = "#0a0d13";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 6, y);
}

function arrowV(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number) {
  line(ctx, { x, y: y1 }, { x, y: y2 });
  const s = y2 > y1 ? 1 : -1;
  ctx.beginPath(); ctx.moveTo(x, y2); ctx.lineTo(x - 5, y2 - 8 * s); ctx.lineTo(x + 5, y2 - 8 * s); ctx.closePath(); ctx.fill();
}

function segDist(px: number, py: number, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
