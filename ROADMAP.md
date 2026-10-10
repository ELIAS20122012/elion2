# Elias OS — roadmap

Legend: [x] done · [ ] open · (P) postponed by Elias — only start when he asks.

## Done
- [x] Kernel: tasks, retries, verification, approvals/permissions, scheduler, kv, event log
- [x] Providers: Claude Code, Codex (ChatGPT), Gemini (CLI / API / Vertex), Ollama, "auto" fallback chain
- [x] Telegram bot: commands, buttons, approvals, voice messages (faster-whisper), spoken replies, files/photos
- [x] Morning briefing (Gmail + Calendar read-only via Google OAuth)
- [x] Plugin + skill system (Markdown skills, Claude skills import), dashboard + remote panel (Cloudflare)
- [x] Reminders, memory notes, Obsidian vault (/find /vault /note), nightly backup to OneDrive, weekly report
- [x] Health watchdog (silent unless something breaks), background jobs silent in Telegram
- [x] YouTube upload with approval; /short slide videos
- [x] AI video (Gemini image + Veo 3.1, Vertex): Mini Rescue daily series 14 s (3 frames, 2 clips joined),
      reference photos, manual delivery to Telegram, auto-switch to free manual mode (Gemini app/Flow) when credit ends
- [x] Research agent (/research → Obsidian 04 Knowledge), agent team (/team, Claude+ChatGPT+Gemini, 2 rounds + vote)
- [x] "Hey Elion" desktop voice assistant (wake word + Ctrl+Alt+E, /listen, /words vocabulary)
- [x] Elion Group website agent (/site → draft → sandboxed preview on panel → publish with approval via wrangler)
- [x] MT4 read-only bridge (/account /trades /draw, risk alerts)
- [x] Persian speech recognition: local faster-whisper large-v3-turbo (accurate, ~2x audio length); TTS retries
- [x] Appointments (/termin) with automatic reminders; chat knows date, appointments and recent messages
- [x] Natural language: the chat agent turns requests into actions; safe ones run, risky ones get a ▶️ button
- [x] PC control from Telegram: /screen /open /file /apps /close /power (risky ones confirm first)
- [x] Antigravity CLI (agy) provider: free Gemini via Google login; in the auto chain after codex, first choice for /team gemini

## Open / next
- [ ] Instagram publishing (after Elias sets up the channel) — with approval
- [ ] Mobile PWA for the panel
- [ ] Personal finance tracker

## Postponed by Elias (P)
- (P) AI video / Mini Rescue / Shorts — switched off 2026-10-08 (quality too low, wasted tokens); plugins disabled in config
- (P) Daily planner & goals (/goal, 08:00 plan, 22:00 check-in, weekly review)
- (P) Automatic smart memory (learns from chats, /memory review)
- (P) Email assistant (drafts, send only with approval)
- (P) MT4 natural-language chart drawing (EA exports candles)
- (P) Trading extras: economic news calendar, trade journal analysis
- (P) Mentorship/students plugin
- (P) Next.js dashboard, n8n connectors, TikTok, multi-user, plugin marketplace, AI lab
