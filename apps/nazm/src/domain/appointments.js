/* Appointments: a dated, timed, optionally located event of a few kinds. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';
import { today, nowHM } from '../core/dates.js';

export const KINDS = {
  visit: { label: 'ترمین', icon: 'medical_services' },
  meet: { label: 'ملاقات', icon: 'groups' },
  meeting: { label: 'جلسه', icon: 'business_center' },
  reminder: { label: 'یادآور', icon: 'notifications_active' },
};
/** Reminder lead times in minutes ('off' = none). */
export const REMIND = { off: 'بدون هشدار', 0: 'سر وقت', 15: '۱۵ دقیقه قبل', 30: '۳۰ دقیقه قبل', 60: '۱ ساعت قبل', 1440: '۱ روز قبل' };
export const remindOf = (a) => (a.remind == null ? '30' : String(a.remind));
export const kindOf = (a) => KINDS[a.kind] || KINDS.reminder;

export const findAppt = (id) => S.appointments.find((a) => a.id === id);
const key = (a) => `${a.date} ${a.time || '99:99'}`;
export const sorted = (list = S.appointments) => list.slice().sort((a, b) => (key(a) < key(b) ? -1 : 1));
export const on = (date) => sorted(S.appointments.filter((a) => a.date === date));

/** Today's later appointments and everything after, soonest first. */
export function upcoming() {
  const t0 = today();
  const now = nowHM();
  return sorted(S.appointments.filter((a) => a.date > t0 || (a.date === t0 && (!a.time || a.time >= now))));
}
export const nextAppointment = () => upcoming()[0] || null;

export function saveAppt(existing, f) {
  const a = existing || { id: uid() };
  Object.assign(a, { title: f.title, kind: f.kind, date: f.date, time: f.time || '', place: f.place || '', remind: f.remind == null ? '30' : String(f.remind) });
  a.notified = false;
  if (!existing) S.appointments.push(a);
  return a;
}
export function removeAppt(id) {
  const i = S.appointments.findIndex((a) => a.id === id);
  return i < 0 ? null : { appt: S.appointments.splice(i, 1)[0], index: i };
}

/* ---- iCalendar export (.ics): every phone/Google calendar can import it and will alert by itself ---- */
const icsText = (x) => String(x || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const stamp = (date, time) => `${date.replace(/-/g, '')}T${(time || '09:00').replace(':', '')}00`;
function endStamp(date, time) {
  const [h, m] = (time || '09:00').split(':').map(Number);
  const t = h * 60 + m + 60;
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + Math.floor(t / 1440));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(Math.floor((t % 1440) / 60))}${p(t % 60)}00`;
}
export function toIcs(list) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nazm//FA', 'CALSCALE:GREGORIAN'];
  list.forEach((a) => {
    lines.push('BEGIN:VEVENT', `UID:${a.id}@nazm`, `DTSTAMP:${stamp(today(), nowHM())}`);
    if (a.time) lines.push(`DTSTART:${stamp(a.date, a.time)}`, `DTEND:${endStamp(a.date, a.time)}`);
    else lines.push(`DTSTART;VALUE=DATE:${a.date.replace(/-/g, '')}`);
    lines.push(`SUMMARY:${icsText(a.title)}`);
    if (a.place) lines.push(`LOCATION:${icsText(a.place)}`);
    const r = remindOf(a);
    if (r !== 'off' && a.time) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(a.title)}`, `TRIGGER:-PT${+r}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
