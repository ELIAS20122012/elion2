/* Tasks, habits and the weekly review. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid, clone, sum } from '../core/util.js';
import { iso, addDays, parseIso, today, weekStart } from '../core/dates.js';
import { addMonthsIso } from '../core/calendar.js';
import { daySpend } from './finance.js';
import { setsOf } from './gym.js';

export const PRIO = {
  high: { label: 'بالا', color: '#DE8353', rank: 0, icon: 'keyboard_double_arrow_up' },
  med: { label: 'متوسط', color: '#c08a3e', rank: 1, icon: 'drag_handle' },
  low: { label: 'پایین', color: '#8EAA97', rank: 2, icon: 'keyboard_double_arrow_down' },
};
export const prio = (t) => PRIO[t.priority] || PRIO.med;
export const CAT = {
  work: { label: 'کار', color: '#DE8353' }, personal: { label: 'شخصی', color: '#8EAA97' },
  health: { label: 'سلامت', color: '#1e293b' }, finance: { label: 'مالی', color: '#fdb885' },
};
export const catOf = (t) => CAT[t.category] || CAT.work;
export const REPEAT = { none: 'بدون تکرار', daily: 'هر روز', weekly: 'هر هفته', monthly: 'هر ماه' };
export const HABIT_ICONS = ['local_drink', 'menu_book', 'self_improvement', 'directions_walk', 'bedtime', 'nutrition', 'fitness_center', 'edit_note', 'medication', 'language'];

/* ---------- tasks ---------- */
export const findTask = (id) => S.tasks.find((t) => t.id === id);
export const activeTasks = () => S.tasks.filter((t) => !t.archived);

export function newTask(f = {}) {
  return {
    id: uid(), title: '', date: today(), time: '', category: 'work', priority: 'med', repeat: 'none',
    subtasks: [], starred: false, done: false, archived: false, reminder: false, note: '', createdAt: today(), ...f,
  };
}

export function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const pa = prio(a).rank;
  const pb = prio(b).rank;
  if (pa !== pb) return pa - pb;
  return (a.time || '99') < (b.time || '99') ? -1 : 1;
}

export function nextRepeatDate(t) {
  const d = t.date || today();
  if (t.repeat === 'daily') return iso(addDays(parseIso(d), 1));
  if (t.repeat === 'weekly') return iso(addDays(parseIso(d), 7));
  if (t.repeat === 'monthly') return addMonthsIso(d, 1);
  return null;
}

/** Toggle done. Completing a repeating task spawns its next occurrence (returned). */
export function toggleDone(t) {
  t.done = !t.done;
  t.doneAt = t.done ? today() : null;
  if (!(t.done && t.repeat && t.repeat !== 'none' && !t.spawnedNext)) return null;
  const next = clone(t);
  Object.assign(next, { id: uid(), done: false, doneAt: null, notified: false, spawnedNext: false, date: nextRepeatDate(t) });
  (next.subtasks || []).forEach((s) => { s.done = false; s.id = uid(); });
  S.tasks.push(next);
  t.spawnedNext = next.id;
  return next;
}

export function duplicateTask(t) {
  const c = clone(t);
  Object.assign(c, { id: uid(), done: false, spawnedNext: false });
  (c.subtasks || []).forEach((s) => { s.id = uid(); s.done = false; });
  S.tasks.push(c);
  return c;
}

export function removeTask(id) {
  const i = S.tasks.findIndex((t) => t.id === id);
  if (i < 0) return null;
  return { task: S.tasks.splice(i, 1)[0], index: i };
}

export function moveTaskTo(t, date) { t.date = date; t.notified = false; }
export function pushOverdueToToday() {
  S.tasks.forEach((t) => { if (!t.done && !t.archived && t.date < today()) moveTaskTo(t, today()); });
}
export function archiveDone() {
  let n = 0;
  S.tasks.forEach((t) => { if (t.done && !t.archived) { t.archived = true; n++; } });
  return n;
}

export function taskBuckets() {
  const t0 = today();
  const all = activeTasks();
  const todays = all.filter((t) => t.date === t0);
  return {
    all, todays,
    overdue: all.filter((t) => !t.done && t.date < t0),
    doneToday: todays.filter((t) => t.done).length,
  };
}

/* ---------- habits ---------- */
export const findHabit = (id) => S.habits.find((h) => h.id === id);
export const habitValue = (h, k = today()) => (h.log && h.log[k]) || 0;
export const habitDone = (h, k = today()) => habitValue(h, k) >= h.target;
export function habitStreak(h) {
  let n = 0;
  let d = new Date();
  if (!habitDone(h, iso(d))) d = addDays(d, -1);
  while (habitDone(h, iso(d)) && n < 999) { n++; d = addDays(d, -1); }
  return n;
}
export function bumpHabit(h, delta, k = today()) {
  h.log = h.log || {};
  h.log[k] = Math.max(0, habitValue(h, k) + delta);
  return h.log[k];
}

/* ---------- weekly review ---------- */
export const REVIEW_FIELDS = [
  ['wins', 'دستاوردها و کارهای خوب این هفته', 'emoji_events', 'چه چیزهایی خوب پیش رفت؟'],
  ['challenges', 'چالش‌ها و درس‌ها', 'psychology', 'چه چیزی سخت بود و چه یاد گرفتم؟'],
  ['next', 'اولویت‌های هفته بعد', 'flag', 'هر خط یک اولویت — می‌توانید آن‌ها را به کار تبدیل کنید'],
  ['notes', 'یادداشت آزاد', 'sticky_note_2', 'هر چیزی که می‌خواهید بنویسید…'],
];
export const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
export const currentWeek = () => iso(weekStart(new Date()));
export const reviewOf = (ws) => S.weekly[ws] || {};
export const reviewHasText = (r) => !!(r && (r.wins || r.challenges || r.next || r.notes));
export const writtenReviews = () => Object.keys(S.weekly).filter((k) => reviewHasText(S.weekly[k]));
export function editReview(ws) { return (S.weekly[ws] = S.weekly[ws] || {}); }

export function weekStats(ws) {
  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(parseIso(ws), i)));
  const inWeek = (d) => d >= days[0] && d <= days[6];
  const due = S.tasks.filter((t) => inWeek(t.date));
  const done = S.tasks.filter((t) => t.done && inWeek(t.doneAt || t.date));
  let total = 0;
  let ok = 0;
  S.habits.forEach((h) => days.forEach((k) => { if (k <= today()) { total++; if (habitDone(h, k)) ok++; } }));
  const gym = days.filter((k) => { const s = S.gym.sessions[k]; return s && (s.finished || setsOf(s).done > 0); }).length;
  return { days, due: due.length, done: done.length, habit: total ? Math.round((ok / total) * 100) : 0, gym, spend: sum(days, daySpend) };
}

/** Turn the "next week" review lines into high-priority tasks. Returns { added, date }. */
export function reviewToTasks(ws) {
  const lines = String(reviewOf(ws).next || '').split('\n').map((x) => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
  if (!lines.length) return null;
  let date = iso(addDays(parseIso(ws), 7));
  if (date < today()) date = today();
  const existing = new Set(S.tasks.map((t) => `${t.title}|${t.date}`));
  let added = 0;
  lines.forEach((title) => {
    if (existing.has(`${title}|${date}`)) return;
    S.tasks.push(newTask({ title, date, priority: 'high', starred: true, note: 'از مرور هفتگی' }));
    added++;
  });
  return { added, date };
}
