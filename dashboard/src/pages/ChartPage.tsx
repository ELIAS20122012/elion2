import { useMemo, useState } from "react";
import Chart from "../components/Chart";
import DrawToolbar from "../components/DrawToolbar";
import DrawingProps from "../components/DrawingProps";
import IndicatorsBar from "../components/IndicatorsBar";
import TradesTable from "../components/TradesTable";
import TradingViewWidget from "../components/TradingViewWidget";
import Icon from "../components/Icon";
import { TIMEFRAMES, type Trade } from "../lib/data";
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
              overlay={s.overlay}
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
