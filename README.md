# Elias OS — Phase 0 (Kernel)

## پروژه‌های Elion در این ریپو (هر پروژه یک branch)

| Branch | پروژه | پوشه روی کامپیوتر |
|---|---|---|
| `main` | Elion / Elias OS — سیستم‌عامل ایجنتیک (تلگرام، پنل وب، پلاگین‌ها، صدا، ویدیو) | `C:\Elion\elias-os` |
| [`trading-robot`](../../tree/trading-robot) | ELION Trading — ژورنال، داشبورد زنده، پل MT4/MT5، EA، ربات | `C:\Elion\trading-robot` |
| [`pen-app`](../../tree/pen-app) | Elion Pen (InkFlow) — اپ قلم/نقاشی روی صفحه (C# / WPF) | `C:\Elion\pen app` |

`skills/` (اسکیل‌های addyosmani و Google) کد شخص ثالث است و از ریپوی خودشان نصب می‌شود؛ اینجا نیست.

سیستم‌عامل عاملی شخصی الیاس. هسته (Kernel) عمومی است؛ ترید، محتوا، منتورشیپ و … بعداً به‌صورت پلاگین وصل می‌شوند.

## فاز ۰ چه چیزی تحویل می‌دهد

| بخش | وضعیت |
|---|---|
| SQLite به‌عنوان منبع حقیقت (`node:sqlite` داخلی Node، بدون build بومی روی ویندوز) | ✔ |
| Task Engine با چرخه: صف → اجازه → اجرا → تأیید (verify) → اصلاح → تلاش مجدد | ✔ |
| Permission / Approval داخل Kernel (انتشار، پرداخت، حذف، ترید واقعی = نیاز به تأیید تو) | ✔ |
| حالت‌های شکست واقعی: `timeout`, `provider_error`, `provider_unavailable`, `verification_failed`, `permission_denied`, `rejected`, `crashed` | ✔ |
| Activity Log کامل برای هر تسک و هر اجرا | ✔ |
| Scheduler داخلی (cron، به وقت محلی، بدون n8n) | ✔ |
| Execution Provider Interface (مدل‌آگنوستیک) + Claude Code CLI روی اشتراک خودت + Echo برای تست | ✔ |
| بازیابی بعد از کرش/ری‌استارت | ✔ |
| CLI (`elias`) + Daemon | ✔ |
| ۱۶ تست خودکار | ✔ |

بدون هیچ وابستگی runtime — فقط Node.js. (`typescript` فقط برای typecheck است.)

## نصب روی PC دسکتاپ (ویندوز)

۱. Node.js **22.18 یا جدیدتر** (پیشنهاد: Node 24 LTS) از nodejs.org نصب کن.
۲. Claude Code CLI نصب و یک‌بار لاگین شده باشد (`claude` در ترمینال کار کند).
۳. در PowerShell:

```powershell
cd C:\Elion\elias-os
npm install          # فقط ابزار typecheck
npm test             # باید 16 pass بدهد
.\bin\elias.cmd init
.\bin\elias.cmd doctor
```

## استفاده

```powershell
# تسک ساده (تست بدون مدل)
.\bin\elias.cmd task add "Smoke test" --prompt "hello" --provider echo
.\bin\elias.cmd run

# تسک واقعی با Claude Code + verify
.\bin\elias.cmd task add "Idea list" --prompt "Give 5 YouTube ideas as JSON {\"ideas\":[...]}" --verify json:ideas
.\bin\elias.cmd run
.\bin\elias.cmd task show <id>

# تسک پرریسک → منتظر تأیید می‌ماند
.\bin\elias.cmd task add "Upload video" --prompt "..." --cap publish:youtube
.\bin\elias.cmd run
.\bin\elias.cmd approvals
.\bin\elias.cmd approve <approval-id>

# زمان‌بندی (ساعت 08:00 هر روز)
.\bin\elias.cmd schedule add daily-briefing "0 8 * * *" --title "Daily briefing" --prompt "..." --cap read:email --cap notify:telegram
.\bin\elias.cmd daemon      # scheduler + worker؛ با Ctrl+C متوقف می‌شود

.\bin\elias.cmd status
.\bin\elias.cmd log
```

## Capabilityها و سیاست پیش‌فرض

قالب: `domain:action`. هر تسک اعلام می‌کند به چه چیزی نیاز دارد؛ Kernel قبل از اجرا چک می‌کند.

- `allow` (خودکار): `read:*`, `think:*`, `write:draft`, `write:notes`, `notify:telegram`
- `approve` (تأیید تو): `send:*`, `publish:*`, `payment:*`, `delete:*`, `trade:execute`, `system:shell`، و هر چیز ناشناخته
- `deny`: هر چیزی که در `config/elias.config.json` ممنوع کنی

جزئیات معماری: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — برنامه فاز بعد: [docs/PHASE-0.md](docs/PHASE-0.md)
