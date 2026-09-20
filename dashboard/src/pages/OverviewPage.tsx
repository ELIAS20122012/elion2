import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KIND_LABEL } from "../components/AccountBar";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import { equityCurve, isClosed, money, net, summarize } from "../lib/analytics";
import { fmtPrice } from "../lib/data";
import { RULES } from "../lib/rules";
import { SYMBOL, useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";

function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="spark" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${40 - ((v - min) / span) * 36 - 2}`).join(" ");
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,40 ${pts} 100,40`} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export default function OverviewPage() {
  const app = useApp();
  const { accounts, status, setActive } = useJournal();
  const nav = useNavigate();
  const rows = useAllAccounts(accounts, status === "ok");
  const { last, change, mode, live } = app;

  // is the price actually moving? (the market can be closed while the bridge is connected)
  const [moving, setMoving] = useState(false);
  const stamp = useRef(0);
  useEffect(() => { stamp.current = Date.now(); setMoving(true); }, [last?.time, last?.close]);
  useEffect(() => {
    const id = setInterval(() => setMoving(Date.now() - stamp.current < 90_000), 5000);
    return () => clearInterval(id);
  }, []);
  const marketOpen = mode === "live" ? live.status === "live" && moving : false;

  const real = rows.filter((r) => r.account.kind !== "backtest");
  const today = last ? Math.floor(last.time / 86400) : Math.floor(Date.now() / 86400000);
  const todayNet = real.flatMap((r) => r.trades).filter((t) => isClosed(t) && Math.floor((t.close_time as number) / 86400) === today).reduce((s, t) => s + net(t), 0);
  const openTrades = real.flatMap((r) => r.trades).filter((t) => !isClosed(t));
  const floating = openTrades.reduce((s, t) => s + t.profit, 0);
  const connected = real.filter((r) => r.live?.connected).length;

  const done = RULES.filter((r) => r.status === "approved").length;
  const nextRule = RULES.find((r) => r.status !== "approved");
  const dateFa = new Date().toLocaleDateString("fa-IR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const tiles = [
    { label: `قیمت ${SYMBOL}`, value: last ? fmtPrice(last.close) : "—", sub: last ? `${change >= 0 ? "+" : ""}${change.toFixed(2)} نسبت به شروع روز` : "منتظر قیمت", tone: change >= 0 ? "up" : "down" },
    { label: "سود/زیان امروز", value: real.length ? money(todayNet) : "—", sub: "معاملات بسته‌ی همه‌ی حساب‌ها", tone: todayNet >= 0 ? "up" : "down" },
    { label: "پوزیشن‌های باز", value: String(openTrades.length), sub: openTrades.length ? `شناور ${money(floating)}` : "هیچ پوزیشن بازی نیست", tone: openTrades.length ? (floating >= 0 ? "up" : "down") : "" },
    { label: "حساب‌های متصل", value: `${connected} / ${real.length}`, sub: real.length ? "ثبت خودکار فعال" : "حسابی اضافه نشده", tone: connected && connected === real.length ? "up" : "" },
  ];

  return (
    <div className="page wide">
      <div className="hero">
        <PageHeader title="خلاصه‌ی امروز" subtitle={dateFa} showTitle />
        <span className={`market-state ${marketOpen ? "open" : ""}`}>
          <span className="dot" />
          {mode === "replay" ? "حالت بازپخش" : marketOpen ? "بازار فعال — قیمت در حال تغییر" : live.status === "live" ? "بازار بسته یا بدون حرکت" : "قیمت زنده وصل نیست"}
        </span>
      </div>

      <div className="kpis">
        {tiles.map((t) => (
          <div key={t.label} className="card kpi">
            <span>{t.label}</span>
            <b className={t.tone} dir="ltr">{t.value}</b>
            <small>{t.sub}</small>
          </div>
        ))}
      </div>

      <section>
        <div className="card-head"><h3>حساب‌ها</h3><Link className="btn sm" to="/journal">مدیریت حساب‌ها</Link></div>
        {status === "loading" ? (
          <div className="acct-grid">{[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 190 }} />)}</div>
        ) : status === "down" ? (
          <div className="card empty-state"><h3>سرور ژورنال روشن نیست</h3><p className="muted">با <b dir="ltr">start-live.bat</b> همه‌چیز را روشن کنید تا حساب‌ها اینجا دیده شوند.</p></div>
        ) : (
          <div className="acct-grid">
            {rows.map(({ account: a, trades, live: lv }) => {
              const s = summarize(trades);
              const curve = equityCurve(trades, 0).slice(-40).map((p) => p.equity);
              const isLive = !!lv?.connected;
              return (
                <button key={a.id} className="acct-card" onClick={() => { setActive(a.id); nav("/journal"); }}>
                  <div className="top">
                    <div>
                      <div className="name">{a.name}</div>
                      <div className="meta">
                        <span className="pill" dir="ltr">{a.platform.toUpperCase()}</span>
                        <span className={`pill kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                        {a.is_live && <span className="pill live">LIVE</span>}
                      </div>
                    </div>
                    {a.kind !== "backtest" && <span className={`live-tag ${isLive ? "on" : ""}`}><span className="dot" />{isLive ? "زنده" : "قطع"}</span>}
                  </div>
                  <div className={`pnl ${s.net >= 0 ? "up" : "down"}`} dir="ltr">{s.count ? money(s.net) : "—"}</div>
                  <Sparkline values={curve} up={s.net >= 0} />
                  <div className="row">
                    <span>معاملات<b>{s.count}</b></span>
                    <span>نرخ برد<b>{s.count ? `${Math.round(s.winRate * 100)}%` : "—"}</b></span>
                    <span>ضریب سود<b>{s.profitFactor != null ? s.profitFactor.toFixed(2) : "—"}</b></span>
                    {lv?.open_count ? <span>باز<b>{lv.open_count}</b></span> : null}
                  </div>
                </button>
              );
            })}
            <button className="acct-card add" onClick={() => nav("/journal")}>
              <Icon name="plus" size={26} />
              <span>افزودن حساب جدید</span>
            </button>
          </div>
        )}
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h3>پیشرفت آموزش قوانین</h3><span className="muted small">{done} از {RULES.length}</span></div>
          <div className="bar"><i style={{ width: `${(done / RULES.length) * 100}%` }} /></div>
          <p className="muted small" style={{ marginTop: 12 }}>
            {nextRule ? <>قانون بعدی: <b style={{ color: "var(--text)" }}>{nextRule.title}</b> — {nextRule.hint}</> : "همه‌ی قوانین تأیید شده‌اند."}
          </p>
          <div className="quick" style={{ marginTop: 14 }}>
            <Link to="/chart"><Icon name="chart" size={18} />باز کردن چارت</Link>
            <Link to="/rules"><Icon name="book" size={18} />قوانین</Link>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>وضعیت سیستم</h3></div>
          <div className="health">
            <div><span className="l"><Icon name="activity" size={16} />قیمت زنده MT5</span><span className={`chip ${live.status === "live" ? "on" : "off"}`}>{live.status === "live" ? "متصل" : "قطع"}</span></div>
            <div><span className="l"><Icon name="server" size={16} />سرور ژورنال</span><span className={`chip ${status === "ok" ? "on" : "off"}`}>{status === "ok" ? "روشن" : "خاموش"}</span></div>
            <div><span className="l"><Icon name="plug" size={16} />ثبت خودکار حساب‌ها</span><span className={`chip ${real.length && connected === real.length ? "on" : "off"}`}>{real.length ? `${connected} از ${real.length}` : "—"}</span></div>
            <div><span className="l"><Icon name="wallet" size={16} />حساب MT5 فعال</span><span className="chip" dir="ltr">{live.account ? `${live.account.login}${live.account.demo ? " · DEMO" : " · REAL"}` : "—"}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
