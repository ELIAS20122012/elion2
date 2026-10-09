"""Publish the read-only mirror of the journal to Cloudflare Pages.

    python -m journal.publish [--force] [--dry-run]

Run it on a timer while this PC is on. Each run exports a fresh snapshot next to the built
dashboard and deploys, but only when it is worth it:

  * the journal actually changed (new trade, edited note, new account, new rule label), or
  * the published mirror is older than --max-age-hours, so a visitor never sees a date from
    last week without knowing it,

and never more often than --min-interval-min. Cloudflare's free plan allows 500 Pages
deployments a month; the defaults here land well inside that even on a busy trading day.

Needs `wrangler` (npx wrangler) plus CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the
environment. See docs/hosting-mirror.md for the one-time setup.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

from . import snapshot

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, "dashboard", "dist")
STATE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".mirror-publish.json")
PROJECT = os.environ.get("CF_PAGES_PROJECT", "elion-dashboard")


def _state() -> dict:
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save(state: dict) -> None:
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def _wrangler() -> list[str]:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        sys.exit("npx پیدا نشد — Node.js نصب نیست یا در PATH نیست.")
    return [npx, "wrangler"]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true", help="publish even if nothing changed and it is not due")
    p.add_argument("--dry-run", action="store_true", help="export and report, but do not deploy")
    p.add_argument("--max-age-hours", type=float, default=6.0)
    p.add_argument("--min-interval-min", type=float, default=10.0)
    p.add_argument("--project", default=PROJECT)
    args = p.parse_args()

    if not os.path.isdir(DIST):
        sys.exit(f"{DIST} وجود ندارد — اول در پوشه‌ی dashboard دستور `npm run build` را بزنید.")

    info = snapshot.write(os.path.join(DIST, "snapshot.json"))
    st = _state()
    now = time.time()
    since = now - st.get("published_at", 0)
    changed = info["digest"] != st.get("digest")
    due = since >= args.max_age_hours * 3600
    too_soon = since < args.min_interval_min * 60

    why = "forced" if args.force else "journal changed" if changed else "mirror is stale" if due else None
    if not args.force and too_soon:
        why = None
    if not why:
        print(json.dumps({**info, "published": False,
                          "reason": "published recently" if too_soon else "nothing changed",
                          "minutes_since_publish": round(since / 60, 1)}, ensure_ascii=False, indent=2))
        return 0

    if args.dry_run:
        print(json.dumps({**info, "published": False, "reason": f"dry run ({why})"}, ensure_ascii=False, indent=2))
        return 0

    cmd = [*_wrangler(), "pages", "deploy", DIST, f"--project-name={args.project}", "--branch=main",
           f"--commit-message=mirror {time.strftime('%Y-%m-%d %H:%M')} ({why})"]
    run = subprocess.run(cmd, cwd=os.path.join(ROOT, "dashboard"), capture_output=True, text=True)
    if run.returncode != 0:
        print(run.stdout[-2000:], file=sys.stderr)
        print(run.stderr[-2000:], file=sys.stderr)
        sys.exit(f"انتشار ناموفق بود (کد {run.returncode}).")

    _save({"digest": info["digest"], "published_at": now, "bytes": info["bytes"]})
    print(json.dumps({**info, "published": True, "reason": why}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
