import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import { money } from "../lib/analytics";
import { journalApi, type BridgeInfo } from "../lib/journalApi";
import { SYMBOL, useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";
import { useAllAccounts } from "../state/useAllAccounts";

const STATUS_TEXT = { live: "متصل", connecting: "در حال اتصال…", down: "قطع", off: "خاموش (حالت بازپخش)" } as const;
const KIND = { manual: "ترید دستی", robot: "ربات", backtest: "بک‌تست" } as const;

/** Connection STATUS only. All instructions are in the Help page. */
export default function AccountPage() {
  return (
    <div className="page wide">
      <PageHeader
        title="اتصال"
        subtitle="وضعیت زنده‌ی قیمت چارت و ثبت خودکار حساب‌ها."
        actions={<Link className="btn" to="/help?topic=quickstart"><Icon name="book" size={16} />راهنمای اتصال</Link>}
      />
      <PriceCard />
      <AccountsCard />
      <Mt4Card />
    </div>
  );
}

function PriceCard() {
  const { live, mode } = useApp();
  const a = live.account;
  const rows: [string, string][] = [
    ["شماره حساب", a?.login ? String(a.login) : "—"],
    ["سرور", a?.server ?? "—"],
    ["نوع حساب", a ? (a.demo ? "دمو" : "واقعی") : "—"],
    ["نماد", a?.symbol ?? SYMBOL],
    ["موجودی", a?.balance != null ? `${a.balance.toFixed(2)}$` : "—"],
    ["اکوییتی", a?.equity != null ? `${a.equity.toFixed(2)}$` : "—"],
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h3>قیمت زنده‌ی چارت (MT5)</h3>
        <span className={`conn ${live.status}`} style={{ margin: 0 }}><span className="dot" />{mode === "live" ? STATUS_TEXT[live.status] : STATUS_TEXT.off}</span>
      </div>
      <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="ltr">{v}</dd></div>)}</dl>
    </section>
  );
}

function AccountsCard() {
  const { accounts, status } = useJournal();
  const rows = useAllAccounts(accounts, status === "ok", 4000).filter((r) => r.account.kind !== "backtest");
  const [terms, setTerms] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => {
    if (status === "ok") journalApi.terminals().then(setTerms).catch(() => {});
  }, [status]);
  const termName = (p: string | null) => (p ? terms.find((t) => t.path === p)?.name ?? p : "ترمینال پیش‌فرض");

  return (
    <section className="card">
      <div className="card-head">
        <h3>ثبت خودکار حساب‌ها</h3>
        <Link className="btn sm" to="/journal"><Icon name="plus" size={14} />افزودن حساب</Link>
      </div>
      {status !== "ok" ? (
        <p className="err">سرور ژورنال روشن نیست. <Link to="/help?topic=trouble">راهنمای عیب‌یابی</Link></p>
      ) : rows.length === 0 ? (
        <p className="empty">هنوز حسابی اضافه نشده. از «ژورنال» یک حساب بسازید.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>حساب</th><th>پلتفرم</th><th>نوع</th><th>وضعیت</th><th>ترمینال</th><th>Balance</th><th>Equity</th><th>شناور</th><th>باز</th></tr></thead>
            <tbody>
              {rows.map(({ account: a, live: lv }) => (
                <tr key={a.id}>
                  <td style={{ direction: "rtl" }}>{a.name}{a.is_live && <span className="pill live" style={{ marginInlineStart: 8 }}>LIVE</span>}</td>
                  <td>{a.platform.toUpperCase()}</td>
                  <td style={{ direction: "rtl" }}>{KIND[a.kind]}</td>
                  <td style={{ direction: "rtl" }}><span className={`chip ${lv?.connected ? "on" : "off"}`}>{lv?.connected ? "زنده" : "قطع"}</span></td>
                  <td style={{ direction: "rtl" }}>{a.platform === "mt5" ? termName(a.terminal_path) : "اندیکاتور MT4"}</td>
                  <td>{lv?.balance != null ? lv.balance.toFixed(2) : "—"}</td>
                  <td>{lv?.equity != null ? lv.equity.toFixed(2) : "—"}</td>
                  <td className={(lv?.floating ?? 0) >= 0 ? "up" : "down"}>{lv?.open_count ? money(lv.floating ?? 0) : "—"}</td>
                  <td>{lv?.open_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.some((r) => !r.live?.connected && r.account.platform === "mt5" && r.live?.error) && (
        <p className="muted small" style={{ marginTop: 10 }}>{rows.find((r) => r.live?.error)?.live?.error}</p>
      )}
    </section>
  );
}

function Mt4Card() {
  const { status, detected, accounts } = useJournal();
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  useEffect(() => {
    if (status === "ok") journalApi.bridgeInfo().then(setInfo).catch(() => {});
  }, [status]);
  const mt4 = accounts.filter((x) => x.platform === "mt4");

  return (
    <section className="card">
      <div className="card-head">
        <h3>اندیکاتور MT4 <span className="muted small">(اختیاری)</span></h3>
        <Link className="btn sm" to="/help?topic=mt4"><Icon name="book" size={14} />راهنمای نصب</Link>
      </div>
      <dl className="kv">
        <div><dt>پوشه‌ی تبادل فایل</dt><dd dir="ltr" className="wrap">{info?.common_dir ?? "—"}</dd></div>
        <div><dt>وضعیت پوشه</dt><dd>{info ? (info.exists ? "موجود" : "پیدا نشد") : "—"}</dd></div>
        <div><dt>اندیکاتور گزارش‌دهنده</dt><dd dir="ltr" className="wrap">{info?.files.length ? info.files.join(", ") : "هنوز چیزی گزارش نشده"}</dd></div>
        <div><dt>حساب‌های MT4 در ژورنال</dt><dd>{mt4.length ? mt4.map((x) => x.name).join("، ") : "—"}</dd></div>
        <div><dt>حساب شناسایی‌شده‌ی افزوده‌نشده</dt><dd dir="ltr">{detected.length ? detected.map((d) => d.login).join(", ") : "—"}</dd></div>
      </dl>
    </section>
  );
}
