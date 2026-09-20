import { useCallback, useEffect, useMemo, useState } from "react";
import type { Candle } from "./data";

export const SPEEDS = [1, 2, 5, 10, 30] as const;

/** Path a candle takes while forming: open -> first extreme -> second extreme -> close. */
function path(c: Candle): number[] {
  return c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
}

function forming(c: Candle, stage: number): Candle {
  const pts = path(c).slice(0, stage);
  return {
    time: c.time,
    open: c.open,
    high: Math.max(...pts),
    low: Math.min(...pts),
    close: pts[pts.length - 1],
  };
}

/**
 * Replays recorded M1 candles as if they were arriving live (4 ticks per candle).
 * This is the stand-in for the MT5 feed until the live connection exists.
 */
export function useReplay(all: Candle[], startAt = 150) {
  const [pos, setPos] = useState(startAt); // index of the candle currently forming
  const [stage, setStage] = useState(4); // 1..4 ticks of that candle received
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(5);

  const done = pos >= all.length - 1 && stage >= 4;

  const tick = useCallback(() => {
    if (all.length === 0) return;
    if (stage < 4) return setStage(stage + 1);
    if (pos < all.length - 1) {
      setPos(pos + 1);
      setStage(1);
    } else {
      setPlaying(false);
    }
  }, [all.length, pos, stage]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(tick, 250 / speed);
    return () => clearInterval(id);
  }, [playing, speed, tick]);

  const candles = useMemo(() => {
    if (all.length === 0) return [];
    const head = all.slice(0, pos);
    return [...head, forming(all[pos], stage)];
  }, [all, pos, stage]);

  const stepCandle = () => {
    setPlaying(false);
    if (stage < 4) return setStage(4);
    if (pos < all.length - 1) {
      setPos(pos + 1);
      setStage(4);
    }
  };
  const reset = () => {
    setPlaying(false);
    setPos(startAt);
    setStage(4);
  };

  return {
    candles,
    playing,
    speed,
    done,
    progress: all.length ? pos / (all.length - 1) : 0,
    toggle: () => (done ? reset() : setPlaying((p) => !p)),
    setSpeed,
    stepCandle,
    reset,
  };
}
