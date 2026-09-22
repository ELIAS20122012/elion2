import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Kpis from "../components/Kpis";
import PageHeader from "../components/PageHeader";
import { equityCurve, summarize } from "../lib/analytics";
import { STRATEGIES, DEFAULT_SIM, asJournalTrades, runBacktest, type BacktestResult, type SimConfig } from "../lib/backtest";
import { TIMEFRAMES, aggregate, fmtDateTime } from "../lib/data";
import { journalApi } from "../lib/journalApi";
import { useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useNavigate } from "react-router-dom";

const TFS = TIMEFRAMES.filter((t) => t.sec <= 900);

export default function BacktestPage() {
  const app = useApp();
  const { setActive, refreshAccounts, status } = useJournal();
  const nav = useNavigate();
  const [sid, setSid] = useState("ema-cross");
  const strat = STRATEGIES.find((s) => s.id === sid)!;
  const [params, setParams] = useState<Record<string, number>>(() => Object.fromEntries(STRATEGIES.flatMap((s) => s.params.map((p) => [`${s.id}.${p.key}`, p.def]))));
  const [sim, setSim] = useState<SimConfig>(DEFAULT_SIM);
  const [tf, setTf] = useState(60);
  const [result, setResult] = useState<{ r: BacktestResult; name: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const candles = useMemo(() => aggregate(app.source.map((c) => ({ ...c })), tf), [app.source, tf]);
  const sp = (k: string) => params[`${sid}.${k}`];
  const stratParams = () => Object.fromEntries(strat.params.map((p) => [p.key, sp(p.key)]));

  const run = () => {
    setMsg(null);
    const r = runBacktest(candles, strat, stratParams(), sim);
    const label = strat.params.map((p) => sp(p.key)).join("/");
    setResult({ r, name: `بک‌تست — ${strat.name} (${label}) · ${TFS.find((t) => t.sec === tf)?.label ?? tf}` });
  };

  const jt = useMemo(() => (result ? asJournalTrades(result.r.trades) : []), [result]);
  const summary = useMemo(() => summarize(jt), [jt]);
  const curve = useMemo(() => equityCurve(jt, sim.initialBalance), [jt, sim.initialBalance]);

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const acc = await journalApi.createAccount({ name: result.name, platform: "other", kind: "backtest", initial_balance: sim.initialBalance, note: `${candles.length} کندل، ریسک ${sim.riskPct}%، اسپرد ${sim.spread}` });
      await journalApi.addTrades(acc.id, result.r.trades);
      await refreshAccounts();
      setActive(acc.id);
      setMsg({ ok: true, text: "به‌عنوان حساب بک‌تست ذخیره شد." });
      nav("/analysis");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setSaving(false);
  };

  const range = candles.length ? `${fmtDateTime(candles[0].time)} تا ${fmtDateTime(candles[candles.length - 1].time)}` : "—";

  return (
    <div className="page wide">
      <PageHeader title="بک‌تست" subtitle="یک استراتژی را روی کندل‌های موجود اجرا کنید. هر اجرا می‌تواند مثل یک حساب جدا ذخیره شود و همان ژورنال و آنالیز را داشته باشد." />

      <div className="two-col">
        <section className="card">
          <h3>۱. استراتژی</h3>
          <ul className="strat-list">
            {STRATEGIES.map((s) => (
              <li key={s.id}>
                <button className={`${sid === s.id ? "on" : ""}`} disabled={!s.ready} onClick={() => { setSid(s.id); setResult(null); }}>
                  <b>{s.name}</b>
                  <small>{s.description}</small>
                  {!s.ready && <span className="tag">منتظر آموزش</span>}
                </button>
              </li>
            ))}
          </ul>
          {strat.params.length > 0 && (
            <div className="params">
              {strat.params.map((p) => (
                <label key={p.key} className="field"><span>{p.label}</span>
                  <input type="number" step={p.step ?? 1} min={p.min ?? 0} value={sp(p.key)} dir="ltr" onChange={(e) => setParams((o) => ({ ...o, [`${sid}.${p.key}`]: Number(e.target.value) }))} />
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3>۲. داده و شبیه‌سازی</h3>
          <p className="muted small">داده: کندل‌های همین لحظه‌ی داشبورد ({app.mode === "live" ? "زنده MT5 — حدود یک هفته" : "بازپخش — داده‌ی ضبط‌شده"}). {candles.length} کندل، {range}</p>
          <div className="field"><span>تایم‌فریم</span><div className="seg">{TFS.map((t) => <button key={t.sec} className={tf === t.sec ? "on" : ""} onClick={() => setTf(t.sec)}>{t.label}</button>)}</div></div>
          <div className="params">
            <Num label="موجودی اولیه ($)" v={sim.initialBalance} on={(v) => setSim({ ...sim, initialBalance: v })} />
            <Num label="ریسک هر معامله (%)" v={sim.riskPct} step={0.1} on={(v) => setSim({ ...sim, riskPct: v })} />
            <Num label="اسپرد (قیمت)" v={sim.spread} step={0.05} on={(v) => setSim({ ...sim, spread: v })} />
            <Num label="کمیسیون هر لات ($)" v={sim.commissionPerLot} step={0.5} on={(v) => setSim({ ...sim, commissionPerLot: v })} />
            <Num label="اندازه‌ی قرارداد (واحد در ۱ لات)" v={sim.contractSize} on={(v) => setSim({ ...sim, contractSize: v })} />
          </div>
          <button className="btn primary wide" onClick={run} disabled={candles.length < 50 || !strat.ready}>▶ اجرای بک‌تست</button>
          {candles.length < 50 && <p className="muted small">داده کافی نیست (حداقل ۵۰ کندل). در حالت زنده منتظر اتصال MT5 باشید یا «بازپخش» را انتخاب کنید.</p>}
        </section>
      </div>

      {result && (
        <>
          <div className="notice">
            <b>هشدار:</b> بک‌تست فرضیات ساده دارد (ورود در باز شدن کندل بعد، اسپرد ثابت، در تداخل SL و TP یک کندل فرض بر خوردن حد ضرر) و روی داده‌ی کوتاه است. نتیجه فقط برای مقایسه‌ی روش‌هاست، نه اثبات سودآوری.
            {result.r.trades.length === 0 && " در این داده هیچ سیگنالی پیدا نشد."}
          </div>
          <Kpis s={summary} full />
          {curve.length > 0 && (
            <section className="card">
              <h3>منحنی سرمایه <small className="muted">({result.r.trades.length} معامله، {result.r.skipped} سیگنال رد شد چون معامله باز بود)</small></h3>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={curve} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="time" tickFormatter={(t: number) => fmtDateTime(t).slice(5, 10)} stroke="var(--muted)" fontSize={11} minTickGap={40} />
                    <YAxis stroke="var(--muted)" fontSize={11} orientation="right" width={56} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: "#161b26", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelFormatter={(t) => fmtDateTime(t as number)} formatter={(v: number) => [v.toFixed(2), "سرمایه"]} />
                    <Area isAnimationActive={false} type="monotone" dataKey="equity" stroke="var(--gold)" fill="var(--gold-soft)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
          <div className="card toolbar-card">
            <div className="tb-info"><b>ذخیره‌ی نتیجه</b><span className="muted small">به‌صورت یک حساب «بک‌تست» جدا ذخیره می‌شود و در ژورنال و آنالیز قابل مشاهده است.</span></div>
            <div className="tb-actions"><button className="btn primary" onClick={save} disabled={saving || status !== "ok" || result.r.trades.length === 0}>ذخیره و رفتن به آنالیز</button></div>
            {status !== "ok" && <p className="err">برای ذخیره، سرور ژورنال باید روشن باشد.</p>}
            {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function Num({ label, v, on, step = 1 }: { label: string; v: number; on: (v: number) => void; step?: number }) {
  return <label className="field"><span>{label}</span><input type="number" value={v} step={step} dir="ltr" onChange={(e) => on(Number(e.target.value))} /></label>;
}

