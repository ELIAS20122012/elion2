"use client";
import { useState } from "react";
import { command, usePoll } from "../api";
import { Offline } from "../parts";
import { Card, Empty, reply } from "../ui";

const AUTO = / ⟨auto (\d{4}-\d{2}-\d{2})⟩$/;

export default function Memory() {
  const { data, down } = usePoll<{ notes: string[] }>("/api/panel/memory", 20000);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  if (down && !data) return <Offline />;
  const notes = (data?.notes ?? []).map((n, i) => ({ i, text: n.replace(AUTO, ""), auto: n.match(AUTO)?.[1] ?? null }));
  const shown = notes.filter((n) => !q.trim() || n.text.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <h1 className="page-h">🧠 حافظه</h1>
      <div className="grid">
        <Card title="➕ چیزی را به خاطر بسپار" wide>
          <form
            className="ask"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              reply(await command("remember", text.trim()));
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: کانال یوتیوب جدیدم Mini Rescue است" aria-label="یادداشت جدید" />
            <button className="primary" disabled={!text.trim()}>ذخیره</button>
          </form>
          <small className="mute">هر شب ساعت ۲۲:۱۵ هم از گفتگوهای روز چیزهای ماندگار را خودش یاد می‌گیرد (🤖).</small>
        </Card>
        <Card
          title={`${notes.length.toLocaleString("fa-IR")} یادداشت`}
          wide
          action={<input type="search" className="mini" placeholder="جستجو…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو در حافظه" />}
        >
          {!data ? <Empty>…</Empty> : shown.length === 0 ? <Empty>{notes.length ? "چیزی پیدا نشد." : "حافظه خالی است."}</Empty> : (
            shown.map((n) => (
              <div className="row" key={n.i}>
                <span className="t">
                  <span className="wrap">{n.text}</span>
                  {n.auto && <small className="mute">🤖 خودکار یاد گرفته · {n.auto}</small>}
                </span>
                <button
                  className="danger"
                  aria-label="حذف"
                  onClick={async () => confirm(`حذف شود؟\n${n.text}`) && reply(await command("forget", String(n.i + 1)))}
                >
                  حذف
                </button>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
