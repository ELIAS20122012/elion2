import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { uid } from "../lib/drawings";
import { useChartShift } from "../lib/prefs";
import Chart from "../components/Chart";
import DrawToolbar from "../components/DrawToolbar";
import DrawingProps from "../components/DrawingProps";
import IndicatorsBar from "../components/IndicatorsBar";
import TradingViewWidget from "../components/TradingViewWidget";
import Icon from "../components/Icon";
import { TIMEFRAMES, type Trade } from "../lib/data";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";
import { useDivergence } from "../state/useDivergence";
import { SPEEDS } from "../lib/useReplay";
import { SYMBOL, useApp } from "../state/AppContext";

const TV_INTERVAL: Record<number, string> = { 60: "1", 300: "5", 900: "15", 1800: "30", 3600: "60", 14400: "240" };

/** The chart on its own page. Rule settings live on the rules page; only quick switches and navigation stay here. */
export default function ChartPage() {
  const s = useApp();
  const [view, setView] = useState<"bot" | "tv">("bot");
  const { live, replay, mode, source, selected } = s;
  const [shift, setShift] = useChartShift();

  // In live mode the chart shows the REAL positions of every connected account (refreshed every few seconds).
  // In replay mode it keeps the recorded trades that belong to the recorded candles.
  const j = useJournal();
  const rows = useAllAccounts(j.accounts, j.status === "ok" && mode === "live", 4000);
  const chartTrades = useMemo<Trade[]>(
    () =>
      mode === "live"
        ? rows
            .filter((r) => r.account.kind !== "backtest")
            .flatMap((r) => r.trades)
            .filter((t) => t.symbol.toUpperCase().startsWith("XAU"))
            .map((t) => ({
              ticket: t.ticket, symbol: t.symbol, direction: t.direction, volume: t.volume,
              open_time: t.open_time, open_price: t.open_price, close_time: t.close_time, close_price: t.close_price,
              stop_loss: t.sl, take_profit: t.tp, profit: +(t.profit + t.commission + t.swap).toFixed(2), status: t.close_time ? "closed" : "open",
            }))
        : s.trades,
    [mode, rows, s.trades],
  );

  /* ---- rule 1: divergence (settings on the rules page) ---- */
  const { on: divOn, closedBars, divs, overlay } = useDivergence();

  // step through what the rule found, newest first
  const [divCursor, setDivCursor] = useState(0);
  const [focus, setFocus] = useState<{ time: number; nonce: number } | null>(null);
  const newest = useMemo(() => [...divs].reverse(), [divs]);
  const goto = (k: number) => {
    if (newest.length === 0) return;
    const i = ((k % newest.length) + newest.length) % newest.length;
    setDivCursor(i);
    setFocus({ time: closedBars[newest[i].b.i].time, nonce: Date.now() });
  };
  // when the layer is switched on (or the timeframe changes) show the newest one straight away
  useEffect(() => {
    if (divOn && newest.length) goto(0);
  }, [divOn, s.tfSec, newest.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // the rule compares against the MT5 MACD, so make sure that pane exists while the layer is on
  useEffect(() => {
    if (divOn && !s.indicators.some((i) => i.id === "macd")) {
      s.setIndicators([...s.indicators, { uid: uid(), id: "macd", params: { fast: 12, slow: 26, sig: 9 }, visible: true }]);
    }
  }, [divOn, s.indicators]); // eslint-disable-line react-hooks/exhaustive-deps

  const nHigh = divs.filter((d) => d.side === "high").length;
  const nLow = divs.length - nHigh;

  return (
    <div className="chart-page">
      <section className="card chart-card">
        <div className="chart-head mt5-bar">
          {view === "bot" && (
            <div className="seg tf" role="group" aria-label="تایم‌فریم" dir="ltr">
              {TIMEFRAMES.map((t) => (
                <button key={t.sec} className={s.tfSec === t.sec ? "on" : ""} onClick={() => s.setTfSec(t.sec)}>{t.label}</button>
              ))}
            </div>
          )}
          {view === "bot" && (
            <>
              <span className="sep" />
              <button className={`tb ${shift ? "on" : ""}`} onClick={() => setShift(!shift)} aria-pressed={shift} title="Chart shift — فاصله‌ی خالی سمت راست آخرین کندل (مثل MT5)">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 15V5M3 10h8M8 6l4 4-4 4" /><path d="M17 4v12" strokeDasharray="2 2" />
                </svg>
              </button>
              <span className="sep" />
              <label className="chip-switch" title="نمایش ورود و خروج معاملات روی چارت">
                <input type="checkbox" checked={!!s.layers.trades} onChange={(e) => s.setLayers({ ...s.layers, trades: e.target.checked })} />
                <span>معاملات</span>
              </label>
              <label className="chip-switch" title="نمایش دایورجنس‌ها روی چارت">
                <input type="checkbox" checked={divOn} onChange={(e) => s.setLayers({ ...s.layers, divergence: e.target.checked })} />
                <span>دایورجنس</span>
              </label>
              {divOn && (
                <div className="stepper" aria-label="پیمایش دایورجنس‌ها">
                  {divs.length > 0 ? (
                    <>
                      <button className="btn sm" onClick={() => goto(divCursor + 1)} aria-label="قدیمی‌تر">قدیمی‌تر</button>
                      <span dir="ltr">{divCursor + 1} / {divs.length}</span>
                      <button className="btn sm" onClick={() => goto(divCursor - 1)} aria-label="جدیدتر">جدیدتر</button>
                      <button className="btn sm primary" onClick={() => goto(0)}>آخرین</button>
                      <span className="muted small">نارنجی (سقف) {nHigh} · سبز (کف) {nLow}</span>
                    </>
                  ) : (
                    <span className="muted small">
                      روی این تایم‌فریم دایورجنسی پیدا نشد — <Link to="/rules">تنظیمات قانون را ببینید</Link>
                    </span>
                  )}
                </div>
              )}
              <Link className="btn sm" to="/rules" style={{ marginInlineStart: "auto" }}>تنظیمات قوانین ←</Link>
            </>
          )}
          <div className="viewtabs" role="tablist" style={view === "bot" ? undefined : { marginInlineStart: 0 }}>
            <button role="tab" aria-selected={view === "bot"} className={view === "bot" ? "on" : ""} onClick={() => setView("bot")}>MT5</button>
            <button role="tab" aria-selected={view === "tv"} className={view === "tv" ? "on" : ""} onClick={() => setView("tv")}>TradingView</button>
          </div>
          {view === "tv" && <span className="muted small">قیمت از TradingView است (OANDA)، نه بروکر شما · رسم‌ها ذخیره نمی‌شوند</span>}
        </div>

        {view === "tv" && (
          <div className="chart-area tv">
            <TradingViewWidget symbol={`OANDA:${SYMBOL}`} interval={TV_INTERVAL[s.tfSec] ?? "1"} />
          </div>
        )}

        {view === "bot" && (
          <IndicatorsBar items={s.indicators} onChange={s.setIndicators} volume={s.showVolume} hasVolume={source[0]?.volume != null} onVolume={() => s.setShowVolume((v) => !v)} />
        )}
        <div className="chart-area" hidden={view !== "bot"}>
          {selected && (
            <DrawingProps
              drawing={selected}
              onChange={(p) => s.updateDrawing(selected.id, p)}
              onDuplicate={() => s.duplicateDrawing(selected.id)}
              onDelete={() => s.removeDrawing(selected.id)}
            />
          )}
          <DrawToolbar
            tool={s.tool}
            onTool={s.setTool}
            magnet={s.magnet}
            onMagnet={() => s.setMagnet((m) => !m)}
            color={s.color}
            onColor={s.setColor}
            hasSelection={!!s.selectedId}
            count={s.drawings.length}
            onDeleteSelected={() => s.selectedId && s.removeDrawing(s.selectedId)}
            onUndo={() => s.setDrawings((d) => d.slice(0, -1))}
            onClear={() => {
              if (window.confirm("همه‌ی رسم‌ها پاک شوند؟")) s.setDrawings([]);
            }}
          />
          {source.length === 0 ? (
            <div className="loading">
              {mode === "live"
                ? live.status === "live" ? "در حال دریافت کندل‌ها…" : "در انتظار پل MT5 — start-live.bat را اجرا کنید"
                : "در حال بارگذاری…"}
            </div>
          ) : (
            <Chart
              candles={s.bars}
              tfSec={s.tfSec}
              trades={chartTrades}
              showTrades={!!s.layers.trades}
              overlay={overlay}
              focus={focus}
              shift={shift}
              indicators={s.indicators}
              drawings={s.drawings}
              tool={s.tool}
              magnet={s.magnet}
              color={s.color}
              selectedId={s.selectedId}
              onAdd={(d) => s.setDrawings((l) => [...l, d])}
              onSelect={s.setSelectedId}
              onDelete={s.removeDrawing}
              onTool={s.setTool}
              onUpdate={s.updateDrawing}
              onDuplicate={s.duplicateDrawing}
              onClearDrawings={() => s.setDrawings([])}
              showVolume={s.showVolume}
            />
          )}
        </div>

        {view !== "bot" ? null : mode === "live" ? (
          <div className="replay">
            <span className="muted">
              {live.account?.login ? `${live.account.server} · ${live.account.symbol} · موجودی ${live.account.balance != null ? `${live.account.balance.toFixed(2)}$` : "—"}` : "—"}
            </span>
            <span className="muted" style={{ marginInlineStart: "auto" }}>فقط خواندنی — هیچ سفارشی ارسال نمی‌شود</span>
          </div>
        ) : (
          <div className="replay">
            <button className="btn primary" onClick={replay.toggle} aria-label={replay.playing ? "توقف" : "پخش"}>
              <Icon name={replay.done ? "reset" : replay.playing ? "pause" : "play"} size={16} />
              {replay.done ? "از اول" : replay.playing ? "توقف" : "پخش"}
            </button>
            <button className="btn" onClick={replay.stepCandle} disabled={replay.done}><Icon name="step" size={16} />کندل بعدی</button>
            <button className="btn icon" onClick={replay.reset} aria-label="از اول" title="از اول"><Icon name="reset" size={16} /></button>
            <div className="speeds" dir="ltr">
              {SPEEDS.map((v) => (
                <button key={v} className={replay.speed === v ? "on" : ""} onClick={() => replay.setSpeed(v)}>{v}x</button>
              ))}
            </div>
            <div className="bar" title="پیشرفت بازپخش"><i style={{ width: `${replay.progress * 100}%` }} /></div>
            <span className="muted">داده‌ی ضبط‌شده · ۱۸ سپتامبر ۲۰۲۶</span>
          </div>
        )}
      </section>
    </div>
  );
}
