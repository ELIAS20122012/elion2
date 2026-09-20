import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AccountBar, { BackendGate } from "../components/AccountBar";
import Kpis from "../components/Kpis";
import PageHeader from "../components/PageHeader";
import { byDay, byDuration, byHour, byTag, byWeekday, equityCurve, excursions, isClosed, money, summarize, type Bucket } from "../lib/analytics";
import { fmtDateTime } from "../lib/data";
import type { JTrade } from "../lib/journalApi";
import { useJournal } from "../state/JournalContext";

const AXIS = { stroke: "#8a93a6", fontSize: 11 };
const GRID = "rgba(255,255,255,0.06)";
const TIP = { contentStyle: { background: "#161b26", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, direction: "rtl" as const }, labelStyle: { color: "#e6e9ef" } };

export default function AnalysisPage() {
  return (
    <div className="page wide">
      <PageHeader title="آنالیز" subtitle="آمار و الگوهای رفتاری هر حساب، جدا از حساب‌های دیگر. اعداد فقط توصیف داده‌اند، نه قانون." />
      <BackendGate>
        <AccountBar />
        <Body />
      </BackendGate>
    </div>
  );
}

function Body() {
  const { accounts, active, trades } = useJournal();
  const [maxPerDay, setMaxPerDay] = useState(3);
  const closed = useMemo(() => trades.filter(isClosed), [trades]);
  const s = useMemo(() => summarize(trades), [trades]);
  const curve = useMemo(() => equityCurve(trades, active?.initial_balance ?? 0), [trades, active?.initial_balance]);
  const days = useMemo(() => byDay(trades, maxPerDay), [trades, maxPerDay]);

  if (accounts.length === 0) return <div className="card empty-state"><h3>هنوز حسابی نیست</h3><p className="muted">ابتدا از صفحه‌ی «ژورنال» یک حساب بسازید.</p></div>;
  if (!active) return null;
  if (closed.length === 0) return <div className="card empty-state"><h3>برای «{active.name}» معامله‌ی بسته‌ای نیست</h3><p className="muted">از صفحه‌ی «ژورنال» معاملات را همگام‌سازی یا وارد کنید تا آنالیز ساخته شود.</p></div>;

  const hours = byHour(trades).filter((b) => b.count > 0);
  const overDays = days.filter((d) => d.over).length;
  const avgGive = days.length ? days.reduce((a, d) => a + d.giveback, 0) / days.length : 0;

  return (
    <>
      <Kpis s={s} full />

      <section className="card">
        <h3>منحنی سرمایه و افت</h3>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={curve} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="time" tickFormatter={(t: number) => fmtDateTime(t).slice(5, 10)} {...AXIS} minTickGap={40} />
              <YAxis {...AXIS} orientation="right" width={56} />
              <Tooltip {...TIP} labelFormatter={(t) => fmtDateTime(t as number)} formatter={(v: number, n: string) => [v.toFixed(2), n === "equity" ? "سرمایه" : "افت"]} />
              <Area isAnimationActive={false} type="monotone" dataKey="equity" stroke="#e0b354" fill="rgba(224,179,84,0.12)" strokeWidth={2} dot={false} />
              <Area isAnimationActive={false} type="monotone" dataKey="drawdown" stroke="#ef5350" fill="rgba(239,83,80,0.12)" strokeWidth={1} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="two-col">
        <Bars title="سود/زیان بر اساس ساعت ورود" data={hours} sub="ساعت بروکر" />
        <Bars title="سود/زیان بر اساس روز هفته" data={byWeekday(trades)} />
        <Bars title="سود/زیان بر اساس مدت معامله" data={byDuration(trades)} sub="اسکالپ را از معاملات طولانی جدا می‌کند" />
        <Observations trades={closed} hours={hours} days={days.length} overDays={overDays} maxPerDay={maxPerDay} avgGive={avgGive} />
      </div>

      <section className="card">
        <div className="filters">
          <h3>روزها — تعداد معاملات و پس‌دادن سود</h3>
          <label className="inline-field">سقف معامله در روز <input type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(Math.max(1, Number(e.target.value) || 1))} dir="ltr" /></label>
        </div>
        <p className="muted small">«اوج» بهترین سود تحقق‌یافته‌ی روز و «پس‌دادن» فاصله‌ی اوج تا سود پایان روز است. (بر پایه‌ی معاملات بسته؛ سود شناور معاملات بازِ لحظه‌ای را نمی‌بیند.)</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>روز</th><th>معاملات</th><th>برد</th><th>سود پایان روز</th><th>اوج سود</th><th>پس‌دادن</th><th>حداکثر در یک ساعت</th><th>هشدار</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className={d.over ? "flag" : ""}>
                  <td>{d.day}</td><td>{d.count}</td><td>{d.wins}</td>
                  <td className={d.net >= 0 ? "up" : "down"}>{money(d.net)}</td>
                  <td>{money(d.peak)}</td>
                  <td className={d.giveback > 0 ? "down" : ""}>{d.giveback > 0 ? money(-d.giveback) : "—"}</td>
                  <td>{d.maxPerHour}</td>
                  <td>{d.over ? <span className="mini bad">بیش از {maxPerDay} معامله</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Inside trades={trades} />
      <Tags trades={trades} />
    </>
  );
}

