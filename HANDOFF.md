# Handoff log

Newest entry on top. Every agent adds an entry when it stops (even if unfinished).
Format: date · agent · what was done · state (finished / half-done + how to continue / how to roll back).

---

## 2026-10-07 · Claude (cloud session, no access to the PC)
- Antigravity CLI provider: `agyProvider` in src/providers/cli.ts (command `agy`, `-p "<prompt>"` as argument, flags before -p, no shell on
  Windows, no permission-skipping flag). CliSpec got `promptAs` ("stdin"|"arg") and `shell`; args() now also receives the prompt.
  Registered as provider `antigravity` ONLY when config `providers.antigravity.enabled` is true; team.ts tries it first for Gemini members
  (Vertex → gemini-cli → gemini remain as backups). antigravity-setup.cmd installs, logs in and tests headless mode with redirected output.
- Why not on by default: written from public docs/issues only — agy could not be run in the cloud. Known risks: `agy -p` reported to hang
  when stdout is not a terminal (v1.0.6), and stdin-only prompting is not documented (so the prompt is the -p argument).
- State: code + 6 new tests green (tests/antigravity.test.ts), NOT verified against a real agy. Next (Elias's PC): run antigravity-setup.cmd;
  if it prints `agy answered: OK` set providers.antigravity.enabled=true and restart; if it hangs/fails, leave disabled and report the output.
  Rollback: remove the flag (nothing else changes), or revert the branch.

## 2026-10-04 (3) · Claude (Cowork)
- Website agent: src/plugins/website.ts. /site <request> → AI returns full HTML files (JSON) → guard rails (privacy.html kept,
  homepage keeps "Elias OS" + /privacy for Google OAuth, no external scripts) → site-draft/ → preview at panel /site-preview/
  (served with CSP sandbox) → /site publish = approval (publish:website) → wrangler pages deploy (project elion-os-site).
- Mini Rescue style switched to photoreal tilt-shift diorama; reference image content/templates/minirescue.ref.jpg auto-attached.
- State: finished, 108 tests green. Wrangler must still be logged in on the PC (site-deploy.cmd did it once).

## 2026-10-04 (2) · Claude (Cowork)
- First real Mini Rescue episode had continuity bugs (problem solved in clip 1, then repeated; objects jumping; dust explosion).
- Fix: long form now = image1 → clip 1 (8 s, start frame only) → real last frame of clip 1 → clip 2 (6 s) → join.
  No forced end frames. Template got physics/logic rules (faces to camera, no explosions, no teleporting, fix only once).
- State: finished, 104 tests green. Next: Elias judges the next episode; options if still weak: veo-3.1 (non-fast).

## 2026-10-04 · Claude (Cowork)
- Added this handbook (AGENTS.md, ROADMAP.md, HANDOFF.md), CLAUDE.md/GEMINI.md pointers, git-setup.cmd, .gitignore update.
- Latest features live and deployed: Mini Rescue 14 s pipeline + manual (free) mode + daily 10:00 schedule,
  Gemini via Vertex for /team, "Hey Elion" voice assistant with vocabulary hints, silent background jobs,
  trading de-emphasised in all prompts.
- State: finished, 103 tests green. Nothing half-done.
- Next suggested: watch the first daily Mini Rescue episode (10:00) and fix quality if needed (see ROADMAP "Open").
