import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import { journalApi, type BridgeInfo } from "../lib/journalApi";
import { useJournal } from "../state/JournalContext";

interface Topic { id: string; title: string; icon: string; body: ReactNode }

/** All instructions live here; other pages only link to a topic (`/help?topic=mt4`). */
export default function HelpPage() {
  const [params, setParams] = useSearchParams();
  const active = params.get("topic") ?? "quickstart";
  const top = useRef<HTMLDivElement>(null);

  const topics: Topic[] = [
    { id: "quickstart", title: "شروع سریع", icon: "play", body: <Quickstart /> },
    { id: "mt5", title: "حساب MT5 (دمو و لایو)", icon: "wallet", body: <Mt5 /> },
    { id: "mt4", title: "حساب MT4 (اختیاری)", icon: "plug", body: <Mt4 /> },
    { id: "concepts", title: "ژورنال، آنالیز و بک‌تست", icon: "notebook", body: <Concepts /> },
    { id: "trouble", title: "عیب‌یابی", icon: "refresh", body: <Trouble /> },
    { id: "safety", title: "ایمنی و پشتیبان‌گیری", icon: "server", body: <Safety /> },
  ];
  const current = topics.find((t) => t.id === active) ?? topics[0];

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [current.id]);

  return (
    <div className="page wide">
      <PageHeader title="راهنما" subtitle="آموزش نصب، اتصال حساب‌ها و حل مشکلات رایج. وضعیت زنده‌ی اتصال‌ها در صفحه‌ی «اتصال» است." actions={<Link className="btn" to="/account">رفتن به وضعیت اتصال</Link>} />
      <div className="help" ref={top}>
        <nav className="toc" aria-label="موضوعات راهنما">
          {topics.map((t) => (
            <button key={t.id} className={t.id === current.id ? "on" : ""} onClick={() => setParams({ topic: t.id })}>
              <Icon name={t.icon} size={18} />
              {t.title}
            </button>
          ))}
        </nav>
        <article className="card help-body">
          <h3>{current.title}</h3>
          {current.body}
        </article>
      </div>
    </div>
  );
}

