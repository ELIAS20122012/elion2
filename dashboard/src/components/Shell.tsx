import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { fmtPrice } from "../lib/data";
import { GROUPS, MODULES } from "../modules/registry";
import { SYMBOL, useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useLiveAccount } from "../state/useLiveAccount";
import { money } from "../lib/analytics";
import Icon from "./Icon";

const COLLAPSE_KEY = "rt.sidebar.collapsed";

export default function Shell() {
  const s = useApp();
  const j = useJournal();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* not persisted */
    }
  }, [collapsed]);

  if (s.error) return <div className="fatal">بارگذاری داده ناموفق بود: {s.error}</div>;

  const { last, change, live, replay, mode } = s;
  const page = MODULES.find((m) => (m.path === "/" ? pathname === "/" : pathname.startsWith(m.path)));

  const item = (m: (typeof MODULES)[number]) => (
    <NavLink key={m.id} to={m.path} end={m.path === "/"} className={({ isActive }) => `nav-item ${isActive ? "on" : ""}`} title={m.title}>
      <Icon name={m.icon} />
      <span>{m.title}</span>
    </NavLink>
  );

  const priceOk = mode === "live" ? live.status === "live" : true;
  const journalOk = j.status === "ok";
  const myLive = useLiveAccount(j.accounts, journalOk); // Elias's real account, on every page, regardless of which terminal streams the chart

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <div className="bg-glow" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand">
          <span className="logo"><Icon name="activity" size={18} /></span>
          <div className="brand-text">
            <strong>Robot Trading</strong>
            <small>تحلیل، ژورنال و ربات</small>
          </div>
        </div>

        <nav aria-label="منوی اصلی">
          {GROUPS.map((g) => (
            <div key={g.id} className="nav-group">
              <span className="nav-label">{g.label}</span>
              {MODULES.filter((m) => m.group === g.id && !m.footer).map(item)}
            </div>
          ))}
        </nav>

        <div className="nav-foot">
          <div className="side-status" aria-label="وضعیت سیستم">
            <div><span className={`dot ${priceOk ? "on" : "bad"}`} /> قیمت زنده {mode === "live" ? (priceOk ? "متصل" : "قطع") : "(بازپخش)"}</div>
            <div><span className={`dot ${journalOk ? "on" : "bad"}`} /> سرور ژورنال {journalOk ? "روشن" : "خاموش"}</div>
          </div>
          {MODULES.filter((m) => m.footer).map(item)}
          <button className="nav-item collapse" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "باز کردن منو" : "جمع کردن منو"}>
            <Icon name="menu" />
            <span>جمع کردن منو</span>
          </button>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <h1 className="topbar-title">{page?.title ?? ""}</h1>

          <div className="symbol" aria-label={`قیمت ${SYMBOL}`}>
            <span className="sym">{SYMBOL}</span>
            <span className="price" dir="ltr">{last ? fmtPrice(last.close) : "—"}</span>
            <span className={`chg ${change >= 0 ? "up" : "down"}`} dir="ltr">{change >= 0 ? "+" : ""}{change.toFixed(2)}</span>
          </div>

          <div className="chips">
            {myLive && (
              <span className="chip real live-acc" dir="ltr" title={`حساب واقعی شما: ${myLive.account.name}`}>
                LIVE · {(myLive.live.balance ?? 0).toFixed(2)}$
                {!!myLive.live.open_count && <span className={(myLive.live.floating ?? 0) >= 0 ? "up" : "down"}> ({money(myLive.live.floating ?? 0)})</span>}
              </span>
            )}
            <div className="seg" role="group" aria-label="منبع داده">
              <button className={mode === "live" ? "on" : ""} onClick={() => s.setMode("live")}>زنده MT5</button>
              <button className={mode === "replay" ? "on" : ""} onClick={() => s.setMode("replay")}>بازپخش</button>
            </div>
            {mode === "live" ? (
              <>
                {live.account?.login && (
                  <span className={`chip ${live.account.demo ? "demo" : "real"}`} dir="ltr" title="حساب متصل به چارت (منبع کندل‌ها) — لزوماً حساب واقعی شما نیست">
                    چارت: {live.account.demo ? "DEMO" : "REAL"} · {live.account.login}
                  </span>
                )}
                <span className={`chip ${live.status === "live" ? "on" : "off"}`}>
                  {live.status === "live" ? "متصل به MT5" : live.status === "connecting" ? "در حال اتصال…" : "پل MT5 قطع است"}
                </span>
              </>
            ) : (
              <span className="chip replay">{replay.playing ? "بازپخش در حال اجرا" : "بازپخش متوقف"}</span>
            )}
          </div>
        </header>

        <main className="page-host">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
