# Robot Trading — پلتفرم آنالیز، ژورنال و ربات

ربات قانون‌محور روی **دموی MT5** + داشبورد چارت زنده + ژورنال/آنالیز/بک‌تست چندحسابی.
جزئیات، تصمیم‌ها و Evidence در ابسیدین: `01 Projects/Robot Trading` و `Decision Log (D-018)`.

## اجرا

1. MT5 را باز کنید و با حساب دمو وارد شوید.
2. `start-live.bat` را اجرا کنید. سه چیز بالا می‌آید:
   - **MT5 Bridge** (`backend/mt5_bridge.py`): قیمت زنده → WebSocket `ws://localhost:8765` (فقط خواندن)
   - **Journal API** (`backend/journal/`): سرور ژورنال روی `http://localhost:8000` با دیتابیس `backend/journal.db`
   - **Dashboard**: `http://localhost:5173`

نصب اول: `python -m venv backend/.venv`، سپس `backend/.venv/Scripts/pip install -r backend/requirements.txt` و در `dashboard/`: `npm install`.

## ساختار

```text
start-live.bat            پل قیمت + سرور ژورنال + داشبورد
backup.bat                بکاپ کد (Git bundle) و دیتابیس‌ها در OneDrive\Backups\robot-trading
dashboard/src/            React + Vite + Lightweight Charts
  modules/registry.tsx    فهرست بخش‌ها؛ بخش جدید = یک فایل در pages/ + یک خط اینجا
  pages/                  چارت، ژورنال، آنالیز، بک‌تست، قوانین، اتصال MT، تنظیمات
  lib/                    اندیکاتورها، رسم‌ها، آنالیز، بک‌تست، rules.ts (وضعیت آموزش قوانین)
backend/
  mt5_bridge.py           قیمت زنده MT5 (فقط خواندن)
  journal/                api.py, db.py, bridge.py (ثبت خودکار), mt5sync.py, parsers.py
  tools/simulate_mt4.py   شبیه‌ساز اندیکاتور MT4 برای تست
  tests/                  test_journal.py, test_bridge.py
  app/                    ⚠ کد قدیمی ربات↔API؛ strategy/ و routers/ بعد از فرمت گم شد (بازسازی می‌شود)
mt4/JournalBridge.mq4     اندیکاتور فقط‌خواندنی MT4 (اختیاری)
ea/mt5, ea/mt4            EA ربات (اجرای سفارش عمداً غیرفعال)
```

## ثبت خودکار معاملات

- **MT5:** خواندن مستقیم از ترمینال هر ۱۰ ثانیه؛ هر حساب می‌تواند ترمینال جدای خودش را داشته باشد (`terminal_path`).
- **MT4:** اندیکاتور `mt4/JournalBridge.mq4` روی یک چارت (راهنما در صفحه‌ی «اتصال MT»).
- همه فقط‌خواندنی‌اند؛ سفارشی ارسال نمی‌شود و رمز حساب گرفته نمی‌شود.

## تست

```powershell
cd backend
.venv\Scripts\python -m pytest tests/test_journal.py tests/test_bridge.py -q
cd ..\dashboard
npx tsc -b
```

## ایمنی

ربات فقط روی حساب **دمو**. اجرای خودکار سفارش تا تأیید صریح قوانین `DISABLED` است.
ژورنال حساب لایو را فقط می‌خواند و هرگز سفارش نمی‌دهد.