function Quickstart() {
  return (
    <>
      <p className="muted">هر بار که رایانه را روشن می‌کنید:</p>
      <ol className="steps big">
        <li>ترمینال <b dir="ltr">MT5</b> را باز کنید و با حساب خودتان (دمو) وارد شوید.</li>
        <li>در پوشه‌ی <b dir="ltr">robot-trading</b> روی Desktop، روی <b dir="ltr">start-live.bat</b> دوبار کلیک کنید.</li>
        <li>سه پنجره‌ی سیاه باز می‌شود: پل قیمت، سرور ژورنال و داشبورد. <b>آن‌ها را نبندید.</b> مرورگر خودش داشبورد را باز می‌کند (<span dir="ltr">http://localhost:5173</span>).</li>
        <li>در «نمای کلی» باید نوار وضعیت سبز باشد. اگر قرمز بود، به «عیب‌یابی» بروید.</li>
      </ol>
      <div className="notice"><b>نکته:</b> پل قیمت و سرور ژورنال اگر بی‌دلیل بایستند ظرف ۳ ثانیه خودشان دوباره راه می‌افتند.</div>
    </>
  );
}

function Mt5() {
  const [terms, setTerms] = useState<{ path: string; name: string }[]>([]);
  const { status } = useJournal();
  useEffect(() => {
    if (status === "ok") journalApi.terminals().then(setTerms).catch(() => {});
  }, [status]);
  return (
    <>
      <p className="muted">MT5 بدون نصب چیزی داخل خودش وصل می‌شود: کافی است ترمینال باز و روی حساب وارد باشد. هر ۱۰ ثانیه معاملات باز و بسته، سود شناور و بیشترین سود/ضرر هر معامله ثبت می‌شود.</p>
      <h4>افزودن یک حساب MT5</h4>
      <ol className="steps big">
        <li>در «ژورنال» روی <b>«حساب جدید»</b> بزنید.</li>
        <li>نام دلخواه، پلتفرم <b dir="ltr">MT5</b>، نوع حساب (ربات یا ترید دستی) و شماره حساب را بنویسید. برای حساب واقعی گزینه‌ی «حساب واقعی» را بزنید.</li>
        <li>در «ترمینال MT5 این حساب» ترمینالی را انتخاب کنید که روی همین حساب وارد است.</li>
        <li>«ساخت حساب» را بزنید؛ ظرف چند ثانیه معاملات وارد می‌شوند.</li>
      </ol>
      <h4>دمو و لایو همزمان</h4>
      <p className="muted">یک ترمینال MT5 در هر لحظه فقط روی یک حساب وارد است. برای اینکه دمو (ربات) و لایو (ترید دستی) هر دو ثبت شوند، MT5 را <b>یک‌بار دیگر در یک پوشه‌ی جدا</b> نصب کنید (مثلاً <span dir="ltr">C:\MT5-Live</span>)، با حساب لایو وارد شوید و برای هر حساب ترمینال خودش را انتخاب کنید.</p>
      <dl className="kv">
        <div><dt>ترمینال‌های MT5 پیدا شده روی این رایانه</dt><dd dir="ltr" className="wrap">{terms.length ? terms.map((t) => t.name).join(", ") : "—"}</dd></div>
      </dl>
    </>
  );
}

function Mt4() {
  const { status } = useJournal();
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (status === "ok") journalApi.bridgeInfo().then(setInfo).catch(() => {});
  }, [status]);

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.indicator_path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the path is selectable */
    }
  };

  return (
    <>
      <p className="muted">فقط اگر حساب MT4 دارید. یک اندیکاتور فقط‌خواندنی وضعیت پوزیشن‌ها را در یک فایل کنار MT4 می‌نویسد و ژورنال آن را می‌خواند. اندیکاتور <b>نمی‌تواند معامله کند</b> و به دکمه‌ی AutoTrading هم نیاز ندارد.</p>
      <ol className="steps big">
        <li>
          در MT4: <b dir="ltr">File → Open Data Folder → MQL4 → Indicators</b> و فایل زیر را آنجا کپی کنید.
          {info && (
            <div className="pathbox">
              <code dir="ltr">{info.indicator_path}</code>
              <button className="btn sm" onClick={copy}><Icon name="copy" size={14} />{copied ? "کپی شد" : "کپی مسیر"}</button>
            </div>
          )}
        </li>
        <li>پنجره‌ی Navigator را باز کنید (<b dir="ltr">Ctrl+N</b>) ← <b dir="ltr">Indicators</b> ← راست‌کلیک ← <b dir="ltr">Refresh</b>. اگر <b dir="ltr">JournalBridge</b> کامپایل نشده بود، روی آن دوبار کلیک کنید تا MetaEditor باز شود و <b dir="ltr">F7</b> بزنید.</li>
        <li><b dir="ltr">JournalBridge</b> را روی یک چارت دلخواه بکشید و OK بزنید.</li>
        <li>به صفحه‌ی «ژورنال» بروید؛ حساب MT4 خودش شناسایی می‌شود و با یک کلیک اضافه می‌کنید.</li>
      </ol>
      <div className="notice"><b>مهم:</b> MT4 باید باز و روی همان حساب وارد باشد. اگر بسته باشد، معاملات همان زمان بعداً از تاریخچه‌ی MT4 (تا ۹۰ روز اخیر) ثبت می‌شوند، ولی بیشترین سود و ضرر شناورشان نه.</div>
    </>
  );
}

