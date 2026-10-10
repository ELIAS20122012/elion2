"use client";
import Link from "next/link";
import { useState } from "react";
import { post, usePoll, type Appointment, type Overview, type Status } from "./api";
import { ApptLine, Offline } from "./parts";
import { TaskRow } from "./TaskRow";
import { Card, Empty, reply, toast } from "./ui";

export default function Home() {
  const { data, down } = usePoll<Overview>("/api/overview");
  const appts = usePoll<{ upcoming: Appointment[] }>("/api/panel/appointments", 30000).data;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const prompt = text.trim();
    if (!prompt) return;
    setBusy(true);
    const r = await post("/api/tasks", { prompt });
    setBusy(false);
    if (r.ok) {
      setText("");
      toast("✔ فرستاده شد — جواب اینجا و در تلگرام می‌آید");
    } else reply(r);
  }

  if (down && !data) return <Offline />;
  const stats = data?.stats ?? {};
  const n = (...s: Status[]) => s.reduce((a, x) => a + (stats[x] ?? 0), 0);
  const tiles = [
    { label: "⚙️ در جریان", v: n("running", "queued", "verifying") },
    { label: "🔐 منتظر تأیید", v: n("awaiting_approval") },
    { label: "❌ شکست", v: n("failed") },
  ];
  return (
    <>
      <h1 className="page-h">سلام الیاس 👋</h1>
      <div className="grid">
        <Card title="📥 چه کاری انجام بدهم؟" wide>
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && send()}
              placeholder="هر چیزی بنویس… مثلاً: فردا ساعت ۱۰ یادم بنداز به بانک زنگ بزنم"
              aria-label="درخواست"
            />
            <button className="primary" disabled={busy || !text.trim()}>
              {busy ? "…" : "ارسال"}
            </button>
          </form>
        </Card>

        {data && data.approvals.length > 0 && (
          <Card title="🔐 منتظر تأیید تو" wide>
            {data.approvals.map((a) => (
              <div className="row" key={a.id}>
                <span className="t">
                  <span className="ttl">{a.task}</span>
                  <small className="mute">{a.reason || a.capability}</small>
                </span>
                <span className="acts">
                  <button className="primary" onClick={async () => reply(await post(`/api/approvals/${a.id}/approve`))}>تأیید</button>
                  <button onClick={async () => reply(await post(`/api/approvals/${a.id}/reject`))}>رد</button>
                </span>
              </div>
            ))}
          </Card>
        )}

        <Card title="📊 وضعیت">
          <div className="stats">
            {tiles.map((x) => (
              <Link href="/tasks" className="stat" key={x.label}>
                <b>{x.v.toLocaleString("fa-IR")}</b>
                <span>{x.label}</span>
              </Link>
            ))}
          </div>
          <div className="pills">
            {data?.providers.map((p) => (
              <span key={p.name} className={`pill ${p.coolingUntil ? "warn" : "ok"}`} dir="ltr" title={p.coolingUntil ? "محدود" : "آماده"}>
                {p.name}
              </span>
            ))}
          </div>
        </Card>

        <Card title="📅 ترمین‌های پیش رو" action={<Link href="/calendar" className="more">همه</Link>}>
          {!appts ? <Empty>…</Empty> : appts.upcoming.length === 0 ? <Empty>ترمینی نداری.</Empty> : (
            appts.upcoming.slice(0, 4).map((a) => <ApptLine key={a.id} a={a} />)
          )}
        </Card>

        <Card title="📋 آخرین کارها" wide action={<Link href="/tasks" className="more">همه</Link>}>
          {!data ? <Empty>…</Empty> : data.tasks.length === 0 ? <Empty>هنوز کاری نیست.</Empty> : data.tasks.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} />)}
        </Card>
      </div>
    </>
  );
}
