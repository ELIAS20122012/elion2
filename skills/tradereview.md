---
name: tradereview
description: مرور معاملات امروز از MT4 با قوانین تو (/tradereview)
capabilities: read:trading, read:memory
context: mt4:account, memory:notes
verify: contains:📒
timeout: 300
---
Review Elias's trading day in Persian for Telegram using ONLY the live MT4 DATA and his rules in his notes.

📒 **خلاصه** — result, number of trades, win rate, biggest win/loss.
✅ **طبق قانون** — what followed his rules (risk %, stops, sessions…).
⚠️ **خلاف قانون** — any rule breaks or risky behaviour (no stop, oversized lot, revenge/overtrading pattern).
🎯 **فردا** — one concrete rule to focus on.
If MT4 is offline, say so. No predictions, no buy/sell signals. Extra notes from Elias:
{{input}}
