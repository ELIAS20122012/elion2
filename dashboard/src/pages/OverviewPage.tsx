import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { KIND_LABEL } from "../components/AccountBar";
import Gauge from "../components/Gauge";
import Hub, { type HubNode } from "../components/Hub";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import { isClosed, money, net, summarize, equityCurve } from "../lib/analytics";
import { fmtDateTime, fmtPrice } from "../lib/data";
import { useMaxPerDay } from "../lib/prefs";
import { dayPressure, LEVEL_LABEL } from "../lib/pressure";
import { RULES } from "../lib/rules";
import { SYMBOL, useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";

type Level = "critical" | "warn" | "info" | "ok";
interface Alert { level: Level; text: string }

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="spark" />;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${40 - ((v - min) / span) * 36 - 2}`).join(" ");
  const c = up ? "var(--up)" : "var(--down)";
  return (
    <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,40 ${pts} 100,40`} fill={c} opacity="0.13" />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Command centre: everything that matters right now on one screen. */
export default function OverviewPage() {
  const app = useApp();
  const j = useJournal();
  const nav = useNavigate();
  const [cap] = useMaxPerDay();
  const rows = useAllAccounts(j.accounts, j.status === "ok", 5000);
  const { last, mode, live, source } = app;

  // is the price really moving? (the market can be closed while the bridge is connected)
  const [moving, setMoving] = useState(false);
  const stamp = useRef(0);
  useEffect(() => { stamp.current = Date.now(); setMoving(true); }, [last?.time, last?.close]);
  useEffect(() => {
    const id = setInterval(() => setMoving(Date.now() - stamp.current < 90_000), 5000);
    return () => clearInterval(id);
  }, []);
  const marketOpen = mode === "live" && live.status === "live" && moving;

  const real = rows.filter((r) => r.account.kind !== "backtest");
  const backtests = rows.filter((r) => r.account.kind === "backtest");
  const trades = useMemo(() => real.flatMap((r) => r.trades), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const connected = real.filter((r) => r.live?.connected).length;
  const today = last ? Math.floor(last.time / 86400) : Math.floor(Date.now() / 86400000);

  /* ---- market ---- */
  const dayCandles = source.filter((c) => Math.floor(c.time / 86400) === today);
  const dayOpen = dayCandles[0]?.open;
  const change = last && dayOpen ? last.close - dayOpen : 0;
  const pct = dayOpen ? (change / dayOpen) * 100 : 0;
  const hi = dayCandles.length ? Math.max(...dayCandles.map((c) => c.high)) : null;
  const lo = dayCandles.length ? Math.min(...dayCandles.map((c) => c.low)) : null;
  const spark = source.slice(-120).map((c) => c.close);

  /* ---- results ---- */
  const closed = trades.filter(isClosed);
  const wins = closed.filter((t) => net(t) > 0).length;
  const losses = closed.filter((t) => net(t) < 0).length;
  const openN = trades.length - closed.length;
  const sum = summarize(trades);
  const curve = equityCurve(trades, 0);
  const openTrades = trades.filter((t) => !isClosed(t));
  const floating = openTrades.reduce((s, t) => s + t.profit, 0);
  const recent = [...trades].sort((a, b) => (b.close_time ?? b.open_time) - (a.close_time ?? a.open_time)).slice(0, 6);

  const pr = dayPressure(trades, today, cap);
  const done = RULES.filter((r) => r.status === "approved").length;
  const nextRule = RULES.find((r) => r.status !== "approved");

  /* ---- alerts (all computed from real state) ---- */
  const alerts: Alert[] = [];
  if (mode === "live" && live.status !== "live") alerts.push({ level: "critical", text: "قیمت زنده وصل نیست (پل MT5)" });
  else if (mode === "live" && !moving) alerts.push({ level: "info", text: "بازار بسته است یا قیمت حرکت نمی‌کند" });
  if (j.status !== "ok") alerts.push({ level: "critical", text: "سرور ژورنال خاموش است" });
  real.filter((r) => !r.live?.connected).forEach((r) => alerts.push({ level: "warn", text: `حساب «${r.account.name}» وصل نیست` }));
  if (pr.tradesToday > pr.cap) alerts.push({ level: "critical", text: `امروز ${pr.tradesToday} معامله زده‌اید؛ سقف شما ${pr.cap} است` });
  else if (pr.tradesToday === pr.cap) alerts.push({ level: "warn", text: `به سقف ${pr.cap} معامله‌ی امروز رسیده‌اید` });
  if (pr.peakToday > 0 && pr.givebackToday / pr.peakToday >= 0.5) alerts.push({ level: "warn", text: `نیمی از بهترین سود امروز پس داده شده (${pr.givebackToday.toFixed(2)}$)` });
  if (pr.lossStreak >= 2) alerts.push({ level: "warn", text: `${pr.lossStreak} باخت پیاپی` });
  if (nextRule) alerts.push({ level: "info", text: `قانون بعدی برای آموزش: ${nextRule.title}` });
  if (!alerts.some((a) => a.level === "critical" || a.level === "warn")) alerts.unshift({ level: "ok", text: "همه‌چیز عادی است" });

  /* ---- hub ---- */
  const nodes: HubNode[] = [
    { id: "data", title: "داده", sub: live.status === "live" ? (marketOpen ? "زنده" : "متصل، بازار ساکن") : "قطع", icon: "activity", state: live.status === "live" ? "on" : "off", to: "/chart" },
    { id: "rules", title: "قوانین", sub: `${done} از ${RULES.length} تأیید`, icon: "book", state: done ? "on" : "soon", to: "/rules" },
    { id: "risk", title: "ریسک", sub: LEVEL_LABEL[pr.level], icon: "shield", state: pr.level === "high" ? "off" : "on" },
    { id: "journal", title: "ژورنال", sub: `${connected} از ${real.length} حساب زنده`, icon: "notebook", state: real.length && connected === real.length ? "on" : "off", to: "/journal" },
    { id: "backtest", title: "بک‌تست", sub: `${backtests.length} اجرا`, icon: "flask", state: "on", to: "/backtest" },
    { id: "exec", title: "اجرای ربات", sub: "غیرفعال — فقط دمو", icon: "lock", state: "off" },
    { id: "ai", title: "تحلیل هوشمند", sub: "به‌زودی", icon: "cpu", state: "soon" },
  ];

  const layers = [
    { icon: "activity", title: "اتصال داده", sub: live.status === "live" ? "MT5 زنده" : "قطع", state: live.status === "live" },
    { icon: "server", title: "پایگاه‌داده", sub: j.status === "ok" ? `${trades.length} معامله` : "خاموش", state: j.status === "ok" },
    { icon: "bolt", title: "اتوماسیون", sub: real.length ? `${connected} از ${real.length} حساب` : "بدون حساب", state: !!real.length && connected === real.length },
    { icon: "plug", title: "API", sub: j.status === "ok" ? "سالم" : "قطع", state: j.status === "ok" },
    { icon: "globe", title: "دسترسی از راه دور", sub: location.hostname.endsWith(".ts.net") ? "از راه دور وصل هستید" : "فقط این رایانه", state: location.hostname.endsWith(".ts.net") },
  ];

  const dateFa = new Date().toLocaleDateString("fa-IR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const donut = closed.length + openN ? [{ n: "برد", v: wins, c: "var(--up)" }, { n: "باخت", v: losses, c: "var(--down)" }, { n: "باز", v: openN, c: "var(--info)" }] : [{ n: "", v: 1, c: "var(--surface-3)" }];

  return (
    <div className="page wide">
      <div className="hero">
        <PageHeader title="مرکز فرماندهی" subtitle={dateFa} showTitle />
        <span className={`market-state ${marketOpen ? "open" : ""}`}>
          <span className="dot" />
          {mode === "replay" ? "حالت بازپخش" : marketOpen ? "بازار فعال — قیمت در حال تغییر" : live.status === "live" ? "بازار بسته یا بدون حرکت" : "قیمت زنده وصل نیست"}
        </span>
      </div>

      <div className="cc-grid">
        {/* ---------- left ---------- */}
        <div className="cc-col">
          <section className="card cc-card">
            <div className="card-head"><h3>نمای بازار</h3><span className="pill" dir="ltr">{SYMBOL}</span></div>
            <div className="mkt-price" dir="ltr">{last ? fmtPrice(last.close) : "—"}</div>
            <div className={`mkt-chg ${change >= 0 ? "up" : "down"}`} dir="ltr">{change >= 0 ? "+" : ""}{change.toFixed(2)} ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</div>
            <Spark values={spark} up={change >= 0} />
            <div className="mini-stats">
              <div><span>بالاترین امروز</span><b dir="ltr">{hi != null ? fmtPrice(hi) : "—"}</b></div>
              <div><span>پایین‌ترین امروز</span><b dir="ltr">{lo != null ? fmtPrice(lo) : "—"}</b></div>
              <div><span>دامنه</span><b dir="ltr">{hi != null && lo != null ? (hi - lo).toFixed(2) : "—"}</b></div>
            </div>
          </section>

          <section className="card cc-card">
            <div className="card-head"><h3>توزیع نتایج</h3><span className="muted small">همه‌ی حساب‌ها</span></div>
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={donut} dataKey="v" nameKey="n" innerRadius={48} outerRadius={68} paddingAngle={donut.length > 1 ? 3 : 0} stroke="none" isAnimationActive={false}>
                    {donut.map((d) => <Cell key={d.n} fill={d.c} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><b dir="ltr">{sum.count ? `${Math.round(sum.winRate * 100)}%` : "—"}</b><small>نرخ برد</small></div>
            </div>
            <div className="legend-row">
              <span><i style={{ background: "var(--up)" }} />برد {wins}</span>
              <span><i style={{ background: "var(--down)" }} />باخت {losses}</span>
              <span><i style={{ background: "var(--info)" }} />باز {openN}</span>
            </div>
          </section>

          <section className="card cc-card">
            <div className="card-head"><h3>عملکرد</h3><span className={`num ${sum.net >= 0 ? "up" : "down"}`} dir="ltr">{sum.count ? money(sum.net) : "—"}</span></div>
            {curve.length > 1 ? (
              <div style={{ direction: "ltr" }}>
                <ResponsiveContainer width="100%" height={110}>
                  <AreaChart data={curve} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="perf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--gold)" stopOpacity="0.45" /><stop offset="1" stopColor="var(--gold)" stopOpacity="0" /></linearGradient></defs>
                    <Tooltip contentStyle={{ background: "#0d1a3a", border: "1px solid rgba(90,165,255,.3)", borderRadius: 8 }} labelFormatter={(t) => fmtDateTime(t as number)} formatter={(v: number) => [v.toFixed(2), "سرمایه"]} />
                    <Area type="monotone" dataKey="equity" stroke="var(--gold)" strokeWidth={2} fill="url(#perf)" isAnimationActive={false} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="muted small">برای نمودار حداقل ۲ معامله‌ی بسته لازم است.</p>}
            <div className="mini-stats">
              <div><span>ضریب سود</span><b dir="ltr">{sum.profitFactor != null ? sum.profitFactor.toFixed(2) : "—"}</b></div>
              <div><span>امید ریاضی</span><b dir="ltr">{sum.count ? money(sum.expectancy) : "—"}</b></div>
              <div><span>معاملات</span><b dir="ltr">{sum.count}</b></div>
            </div>
          </section>
        </div>

        {/* ---------- centre ---------- */}
        <div className="cc-center">
          <section className="card hub-card">
            <Hub nodes={nodes} />
          </section>
          <section>
            <div className="card-head"><h3>حساب‌ها</h3><Link className="btn sm" to="/journal"><Icon name="plus" size={14} />مدیریت</Link></div>
            <div className="acct-grid compact">
              {rows.map(({ account: a, trades: tr, live: lv }) => {
                const s = summarize(tr);
                const cv = equityCurve(tr, 0).slice(-40).map((p) => p.equity);
                return (
                  <button key={a.id} className="acct-card" onClick={() => { j.setActive(a.id); nav("/journal"); }}>
                    <div className="top">
                      <div>
                        <div className="name">{a.name}</div>
                        <div className="meta">
                          <span className="pill" dir="ltr">{a.platform.toUpperCase()}</span>
                          <span className={`pill kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                          {a.is_live && <span className="pill live">LIVE</span>}
                        </div>
                      </div>
                      {a.kind !== "backtest" && <span className={`live-tag ${lv?.connected ? "on" : ""}`}><span className="dot" />{lv?.connected ? "زنده" : "قطع"}</span>}
                    </div>
                    <div className={`pnl ${s.net >= 0 ? "up" : "down"}`} dir="ltr">{s.count ? money(s.net) : "—"}</div>
                    <Spark values={cv} up={s.net >= 0} />
                  </button>
                );
              })}
              {rows.length === 0 && <button className="acct-card add" onClick={() => nav("/journal")}><Icon name="plus" size={24} /><span>افزودن حساب</span></button>}
            </div>
          </section>
        </div>

        {/* ---------- right ---------- */}
        <div className="cc-col">
          <section className="card cc-card">
            <div className="card-head"><h3>فشار روز</h3><span className="muted small">مشاهده، نه قانون</span></div>
            <Gauge value={pr.score} label={LEVEL_LABEL[pr.level]} tone={pr.level} />
            <ul className="parts">
              {pr.parts.map((p) => (
                <li key={p.label}>
                  <div><span>{p.label}</span><b dir="ltr">{p.note}</b></div>
                  <div className="bar"><i style={{ width: `${(p.points / p.max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
            <p className="muted small">سقف معامله‌ی روز از «تنظیمات» عوض می‌شود (الان {cap}).</p>
          </section>

          <section className="card cc-card">
            <div className="card-head"><h3>آخرین معاملات</h3><span className="muted small" dir="ltr">{openTrades.length ? `${openTrades.length} open · ${money(floating)}` : ""}</span></div>
            {recent.length === 0 ? <p className="muted small">هنوز معامله‌ای نیست.</p> : (
              <ul className="tx">
                {recent.map((t) => {
                  const v = isClosed(t) ? net(t) : t.profit;
                  return (
                    <li key={`${t.account_id}-${t.id}`}>
                      <span className={`dir ${t.direction}`}>{t.direction === "buy" ? "BUY" : "SELL"}</span>
                      <span className="tx-meta" dir="ltr">{t.symbol} · {fmtDateTime(t.close_time ?? t.open_time).slice(5)}</span>
                      <b className={v >= 0 ? "up" : "down"} dir="ltr">{money(v)}{!isClosed(t) && " •"}</b>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card cc-card">
            <div className="card-head"><h3>هشدارها</h3><span className="pill">{alerts.filter((a) => a.level === "critical" || a.level === "warn").length}</span></div>
            <ul className="alerts">
              {alerts.slice(0, 6).map((a, i) => (
                <li key={i} className={a.level}>
                  <Icon name={a.level === "ok" ? "check" : a.level === "info" ? "bell" : "alert"} size={16} />
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="layers">
        {layers.map((l) => (
          <div key={l.title} className={`layer ${l.state ? "on" : ""}`}>
            <Icon name={l.icon} size={20} />
            <div><b>{l.title}</b><small>{l.sub}</small></div>
            <i className="hn-dot" />
          </div>
        ))}
      </div>
    </div>
  );
}
