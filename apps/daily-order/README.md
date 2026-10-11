# Daily Order (نظم روزانه)

اپ شخصی فارسی برای برنامه‌ریزی روزانه، کارها و عادت‌ها، کیف پول و حسابداری، و ورزش. بدون بیلد و بدون وابستگی:
فقط HTML/CSS و ماژول‌های ES. همه‌ی داده‌ها فقط در `localStorage` مرورگر (کلید `daily-order-v2`) می‌مانند.

## اجرا
ماژول‌های ES از `file://` بارگذاری نمی‌شوند؛ با هر سرور ایستا باز کنید:

```
cd apps/daily-order
python3 -m http.server 8765      # یا: npx http-server -p 8765
# → http://localhost:8765/
```

## تست
```
node --test "apps/daily-order/tests/*.test.js"      # (هم‌چنین جزو npm test ریشه است)
```

## ساختار
```
index.html            شِل: هدر، ناوبری پایین، <main id="app">
css/
  tokens.css          رنگ و سایه (روشن/تاریک با html.dark)
  base.css            ریست، شِل، ابزارهای چیدمان، toast و sheet
  components.css      کارت، دکمه، فرم، آکاردئون (hub)، نمودار…
  pages.css           استایل مخصوص هر صفحه
src/
  main.js             راه‌اندازی، روتر hash، حلقه‌ی رندر
  router.js           مسیرها (#/dashboard …) و go()
  core/               بدون DOM: config, util, dates, jalali, calendar, format, seed, store
  domain/             منطق داده (finance, tasks, gym, planner) — فقط روی state، بدون DOM
  ui/                 dom (delegate/patchHTML), sheet (فرم/منو/تأیید), toast, hub (آکاردئون), widgets, theme
  services/           files (ذخیره/انتخاب فایل), ai (قابلیت‌های اختیاری میزبان), notify
  features/           دیالوگ‌های مشترک بین صفحه‌ها (مالی، کارها، ورزش، برنامه‌ریز، تنظیمات، یادآور)
  pages/              dashboard, tasks, planner, gym, wallet (+ wallet-hub)
tests/                node:test برای core و domain
```

## قراردادها
- **State**: یک سند JSON (`S` از `core/store.js`). بعد از هر تغییر `commit()` (ذخیره + رندر مجدد)؛ برای متنِ در حال تایپ `persist()`.
- **صفحه**: `{ id, title, render() → html, act, input, change, hold, mount?, tick? }`. رویدادها با `data-act="name"`
  (و `data-input`, `data-change`, `data-hold`) به‌صورت delegated به `act[name](el, ev)` می‌رسند؛ بدون addEventListener روی هر المان.
- **رندر**: رشته‌ی HTML (هر مقدار کاربر با `esc()`)، و `patchHTML` فوکوس فیلدهای `data-key` را نگه می‌دارد.
- **تاریخ**: ذخیره‌ی میلادی `YYYY-MM-DD`؛ نمایش و ماه‌ها با تقویم انتخابی (شمسی پیش‌فرض) از `core/calendar.js`.
- **سازگاری داده**: `migrate()` در `core/store.js` سندهای قدیمی را ارتقا می‌دهد.
