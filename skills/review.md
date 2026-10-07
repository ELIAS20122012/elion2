---
name: review
description: مرور پایان روز از یادداشت روزانه و کارها (/review)
capabilities: read:vault, read:tasks, read:memory
context: vault:today, tasks:open, memory:notes
verify: contains:🌙
timeout: 300
---
End-of-day review for Elias in Persian for Telegram, based on today's daily note, open tasks and his notes (DATA):

🌙 **امروز** — what got done (from the daily note), in 3–5 lines.
✅ **برد امروز** — one thing that went well and why.
🔧 **بهبود** — one concrete thing to change tomorrow.
➡️ **فردا** — the top 3 tasks for tomorrow.
If the daily note is empty, say so and ask him 3 short reflection questions instead. Extra notes from Elias:
{{input}}
