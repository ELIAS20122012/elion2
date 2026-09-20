import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AccountBar, { BackendGate, KIND_LABEL } from "../components/AccountBar";
import Kpis from "../components/Kpis";
import Icon from "../components/Icon";
import { DetectedBanner, LiveBar } from "../components/LiveBar";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/Toast";
import TradeDrawer from "../components/TradeDrawer";
import { durationSec, fmtDuration, isClosed, money, net, summarize } from "../lib/analytics";
import { fmtDateTime, fmtPrice } from "../lib/data";
import { journalApi, type JTrade } from "../lib/journalApi";
import { useJournal } from "../state/JournalContext";

const VALID_LABEL = { yes: "معتبر", no: "نامعتبر", unsure: "؟" } as const;

export default function JournalPage() {
  return (
    <div className="page wide">
      <PageHeader title="ژورنال" subtitle="معاملات هر حساب جدا و خودکار ثبت می‌شود. حساب را انتخاب کنید یا حساب جدید اضافه کنید." />
      <BackendGate>
        <AccountBar />
        <Body />
      </BackendGate>
    </div>
  );
}

function Body() {
  const { accounts, active, trades, refreshTrades, refreshAccounts } = useJournal();
  const [open, setOpen] = useState<JTrade | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState<"all" | "buy" | "sell">("all");
  const [res, setRes] = useState<"all" | "win" | "loss" | "open">("all");
  const [sym, setSym] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))], [trades]);
  const shown = useMemo(
    () =>
      trades
        .filter((t) => (dir === "all" || t.direction === dir) && (sym === "all" || t.symbol === sym))
        .filter((t) => (res === "all" ? true : res === "open" ? !isClosed(t) : isClosed(t) && (res === "win" ? net(t) > 0 : net(t) < 0)))
        .sort((a, b) => b.open_time - a.open_time),
    [trades, dir, res, sym],
  );
  const summary = useMemo(() => summarize(trades), [trades]);

  if (accounts.length === 0)
    return (
      <>
        <DetectedBanner />
        <div className="card empty-state">
          <h3>هنوز حسابی اضافه نشده</h3>
          <p className="muted">با «＋ حساب جدید» بالای صفحه شروع کنید. برای MT4 کافی است اندیکاتور JournalBridge را در ترمینال روی یک چارت بگذارید؛ حساب خودش اینجا شناسایی می‌شود و با یک کلیک اضافه می‌شود. <Link to="/account">راهنمای نصب</Link></p>
        </div>
      </>
    );
  if (!active) return <DetectedBanner />;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.ok(await fn());
      await Promise.all([refreshTrades(), refreshAccounts()]);
    } catch (e) {
      toast.err((e as Error).message);
    }
    setBusy(false);
  };

  const sync = () => run(async () => {
    const r = await journalApi.syncMt5(active.id);
    return `${r.fetched} معامله از MT5 خوانده شد (${r.inserted} جدید، ${r.updated} به‌روز).`;
  });
  const importFile = (f: File) => run(async () => {
    const r = await journalApi.importFile(active.id, f);
    return `${r.parsed} معامله در فایل بود (${r.inserted} جدید، ${r.updated} از قبل موجود).`;
  });

  return (
    <>
      <DetectedBanner />
      <LiveBar />
      <div className="toolbar-row">
        <p className="muted small">
          {active.platform === "mt4"
            ? "ثبت خودکار است (اندیکاتور JournalBridge). فایل Statement فقط برای معاملات قدیمی‌تر از نصب اندیکاتور لازم است."
            : "ثبت خودکار است و هر ۱۰ ثانیه از ترمینال MT5 به‌روز می‌شود."}
          <span> · {KIND_LABEL[active.kind]}{active.login ? ` · ${active.login}` : ""}</span>
        </p>
        <div className="tb-actions">
          {active.platform === "mt5" && <button className="btn" onClick={sync} disabled={busy}><Icon name="refresh" size={16} />همگام‌سازی همین حالا</button>}
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy} title="فقط برای معاملات قدیمی‌تر از زمان نصب اندیکاتور لازم است"><Icon name="upload" size={16} />وارد کردن فایل قدیمی</button>
          <input ref={fileRef} type="file" accept=".htm,.html,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </div>
      </div>

      <Kpis s={summary} />

      <section className="card">
        <div className="filters">
          <h3>معاملات <small className="muted">({shown.length})</small></h3>
          <div className="seg">{([["all", "همه"], ["buy", "خرید"], ["sell", "فروش"]] as const).map(([v, l]) => <button key={v} className={dir === v ? "on" : ""} onClick={() => setDir(v)}>{l}</button>)}</div>
          <div className="seg">{([["all", "همه"], ["win", "سودده"], ["loss", "زیان‌ده"], ["open", "باز"]] as const).map(([v, l]) => <button key={v} className={res === v ? "on" : ""} onClick={() => setRes(v)}>{l}</button>)}</div>
          {symbols.length > 1 && (
            <select value={sym} onChange={(e) => setSym(e.target.value)} dir="ltr" aria-label="نماد">
              <option value="all">همه‌ی نمادها</option>
              {symbols.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
        </div>

        {trades.length === 0 ? (
          <div className="empty">این حساب هنوز معامله‌ای ندارد. {active.platform === "mt5" ? "«همگام‌سازی MT5» را بزنید." : "فایل Statement را وارد کنید."}</div>
        ) : shown.length === 0 ? (
          <div className="empty">با این فیلترها معامله‌ای نیست.</div>
        ) : (
          <div className="table-wrap">
            <table className="clickable">
              <thead><tr><th>زمان ورود</th><th>نماد</th><th>جهت</th><th>حجم</th><th>ورود</th><th>خروج</th><th>مدت</th><th>سود/زیان</th><th>برچسب‌ها</th></tr></thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} onClick={() => setOpen(t)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(t)}>
                    <td>{fmtDateTime(t.open_time)}</td>
                    <td>{t.symbol}</td>
                    <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "BUY" : "SELL"}</td>
                    <td>{t.volume}</td>
                    <td>{fmtPrice(t.open_price)}</td>
                    <td>{isClosed(t) ? fmtPrice(t.close_price) : <span className="mini open">باز</span>}</td>
                    <td>{isClosed(t) ? fmtDuration(durationSec(t)) : "—"}</td>
                    <td className={(isClosed(t) ? net(t) : t.profit) >= 0 ? "up" : "down"}>
                      {isClosed(t) ? money(net(t)) : <>{money(t.profit)} <small className="muted">شناور</small></>}
                    </td>
                    <td className="tags-cell">
                      {t.setup_valid && <span className={`mini ${t.setup_valid}`}>{VALID_LABEL[t.setup_valid]}</span>}
                      {t.emotion && <span className="mini">{t.emotion}</span>}
                      {t.error && <span className="mini bad">{t.error}</span>}
                      {!t.setup_valid && !t.emotion && !t.error && <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && <TradeDrawer trade={trades.find((t) => t.id === open.id) ?? open} onClose={() => setOpen(null)} onSaved={refreshTrades} />}
    </>
  );
}
