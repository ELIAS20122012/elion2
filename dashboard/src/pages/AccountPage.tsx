import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { journalApi, type BridgeInfo } from "../lib/journalApi";
import { SYMBOL, useApp } from "../state/AppContext";
import { useJournal } from "../state/JournalContext";

const STATUS_TEXT = { live: "متصل", connecting: "در حال اتصال…", down: "قطع", off: "خاموش (حالت بازپخش)" } as const;

export default function AccountPage() {
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
    <div className="page">
      <PageHeader title="اتصال به MetaTrader" subtitle="دو اتصال جدا و هر دو فقط‌خواندنی: قیمت زنده‌ی چارت از MT5، و ثبت خودکار معاملات ژورنال از MT4 یا MT5." />

      <Mt5Guide />
      <Mt4Guide />

      <div className="two-col">
        <section className="card">
          <h3>قیمت زنده‌ی چارت (MT5)</h3>
          <div className={`conn ${live.status}`}>
            <span className="dot" />
            {mode === "live" ? STATUS_TEXT[live.status] : STATUS_TEXT.off}
          </div>
          <dl className="kv">
            {rows.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd dir="ltr">{v}</dd></div>
            ))}
          </dl>
        </section>

        <section className="card">
          <h3>راه‌اندازی روزانه</h3>
          <ol className="steps">
            <li>MT5 را باز کنید و با حساب دمو وارد شوید (برای چارت زنده و ژورنال MT5).</li>
            <li>فایل <b dir="ltr">start-live.bat</b> را اجرا کنید (پل قیمت، سرور ژورنال و داشبورد با هم بالا می‌آیند).</li>
            <li>برای ژورنال MT4، ترمینال MT4 با اندیکاتور JournalBridge باز باشد.</li>
          </ol>
          <div className="notice">
            <b>ایمنی:</b> هیچ‌کدام از این اتصال‌ها سفارش ارسال نمی‌کند. اندیکاتور MT4 اصلاً توان معامله ندارد و رمز حساب را هیچ‌جا نمی‌گیرم.
          </div>
        </section>
      </div>
    </div>
  );
}

function Mt5Guide() {
  const { status, accounts } = useJournal();
  const [terms, setTerms] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => {
    if (status === "ok") journalApi.terminals().then(setTerms).catch(() => {});
  }, [status]);
  const mt5 = accounts.filter((a) => a.platform === "mt5" && a.kind !== "backtest");

  return (
    <section className="card">
      <h3>ثبت خودکار معاملات MT5 (پیشنهادی)</h3>
      <p className="muted small">بدون نصب چیزی داخل MT5: کافی است ترمینال باز و روی حساب وارد باشد. هر ۱۰ ثانیه معاملات باز و بسته، سود شناور و بیشترین سود/ضرر هر معامله ثبت می‌شود.</p>
      <ol className="steps big">
        <li>حساب MT5 لایو را باز کنید و در <b>یک ترمینال جدا</b> نصب و وارد شوید (بروکر همان مسیر نصب را دارد؛ آن را در یک پوشه‌ی دیگر مثلاً <b dir="ltr">C:\MT5-Live</b> نصب کنید). این‌طور ترمینال دمو/ربات دست نمی‌خورد.</li>
        <li>در «ژورنال» ← «＋ حساب جدید» ← پلتفرم <b dir="ltr">MT5</b>، شماره حساب لایو، «حساب واقعی» را بزنید و در «ترمینال MT5 این حساب» ترمینال لایو را انتخاب کنید.</li>
        <li>همین‌طور برای حساب دمو (ربات) ترمینال خودش را انتخاب کنید. هر دو همزمان و خودکار ثبت می‌شوند.</li>
      </ol>
      <div className="notice"><b>ایمنی:</b> ژورنال فقط می‌خواند و رمز حساب را نمی‌خواهد؛ خود شما در ترمینال وارد شده‌اید.</div>
      <dl className="kv">
        <div><dt>ترمینال‌های MT5 پیدا شده روی این رایانه</dt><dd dir="ltr" className="wrap">{terms.length ? terms.map((t) => t.name).join(", ") : "—"}</dd></div>
        <div><dt>حساب‌های MT5 در ژورنال</dt><dd>{mt5.length ? mt5.map((a) => `${a.name}${a.terminal_path ? "" : " (ترمینال پیش‌فرض)"}`).join("، ") : "—"}</dd></div>
      </dl>
    </section>
  );
}

