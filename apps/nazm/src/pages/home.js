/* Home: greeting, today at a glance, the task list and habits. */
import { S, refresh } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { fa, faInt, esc } from '../core/format.js';
import { faDate, relDay } from '../core/calendar.js';
import { go } from '../router.js';
import { icon } from '../ui/widgets.js';
import * as T from '../domain/tasks.js';
import * as G from '../domain/gym.js';
import { taskSheet, toggleTask, quickAddTask, habitSheet, tapHabit, habitMenu } from '../features/task-sheets.js';

let showDone = false;
let showLater = false;

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'شب بخیر' : h < 12 ? 'صبح بخیر' : h < 17 ? 'ظهر بخیر' : h < 21 ? 'عصر بخیر' : 'شب بخیر';
};

function glance(b) {
  const s = G.sessionFromPlan(today());
  const st = G.setsOf(s);
  const goal = S.gym.goals.kcal;
  const left = goal - G.sumMeals(G.mealsOn()).kcal;
  const cell = (act, value, label) => `<button class="glance-cell" data-act="${act}"><b>${value}</b><small>${label}</small></button>`;
  return `<section class="hero">
    <svg class="leaf" viewBox="0 0 120 160" aria-hidden="true"><path d="M60 155 C58 110 60 60 64 8 M60 120 C40 112 26 96 22 74 M60 96 C80 88 94 72 98 50 M60 66 C44 60 34 46 32 28 M62 44 C76 40 84 30 86 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    <small class="eyebrow">امروز</small>
    <h2>${b.total ? `${fa(b.done.length)} از ${fa(b.total)} کار انجام شد` : 'روز آرامی دارید'}</h2>
    <div class="glance">
      ${cell('tasks', `${fa(b.open.length)}`, 'کار باقی‌مانده')}
      ${cell('gym', s && s.exercises.length ? `${fa(st.done)}/${fa(st.tot)}` : '—', s && s.exercises.length ? 'ست تمرین' : 'استراحت')}
      ${cell('gym', left >= 0 ? faInt(left) : `+${faInt(-left)}`, left >= 0 ? 'کالری مانده' : 'کالری اضافه')}
    </div></section>`;
}

function taskRow(t) {
  const overdue = !t.done && t.date < today();
  const meta = [overdue ? `<b class="neg">${relDay(t.date)}</b>` : t.date > today() ? relDay(t.date) : '', t.time ? fa(t.time) : ''].filter(Boolean).join(' • ');
  return `<div class="row-item task${t.done ? ' is-done' : ''}">
    <button class="check${t.done ? ' on' : ''}" data-act="check" data-id="${t.id}" aria-label="انجام شد">${icon('check')}</button>
    <button class="grow col task-text" data-act="edit" data-id="${t.id}"><span class="truncate">${esc(t.title)}</span>${meta ? `<small>${meta}</small>` : ''}</button>
  </div>`;
}

function habits() {
  const items = S.habits.map((h) => {
    const pct = Math.min(100, Math.round((T.habitValue(h) / h.target) * 100));
    return `<button class="habit${T.habitDone(h) ? ' ok' : ''}" data-act="habit" data-hold="habit" data-id="${h.id}">
      <span class="habit-circle" style="--p:${pct}">${icon(h.icon || 'repeat')}</span><small class="truncate">${esc(h.title)}</small><b>${fa(T.habitValue(h))}/${fa(h.target)}</b></button>`;
  }).join('');
  return `<section class="section"><div class="section-head"><h3>عادت‌ها</h3><button class="link" data-act="habit-new">افزودن</button></div>
    ${items ? `<div class="habit-row">${items}</div>` : '<p class="empty">هنوز عادتی تعریف نشده</p>'}</section>`;
}

export default {
  id: 'home',
  title: '',
  render() {
    const b = T.todayBuckets();
    const toggle = (act, on, label, n) => (n ? `<button class="link center" data-act="${act}">${label} (${fa(n)}) ${icon(on ? 'expand_less' : 'expand_more', 'tiny')}</button>` : '');
    return `
      <header class="greet"><h1>${greeting()}${S.profile.name ? `، ${esc(S.profile.name)}` : ''}</h1>
        <p>${faDate(parseIso(today()), { weekday: 'long', day: 'numeric', month: 'long' })}</p></header>
      ${glance(b)}
      <section class="section" id="tasks">
        <div class="section-head"><h3>کارهای امروز</h3></div>
        <form class="add-line" data-submit="add"><input data-key="qa" name="qa" autocomplete="off" placeholder="کار جدید…"><button class="round" type="submit" aria-label="افزودن">${icon('add')}</button></form>
        <div class="list-plain">
          ${b.open.map(taskRow).join('') || (b.total ? '<p class="empty">همه کارها انجام شد</p>' : '')}
          ${toggle('toggle-done', showDone, 'انجام‌شده', b.done.length)}${showDone ? b.done.map(taskRow).join('') : ''}
          ${toggle('toggle-later', showLater, 'بعداً', b.later.length)}${showLater ? b.later.map(taskRow).join('') : ''}
        </div>
      </section>
      ${habits()}`;
  },
  act: {
    add(el) { const input = el.querySelector('input'); if (quickAddTask(input.value)) input.value = ''; },
    check: (el) => toggleTask(el.dataset.id),
    edit: (el) => taskSheet(el.dataset.id),
    tasks: () => document.getElementById('tasks').scrollIntoView({ behavior: 'smooth' }),
    gym: () => go('gym'),
    'toggle-done'() { showDone = !showDone; refresh(); },
    'toggle-later'() { showLater = !showLater; refresh(); },
    habit(el) { const h = T.findHabit(el.dataset.id); if (h) tapHabit(h); },
    'habit-new': () => habitSheet(),
  },
  hold: { habit(el) { const h = T.findHabit(el.dataset.id); if (h) habitMenu(h); } },
};
