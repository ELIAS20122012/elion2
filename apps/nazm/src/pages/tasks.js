/* Tasks: calendar · appointments · daily tasks · shopping. One "+" always opens a small form. */
import { S, refresh } from '../core/store.js';
import { iso, addDays, parseIso, today, weekStart, WD_SHORT } from '../core/dates.js';
import { fa, esc } from '../core/format.js';
import { faDate, faDayNum, relDay } from '../core/calendar.js';
import { menu } from '../ui/sheet.js';
import { icon } from '../ui/widgets.js';
import { pageHead, drawers, toggleDrawer, row, check, empty, section, ring, tabOf, openOr } from '../ui/kit.js';
import * as T from '../domain/tasks.js';
import * as A from '../domain/appointments.js';
import { taskSheet, toggleTask } from '../features/task-sheets.js';
import { apptSheet } from '../features/plan-sheets.js';

const ORDER = ['calendar', 'appts', 'daily'];
const LABELS = { calendar: 'تقویم', appts: 'قرارها', daily: 'کارهای روزانه' };
let day = today();

const dayLabel = (d) => (d === today() ? 'امروز' : relDay(d) === 'فردا' ? 'فردا' : faDate(parseIso(d), { weekday: 'long', day: 'numeric', month: 'long' }));

/* ---------- rows ---------- */
const taskRow = (t) => row({
  ic: '', title: esc(t.title), cls: t.done ? 'is-done' : '',
  sub: [t.time ? fa(t.time) : '', t.repeat && t.repeat !== 'none' ? T.REPEAT[t.repeat] : ''].filter(Boolean).join(' · '),
  act: 'task-edit', attrs: `data-id="${t.id}"`, trailing: check('task-check', t.id, t.done),
});

const apptRow = (a, showDate = false) => row({
  ic: A.kindOf(a).icon, tint: 'coral', title: esc(a.title), act: 'appt-edit', attrs: `data-id="${a.id}"`,
  sub: [showDate ? dayLabel(a.date) : '', A.kindOf(a).label, a.time ? fa(a.time) : '', a.place ? esc(a.place) : ''].filter(Boolean).join(' · '),
});

/* ---------- tabs ---------- */
function calendarTab() {
  const ws = weekStart(parseIso(day));
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = iso(addDays(ws, i));
    const hasAppt = S.appointments.some((a) => a.date === d);
    const hasTask = S.tasks.some((t) => t.date === d && !t.archived);
    return `<button class="wd${d === day ? ' on' : ''}${d === today() ? ' now' : ''}" data-act="pick-day" data-date="${d}">
      <small>${WD_SHORT[parseIso(d).getDay()]}</small><b>${faDayNum(parseIso(d))}</b>
      <span class="dots">${hasAppt ? '<i class="dot coral"></i>' : ''}${hasTask ? '<i class="dot green"></i>' : ''}</span></button>`;
  }).join('');
  const appts = A.on(day);
  const tasks = T.tasksOn(day);
  return `<section class="card">
      <div class="row-between"><button class="icon-btn" data-act="week" data-d="-7" aria-label="هفته قبل">${icon('chevron_right')}</button>
        <b>${faDate(ws, { month: 'long', year: 'numeric' })}</b>
        <button class="icon-btn" data-act="week" data-d="7" aria-label="هفته بعد">${icon('chevron_left')}</button></div>
      <div class="week">${strip}</div>
      <div class="legend"><span><i class="dot coral"></i>قرار</span><span><i class="dot green"></i>کار</span></div>
    </section>
    ${section(dayLabel(day), `<div class="list">${appts.map((a) => apptRow(a)).join('')}${tasks.map(taskRow).join('')}${appts.length || tasks.length ? '' : empty('برای این روز چیزی ثبت نشده')}</div>`)}`;
}

function apptsTab() {
  const list = A.upcoming();
  const groups = [];
  list.forEach((a) => { const g = groups[groups.length - 1]; if (g && g.date === a.date) g.items.push(a); else groups.push({ date: a.date, items: [a] }); });
  return groups.map((g) => section(dayLabel(g.date), `<div class="list">${g.items.map((a) => apptRow(a)).join('')}</div>`)).join('') || empty('قراری در پیش نیست');
}

function dailyTab() {
  const list = T.tasksOn(day);
  const done = list.filter((t) => t.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  return `<section class="card day-card">
      <button class="icon-btn" data-act="step" data-d="-1" aria-label="روز قبل">${icon('chevron_right')}</button>
      <div class="grow center">${ring(pct, `${fa(done)}/${fa(list.length)}`, 'انجام شد', 72)}<b class="block">${dayLabel(day)}</b></div>
      <button class="icon-btn" data-act="step" data-d="1" aria-label="روز بعد">${icon('chevron_left')}</button>
    </section>
    <div class="list">${list.map(taskRow).join('') || empty('کاری برای این روز نیست')}</div>`;
}

export default {
  id: 'tasks',
  title: 'کارها',
  mount() { day = today(); },
  render() {
    const bodies = { calendar: calendarTab, appts: apptsTab, daily: dailyTab };
    const items = ORDER.map((key) => ({ key, label: LABELS[key], body: () => `<div class="stack">${bodies[key]()}</div>` }));
    return `${pageHead('کارها', 'برنامه‌ی روز و هفته', 'add')}${drawers(items, tabOf('tasks', 'daily'))}`;
  },
  act: {
    tab: toggleDrawer('tasks'),
    'pick-day'(el) { day = el.dataset.date; refresh(); },
    week(el) { day = iso(addDays(parseIso(day), +el.dataset.d)); refresh(); },
    step(el) { day = iso(addDays(parseIso(day), +el.dataset.d)); refresh(); },
    'task-check': (el) => toggleTask(el.dataset.id),
    'task-edit': (el) => taskSheet(el.dataset.id),
    'appt-edit': (el) => apptSheet(el.dataset.id),
    add() {
      const tab = openOr('tasks', 'daily');
      if (tab === 'appts') apptSheet(null, day);
      else if (tab === 'calendar') menu('افزودن به ' + dayLabel(day), [{ icon: 'task_alt', label: 'کار', run: () => taskSheet(null, day) }, { icon: 'event', label: 'قرار', run: () => apptSheet(null, day) }]);
      else taskSheet(null, day);
    },
  },
};
