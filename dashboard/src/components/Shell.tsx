import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { TIMEFRAMES, fmtPrice } from "../lib/data";
import { MODULES } from "../modules/registry";
import { SYMBOL, useApp } from "../state/AppContext";
import Icon from "./Icon";

const COLLAPSE_KEY = "rt.sidebar.collapsed";

export default function Shell() {
  const s = useApp();
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
  const nav = (footer: boolean) =>
    MODULES.filter((m) => !!m.footer === footer).map((m) => (
      <NavLink key={m.id} to={m.path} end={m.path === "/"} className={({ isActive }) => `nav-item ${isActive ? "on" : ""}`} title={m.title}>
        <Icon name={m.icon} />
        <span>{m.title}</span>
      </NavLink>
    ));

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">◆</span>
          <div className="brand-text">
            <strong>Robot Trading</strong>
            <small>پلتفرم آنالیز و اجرا</small>
          </div>
        </div>
        <nav aria-label="منوی اصلی">{nav(false)}</nav>
        <div className="nav-foot">
          {nav(true)}
          <button className="nav-item collapse" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "باز کردن منو" : "جمع کردن منو"}>
            <Icon name="menu" />
            <span>جمع کردن منو</span>
          </button>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="symbol">
            <span className="sym">{SYMBOL}</span>
            <span className="price" dir="ltr">{last ? fmtPrice(last.close) : "—"}</span>
            <span className={`chg ${change >= 0 ? "up" : "down"}`} dir="ltr">
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}
            </span>
          </div>

          {pathname === "/" && (
            <div className="seg" role="group" aria-label="تایم‌فریم">
              {TIMEFRAMES.map((t) => (
                <button key={t.sec} className={s.tfSec === t.sec ? "on" : ""} onClick={() => s.setTfSec(t.sec)}>{t.label}</button>
              ))}
            </div>
          )}

          <div className="seg" role="group" aria-label="منبع داده">
            <button className={mode === "live" ? "on" : ""} onClick={() => s.setMode("live")}>زنده MT5</button>
            <button className={mode === "replay" ? "on" : ""} onClick={() => s.setMode("replay")}>بازپخش</button>
          </div>

          <div className="chips">
            {mode === "live" ? (
              <>
                {live.account && (
                  <span className={`chip ${live.account.demo ? "demo" : "real"}`} dir="ltr">
                    {live.account.demo ? "DEMO" : "REAL"} · {live.account.login}
                  </span>
                )}
                <span className={`chip ${live.status === "live" ? "on" : "off"}`}>
                  {live.status === "live" ? "● متصل به MT5" : live.status === "connecting" ? "در حال اتصال…" : "پل MT5 قطع است"}
                </span>
              </>
            ) : (
              <span className="chip replay">{replay.playing ? "▶ بازپخش" : "⏸ بازپخش (متوقف)"}</span>
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
