import { useEffect, useState } from "react";
import { TZ_OPTIONS, useSettings } from "../lib/elionSettings";
import { dateLocale } from "../lib/i18n";
import { journalApi, type NewsEvent } from "../lib/journalApi";

/** Economic calendar from the journal server's /news (Forex Factory public feed, cached 10 min server-side). */
export function useNews(enabled = true): { events: NewsEvent[]; error: string | null; stale: boolean; loading: boolean } {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const load = () =>
      journalApi.news().then((r) => {
        if (dead) return;
        setEvents(r.events); setStale(r.stale); setError(null); setLoading(false);
      }).catch((e: Error) => {
        if (dead) return;
        setError(e.message); setLoading(false);
      });
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => { dead = true; window.clearInterval(id); };
  }, [enabled]);
  return { events, error, stale, loading };
}

const IMPACT_COLOR: Record<string, string> = { High: "#e0463f", Medium: "#e9b04a", Low: "#7f8b89", Holiday: "#5a6a70" };

function countdown(sec: number): string {
  const m = Math.round(sec / 60);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h}h ${m % 60}m` : `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function ElionNews({ rows = 6, compact = false }: { rows?: number; compact?: boolean }) {
  const { events, error, stale, loading } = useNews();
  const [s] = useSettings();
  const [ccy, setCcy] = useState<"USD" | "All">("All");
  const [imp, setImp] = useState<"High" | "Med+" | "All">("All");
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now() / 1000), 30_000); return () => window.clearInterval(id); }, []);

  const fmtTime = (t: number) =>
    new Intl.DateTimeFormat(dateLocale("en-GB"), { timeZone: TZ_OPTIONS[s.tz], weekday: "short", hour: "2-digit", minute: "2-digit", hour12: s.tf === "12-hour" }).format(new Date(t * 1000));

  const list = events
    .filter((e) => e.impact !== "Holiday" || imp === "All")
    .filter((e) => ccy === "All" || e.country === "USD")
    .filter((e) => imp === "All" || (imp === "High" ? e.impact === "High" : e.impact === "High" || e.impact === "Medium"))
    .filter((e) => e.time > now - 3600); // an hour of "just released" context, then upcoming
  const shown = list.slice(0, rows);

  const chip = (label: string, on: boolean, pick: () => void) => (
    <span key={label} onClick={pick} style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10.5, cursor: "pointer", background: on ? "#2a2518" : "transparent", color: on ? "var(--e-ivory)" : "var(--e-text-3)", border: `1px solid ${on ? "rgba(233,215,176,.55)" : "var(--e-border)"}` }}>{label}</span>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        {(["USD", "All"] as const).map((c) => chip(c === "USD" ? "USD only" : "All currencies", ccy === c, () => setCcy(c)))}
        <span style={{ width: 1, height: 14, background: "var(--e-border)" }} />
        {(["High", "Med+", "All"] as const).map((i) => chip(i === "Med+" ? "Medium+" : i === "All" ? "All impact" : "High", imp === i, () => setImp(i)))}
      </div>
      {loading && <div style={{ color: "var(--e-muted)", fontSize: 11.5, padding: "8px 2px" }}>Loading economic calendar…</div>}
      {!loading && error && events.length === 0 && (
        <div style={{ color: "#f3b5ae", fontSize: 11.5, padding: "8px 2px" }} dir="auto">{error}</div>
      )}
      {!loading && events.length > 0 && shown.length === 0 && (
        <div style={{ color: "var(--e-muted)", fontSize: 11.5, padding: "8px 2px" }}>No upcoming events match these filters.</div>
      )}
      {shown.map((e, i) => {
        const past = e.time <= now;
        return (
          <div key={`${e.time}-${e.title}-${i}`} style={{ display: "grid", gridTemplateColumns: compact ? "10px 68px 34px 1fr auto" : "10px 76px 36px 1fr auto", alignItems: "center", gap: 8, fontSize: 11.5, padding: "5px 2px", borderTop: "1px solid var(--e-line-2)", opacity: past ? 0.55 : 1 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: IMPACT_COLOR[e.impact] ?? "#7f8b89" }} title={`${e.impact} impact`} />
            <span style={{ color: "var(--e-text-2)" }}>{fmtTime(e.time)}</span>
            <span style={{ color: "var(--e-text-3)" }}>{e.country}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${e.title}${e.forecast ? ` · forecast ${e.forecast}` : ""}${e.previous ? ` · previous ${e.previous}` : ""}${e.actual ? ` · actual ${e.actual}` : ""}`}>
              {e.title}
              {(e.actual || e.forecast) && <span style={{ color: "var(--e-muted)" }}>{e.actual ? ` · act ${e.actual}` : ""}{e.forecast ? ` · fc ${e.forecast}` : ""}</span>}
            </span>
            <span style={{ color: past ? "var(--e-muted)" : e.time - now < 900 ? "#e0463f" : "var(--e-text-3)", whiteSpace: "nowrap" }}>{past ? "released" : countdown(e.time - now)}</span>
          </div>
        );
      })}
      {stale && <div style={{ fontSize: 10.5, color: "var(--e-muted)" }}>Feed unreachable right now — showing the last saved calendar.</div>}
    </div>
  );
}

