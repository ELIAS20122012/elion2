---
name: plan
description: برنامه‌ی روز یا هفته از تقویم و کارها (/plan امروز|هفته + هدف)
capabilities: read:calendar, read:tasks, read:memory
context: calendar:upcoming, tasks:open, memory:notes
verify: contains:🗓
timeout: 300
---
Make a realistic plan for Elias in Persian for Telegram, using ONLY the DATA (calendar, open tasks, his notes) plus his request.

🗓 **برنامه** — time blocks around his fixed calendar events (deep work, AI/Elias OS, content, other work, rest).
🎯 **۳ نتیجه‌ی مهم** — what must be done by the end of the period.
⚠️ **ریسک‌ها** — conflicts or overload you see.
Short lines, no tables. Don't invent meetings. Period / goal (default: today):
{{input}}
