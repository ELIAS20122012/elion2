import { useState } from "react";
import Chart from "../components/Chart";
import DrawToolbar from "../components/DrawToolbar";
import DrawingProps from "../components/DrawingProps";
import IndicatorsBar from "../components/IndicatorsBar";
import TradesTable from "../components/TradesTable";
import TradingViewWidget from "../components/TradingViewWidget";
import { RULES, STATUS_LABEL } from "../lib/rules";
import { SPEEDS } from "../lib/useReplay";
import { SYMBOL, useApp } from "../state/AppContext";

const TV_INTERVAL: Record<number, string> = { 60: "1", 300: "5", 900: "15", 1800: "30", 3600: "60", 14400: "240" };

export default function ChartPage() {
  const s = useApp();
  const [view, setView] = useState<"bot" | "tv">("bot");
  const [dock, setDock] = useState(true);
  const { live, replay, mode, source, selected } = s;

  return (
    <div className={`chart-page ${dock ? "" : "no-dock"}`}>
      <section className="card chart-card">
        <div className="viewtabs" role="tablist">
          <button role="tab" aria-selected={view === "bot"} className={view === "bot" ? "on" : ""} onClick={() => setView("bot")}>چارت ربات (داده‌ی MT5)</button>
          <button role="tab" aria-selected={view === "tv"} className={view === "tv" ? "on" : ""} onClick={() => setView("tv")}>TradingView</button>
          {view === "tv" && <span className="muted small">قیمت از TradingView است (OANDA)، نه بروکر شما · رسم‌ها ذخیره نمی‌شوند</span>}
          <button className="dock-toggle" onClick={() => setDock((d) => !d)} title={dock ? "بستن پنل کناری" : "باز کردن پنل کناری"} aria-label="پنل کناری">
            {dock ? "⟩" : "⟨"}
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
              trades={s.trades}
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
              {live.account ? `${live.account.server} · ${live.account.symbol} · موجودی ${live.account.balance?.toFixed(2)}$` : "—"}
            </span>
            <span className="muted" style={{ marginInlineStart: "auto" }}>فقط خواندنی — هیچ سفارشی ارسال نمی‌شود</span>
          </div>
        ) : (
          <div className="replay">
            <button className="btn primary" onClick={replay.toggle} aria-label={replay.playing ? "توقف" : "پخش"}>
              {replay.done ? "↺ از اول" : replay.playing ? "⏸ توقف" : "▶ پخش"}
            </button>
            <button className="btn" onClick={replay.stepCandle} disabled={replay.done}>کندل بعدی ⏭</button>
            <button className="btn" onClick={replay.reset}>↺</button>
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
            <h3>لایه‌های قوانین</h3>
            <p className="muted small">هر قانون بعد از آموزش و تأیید شما روشن می‌شود.</p>
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
          </section>

          <section className="card">
            <h3>وضعیت ستاپ لول</h3>
            <div className="status-empty">
              <span className="dot" /> موتور تشخیص هنوز فعال نیست
            </div>
            <p className="muted small">بعد از آموزش قوانین، اینجا مرحله‌ی فعلی ستاپ و دلیل هر تصمیم نمایش داده می‌شود.</p>
          </section>

          <section className="card stats">
            <h3>آمار معاملات</h3>
            <div className="grid">
              <div><span>معاملات بسته</span><b>{s.closed.length}</b></div>
              <div><span>نرخ برد</span><b>{s.closed.length ? Math.round((s.wins / s.closed.length) * 100) : 0}%</b></div>
              <div><span>سود/زیان</span><b className={s.net >= 0 ? "up" : "down"} dir="ltr">{s.net >= 0 ? "+" : ""}{s.net.toFixed(2)}$</b></div>
            </div>
          </section>
        </aside>
      )}

      <section className="card trades">
        <h3>معاملات <small className="muted">({s.visibleTrades.length})</small></h3>
        <TradesTable trades={s.visibleTrades} lastTime={s.last?.time ?? 0} />
      </section>
    </div>
  );
}
