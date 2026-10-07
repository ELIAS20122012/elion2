---
name: today
description: برنامه‌ی تقویم امروز و فردا
capabilities: read:calendar
context: calendar:upcoming
verify: contains:📅
timeout: 300
---
Using ONLY the calendar DATA, reply in Persian for Telegram:

📅 **امروز** — today's events in time order (time — title — place).
📅 **فردا** — tomorrow's events.
If there are free blocks of 2+ hours today, mention them in one line.

Never invent events. Extra request from Elias (may be empty): {{input}}
