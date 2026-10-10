"use client";
import { useState } from "react";
import { command, usePoll, type Appointment } from "../api";
import { ApptLine, Offline } from "../parts";
import { Card, Empty, reply } from "../ui";

export default function Calendar() {
  const { data, down } = usePoll<{ upcoming: Appointment[] }>("/api/panel/appointments", 15000);
  const [text, setText] = useState("");
  if (down && !data) return <Offline />;
  return (
    <>
      <h1 className="page-h">📅 ترمین‌ها</h1>
      <div className="grid">
        <Card title="➕ ترمین جدید" wide>
          <form
            className="ask"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              reply(await command("termin", text.trim()));
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: 15.10.2026 10:30 ترمین با AMS" aria-label="ترمین جدید" />
            <button className="primary" disabled={!text.trim()}>ثبت</button>
          </form>
          <small className="mute">یک روز قبل و روز ترمین در تلگرام یادآوری می‌شود و در Google Calendar هم ثبت می‌شود.</small>
        </Card>
        <Card
          title="پیش رو"
          wide
          action={<button onClick={async () => reply(await command("termin", "sync"))}>همگام با Google Calendar</button>}
        >
          {!data ? <Empty>…</Empty> : data.upcoming.length === 0 ? <Empty>ترمینی نداری.</Empty> : (
            data.upcoming.map((a, i) => (
              <div className="with-acts" key={a.id}>
                <ApptLine a={a} />
                <button
                  className="danger"
                  aria-label={`حذف ${a.text}`}
                  onClick={async () => confirm(`«${a.text}» حذف شود؟`) && reply(await command("termin", `del ${i + 1}`))}
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
