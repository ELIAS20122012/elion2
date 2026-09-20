import { useEffect, useMemo, useState } from "react";
import { detectDivergences, MACD_DEFAULT } from "../lib/detectors/divergence";
import { uid } from "../lib/drawings";
import { useDivParams } from "../lib/prefs";
import Chart from "../components/Chart";
import DrawToolbar from "../components/DrawToolbar";
import DrawingProps from "../components/DrawingProps";
import IndicatorsBar from "../components/IndicatorsBar";
import TradesTable from "../components/TradesTable";
import TradingViewWidget from "../components/TradingViewWidget";
import Icon from "../components/Icon";
import { TIMEFRAMES, type Overlay, type OverlayLine, type OverlayMarker, type Trade } from "../lib/data";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";
import { LAYERS, RULES, STATUS_LABEL } from "../lib/rules";
import { SPEEDS } from "../lib/useReplay";
import { SYMBOL, useApp } from "../state/AppContext";

const TV_INTERVAL: Record<number, string> = { 60: "1", 300: "5", 900: "15", 1800: "30", 3600: "60", 14400: "240" };

export default function ChartPage() {
  const s = useApp();
  const [view, setView] = useState<"bot" | "tv">("bot");
  const [dock, setDock] = useState(true);
  const { live, replay, mode, source, selected } = s;

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
  /* ---- rule: regular divergence on the highs (drawn only while its layer is on) ---- */
  const [divP, setDivP] = useDivParams();
  const divOn = !!s.layers.divergence;
  // only CLOSED candles: the forming candle would make a result flip while it is still moving
  const closedBars = useMemo(() => s.bars.slice(0, -1), [s.bars.length, s.bars[0]?.time, s.tfSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const analysis = useMemo(() => (divOn ? detectDivergences(closedBars, divP) : null), [divOn, closedBars, divP]);
  const divs = useMemo(() => analysis?.divergences ?? [], [analysis]);
  const divOverlay = useMemo<Overlay>(() => {
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
    }
    return { lines, markers };
  }, [divs, closedBars]);

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

  // stats and table follow the same source as the markers on the chart
  const tableTrades = useMemo(
    () => (mode === "live" ? [...chartTrades].sort((a, b) => b.open_time - a.open_time).slice(0, 30) : s.visibleTrades),
    [mode, chartTrades, s.visibleTrades],
  );
  const stats = useMemo(() => {
    const pool = mode === "live" ? chartTrades : s.visibleTrades;
    const closed = pool.filter((t) => t.close_time && t.close_time <= (s.last?.time ?? Number.MAX_SAFE_INTEGER));
    return { closed: closed.length, wins: closed.filter((t) => (t.profit ?? 0) > 0).length, net: closed.reduce((a, t) => a + (t.profit ?? 0), 0) };
  }, [mode, chartTrades, s.visibleTrades, s.last?.time]);

  return (
    <div className={`chart-page ${dock ? "" : "no-dock"}`}>
      <section className="card chart-card">
        <div className="chart-head">
          <div className="viewtabs" role="tablist">
            <button role="tab" aria-selected={view === "bot"} className={view === "bot" ? "on" : ""} onClick={() => setView("bot")}>چارت ربات (داده‌ی MT5)</button>
            <button role="tab" aria-selected={view === "tv"} className={view === "tv" ? "on" : ""} onClick={() => setView("tv")}>TradingView</button>
            {view === "tv" && <span className="muted small">قیمت از TradingView است (OANDA)، نه بروکر شما · رسم‌ها ذخیره نمی‌شوند</span>}
          </div>
          {view === "bot" && (
            <div className="seg" role="group" aria-label="تایم‌فریم">
              {TIMEFRAMES.map((t) => (
                <button key={t.sec} className={s.tfSec === t.sec ? "on" : ""} onClick={() => s.setTfSec(t.sec)}>{t.label}</button>
              ))}
            </div>
          )}
          <button className="dock-toggle" onClick={() => setDock((d) => !d)} title={dock ? "بستن پنل کناری" : "باز کردن پنل کناری"} aria-label="پنل کناری">
            <Icon name={dock ? "chevron-right" : "chevron-left"} size={16} />
          </button>
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
              overlay={divOverlay}
              focus={focus}
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

      {dock && (
        <aside className="side">
          <section className="card">
            <h3>لایه‌ها</h3>
            <ul className="rules">
              {LAYERS.map((l) => (
                <li key={l.id}>
                  <div>
                    <b>{l.title}</b>
                    <small>{l.hint}</small>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={!!s.layers[l.id]} onChange={(e) => s.setLayers({ ...s.layers, [l.id]: e.target.checked })} />
                    <span />
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h3>قوانین</h3>
            {RULES.length === 0 ? (
              <>
                <div className="status-empty"><span className="dot" /> هنوز قانونی تعریف نشده</div>
                <p className="muted small">هر قانون را که برایم توضیح دهید، همین‌جا با وضعیتش اضافه می‌شود و روی چارت کشیده می‌شود.</p>
              </>
            ) : (
              <ul className="rules">
                {RULES.map((r) => (
                  <li key={r.id} className={r.ready ? "" : "locked"}>
                    <div>
                      <b>{r.title}</b>
                      <small>{r.hint}</small>
                    </div>
                    {r.ready ? (
                      <label className="switch">
                        <input type="checkbox" checked={!!s.layers[r.id]} onChange={(e) => s.setLayers({ ...s.layers, [r.id]: e.target.checked })} />
                        <span />
                      </label>
                    ) : (
                      <span className="tag">{STATUS_LABEL[r.status]}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {divOn && (
              <div className="rule-detail">
                <p className="found">
                  <b>{divs.length}</b> دایورجنس روی همین نمودار پیدا شد
                  <small className="muted"> — سقف (نارنجی): {divs.filter((d) => d.side === "high").length} · کف (سبز): {divs.filter((d) => d.side === "low").length}</small>
                </p>
                {divs.length > 0 ? (
                  <div className="stepper">
                    <button className="btn sm" onClick={() => goto(divCursor + 1)} aria-label="قدیمی‌تر">قدیمی‌تر</button>
                    <span dir="ltr">{divCursor + 1} / {divs.length}</span>
                    <button className="btn sm" onClick={() => goto(divCursor - 1)} aria-label="جدیدتر">جدیدتر</button>
                    <button className="btn sm primary" onClick={() => goto(0)}>آخرین</button>
                  </div>
                ) : (
                  <p className="muted small">روی این تایم‌فریم چیزی پیدا نشد. تایم‌فریم دیگری را امتحان کنید (M1، M5، M15).</p>
                )}
                <ul className="basis">
                  <li><span className="src you">از شما</span>مکدی پیش‌فرض MT5 ({MACD_DEFAULT.fast}, {MACD_DEFAULT.slow}, {MACD_DEFAULT.signal})</li>
                  <li><span className="src you">از شما</span>سقف (روند صعودی): قیمت دو سقف، دومی بالاتر · مکدی دو سقف، دومی پایین‌تر</li>
                  <li><span className="src you">از شما</span>کف (روند نزولی): قیمت دو کف، دومی پایین‌تر · مکدی دو کف، دومی بالاتر</li>
                  <li><span className="src you">از شما</span>هر سقف/کف قیمت باید یک سقف/کف مکدی هم کنارش داشته باشد (تناسب)</li>
                </ul>
                <div className="assume">
                  <span className="src guess">فرض من — اصلاح کنید</span>
                  <label className="check">
                    <input type="checkbox" checked={divP.high} onChange={(e) => setDivP({ ...divP, high: e.target.checked })} /> سقف‌ها (نارنجی)
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={divP.low} onChange={(e) => setDivP({ ...divP, low: e.target.checked })} /> کف‌ها (سبز)
                  </label>
                  <label>مکدی «سقف/کف» دارد یعنی حداکثر این تعداد کندل با سقف/کف قیمت فاصله داشته باشد
                    <input type="number" min={0} max={20} value={divP.tol} dir="ltr" onChange={(e) => setDivP({ ...divP, tol: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                  <label>«سقف» یعنی قله‌ای که از این تعداد کندل هر طرف بالاتر باشد (کف: برعکس)
                    <input type="number" min={1} max={10} value={divP.n} dir="ltr" onChange={(e) => setDivP({ ...divP, n: Math.max(1, Number(e.target.value) || 1) })} />
                  </label>
                  <label>دو سقف حداکثر چند کندل از هم فاصله داشته باشند
                    <input type="number" min={3} max={1000} value={divP.maxGap} dir="ltr" onChange={(e) => setDivP({ ...divP, maxGap: Math.max(3, Number(e.target.value) || 3) })} />
                  </label>
                  <small className="muted">سقف مکدی = نقطه‌ای که از کندل قبل و بعدش بالاتر است (کف: برعکس). فقط کندل‌های بسته حساب می‌شوند تا نتیجه بعداً عوض نشود.</small>
                </div>
              </div>
            )}
          </section>

          <section className="card stats">
            <h3>آمار معاملات</h3>
            <div className="grid">
              <div><span>معاملات بسته</span><b>{stats.closed}</b></div>
              <div><span>نرخ برد</span><b>{stats.closed ? Math.round((stats.wins / stats.closed) * 100) : 0}%</b></div>
              <div><span>سود/زیان</span><b className={stats.net >= 0 ? "up" : "down"} dir="ltr">{stats.net >= 0 ? "+" : ""}{stats.net.toFixed(2)}$</b></div>
            </div>
          </section>
        </aside>
      )}

      <section className="card trades">
        <h3>{mode === "live" ? "معاملات واقعی (آخرین ۳۰ تا)" : "معاملات ضبط‌شده"} <small className="muted">({tableTrades.length})</small></h3>
        <TradesTable trades={tableTrades} lastTime={s.last?.time ?? Number.MAX_SAFE_INTEGER} />
      </section>
    </div>
  );
}
