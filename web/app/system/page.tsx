"use client";
import { useState } from "react";
import { command, post, usePoll, when, type Overview } from "../api";
import { Offline } from "../parts";
import { Card, Empty, reply } from "../ui";

export default function System() {
  const { data, down } = usePoll<Overview>("/api/overview", 6000);
  const [cmd, setCmd] = useState<string | null>(null);
  const [arg, setArg] = useState("");
  if (down && !data) return <Offline />;
  return (
    <>
      <h1 className="page-h">⚙️ سیستم</h1>
      <div className="grid">
        <Card title="⚡ دستورها و اسکیل‌ها" wide>
          {cmd && (
            <form
              className="ask"
              onSubmit={async (e) => {
                e.preventDefault();
                const isSkill = data?.skills.some((s) => s.name === cmd) && !data?.commands.some((c) => c.name === cmd);
                reply(isSkill ? await post(`/api/skills/${cmd}/run`, { input: arg }) : await command(cmd, arg));
                setCmd(null);
                setArg("");
              }}
            >
              <span className="cmd" dir="ltr">/{cmd}</span>
              <input autoFocus value={arg} onChange={(e) => setArg(e.target.value)} placeholder="ورودی (اختیاری)" aria-label="ورودی دستور" />
              <button className="primary">اجرا</button>
              <button type="button" onClick={() => setCmd(null)}>بستن</button>
            </form>
          )}
          <div className="chips">
            {[...(data?.commands ?? []), ...(data?.skills ?? []).filter((s) => !data?.commands.some((c) => c.name === s.name))].map((c) => (
              <button key={c.name} className="chip" title={c.description} onClick={() => setCmd(c.name)}>
                <b dir="ltr">/{c.name}</b>
                <small>{c.description}</small>
              </button>
            ))}
          </div>
        </Card>

        <Card title="⏰ زمان‌بندی‌ها">
          {!data ? <Empty>…</Empty> : data.schedules.length === 0 ? <Empty>—</Empty> : (
            data.schedules.map((s) => (
              <div className="row" key={s.name}>
                <span className="t">
                  <span className="ttl">{s.name}</span>
                  <small className="mute" dir="ltr">{s.cron}</small>
                </span>
                <small className={s.enabled ? "" : "mute"}>{s.enabled ? `بعدی: ${when(s.nextRunAt)}` : "غیرفعال"}</small>
              </div>
            ))
          )}
        </Card>

        <Card title="🔌 پلاگین‌ها">
          {data?.plugins.map((p) => (
            <div className="row" key={p.name}>
              <span className="t">
                <span className="ttl">{p.error ? "✖" : "✔"} {p.name}</span>
                <small className={p.error ? "bad" : "mute"}>{p.error || p.description}</small>
              </span>
            </div>
          ))}
        </Card>

        <Card title="📜 لاگ" wide action={<a className="more" href="/classic">پنل قدیمی</a>}>
          <div className="log" dir="ltr">
            {data?.events.map((e, i) => (
              <div key={i} className={e.level === "error" ? "bad" : e.level === "warn" ? "warn" : ""}>
                <span className="mute">{new Date(e.ts).toLocaleTimeString("en-GB")}</span> {e.type} — {e.message}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
