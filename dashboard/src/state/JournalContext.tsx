import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { journalApi, type Account, type Detected, type JTrade, type LiveInfo } from "../lib/journalApi";

const ACTIVE_KEY = "rt.journal.active";
export type BackendStatus = "loading" | "ok" | "down";

function loadActive(): number | null {
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function useJournalState() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveRaw] = useState<number | null>(loadActive);
  const [trades, setTrades] = useState<JTrade[]>([]);
  const [status, setStatus] = useState<BackendStatus>("loading");
  const [detected, setDetected] = useState<Detected[]>([]);
  const [live, setLive] = useState<LiveInfo | null>(null);

  const setActive = useCallback((id: number | null) => {
    setActiveRaw(id);
    try {
      if (id == null) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, String(id));
    } catch {
      /* not persisted */
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await journalApi.accounts();
      setAccounts(list);
      setStatus("ok");
      setActiveRaw((cur) => (cur != null && list.some((a) => a.id === cur) ? cur : list[0]?.id ?? null));
    } catch {
      setStatus("down");
    }
  }, []);

  const active = useMemo(() => accounts.find((a) => a.id === activeId) ?? null, [accounts, activeId]);

  const refreshTrades = useCallback(async () => {
    if (activeId == null) return setTrades([]);
    try {
      setTrades(await journalApi.trades(activeId));
    } catch {
      /* keep what we have; status is tracked by refreshAccounts */
    }
  }, [activeId]);

  useEffect(() => {
    refreshAccounts();
    const id = setInterval(refreshAccounts, 30000);
    return () => clearInterval(id);
  }, [refreshAccounts]);

  useEffect(() => {
    setTrades([]);
    refreshTrades();
    const id = setInterval(refreshTrades, 20000); // picks up trades an EA or the robot pushed in
    return () => clearInterval(id);
  }, [refreshTrades]);

  // accounts the MT4 indicator reports that the user hasn't added yet
  useEffect(() => {
    if (status !== "ok") return;
    let dead = false;
    const tick = () => journalApi.detected().then((d) => !dead && setDetected(d)).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => { dead = true; clearInterval(id); };
  }, [status]);

  // connection state + floating P/L of the selected account, and the trades it produced
  useEffect(() => {
    setLive(null);
    if (activeId == null || status !== "ok") return;
    let dead = false;
    const tick = () => {
      journalApi.live(activeId).then((l) => !dead && setLive(l)).catch(() => {});
      journalApi.trades(activeId).then((t) => !dead && setTrades(t)).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { dead = true; clearInterval(id); };
  }, [activeId, status]);

  return { accounts, active, activeId, setActive, trades, status, detected, live, refreshAccounts, refreshTrades };
}

export type JournalState = ReturnType<typeof useJournalState>;
const Ctx = createContext<JournalState | null>(null);

export function JournalProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useJournalState()}>{children}</Ctx.Provider>;
}

export function useJournal(): JournalState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useJournal must be used inside <JournalProvider>");
  return v;
}
