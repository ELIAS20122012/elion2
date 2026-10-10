"use client";
import { useState } from "react";
import { FA, ICON, post, when, type Task } from "./api";
import { reply } from "./ui";

export function TaskRow({ t }: { t: Task }) {
  const [open, setOpen] = useState(false);
  const live = t.status === "queued" || t.status === "running" || t.status === "verifying" || t.status === "awaiting_approval";
  const body = t.result ?? t.error;
  return (
    <div className={`row task s-${t.status}`}>
      <button className="row-main" onClick={() => body && setOpen(!open)} aria-expanded={body ? open : undefined}>
        <span className="st" title={FA[t.status]} aria-label={FA[t.status]}>{ICON[t.status]}</span>
        <span className="t">
          <span className="ttl">{t.title}</span>
          <small className="mute">
            {when(t.updatedAt)} · <span dir="ltr">{t.provider}</span> · {t.source}
          </small>
        </span>
      </button>
      <span className="acts">
        {live && <button onClick={async () => reply(await post(`/api/tasks/${t.id}/cancel`))}>لغو</button>}
        {(t.status === "failed" || t.status === "cancelled") && <button onClick={async () => reply(await post(`/api/tasks/${t.id}/retry`))}>دوباره</button>}
      </span>
      {open && body && <pre className={t.error && !t.result ? "bad" : ""}>{body}</pre>}
    </div>
  );
}
