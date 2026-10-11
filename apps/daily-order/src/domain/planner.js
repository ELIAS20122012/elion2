/* Time blocks for the day planner. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid, clone } from '../core/util.js';
import { iso, addDays, parseIso, hmToMin, minToHM } from '../core/dates.js';

export const BLOCK_COLORS = {
  terracotta: { color: '#DE8353', label: 'تمرکز', icon: 'bolt' },
  slate: { color: '#1e293b', label: 'جلسه', icon: 'groups' },
  sage: { color: '#8EAA97', label: 'سلامت', icon: 'spa' },
  sand: { color: '#fdb885', label: 'شخصی', icon: 'person' },
};
export const blockColor = (b) => BLOCK_COLORS[b.color] || BLOCK_COLORS.terracotta;

/* The timeline spans 06:00–24:00. */
export const DAY_START = 6 * 60;
export const DAY_SPAN = 18 * 60;

export const findBlock = (id) => S.blocks.find((b) => b.id === id);
export const blocksOn = (date) => S.blocks.filter((b) => b.date === date).sort((a, b) => hmToMin(a.start) - hmToMin(b.start));

export function saveBlock(existing, f) {
  const b = existing || { id: uid(), done: false };
  Object.assign(b, { title: f.title, date: f.date, start: f.start, end: f.end, color: f.color, icon: blockColor(f).icon, notify: !!f.notify, notified: false });
  if (!existing) S.blocks.push(b);
  return b;
}

/** First other block on that day that overlaps [start, end). */
export function clashWith(f, ignore) {
  return S.blocks.find((x) => x !== ignore && x.date === f.date && hmToMin(f.start) < hmToMin(x.end) && hmToMin(f.end) > hmToMin(x.start));
}

export function duplicateToNextDay(b) {
  const c = clone(b);
  Object.assign(c, { id: uid(), done: false, notified: false, date: iso(addDays(parseIso(b.date), 1)) });
  S.blocks.push(c);
  return c;
}

/** Default start for a new block: the next half hour; end defaults to +1h. */
export function defaultSlot(nowMin) {
  const start = Math.min(Math.ceil((nowMin + 1) / 30) * 30, 22 * 60);
  return { start: minToHM(start), end: minToHM(Math.min(start + 60, 23 * 60 + 59)) };
}
