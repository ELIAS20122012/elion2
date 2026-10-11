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
  Object.assign(a, { title: f.title, kind: f.kind, date: f.date, time: f.time || '', place: f.place || '' });
  if (!existing) S.appointments.push(a);
  return a;
}
export function removeAppt(id) {
  const i = S.appointments.findIndex((a) => a.id === id);
  return i < 0 ? null : { appt: S.appointments.splice(i, 1)[0], index: i };
}
