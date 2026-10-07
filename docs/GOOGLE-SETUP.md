# اتصال Gmail و Calendar (فقط خواندنی)

یک‌بار انجام می‌شود، حدود ۱۰ دقیقه. Elias OS فقط **می‌خواند**؛ نه ایمیل می‌فرستد، نه چیزی را پاک یا عوض می‌کند.

## ۱. ساخت پروژه
1. برو به **console.cloud.google.com** و با همان حساب Gmail وارد شو.
2. بالای صفحه: انتخاب پروژه → **New Project** → نام: `Elias OS` → **Create**. مطمئن شو پروژه‌ی جدید انتخاب شده.

## ۲. فعال کردن دو API
منوی ☰ → **APIs & Services** → **Library**:
- `Gmail API` را جستجو کن → **Enable**
- `Google Calendar API` را جستجو کن → **Enable**

## ۳. صفحه‌ی رضایت (OAuth consent)
منوی ☰ → **APIs & Services** → **OAuth consent screen** (یا **Google Auth Platform**) → **Get started**:
- App name: `Elias OS` — User support email: ایمیل خودت → Next
- Audience: **External** → Next
- Contact email: ایمیل خودت → Next → تیک موافقت → **Create**

بعد در بخش **Audience**: دکمه‌ی **Publish app** → **Confirm** (وضعیت باید **In production** شود).
> اگر در حالت Testing بماند، Google هر ۷ روز اتصال را قطع می‌کند.

## ۴. ساخت کلید برنامه
بخش **Clients** (یا **Credentials** → **Create credentials** → **OAuth client ID**):
- Application type: **Desktop app** — Name: `Elias OS` → **Create**
- در پنجره‌ی بعد: **Download JSON**. فایل با نام `client_secret_....json` در پوشه‌ی Downloads ذخیره می‌شود. به چیز دیگری دست نزن.

## ۵. اتصال
در `C:\Elion\elias-os` روی **`google-setup.cmd`** دابل‌کلیک کن (یا بگو Claude اجرایش کند). مرورگر باز می‌شود:
- حسابت را انتخاب کن
- پیام «Google hasn't verified this app» عادی است (برنامه‌ی خودت است): **Advanced** → **Go to Elias OS (unsafe)**
- تیک دسترسی Gmail و Calendar را بزن → **Continue**

تمام. گزارش صبح هر روز ساعت ۰۸:۰۰ در Telegram می‌آید و با `/brief` هر وقت بخواهی.

## قطع دسترسی
myaccount.google.com/permissions → Elias OS → Remove access. یا فایل `config\google-token.json` را پاک کن.
