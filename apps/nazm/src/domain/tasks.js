/* Tasks and habits. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';
import { iso, addDays, parseIso, today } from '../core/dates.js';

export const HABIT_ICONS = ['local_drink', 'menu_book', 'self_improvement', 'directions_walk', 'bedtime', 'nutrition', 'fitness_center', 'edit_note'];

/* ---------- tasks ---------- */
export const findTask = (id) => S.tasks.find((t) => t.id === id);
export const activeTasks = () => S.tasks.filter((t) => !t.archived);

export function newTask(f = {}) {
  return { id: uid(), title: '', date: today(), time: '', repeat: 'none', priority: 'med', starred: false, done: false, archived: false, note: '', createdAt: today(), ...f };
}

/** Open first, then by date, then time. */
export function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time || '99') < (b.time || '99') ? -1 : 1;
}

export const REPEAT = { none: 'یک‌بار', daily: 'هر روز', weekly: 'هر هفته' };

export function nextRepeatDate(t) {
  const d = t.date || today();
  if (t.repeat === 'daily') return iso(addDays(parseIso(d), 1));
  if (t.repeat === 'weekly') return iso(addDays(parseIso(d), 7));
  return null;
}

/** Toggle done. Completing a repeating task creates its next occurrence once (returned). */
export function toggleDone(t) {
  t.done = !t.done;
  t.doneAt = t.done ? today() : null;
  if (!(t.done && (t.repeat === 'daily' || t.repeat === 'weekly') && !t.spawnedNext)) return null;
  const next = { ...t, id: uid(), done: false, doneAt: null, spawnedNext: false, date: nextRepeatDate(t) };
  S.tasks.push(next);
  t.spawnedNext = next.id;
  return next;
}

/** Tasks (not archived) planned for one day: open first, then done. */
export const tasksOn = (date) => activeTasks().filter((t) => t.date === date).sort(sortTasks);

export function removeTask(id) {
  const i = S.tasks.findIndex((t) => t.id === id);
  return i < 0 ? null : { task: S.tasks.splice(i, 1)[0], index: i };
}

/** What the Today page shows: unfinished tasks due today or earlier, today's finished ones, and what is coming. */
export function todayBuckets() {
  const t0 = today();
  const all = activeTasks();
  const open = all.filter((t) => !t.done && t.date <= t0).sort(sortTasks);
  const done = all.filter((t) => t.done && (t.doneAt || t.date) === t0);
  const later = all.filter((t) => !t.done && t.date > t0).sort(sortTasks);
  return { open, done, later, total: open.length + done.length };
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
