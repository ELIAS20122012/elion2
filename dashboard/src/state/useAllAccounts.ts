import { useEffect, useState } from "react";
import { journalApi, type Account, type JTrade, type LiveInfo } from "../lib/journalApi";

export interface AccountRow { account: Account; trades: JTrade[]; live: LiveInfo | null }

/** Trades + live state of every account, refreshed in the background. Used by the overview and to draw real positions on the chart. */
export function useAllAccounts(accounts: Account[], enabled: boolean, everyMs = 8000): AccountRow[] {
  const [rows, setRows] = useState<AccountRow[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const load = async () => {
      const next = await Promise.all(
        accounts.map(async (account) => ({
          account,
          trades: await journalApi.trades(account.id).catch(() => [] as JTrade[]),
          live: account.kind === "backtest" ? null : await journalApi.live(account.id).catch(() => null),
        })),
      );
      if (!dead) setRows(next);
    };
    load();
    const id = setInterval(load, everyMs);
    return () => { dead = true; clearInterval(id); };
  }, [accounts, enabled, everyMs]);
  return rows;
}
