import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { formatClock, useSettings } from "../lib/elionSettings";
import { setLang } from "../lib/i18n";

/** Shared bits between the Elion dashboard and journal pages (design/elion/*.dc.html reference). */

export function useElionClock() {
  const [now, setNow] = useState(() => new Date());
  const [s] = useSettings();
  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(iv);
  }, []);
  return formatClock(now, s);
}

type NavItem = { icon: string; label: string; to: string | null };

/**
 * One rail for every Elion screen. The reference designs each drew this slightly differently
 * (7 items on the dashboard/journal/analytics, 9 on trade/rules, three different widths); Elias
 * asked for it to be identical everywhere, so this is the trade/rules rail used throughout.
 */
const NAV: NavItem[] = [
  { icon: "home", label: "Home", to: "/elion" },
  { icon: "candlestick_chart", label: "Trade", to: "/chart" },
  { icon: "menu_book", label: "Journal", to: "/journal" },
  { icon: "monitoring", label: "Analytics", to: "/analysis" },
  { icon: "psychology", label: "AI Lab", to: "/ai-lab" },
  { icon: "history", label: "Backtest", to: "/backtest" },
  { icon: "rule", label: "Rules", to: "/rules" },
  { icon: "handyman", label: "Tools", to: "/tools" },
  { icon: "cable", label: "Connection", to: "/account" },
  { icon: "settings", label: "Settings", to: "/settings" },
];

/** the rail's own column width — pages set this as their first grid column */
export const ELION_RAIL_W = 78;

export type ElionNavLabel = "Home" | "Trade" | "Journal" | "Analytics" | "AI Lab" | "Backtest" | "Rules" | "Tools" | "Connection" | "Settings" | "";

/** true while the viewport is at or under the drawer breakpoint (matches the 900px rule in elion.css) */
function useNarrow() {
  const q = "(max-width: 900px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function ElionSidebar({ active, spanRows = false }: { active: ElionNavLabel; spanRows?: boolean }) {
  const [{ lang }] = useSettings();
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
    {/* small screens: the rail becomes an off-canvas drawer opened from this button (see elion.css) */}
    {narrow && <button type="button" className="e-menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <span className="e-icon">{open ? "close" : "menu"}</span>
    </button>}
    {narrow && open && <div className="e-scrim" onClick={() => setOpen(false)} />}
    <aside className={`e-rail${open ? " open" : ""}`} style={{ gridRow: spanRows ? "1 / span 2" : undefined, borderRight: "1px solid var(--e-line-2)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0 18px", gap: 4 }}>
      <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", marginBottom: 18 }}>
        <div style={{ width: 22, height: 22, border: "1.5px solid var(--e-gold)", transform: "rotate(45deg)", display: "grid", placeItems: "center" }}>
          <div style={{ width: 8, height: 8, background: "var(--e-gold)" }} />
        </div>
      </div>
      {NAV.map((n) => {
        const on = n.label === active;
        const style = {
          width: 70, padding: "10px 0 8px", borderRadius: 8, display: "flex", flexDirection: "column" as const, alignItems: "center" as const, gap: 5,
          color: on ? "var(--e-ivory)" : "var(--e-text)",
          background: on ? "linear-gradient(180deg,#232519,#171a14)" : "transparent",
          border: `1px solid ${on ? "rgba(233,215,176,.6)" : "transparent"}`,
          boxSizing: "border-box" as const, cursor: "pointer",
        };
        const inner = (
          <>
            <span className={`e-icon${on ? " fill" : ""}`} style={{ fontSize: 25 }}>{n.icon}</span>
            <span style={{ fontSize: 12 }}>{n.label}</span>
          </>
        );
        return n.to ? (
          <Link key={n.label} to={n.to} className="e-nav-item" style={style}>{inner}</Link>
        ) : (
          <a key={n.label} href="#" className="e-nav-item" style={style} onClick={(e) => e.preventDefault()}>{inner}</a>
        );
      })}
      <div style={{ flex: 1 }} />
      <div className="e-lang-switch" data-no-i18n title="Language / زبان">
        <span className={lang === "en" ? "on" : ""} onClick={() => lang !== "en" && setLang("en")}>EN</span>
        <span className={lang === "fa" ? "on" : ""} onClick={() => lang !== "fa" && setLang("fa")}>فا</span>
      </div>
      <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--e-text-3)", width: 58 }}>Better Traders Brighter Tomorrows</div>
    </aside>
    </>
  );
}

export function ElionBrand() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, letterSpacing: ".2em", color: "var(--e-ivory)", lineHeight: 1 }}>ELION</div>
      <div style={{ fontSize: 9, letterSpacing: ".42em", color: "var(--e-text-2)" }}>TRADING</div>
    </div>
  );
}
