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
import { FIB_LEVELS, TimeMap, type Drawing, type DPoint } from "../lib/drawings";

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
      const list = this.preview ? [...this.drawings, this.preview] : this.drawings;
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

function segDist(px: number, py: number, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
