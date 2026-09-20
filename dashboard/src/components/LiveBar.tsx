import { useState } from "react";
import { Link } from "react-router-dom";
import { money } from "../lib/analytics";
import { journalApi, type Detected } from "../lib/journalApi";
import { useJournal } from "../state/JournalContext";

/** Offers to add MT4 accounts that the indicator is already reporting — the user never types a statement. */
export function DetectedBanner() {
  const { detected, refreshAccounts, setActive } = useJournal();
  if (detected.length === 0) return null;
  return (
    <div className="detected">
      {detected.map((d) => <DetectedCard key={d.login} d={d} onAdded={async (id) => { await refreshAccounts(); setActive(id); }} />)}
    </div>
  );
}

function DetectedCard({ d, onAdded }: { d: Detected; onAdded: (id: number) => void }) {
  const [name, setName] = useState(`MT4 ${d.login}`);
  const [live, setLive] = useState(!/demo/i.test(d.server));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    try {
      const a = await journalApi.createAccount({ name: name.trim() || `MT4 ${d.login}`, platform: "mt4", kind: "manual", login: d.login, broker: d.company, is_live: live, initial_balance: null });
      onAdded(a.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card detected-card">
      <div className="d-info">
        <b>حساب MT4 شناسایی شد <span dir="ltr">#{d.login}</span></b>
        <span className="muted small" dir="ltr">{d.company} · {d.server} · {d.balance?.toFixed(2)} {d.currency} · {d.open_count} open</span>
        <span className="muted small">اندیکاتور JournalBridge در حال ارسال اطلاعات است. با افزودن، همه‌ی معاملات از همین لحظه (و تاریخچه‌ی اخیر) خودکار ثبت می‌شود.</span>
      </div>
      <div className="d-form">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="نام حساب" />
        <label className="check-inline"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> حساب واقعی</label>
        <button className="btn primary" onClick={add} disabled={busy}>＋ افزودن به ژورنال</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** Connection state and live numbers of the selected account. */
export function LiveBar() {
  const { active, live } = useJournal();
  if (!active || active.kind === "backtest" || !live) return null;

  const isMt4 = active.platform === "mt4";
  const ok = live.connected;
  const fl = live.floating ?? 0;

  return (
    <div className={`livebar ${ok ? "on" : "off"}`}>
      <span className="live-dot" />
      <b>{ok ? "زنده" : isMt4 ? "منتظر اندیکاتور MT4" : "MT5 وصل نیست"}</b>
      {ok ? (
        <>
          <span className="muted small">هر معامله‌ای که باز و بسته کنید خودکار ثبت می‌شود</span>
          <span className="lv" dir="ltr">Balance {live.balance?.toFixed(2) ?? "—"}</span>
          <span className="lv" dir="ltr">Equity {live.equity?.toFixed(2) ?? "—"}</span>
          <span className={`lv ${fl >= 0 ? "up" : "down"}`} dir="ltr">{live.open_count ? `Floating ${money(fl)} (${live.open_count} open)` : "No open position"}</span>
        </>
      ) : (
        <span className="muted small">
          {isMt4 ? <>در MT4 اندیکاتور JournalBridge را روی یک چارت بگذارید. <Link to="/account">راهنمای نصب</Link></> : live.error ?? "ترمینال MT5 باز و لاگین باشد."}
        </span>
      )}
    </div>
  );
}