function Mt4Guide() {
  const { status, detected, accounts } = useJournal();
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (status === "ok") journalApi.bridgeInfo().then(setInfo).catch(() => {});
  }, [status]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the path is selectable in the page */
    }
  };
  const mt4 = accounts.filter((x) => x.platform === "mt4");

  return (
    <section className="card">
      <h3>ثبت خودکار معاملات MT4 (فقط اگر حساب MT4 دارید)</h3>
      <p className="muted small">هر پوزیشنی که باز و بسته می‌کنید، خودکار و بدون Statement در ژورنال ثبت می‌شود؛ همراه با بیشترین سود و ضرر شناور هر معامله.</p>
      <ol className="steps big">
        <li>
          در MT4: <b dir="ltr">File → Open Data Folder → MQL4 → Indicators</b> و فایل زیر را آنجا کپی کنید.
          {info && (
            <div className="pathbox">
              <code dir="ltr">{info.indicator_path}</code>
              <button className="btn" onClick={() => copy(info.indicator_path, "p")}>{copied === "p" ? "کپی شد ✓" : "کپی مسیر"}</button>
            </div>
          )}
        </li>
        <li>در MT4 پنجره‌ی Navigator را باز کنید (Ctrl+N) ← <b dir="ltr">Indicators</b> ← راست‌کلیک ← Refresh. اگر <b dir="ltr">JournalBridge</b> کامپایل‌نشده بود، روی آن دوبار کلیک کنید تا MetaEditor باز شود و <b dir="ltr">F7</b> بزنید.</li>
        <li><b dir="ltr">JournalBridge</b> را روی یک چارت دلخواه بکشید و OK بزنید. (به دکمه‌ی AutoTrading نیازی نیست و اندیکاتور نمی‌تواند معامله کند.)</li>
        <li>به صفحه‌ی «ژورنال» بروید؛ حساب MT4 خودش شناسایی می‌شود و با یک کلیک اضافه می‌کنید.</li>
      </ol>
      <div className="notice">
        <b>مهم:</b> MT4 باید باز و روی همان حساب وارد شده باشد. اگر MT4 بسته باشد، معاملاتِ همان لحظه بعداً از تاریخچه‌ی MT4 (تا ۹۰ روز اخیر) ثبت می‌شوند، ولی بیشترین سود و ضرر شناورشان نه.
      </div>
      <dl className="kv">
        <div><dt>پوشه‌ی تبادل فایل</dt><dd dir="ltr" className="wrap">{info?.common_dir ?? "—"}</dd></div>
        <div><dt>وضعیت پوشه</dt><dd>{info ? (info.exists ? "موجود" : "پیدا نشد — یک‌بار MT4 یا MT5 را اجرا کنید") : "—"}</dd></div>
        <div><dt>اندیکاتور فعال روی MT4</dt><dd dir="ltr">{info?.files.length ? info.files.join(", ") : "هنوز چیزی گزارش نشده"}</dd></div>
        <div><dt>حساب‌های MT4 در ژورنال</dt><dd>{mt4.length ? mt4.map((x) => x.name).join("، ") : "—"}</dd></div>
        <div><dt>حساب شناسایی‌شده‌ی افزوده‌نشده</dt><dd dir="ltr">{detected.length ? detected.map((d) => d.login).join(", ") : "—"}</dd></div>
      </dl>
      {status !== "ok" && <p className="err">سرور ژورنال روشن نیست (start-live.bat).</p>}
    </section>
  );
}
