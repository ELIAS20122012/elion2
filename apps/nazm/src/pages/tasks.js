/* Tasks: calendar · appointments · daily tasks · shopping. One "+" always opens a small form. */
import { S, commit, refresh } from '../core/store.js';
import { iso, addDays, parseIso, today, weekStart, WD_SHORT } from '../core/dates.js';
import { fa, esc } from '../core/format.js';
import { faDate, faDayNum, relDay } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { menu } from '../ui/sheet.js';
import { icon } from '../ui/widgets.js';
import { pageHead, tabs, row, check, fab, empty, section, ring, tabOf, setTab } from '../ui/kit.js';
import * as T from '../domain/tasks.js';
import * as A from '../domain/appointments.js';
import * as SH from '../domain/shopping.js';
import { taskSheet, toggleTask, quickAddTask } from '../features/task-sheets.js';
import { apptSheet, shopSheet, quickShop } from '../features/plan-sheets.js';

const TABS = [{ key: 'calendar', label: 'تقویم' }, { key: 'appts', label: 'قرارها' }, { key: 'daily', label: 'کارهای روزانه' }, { key: 'shop', label: 'خریدها' }];
let day = today();

const dayLabel = (d) => (d === today() ? 'امروز' : relDay(d) === 'فردا' ? 'فردا' : faDate(parseIso(d), { weekday: 'long', day: 'numeric', month: 'long' }));

/* ---------- rows ---------- */
const taskRow = (t) => row({
  ic: t.repeat && t.repeat !== 'none' ? 'repeat' : 'task_alt', title: esc(t.title), cls: t.done ? 'is-done' : '',
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
      <div class="grow center">${ring(pct, `${fa(done)}/${fa(list.length)}`, 'انجام شد', 96)}<b class="block">${dayLabel(day)}</b></div>
      <button class="icon-btn" data-act="step" data-d="1" aria-label="روز بعد">${icon('chevron_left')}</button>
    </section>
    <form class="add-line" data-submit="quick-task">${icon('add_task', 'muted')}<input data-key="qt" name="qt" autocomplete="off" placeholder="کار تازه برای ${dayLabel(day)}…"><button class="btn-sm" type="submit">افزودن</button></form>
    <div class="list">${list.map(taskRow).join('') || empty('کاری برای این روز نیست')}</div>`;
}

function shopTab() {
  const groups = SH.grouped();
  const bought = S.shopping.filter((i) => i.done).length;
  return `<section class="card row-between"><span><b class="big">${fa(SH.remaining())}</b> <small>مورد باقی‌مانده</small></span>
      ${bought ? `<button class="link" data-act="clear-bought">پاک کردن خریده‌شده‌ها (${fa(bought)})</button>` : ''}</section>
    <form class="add-line" data-submit="quick-shop">${icon('add_shopping_cart', 'muted')}<input data-key="qs" name="qs" autocomplete="off" placeholder="چه چیزی بخریم؟"><button class="btn-sm" type="submit">افزودن</button></form>
    ${groups.map((g) => section(SH.CATS[g.cat].label, `<div class="list">${g.items.map((i) => row({ ic: SH.catOf(i).icon, title: esc(i.title), cls: i.done ? 'is-done' : '', act: 'shop-edit', attrs: `data-id="${i.id}"`, trailing: check('shop-check', i.id, i.done) })).join('')}</div>`)).join('') || empty('فهرست خرید خالی است')}`;
}

export default {
  id: 'tasks',
  title: 'کارها',
  mount() { day = today(); },
  render() {
    const tab = tabOf('tasks', 'daily');
    const body = tab === 'calendar' ? calendarTab() : tab === 'appts' ? apptsTab() : tab === 'shop' ? shopTab() : dailyTab();
    return `${pageHead('کارها', 'برنامه‌ی روز و هفته')}${tabs(TABS, tab)}<div class="stack">${body}</div>${fab('add')}`;
  },
  act: {
    tab: (el) => setTab('tasks', el.dataset.v),
    'pick-day'(el) { day = el.dataset.date; refresh(); },
    week(el) { day = iso(addDays(parseIso(day), +el.dataset.d)); refresh(); },
    step(el) { day = iso(addDays(parseIso(day), +el.dataset.d)); refresh(); },
    'task-check': (el) => toggleTask(el.dataset.id),
    'task-edit': (el) => taskSheet(el.dataset.id),
    'appt-edit': (el) => apptSheet(el.dataset.id),
    'shop-check'(el) { const i = SH.findItem(el.dataset.id); i.done = !i.done; commit(); },
    'shop-edit': (el) => shopSheet(el.dataset.id),
    'clear-bought'() { const n = SH.clearBought(); commit(); toast(`${fa(n)} مورد پاک شد`); },
    'quick-task'(el) { const input = el.querySelector('input'); if (quickAddTask(input.value, day)) input.value = ''; },
    'quick-shop'(el) { const input = el.querySelector('input'); if (quickShop(input.value)) input.value = ''; },
    add() {
      const tab = tabOf('tasks', 'daily');
      if (tab === 'appts') apptSheet(null, day);
      else if (tab === 'shop') shopSheet();
      else if (tab === 'calendar') menu('افزودن به ' + dayLabel(day), [{ icon: 'task_alt', label: 'کار', run: () => taskSheet(null, day) }, { icon: 'event', label: 'قرار', run: () => apptSheet(null, day) }]);
      else taskSheet(null, day);
    },
  },
};
