import PageHeader from "../components/PageHeader";
import { useMaxPerDay, useTheme } from "../lib/prefs";
import { useApp } from "../state/AppContext";

export default function SettingsPage() {
  const [theme, setTheme] = useTheme();
  const [cap, setCap] = useMaxPerDay();
  const { drawings, setDrawings, indicators, setIndicators, magnet, setMagnet, showVolume, setShowVolume } = useApp();
  return (
    <div className="page">
      <PageHeader title="تنظیمات" subtitle="ترجیحات چارت و داده‌های ذخیره‌شده در همین مرورگر." />

      <section className="card settings">
        <h3>ظاهر</h3>
        <div className="row">
          <div><b>تم</b><small>نئونی (آبی، مثل مرکز فرماندهی) یا کلاسیک (طلایی)</small></div>
          <div className="seg" role="group" aria-label="تم">
            <button className={theme === "neon" ? "on" : ""} onClick={() => setTheme("neon")}>نئونی</button>
            <button className={theme === "classic" ? "on" : ""} onClick={() => setTheme("classic")}>کلاسیک</button>
          </div>
        </div>
      </section>

      <section className="card settings">
        <h3>ریسک روز</h3>
        <label className="row">
          <div><b>سقف معامله در روز</b><small>در «فشار روز»، هشدارها و آنالیز استفاده می‌شود. الان طبق آزمایش خودتان: ۳</small></div>
          <input type="number" min={1} value={cap} onChange={(e) => setCap(Number(e.target.value))} dir="ltr" style={{ width: 80 }} />
        </label>
      </section>

      <section className="card settings">
        <h3>چارت</h3>
        <label className="row">
          <div><b>آهن‌ربا</b><small>نقطه‌ی رسم به High/Low/Open/Close نزدیک‌ترین کندل می‌چسبد</small></div>
          <span className="switch"><input type="checkbox" checked={magnet} onChange={(e) => setMagnet(e.target.checked)} /><span /></span>
        </label>
        <label className="row">
          <div><b>نمایش حجم</b><small>حجم تیک MT5 زیر چارت (فقط در حالت زنده)</small></div>
          <span className="switch"><input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} /><span /></span>
        </label>
      </section>

      <section className="card settings">
        <h3>داده‌های ذخیره‌شده</h3>
        <div className="row">
          <div><b>رسم‌ها</b><small>{drawings.length} مورد</small></div>
          <button className="btn danger" disabled={!drawings.length} onClick={() => window.confirm("همه‌ی رسم‌ها پاک شوند؟") && setDrawings([])}>پاک‌کردن</button>
        </div>
        <div className="row">
          <div><b>اندیکاتورها</b><small>{indicators.length} مورد</small></div>
          <button className="btn danger" disabled={!indicators.length} onClick={() => window.confirm("همه‌ی اندیکاتورها حذف شوند؟") && setIndicators([])}>پاک‌کردن</button>
        </div>
      </section>

      <section className="card settings">
        <h3>درباره</h3>
        <p className="muted small">Robot Trading · داشبورد نسخه‌ی ۰٫۲ · چارت با Lightweight Charts (TradingView، متن‌باز)</p>
      </section>
    </div>
  );
}
