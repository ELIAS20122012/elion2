# Elias OS — Architecture (Phase 0)

```
            ┌───────────── Interfaces (later) ─────────────┐
            │  CLI (now) · Telegram · Voice · Dashboard     │
            └──────────────────────┬────────────────────────┘
                                   │ create task / approve / query
┌──────────────────────────────────▼──────────────────────────────────┐
│                              KERNEL                                  │
│  Scheduler (cron) ──► Task Engine ──► Permission Gate ──► Provider   │
│                          │   ▲              │                │       │
│                          │   └── Verify ◄───┼────────────────┘       │
│                          │      (retry with feedback)                │
│                    Activity Log · Approvals · Crash recovery          │
│                         SQLite (single source of truth)              │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ ExecutionProvider interface
          ┌────────────────┬───────┴────────┬──────────────────┐
     Claude Code CLI    Echo (test)    ChatGPT / Gemini    plain-code tools
     (v0.1 runtime)                     (later, swappable)
```

## Task lifecycle

```
queued ──gate──► awaiting_approval ──approve──► queued
   │                    └──reject──► cancelled (rejected)
   ├──deny──► failed (permission_denied)
   └──claim──► running ──► verifying ──ok──► succeeded
                 │              └──fail──► queued (retry w/ feedback) │ failed (verification_failed)
                 ├─ error ─► queued (backoff) │ failed (provider_error)
                 ├─ timeout ─► queued │ failed (timeout)
                 └─ CLI missing ─► failed (provider_unavailable, no retry)
crash/restart: running → recover() → queued │ failed (crashed)
```

## Principles locked in

1. **Model-agnostic core** — the kernel only knows `ExecutionProvider` (`src/providers/types.ts`).
2. **SQLite is the source of truth**; Markdown/Obsidian is only for knowledge.
3. **Scheduler, task engine, permissions live inside Elias OS** — n8n is only a connector layer later.
4. **Permissions from v0.1** — every capability is checked before any provider runs; unknown = approve.
5. **No silent failure** — every failure has a kind, a message, a run row and log events.
6. **Domain-agnostic** — trading/content/mentorship are plugins that create tasks with capabilities.

## Files

| Path | Role |
|---|---|
| `src/kernel/db.ts` | SQLite open + versioned migrations (`PRAGMA user_version`) |
| `src/kernel/kernel.ts` | Task engine, gate, verify loop, scheduler tick, log, recovery |
| `src/kernel/permissions.ts` | Policy + capability matching |
| `src/kernel/verify.ts` | Output verification specs |
| `src/kernel/cron.ts` | In-house 5-field cron (local time) |
| `src/providers/*` | Provider interface, Claude Code CLI, Echo/Scripted |
| `src/cli.ts` | `elias` command + daemon loop |
| `tests/kernel.test.ts` | 16 tests covering every state transition |

## Tables

`tasks`, `runs` (one per attempt), `approvals`, `events` (activity log), `schedules`, `kv` (heartbeat etc.).
