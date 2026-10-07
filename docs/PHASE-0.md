# Phase 0 — status and next steps

## Done (2026-10-02)

- Kernel: tasks, runs, approvals, events, schedules in SQLite
- Loop: gate → execute → verify → correct (feedback in prompt) → retry with exponential backoff
- Real failure states + crash recovery + cancellation with abort
- Permission policy in kernel, configurable in `config/elias.config.json`
- Providers: `claude-code` (headless `claude -p --output-format json`, prompt via stdin), `echo`
- Internal cron scheduler + daemon with heartbeat
- CLI: init, doctor, status, task, run, daemon, approvals, approve/reject, policy, schedule, log
- 16 automated tests; verified end-to-end with the real Claude Code CLI

## Phase 0 acceptance check on the desktop PC

- [ ] `npm test` → 16 pass
- [ ] `elias doctor` → all ✔ (Node ≥ 22.18, claude-code healthy)
- [ ] One real Claude Code task succeeds with `--verify`
- [ ] One `publish:*` task stops at `awaiting_approval` and runs only after `approve`
- [ ] `elias daemon` runs for an hour, heartbeat updates, Ctrl+C stops it cleanly

## Phase 1 progress (2026-10-02)

- [x] Telegram bot @Elion_OS_bot — owner-only pairing, chat → task → verified reply, ✅/❌ approval buttons, /status /tasks /approvals /cancel
- [x] Runs hidden in the background, starts with Windows, auto-restarts on crash, single instance (`install-autostart.cmd`, `stop-elias.cmd`)
- [x] Agents run in `data/workspace` with an Elias OS persona (`CLAUDE.md`)
- [x] Gmail + Calendar (read-only), Google app in production (no 7-day expiry)
- [x] 08:00 daily briefing
- [x] Telegram voice → faster-whisper
- [x] Multi-provider fallback: claude-code → codex → gemini → ollama

## Phase 2 progress (2026-10-03)

- [x] Plugin host (built-in + `plugins/`), skills registry, Markdown skills (`skills/*.md`), Telegram `/<skill>` + menu — see docs/PLUGINS.md
- [x] Instant commands (`registerCommand`), memory plugin: /remember /notes /forget → `data/knowledge/memory.md`, used as context in every chat
- [x] Persona (CLAUDE.md + AGENTS.md) regenerated on start with the real skill/command list; own additions in `data/workspace/PERSONA.local.md`
- [x] Telegram /retry + 🔁 button on failures (re-runs on the fallback chain)
- [x] Work skills: /journal /setup (trading) · /lesson /student /quiz (mentorship) · /idea /script /caption (content) · exact /lot calculator (code, not AI)
- [x] Local web dashboard in the daemon: http://127.0.0.1:7420 (`elias dashboard`) — status, providers, approvals, tasks (retry/cancel), skills/commands, schedules, plugins, log
- [x] YouTube plugin: `/yt` lists `content/youtube/`, `/yt N | notes` → AI metadata → approval (publish:youtube) → resumable upload (no auto-retry). Privacy via `plugins.options.youtube.privacy`
- [x] Auto Shorts: `/short [topic]` → AI script → edge-tts Persian voice + Vazirmatn slides + ffmpeg (1080x1920) → video preview in Telegram + approval → upload. `elias short schedule --time 18:00` for one per day. Setup: `video-setup.cmd`
- [x] AI videos: `/ai <template|idea>` → plan (template from `content/templates/*.md`, no questions) → Gemini image ×2 (first/last frame) → Veo 3.1 fast 8s 9:16 with audio → Telegram preview + approval → YouTube. Paid key: `media-key.cmd` (secrets.media.apiKey). Never auto-retried.
- [x] Spoken replies: voice message → answer as text + Persian voice note (edge-tts → OGG/Opus). `/voice on` = every chat reply spoken
- [x] Reminders (no AI): `/remind 18:30 …`, `فردا 9 …`, `2h …`, `۱۰ دقیقه …`, `هر روز 8:00 …`; "یادم بنداز …" in chat/voice; `/reminders`. Remote restart: Telegram `/restart` or `data/restart.flag`
- [x] Agentic actions: AI answers can end with `>>> /command args` → ▶️ button in Telegram runs it (e.g. "یه شورت درباره ریسک بساز" by voice)
- [x] Maintenance (no AI): nightly backup 03:30 → `data/backups` (DB snapshot via VACUUM INTO + knowledge/skills/templates/config, no secrets, keep 14; `plugins.options.maintenance.backupDir`), weekly report Sunday 19:00; `/backup`, `/report`
- [x] Obsidian vault: `/find q` (instant), `/vault q` (AI answer from top notes, cites sources), `/note text` → `07 Daily Notes/YYYY-MM-DD.md`
- [x] Advisor skills: `/board` (4 advisors + synthesis, one AI call), `/plan` (calendar+tasks+notes), `/review` (end-of-day from today's daily note via context `vault:today`)
- [x] Files in Telegram: photos/PDF/documents (≤20 MB) → `data/workspace/inbox/` (auto-cleaned after 7 days) → AI reads them (chart analysis without signals, summaries). Caption = request
- [x] Chart markup: for chart screenshots the AI adds `MARKS: {levels:[{y,label,type}]}` → levels drawn on the image (Pillow) and sent back (approximate placement)
- [x] MT4 bridge (read-only EA `mt4/EliasBridge.mq4`, `mt4-setup.cmd`): `/account`, `/trades`, `/draw 4188 مقاومت | 4122 حمایت` (draws on the MT4 chart), context `mt4:account`, risk watch every 5 min (no stop / risk > 1% / daily loss > 3% → Telegram alert once), daily trade report 23:00 Mon–Fri, `/tradereview` skill
- [x] Remote panel: https://panel.eliongroup.org via Cloudflare Tunnel run by the daemon (`data/bin/cloudflared.exe`, token in secrets `tunnel.token` via `tunnel-key.cmd`) + Cloudflare Access; dashboard also checks the Access email header = owner
- [x] Health watchdog (no AI): every 15 min Google, AI models/limits, tunnel, backups, disk, failure bursts → one Telegram alert on break + one on recovery; `/health`

## Phase 1 (toward the v0.1 success target: 08:00 daily briefing)

1. **Telegram interface** — bot: notify, `/approve`, `/reject`, `/status`; approvals arrive as buttons
2. **Connectors (read-only)** — Gmail + Google Calendar as `read:email`, `read:calendar` tools
3. **Daily briefing agent** — schedule `0 8 * * *`: email + calendar + open tasks → summary → Telegram, verified by `json:summary,items`
4. **Run as a Windows service** (auto-start with the PC, restart on crash)
5. **Telegram voice → faster-whisper** (local, CPU) for voice commands

Deferred: dashboard (Next.js), wake word, Boardroom/Coaches, marketplace, content publishing plugins, trading plugin.
