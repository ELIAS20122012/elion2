import { useEffect, useRef } from "react";
import { ACCENTS, notifyUser, useSettings } from "../lib/elionSettings";
import { t as tr } from "../lib/i18n";
import { useNews } from "./ElionNews";
import { journalApi } from "../lib/journalApi";
import { sessionsNow } from "../lib/sessions";
import { useAllAccounts } from "../state/useAllAccounts";
import { useJournal } from "../state/JournalContext";

const FONT_ZOOM: Record<string, number> = { Small: 0.92, Medium: 1, Large: 1.1 };

/** Applies the Settings page options that act app-wide. Renders nothing. */
export default function ElionGlobalEffects() {
  const [s] = useSettings();
  const j = useJournal();

  // font size / accent / midnight theme / animations, as one injected stylesheet over .elion-scope
  useEffect(() => {
    let el = document.getElementById("elion-user-style") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "elion-user-style";
      document.head.appendChild(el);
    }
    const acc = ACCENTS[s.accent] ?? ACCENTS[0];
    const z = FONT_ZOOM[s.font] ?? 1;
    el.textContent = [
      z !== 1 ? `.elion-scope{zoom:${z}}` : "",
      s.accent > 0 ? `.elion-scope{--e-gold:${acc};--e-gold-2:${acc};--e-gold-line:${acc}59}` : "",
      s.colorTheme === "ELION Midnight" ? ".elion-scope{--e-bg:#02060a;--e-bg-2:#060e13;--e-panel-2:#080f12;--e-panel-3:#060c0f;--e-panel-4:#070d10}" : "",
      s.anim ? "" : ".elion-scope *,.elion-scope *::before,.elion-scope *::after{animation:none!important;transition:none!important}",
    ].join("\n");
  }, [s.font, s.accent, s.colorTheme, s.anim]);

  useEffect(() => {
    if (!s.confirmExit) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [s.confirmExit]);

  // one backup per calendar day while the app is open (the server skips repeats)
  useEffect(() => {
    if (s.autoBackup && j.status === "ok") journalApi.backup(true).catch(() => {});
  }, [s.autoBackup, j.status]);

  // trade opened / closed notifications, from every connected account's trades
  const rows = useAllAccounts(j.accounts, j.status === "ok" && s.notify && (s.nExec || s.nClose), 6000);
  const seen = useRef<Map<string, boolean> | null>(null); // key -> closed?
  useEffect(() => {
    if (rows.length === 0) return;
    const now = new Map<string, boolean>();
    const first = seen.current == null;
    for (const r of rows) {
      if (r.account.kind === "backtest") continue;
      for (const t of r.trades) {
        const key = `${r.account.id}:${t.ticket}`;
        const closed = t.close_time != null;
        now.set(key, closed);
        if (first) continue;
        const was = seen.current!.get(key);
        if (was === undefined && !closed && s.nExec) {
          notifyUser(tr("Trade opened"), `${t.direction.toUpperCase()} ${t.volume} ${t.symbol} @ ${t.open_price.toFixed(2)} (${r.account.name})`);
        } else if (closed && was !== true && s.nClose) {
          const pnl = t.profit + t.commission + t.swap;
          const hit = t.close_price != null && t.tp != null && Math.abs(t.close_price - t.tp) < 0.1 ? tr("TP hit")
            : t.close_price != null && t.sl != null && Math.abs(t.close_price - t.sl) < 0.1 ? tr("SL hit") : tr("Closed");
          notifyUser(tr(`Trade ${hit}`), `${t.symbol} ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${r.account.name})`);
        }
      }
    }
    seen.current = now;
  }, [rows, s.nExec, s.nClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // session start notifications (real UTC session clock)
  const lastSess = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!s.notify || !s.nSess) { lastSess.current = undefined; return; }
    const tick = () => {
      const cur = sessionsNow().find((x) => x.status === "Active")?.name ?? null;
      if (lastSess.current !== undefined && cur && cur !== lastSess.current) notifyUser(tr("Session started"), tr(`${cur} session is now open`));
      lastSess.current = cur;
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [s.notify, s.nSess]);

  // high-impact USD release coming up: alert once, 15 minutes ahead
  const { events } = useNews(s.notify && s.nNews);
  const alerted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!s.notify || !s.nNews) return;
    const check = () => {
      const nowSec = Date.now() / 1000;
      for (const e of events) {
        const key = `${e.time}:${e.title}`;
        if (e.country === "USD" && e.impact === "High" && e.time > nowSec && e.time - nowSec <= 900 && !alerted.current.has(key)) {
          alerted.current.add(key);
          notifyUser(tr("High-impact news soon"), tr(`${e.title} (USD) in ${Math.max(1, Math.round((e.time - nowSec) / 60))} min`));
        }
      }
    };
    check();
    const id = window.setInterval(check, 30000);
    return () => window.clearInterval(id);
  }, [events, s.notify, s.nNews]);

  return null;
}

