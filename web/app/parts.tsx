"use client";
import { daysUntil, faDate, type Appointment } from "./api";

export function ApptLine({ a }: { a: Appointment }) {
  const n = daysUntil(a.date);
  const rel = n === 0 ? "امروز" : n === 1 ? "فردا" : `${n.toLocaleString("fa-IR")} روز دیگر`;
  return (
    <div className="row appt">
      <span className={`when${n <= 1 ? " soon" : ""}`}>{rel}</span>
      <span className="t">
        <span className="ttl">{a.text}</span>
        <small className="mute">
          {faDate(a.date)}
          {a.time ? ` · ساعت ${a.time}` : ""}
        </small>
      </span>
    </div>
  );
}

export function Offline() {
  return (
    <div className="offline">
      <b>به Elion وصل نیستم.</b>
      <p className="mute">کامپیوتر خاموش است یا Elion اجرا نمی‌شود. خودش هر چند ثانیه دوباره امتحان می‌کند.</p>
    </div>
  );
}
