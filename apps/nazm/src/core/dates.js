/* Gregorian date helpers. Dates are stored as local "YYYY-MM-DD" strings. */
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseIso(s) {
  const [y, m, d] = s.split('-');
  return new Date(+y, +m - 1, +d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const today = () => iso(new Date());
export const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function hmToMin(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':');
  return +h * 60 + (+m || 0);
}
export const minToHM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 864e5);

/* index = Date#getDay() (0 = Sunday) */
export const WD_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];
export const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WD_EN_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WD_LONG = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/* The Persian week starts on Saturday. */
export function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 1) % 7));
}
