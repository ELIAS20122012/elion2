/* Today: what's left to do and today's habits. One list, no tabs. */
import { S, refresh } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { fa, esc } from '../core/format.js';
import { faDate, relDay } from '../core/calendar.js';
import { icon, ring } from '../ui/widgets.js';
import * as T from '../domain/tasks.js';
import { taskSheet, toggleTask, quickAddTask, habitSheet, tapHabit, habitMenu } from '../features/task-sheets.js';

let showDone = false;
let showLater = false;

function taskRow(t) {
  const overdue = !t.done && t.date < today();
  const meta = [overdue ? `<b class="neg">${relDay(t.date)}</b>` : t.date > today() ? relDay(t.date) : '', t.time ? fa(t.time) : ''].filter(Boolean).join(' • ');
  return `<div class="task${t.done ? ' is-done' : ''}">
    <button class="check-circle${t.done ? ' on' : ''}" data-act="check" data-id="${t.id}" aria-label="انجام شد">${icon('check')}</button>
    <button class="task-text" data-act="edit" data-id="${t.id}"><span class="truncate">${esc(t.title)}</span>${meta ? `<small class="muted">${meta}</small>` : ''}</button>
  </div>`;
}

function habits() {
  const chips = S.habits.map((h) => {
    const ok = T.habitDone(h);
    return `<button class="habit${ok ? ' ok' : ''}" data-act="habit" data-hold="habit" data-id="${h.id}">
      ${icon(h.icon || 'repeat')}<b class="truncate">${esc(h.title)}</b><span class="habit-count">${fa(T.habitValue(h))}/${fa(h.target)}</span></button>`;
  }).join('');
  return `<section class="stack-sm"><div class="row-between section-head"><b>عادت‌ها</b><button class="link accent" data-act="habit-new">+ عادت جدید</button></div>
    ${chips ? `<div class="habit-row">${chips}</div>` : '<div class="empty">هنوز عادتی تعریف نشده</div>'}</section>`;
}

export default {
  id: 'today',
  title: 'امروز',
  render() {
    const b = T.todayBuckets();
    const pct = b.total ? Math.round((b.done.length / b.total) * 100) : 0;
    const toggle = (act, on, label, n) => (n ? `<button class="link muted center" data-act="${act}">${icon(on ? 'expand_less' : 'expand_more', 'tiny')} ${label} (${fa(n)})</button>` : '');
    return `
      <section class="card summary">
        ${ring(pct, `${fa(pct)}%`, 64)}
        <div class="grow col"><b>${S.profile.name ? `سلام ${esc(S.profile.name)}` : 'امروز'}</b>
          <small class="muted">${faDate(parseIso(today()), { weekday: 'long', day: 'numeric', month: 'long' })}</small>
          <small>${b.total ? `${fa(b.done.length)} از ${fa(b.total)} کار انجام شد` : 'کاری برای امروز نیست'}</small></div>
      </section>
      <form class="well quick-add" data-submit="add">
        ${icon('add_task', 'muted')}
        <input data-key="qa" name="qa" autocomplete="off" placeholder="کار جدید… و Enter">
        <button type="submit" class="icon-btn sm primary" aria-label="افزودن">${icon('arrow_upward')}</button>
      </form>
      <section class="stack-sm">
        ${b.open.map(taskRow).join('') || (b.total ? '<div class="empty">همه کارها انجام شد 🎉</div>' : '')}
        ${toggle('toggle-done', showDone, 'انجام‌شده', b.done.length)}${showDone ? b.done.map(taskRow).join('') : ''}
        ${toggle('toggle-later', showLater, 'بعداً', b.later.length)}${showLater ? b.later.map(taskRow).join('') : ''}
      </section>
      ${habits()}`;
  },
  act: {
    add(el) { const input = el.querySelector('input'); if (quickAddTask(input.value)) input.value = ''; },
    check: (el) => toggleTask(el.dataset.id),
    edit: (el) => taskSheet(el.dataset.id),
    'toggle-done'() { showDone = !showDone; refresh(); },
    'toggle-later'() { showLater = !showLater; refresh(); },
    habit(el) { const h = T.findHabit(el.dataset.id); if (h) tapHabit(h); },
    'habit-new': () => habitSheet(),
  },
  hold: { habit(el) { const h = T.findHabit(el.dataset.id); if (h) habitMenu(h); } },
};