function Inside({ trades }: { trades: JTrade[] }) {
  const e = excursions(trades);
  if (!e) return null;
  const cells: [string, string][] = [
    ["معاملات زیر نظر", String(e.tracked)],
    ["میانگین بیشترین سود شناور", money(e.avgMfe)],
    ["میانگین بیشترین ضرر شناور", money(e.avgMae)],
    ["میانگین سود پس‌داده‌شده از اوج", money(-e.avgGiveback)],
    ["از اوجِ سود چند درصد را گرفتی (معاملات برنده)", e.captured != null ? `${Math.round(e.captured * 100)}%` : "—"],
    ["معاملاتی که سود رفت ولی با ضرر بسته شد", String(e.peakThenLoss)],
  ];
  return (
    <section className="card">
      <h3>درون معامله (MFE / MAE)</h3>
      <p className="muted small">فقط معاملاتی که خودکار زیر نظر بودند (از نصب اندیکاتور به بعد). نشان می‌دهد سود را در کجای معامله دیده‌ای و چقدر از آن را پس داده‌ای.</p>
      <div className="kpis">{cells.map(([l, v]) => <div key={l} className="card kpi"><span>{l}</span><b dir="ltr">{v}</b></div>)}</div>
    </section>
  );
}

function Bars({ title, data, sub }: { title: string; data: Bucket[]; sub?: string }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {sub && <p className="muted small">{sub}</p>}
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval={0} tick={{ ...AXIS, fontSize: 10 }} />
            <YAxis {...AXIS} orientation="right" width={48} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Tooltip {...TIP} formatter={(v: number, _n: string, p: { payload?: Bucket }) => [`${v.toFixed(2)}$ · ${p.payload?.count ?? 0} معامله · برد ${Math.round((p.payload?.winRate ?? 0) * 100)}%`, "خالص"]} />
            <Bar isAnimationActive={false} dataKey="net" radius={[3, 3, 0, 0]}>
              {data.map((b) => <Cell key={b.key} fill={b.net >= 0 ? "#26a69a" : "#ef5350"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Observations({ trades, hours, days, overDays, maxPerDay, avgGive }: { trades: JTrade[]; hours: Bucket[]; days: number; overDays: number; maxPerDay: number; avgGive: number }) {
  const solid = hours.filter((h) => h.count >= 3);
  const best = [...solid].sort((a, b) => b.net - a.net)[0];
  const worst = [...solid].sort((a, b) => a.net - b.net)[0];
  const items: string[] = [];
  if (best && best.net > 0) items.push(`سودآورترین ساعت ورود: ${best.label} (${money(best.net)} با ${best.count} معامله).`);
  if (worst && worst.net < 0) items.push(`زیان‌ده‌ترین ساعت ورود: ${worst.label} (${money(worst.net)} با ${worst.count} معامله).`);
  if (days) items.push(`${overDays} روز از ${days} روز بیش از ${maxPerDay} معامله داشته است.`);
  if (avgGive > 0) items.push(`میانگین سودِ پس‌داده‌شده در هر روز: ${avgGive.toFixed(2)}$.`);
  if (solid.length === 0) items.push("برای مشاهده‌ی الگوی ساعتی، حداقل ۳ معامله در یک ساعت لازم است.");
  return (
    <section className="card">
      <h3>مشاهدات</h3>
      <p className="muted small">توصیف داده‌ی {trades.length} معامله؛ نه پیشنهاد و نه قانون. برای اعتماد به الگو، داده‌ی بیشتری لازم است.</p>
      <ul className="obs">{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </section>
  );
}

function Tags({ trades }: { trades: JTrade[] }) {
  const groups: [string, ReturnType<typeof byTag>][] = [
    ["اعتبار ستاپ", byTag(trades, (t) => (t.setup_valid === "yes" ? "ستاپ معتبر" : t.setup_valid === "no" ? "ستاپ نامعتبر" : t.setup_valid === "unsure" ? "نامطمئن" : null))],
    ["حالت روانی", byTag(trades, (t) => t.emotion)],
    ["خطای اجرا", byTag(trades, (t) => t.error)],
  ];
  const any = groups.some(([, rows]) => rows.length);
  return (
    <section className="card">
      <h3>تحلیل بر اساس برچسب‌ها</h3>
      {!any ? (
        <p className="muted">هنوز معامله‌ای برچسب نخورده. در «ژورنال» روی هر معامله کلیک کنید و با چند کلیک اعتبار ستاپ، حالت روانی و خطای اجرا را بزنید تا اینجا نتیجه‌ی هر کدام را ببینید.</p>
      ) : (
        <div className="two-col">
          {groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
            <div key={title}>
              <h4>{title}</h4>
              <table>
                <thead><tr><th>برچسب</th><th>تعداد</th><th>برد</th><th>خالص</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.tag}><td>{r.tag}</td><td>{r.count}</td><td>{Math.round(r.winRate * 100)}%</td><td className={r.net >= 0 ? "up" : "down"}>{money(r.net)}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

