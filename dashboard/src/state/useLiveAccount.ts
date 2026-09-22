import { useEffect, useState } from "react";
import { journalApi, type Account, type LiveInfo } from "../lib/journalApi";

/**
 * The real (non-demo, non-backtest) account's own balance, read straight from the journal — independent of which
 * MT5 terminal happens to be streaming the chart's candles. Added because the top bar's old "DEMO/REAL" chip
 * mirrored the CHART's price source, which is pinned to the demo/robot terminal; Elias was reading his live
 * profit off a number that was actually the demo account's, and it looked "stuck".
 */
export function useLiveAccount(accounts: Account[], enabled: boolean): { account: Account; live: LiveInfo } | null {
  const liveAccount = accounts.find((a) => a.is_live && a.kind !== "backtest" && a.platform === "mt5");
  const [live, setLive] = useState<LiveInfo | null>(null);

  useEffect(() => {
    if (!enabled || !liveAccount) { setLive(null); return; }
    let dead = false;
    const load = () => { journalApi.live(liveAccount.id).then((l) => !dead && setLive(l)).catch(() => {}); };
    load();
    const id = setInterval(load, 8000);
    return () => { dead = true; clearInterval(id); };
  }, [enabled, liveAccount?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return liveAccount && live ? { account: liveAccount, live } : null;
}
