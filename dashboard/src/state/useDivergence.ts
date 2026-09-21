import { useMemo } from "react";
import { detectDivergences } from "../lib/detectors/divergence";
import type { Overlay, OverlayLine, OverlayMarker } from "../lib/data";
import { useDivParams } from "../lib/prefs";
import { useApp } from "./AppContext";

/**
 * Rule 1 (divergence between price and the default MT5 MACD): the detection and the drawing instructions.
 * The chart page draws `overlay`; the rules page edits the parameters. Both read the same stored settings.
 */
export function useDivergence() {
  const s = useApp();
  const [divP, setDivP] = useDivParams();
  const on = !!s.layers.divergence;
  // only CLOSED candles: the forming candle would make a result flip while it is still moving
  const closedBars = useMemo(() => s.bars.slice(0, -1), [s.bars.length, s.bars[0]?.time, s.tfSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const analysis = useMemo(() => (on ? detectDivergences(closedBars, divP) : null), [on, closedBars, divP]);
  const divs = useMemo(() => analysis?.divergences ?? [], [analysis]);

  const overlay = useMemo<Overlay>(() => {
    const lines: OverlayLine[] = [];
    const markers: OverlayMarker[] = [];
    for (const d of divs) {
      const hi = d.side === "high";
      const color = hi ? "#ff9d3d" : "#2ee6a6"; // orange = highs (uptrend), green = lows (downtrend)
      const A = closedBars[d.a.i];
      const B = closedBars[d.b.i];
      const ma = closedBars[d.a.mi];
      const mb = closedBars[d.b.mi];
      const id = `div-${d.side}-${d.a.i}-${d.b.i}`;
      lines.push({ id: `${id}-price`, pane: "price", color, width: 2, points: [{ time: A.time, value: d.a.price }, { time: B.time, value: d.b.price }] });
      const [t1, t2] = ma.time < mb.time ? [ma.time, mb.time] : [A.time, B.time]; // times must be strictly increasing
      lines.push({ id: `${id}-macd`, pane: "macd", color, width: 2, points: [{ time: t1, value: d.a.macd }, { time: t2, value: d.b.macd }] });
      const position = hi ? "aboveBar" : "belowBar";
      markers.push({ time: A.time, position, shape: "circle", color });
      markers.push({ time: B.time, position, shape: hi ? "arrowDown" : "arrowUp", color, text: hi ? "دایورجنس سقف" : "دایورجنس کف" });
      markers.push({ time: closedBars[d.cross].time, position, shape: "square", color, text: "کراس" }); // formed here
    }
    return { lines, markers };
  }, [divs, closedBars]);

  return { divP, setDivP, on, closedBars, analysis, divs, overlay };
}
