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

## فایل یکپارچه (برای آرتیفکت یا باز کردن مستقیم)
```
node apps/daily-order/tools/build.mjs   # → apps/daily-order/dist/daily-order.html
```
یک HTML مستقل (CSS و JS داخلش) که از `file://` و داخل میزبان‌های sandbox هم باز می‌شود. بعد از هر تغییر در `src/` یا `css/` دوباره بسازید.

## تست
```
node --test "apps/daily-order/tests/*.test.js"      # (هم‌چنین جزو npm test ریشه است)
```

## صفحه‌ها (ساده، سه تا)
- **امروز**: کارهای باقی‌مانده (+ معوق)، افزودن سریع با Enter، عادت‌ها (لمس = یک قدم). «انجام‌شده» و «بعداً» جمع‌شده‌اند.
- **پول**: موجودی، دکمه‌ی هزینه/درآمد، سررسیدهای ۷ روز آینده با «پرداخت» یک‌لمسی (واگرد دارد)، آخرین تراکنش‌ها.
  قسط/قبض/حساب/گزارش پشت یک لینک «قسط، قبض و حساب‌ها» هستند.
- **ورزش**: نوار «برنامه باشگاه» → هفت روز هفته → برنامه‌ی همان روز (لمس ست‌ها، ویرایش برنامه)؛ زیرش کالری همان روز
  (نوار، وعده‌ها، «عکس غذا» که کالری را تخمین می‌زند و روی همان روز ذخیره می‌کند، یا ورود دستی)؛ و وزن.
  تشخیص کالری از عکس: داخل آرتیفکت Claude خودکار؛ در مرورگر معمولی با کلید Gemini در تنظیمات (کلید جدا از داده‌ها ذخیره می‌شود و در بکاپ نیست).

## ساختار
```
index.html            شِل: هدر (عنوان + تنظیمات)، ناوبری پایین، <main id="app">
css/                  tokens (رنگ/سایه، روشن و تاریک) · base · components · pages
src/
  main.js, router.js  راه‌اندازی، روتر hash (#/today #/money #/gym)
  core/               بدون DOM: config, util, dates, jalali, calendar, format, seed, store
  domain/             منطق داده (finance, tasks, gym) — فقط روی state
  ui/                 dom (delegate/patchHTML), sheet (فرم/منو/تأیید), toast, widgets, theme
  services/           files, ai (قابلیت‌های اختیاری میزبان), notify
  features/           دیالوگ‌ها: finance-sheets, task-sheets, gym-sheets, settings, reminders
  pages/              today, money, gym
tools/build.mjs       ساخت dist/daily-order.html
tests/                node:test برای core و domain
```
داده‌های قدیمی (بلوک‌های برنامه‌ریز، مرور هفتگی، اولویت و دسته‌ی کارها…) در سند باقی می‌مانند ولی دیگر نمایش داده نمی‌شوند.

## قراردادها
- **State**: یک سند JSON (`S` از `core/store.js`). بعد از هر تغییر `commit()` (ذخیره + رندر مجدد)؛ برای متنِ در حال تایپ `persist()`.
- **صفحه**: `{ id, title, render() → html, act, input, change, hold, mount?, tick? }`. رویدادها با `data-act="name"`
  (و `data-input`, `data-change`, `data-hold`) به‌صورت delegated به `act[name](el, ev)` می‌رسند؛ بدون addEventListener روی هر المان.
- **رندر**: رشته‌ی HTML (هر مقدار کاربر با `esc()`)، و `patchHTML` فوکوس فیلدهای `data-key` را نگه می‌دارد.
- **تاریخ**: ذخیره‌ی میلادی `YYYY-MM-DD`؛ نمایش و ماه‌ها با تقویم انتخابی (شمسی پیش‌فرض) از `core/calendar.js`.
- **سازگاری داده**: `migrate()` در `core/store.js` سندهای قدیمی را ارتقا می‌دهد.
