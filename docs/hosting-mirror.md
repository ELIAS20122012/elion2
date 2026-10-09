# میزبانی داشبورد روی وب (بدون وابستگی به روشن‌بودن کامپیوتر)

هدف: سایت از هر جایی و هر ساعتی باز شود. ثبت معامله و اتصال زنده همچنان روی همین کامپیوتر
انجام می‌شود. هزینهٔ ماهانه: صفر.

## چطور کار می‌کند

```
                 ┌──────────── Cloudflare Pages (همیشه روشن، رایگان) ────────────┐
مرورگر شما ───►  │  dist/  = برنامه‌ی بیلدشده                                    │
                 │  functions/api/[[path]].ts  = تصمیم می‌گیرد داده از کجا بیاید │
                 └───────┬───────────────────────────────────┬──────────────────┘
                         │ کامپیوتر روشن                      │ کامپیوتر خاموش
                         ▼                                    ▼
          Cloudflare Tunnel ──► 127.0.0.1:8000        snapshot.json
          (journal API روی همین PC)                   (آینه‌ی فقط‌خواندنی)
```

مرورگر همیشه فقط با یک دامنه حرف می‌زند، پس نه CORS داریم نه دو آدرس مختلف برای حفظ‌کردن.

## در حالت آینه چه چیزی کار می‌کند

| کار می‌کند | کار نمی‌کند (و صادقانه می‌گوید چرا) |
|---|---|
| ژورنال، آنالیز، بک‌تست، قوانین | ثبت یادداشت و ستاپ |
| موجودی و منحنی اکوییتی تا آخرین به‌روزرسانی | قیمت زنده و چارت لحظه‌ای |
| شمارش معاملات باز و سود شناور ذخیره‌شده | Start Engine و اتصال ترمینال |
| برچسب‌های قوانین | ثبت سفارش (کلاً رد می‌شود) |
| | تقویم اقتصادی و تاریخچه‌ی کندل |

پایین صفحه یک نوار کهربایی نشان می‌دهد «حالت نمایش» فعال است و آخرین به‌روزرسانی کِی بوده،
تا هیچ‌وقت عدد دیروز را به‌جای عدد زنده نخوانید.

## راه‌اندازی یک‌باره

### ۱. پروژه‌ی Pages بسازید

```bash
cd dashboard
npm run build
npx wrangler pages project create elion-dashboard --production-branch main
```

### ۲. مسیر جدید تونل به journal API

در `C:\Users\elias\.cloudflared\config.yml` یک hostname اضافه کنید که **مستقیم** به
journal server وصل شود (نه به سرور Vite):

```yaml
ingress:
  - hostname: pc.eliongroup.org
    service: http://127.0.0.1:8000
  - hostname: trade.eliongroup.org      # این خط بعد از مرحله‌ی ۵ حذف می‌شود
    service: http://127.0.0.1:5173
  - service: http_status:404
```

و رکورد DNS آن را بسازید:

```bash
cloudflared tunnel route dns 7f99855a-c35a-4f01-b5e0-0e4e8aa4e0d4 pc.eliongroup.org
```

### ۳. Access روی هر دو دامنه

در Cloudflare Zero Trust:

1. برای `pc.eliongroup.org` یک Application بسازید (مثل همانی که برای trade دارید).
2. یک **Service Token** بسازید (`Access → Service Auth`) و Client ID و Secret را بردارید.
3. در پالیسی همان Application یک rule از نوع **Service Auth** اضافه کنید که این توکن را بپذیرد.

بدون این کار، تابع Pages به‌جای داده، صفحه‌ی لاگین Access را می‌گیرد.

### ۴. متغیرهای پروژه‌ی Pages

در داشبورد Cloudflare → Pages → elion-dashboard → Settings → Environment variables (Production)
این سه مورد را به‌صورت **Secret** اضافه کنید:

| نام | مقدار |
|---|---|
| `PC_ORIGIN` | `https://pc.eliongroup.org` |
| `ACCESS_CLIENT_ID` | Client ID سرویس‌توکن |
| `ACCESS_CLIENT_SECRET` | Client Secret سرویس‌توکن |

### ۵. دامنه‌ی اصلی را به Pages بدهید

در Pages → Custom domains دامنه‌ی `trade.eliongroup.org` را اضافه کنید، سپس همان hostname را
از `config.yml` تونل حذف کرده و `cloudflared` را ری‌استارت کنید. از این لحظه `trade.eliongroup.org`
همیشه بالاست. Access را روی آن مثل قبل نگه دارید.

### ۶. اجازه‌ی انتشار برای این کامپیوتر

یک API Token با دسترسی `Cloudflare Pages: Edit` بسازید و کنار Account ID به‌صورت متغیر محیطی
دائمی ویندوز ثبت کنید:

```powershell
setx CLOUDFLARE_API_TOKEN "..."
setx CLOUDFLARE_ACCOUNT_ID "..."
```

پنجره‌ی ترمینال را ببندید و باز کنید تا مقدارها خوانده شوند.

## کار روزمره

`start-services.ps1` از این به بعد `run-mirror.bat` را هم بالا می‌آورد (فقط وقتی توکن ست شده باشد).
هر ۵ دقیقه یک بار بررسی می‌کند و **فقط وقتی ژورنال واقعاً عوض شده** منتشر می‌کند، پس در ماه چند ده
انتشار می‌شود — سقف رایگان Cloudflare ۵۰۰ تا در ماه است.

دستی هم می‌شود:

```bash
cd backend
.venv\Scripts\python.exe -m journal.publish --dry-run   # فقط گزارش
.venv\Scripts\python.exe -m journal.publish --force     # همین الان منتشر کن
```

> بعد از هر بار `npm run build` پوشه‌ی `dist` خالی و دوباره ساخته می‌شود و `snapshot.json` از بین
> می‌رود. انتشار بعدی خودش دوباره می‌سازدش؛ نگران نباشید.

## وقتی چیزی کار نکرد

| نشانه | علت معمول |
|---|---|
| همیشه «حالت نمایش» است، حتی با PC روشن | `PC_ORIGIN` غلط است، یا سرویس‌توکن در پالیسی Access نیست |
| «سرور ژورنال در دسترس نیست و نسخه‌ی ذخیره‌شده‌ای هم منتشر نشده» | هنوز یک بار `journal.publish` اجرا نشده |
| داده‌ی آینه قدیمی است | `run-mirror.bat` بالا نیست یا توکن ست نشده |
| `publish` با کد ۱ خطا می‌دهد | API Token دسترسی `Pages: Edit` ندارد |

## تست محلی

اجرای محلی `wrangler pages dev` روی این ویندوز با خطای `write EOF` بالا نمی‌آید (باگ خود ابزار).
به‌جایش منطق آینه با تست‌های `dashboard/functions/api/mirror.test.ts` پوشش داده شده:

```bash
cd dashboard && npx vitest run functions/api/mirror.test.ts
```
