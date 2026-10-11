/* Today: a short summary only — focus, remaining tasks, next appointment, workout, today's spending. */
import { S } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDate, relDay } from '../core/calendar.js';
import { icon } from '../ui/widgets.js';
import { goTab } from '../ui/kit.js';
import * as T from '../domain/tasks.js';
import * as G from '../domain/gym.js';
import * as A from '../domain/appointments.js';
import * as fin from '../domain/finance.js';
import { toggleTask } from '../features/task-sheets.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'شب بخیر' : h < 12 ? 'صبح بخیر' : h < 17 ? 'ظهر بخیر' : h < 21 ? 'عصر بخیر' : 'شب بخیر';
};

const stat = (act, ic, value, label) => `<button class="stat" data-act="${act}">${icon(ic)}<b>${value}</b><small>${label}</small></button>`;

export default {
  id: 'today',
  title: 'امروز',
  render() {
    const open = T.todayBuckets().open;
    const next = open[0];
    const s = G.sessionFromPlan(today());
    const st = G.setsOf(s);
    const workout = s && s.exercises.length ? `${fa(st.done)}/${fa(st.tot)}` : 'استراحت';
    const ap = A.nextAppointment();
    return `
      <header class="greet"><h1>${greeting()}${S.profile.name ? `، ${esc(S.profile.name)}` : ''}</h1><p>${faDate(parseIso(today()), { weekday: 'long', day: 'numeric', month: 'long' })}</p></header>
      <section class="focus">
        <svg class="leaf" viewBox="0 0 120 160" aria-hidden="true"><path d="M60 155 C58 110 60 60 64 8 M60 120 C40 112 26 96 22 74 M60 96 C80 88 94 72 98 50 M60 66 C44 60 34 46 32 28 M62 44 C76 40 84 30 86 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        <small class="eyebrow">تمرکز امروز</small>
        <h2>${next ? esc(next.title) : 'روز آزاد'}</h2>
        <p>${next ? (next.time ? `ساعت ${fa(next.time)}` : next.date < today() ? `معوق · ${relDay(next.date)}` : 'برای امروز') : 'کاری باقی نمانده است'}</p>
        ${next ? `<button class="btn-accent" data-act="done" data-id="${next.id}">${icon('check')}انجام شد</button>` : `<button class="btn-accent" data-act="tasks">${icon('add')}کار جدید</button>`}
      </section>
      <div class="stats">
        ${stat('tasks', 'task_alt', fa(open.length), 'کار باقی‌مانده')}
        ${stat('gym', 'fitness_center', workout, 'ورزش')}
        ${stat('money', 'payments', money(fin.daySpend(today())), 'خرج امروز')}
      </div>
      <button class="note-card" data-act="appts">
        <span class="row-ic coral">${icon(ap ? A.kindOf(ap).icon : 'event_available')}</span>
        <span class="grow col"><small>نزدیک‌ترین قرار</small>
          <b class="truncate">${ap ? esc(ap.title) : 'قراری در پیش نیست'}</b>
          ${ap ? `<small>${ap.date === today() ? 'امروز' : relDay(ap.date)}${ap.time ? ` · ${fa(ap.time)}` : ''}${ap.place ? ` · ${esc(ap.place)}` : ''}</small>` : ''}</span>
        ${icon('chevron_left', 'muted')}
      </button>`;
  },
  act: {
    done: (el) => toggleTask(el.dataset.id),
    tasks: () => goTab('tasks', 'daily'),
    gym: () => goTab('gym', 'program'),
    money: () => goTab('money', 'tx'),
    appts: () => goTab('tasks', 'appts'),
  },
};
