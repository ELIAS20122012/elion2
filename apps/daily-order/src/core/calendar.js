/* Calendar-aware helpers: Jalali by default, Gregorian when the profile says so. */
import { config } from './config.js';
import { pad, iso, parseIso, daysBetween, today } from './dates.js';
import { toJ, fromJ, jMonthLen } from './jalali.js';
import { fa } from './format.js';

export const useJ = () => config.calendar !== 'gregorian';

export function faDate(d, opt) {
  try {
    return new Intl.DateTimeFormat(useJ() ? 'fa-IR-u-ca-persian' : 'fa-IR-u-ca-gregory', opt).format(d);
  } catch { return iso(d); }
}
export const faDayMonth = (d) => faDate(d, { day: 'numeric', month: 'long' });
export const faDayNum = (d) => faDate(d, { day: 'numeric' });
export const fullDate = (s) => faDate(parseIso(s), { day: 'numeric', month: 'long', year: 'numeric' });
export const monthName = (s) => faDate(parseIso(s), { month: 'long' });
export const monthYear = (s) => faDate(parseIso(s), { month: 'long', year: 'numeric' });

/* ---- month keys: "YYYY-MM" in the active calendar ---- */
export function monthKey(dateIso) {
  if (useJ()) { const j = toJ(dateIso); return `${j.jy}-${pad(j.jm)}`; }
  return dateIso.slice(0, 7);
}
export function monthStartIso(key) {
  const [y, m] = key.split('-');
  return useJ() ? fromJ(+y, +m, 1) : `${key}-01`;
}
export function shiftMonthKey(key, n) {
  const [y0, m0] = key.split('-');
  let y = +y0;
  const m = +m0 - 1 + n;
  y += Math.floor(m / 12);
  return `${y}-${pad((((m % 12) + 12) % 12) + 1)}`;
}
export const currentMonthKey = () => monthKey(today());
export const prevMonthKey = () => shiftMonthKey(currentMonthKey(), -1);
export const monthLabel = (key) => monthYear(monthStartIso(key));

export function dayOfMonth(dateIso) {
  return useJ() ? toJ(dateIso).jd : parseIso(dateIso).getDate();
}

/** Add n calendar months, keeping the anchor day (clamped to the month length). */
export function addMonthsIso(dateIso, n, anchorDay) {
  if (useJ()) {
    const j = toJ(dateIso);
    let m = j.jm - 1 + n;
    const y = j.jy + Math.floor(m / 12);
    m = (((m % 12) + 12) % 12) + 1;
    return fromJ(y, m, Math.min(anchorDay || j.jd, jMonthLen(y, m)));
  }
  const d = parseIso(dateIso);
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return iso(new Date(y, m, Math.min(anchorDay || d.getDate(), last)));
}

/** "today", "tomorrow", "3 days from now", … */
export function relDay(d) {
  const n = daysBetween(today(), d);
  if (n === 0) return 'امروز';
  if (n === 1) return 'فردا';
  if (n === -1) return 'دیروز';
  return n > 0 ? `${fa(n)} روز دیگر` : `${fa(-n)} روز گذشته`;
}

/** A date as a "yyyy/mm/dd" string (for CSV export). */
export function jalaliString(dateIso) {
  const j = toJ(dateIso);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}