function Concepts() {
  return (
    <dl className="glossary">
      <dt>ژورنال</dt>
      <dd>لیست معاملات هر حساب. با کلیک روی هر معامله، اعتبار ستاپ، حالت روانی و خطای اجرا را با چند کلیک برچسب می‌زنید (نوشتن اجباری نیست). «ضرر ستاپ» با «خطای اجرا» فرق دارد: یک ستاپ معتبر با اجرای درست هم می‌تواند ضرر بدهد.</dd>
      <dt>آنالیز</dt>
      <dd>آمار و الگوهای هر حساب جدا از حساب‌های دیگر: منحنی سرمایه، سود بر اساس ساعت و روز، روزهایی که از سقف معامله گذشته‌اید، و پس‌دادن سود. اعداد فقط توصیف داده‌اند، نه قانون.</dd>
      <dt>MFE و MAE</dt>
      <dd>بیشترین سود و بیشترین ضرر شناوری که هر معامله در طول باز بودن نشان داده است. با آن می‌بینید سود را کجای معامله دیده‌اید و چقدر از آن را پس داده‌اید.</dd>
      <dt>بک‌تست</dt>
      <dd>اجرای یک استراتژی روی کندل‌های موجود. نتیجه به‌صورت یک حساب «بک‌تست» جدا ذخیره می‌شود و همان ژورنال و آنالیز را دارد. فرضیات ساده دارد و فقط برای مقایسه‌ی روش‌هاست، نه اثبات سودآوری.</dd>
      <dt>قوانین</dt>
      <dd>قوانین سیستم به ترتیب آموزش. هر قانون بعد از رسم روی چارت و تأیید شما «تأیید شده» می‌شود.</dd>
      <dt>ربات و حساب لایو</dt>
      <dd>ربات فقط روی حساب دمو کار می‌کند. ژورنال حساب لایو را فقط می‌خواند و هرگز سفارش نمی‌دهد.</dd>
    </dl>
  );
}

function Trouble() {
  const items: [string, string][] = [
    ["«سرور ژورنال در دسترس نیست» می‌بینم", "پنجره‌ی Journal API را ببندید و start-live.bat را دوباره اجرا کنید. اگر پنجره‌ها باز هستند، چند ثانیه صبر کنید و صفحه را رفرش کنید؛ سرور خودش دوباره راه می‌افتد."],
    ["قیمت چارت نمی‌آید یا «پل MT5 قطع است»", "MT5 باید باز و لاگین باشد و نماد XAUUSD در Market Watch فعال باشد. پنجره‌ی MT5 Bridge را چک کنید. آخر هفته بازار بسته است و قیمت حرکت نمی‌کند."],
    ["معامله‌ای که زدم در ژورنال نیست", "برای MT5 تا ۱۰ ثانیه صبر کنید. مطمئن شوید ترمینال روی همان حساب وارد است و در حساب ژورنال ترمینال درست انتخاب شده. اگر شماره حساب با ترمینال نخواند، صفحه‌ی «اتصال» پیام روشن می‌دهد."],
    ["نوار حساب می‌گوید «MT5 وصل نیست»", "ترمینال MT5 آن حساب باز و لاگین نیست، یا در «تنظیم حساب» ترمینال اشتباه انتخاب شده."],
    ["حساب MT4 شناسایی نمی‌شود", "اندیکاتور JournalBridge باید روی یک چارت باشد و در گوشه‌ی چارت پیامی داشته باشد. در «اتصال» بخش MT4 را نگاه کنید: اگر فایلی گزارش نشده، اندیکاتور کار نمی‌کند."],
    ["پیام خطا هنگام کامپایل اندیکاتور در MT4", "متن خطا را برای پشتیبان پروژه بفرستید تا اصلاح شود."],
  ];
  return (
    <div className="faq">
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p className="muted">{a}</p>
        </details>
      ))}
    </div>
  );
}

function Safety() {
  return (
    <>
      <div className="notice"><b>ایمنی:</b> هیچ‌کدام از اتصال‌ها سفارش ارسال نمی‌کند و رمز حساب را نمی‌گیرد. ربات فقط روی دمو کار می‌کند و اجرای خودکار سفارش تا تأیید قوانین غیرفعال است.</div>
      <h4>پشتیبان‌گیری</h4>
      <p className="muted">فایل <b dir="ltr">backup.bat</b> در پوشه‌ی پروژه یک نسخه از کد و پایگاه‌داده‌ی ژورنال را در <span dir="ltr">OneDrive\Backups\robot-trading</span> می‌گذارد. هر وقت خواستید (مثلاً پایان روز کاری) آن را اجرا کنید.</p>
      <p className="muted">بازیابی روی رایانه‌ی جدید: <span dir="ltr">git clone &lt;فایل bundle&gt; robot-trading</span> و کپی دیتابیس‌ها از پوشه‌ی <span dir="ltr">data</span>.</p>
      <h4>داده‌ها</h4>
      <p className="muted">ژورنال داده‌ها را فقط روی همین رایانه (فایل <span dir="ltr">backend\journal.db</span>) نگه می‌دارد. رسم‌ها و اندیکاتورهای چارت در مرورگر ذخیره می‌شوند.</p>
    </>
  );
}
