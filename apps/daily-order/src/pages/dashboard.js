/* Dashboard: clock, nearest tasks, spending of the week and today's workout at a glance. */
import { S, refresh } from '../core/store.js';
import { iso, addDays, parseIso, today, nowHM, WD_SHORT } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDayMonth } from '../core/calendar.js';
import { go } from '../router.js';
import { toast } from '../ui/toast.js';
import { icon, ring, barChart } from '../ui/widgets.js';
import * as T from '../domain/tasks.js';
import * as G from '../domain/gym.js';
import * as fin from '../domain/finance.js';
import { toggleTask, taskSheet } from '../features/task-sheets.js';
import { reportSheet, budgetSheet } from '../features/finance-sheets.js';
import { finishOrReopen } from '../features/gym-sheets.js';

const FILTERS = ['همه', 'امروز', 'مهم'];
let filterMode = 0;
let pickedBar = 6; // index into the 7-day chart (6 = today)

function nearestTasks() {
  const all = T.activeTasks();
  const todays = all.filter((t) => t.date === today());
  const pool = filterMode === 1 ? todays : filterMode === 2 ? all.filter((t) => t.starred) : all.filter((t) => t.date >= today() || !t.done);
  return { pool, open: pool.filter((t) => !t.done).sort(T.sortTasks).slice(0, 3), todays };
}

function tasksCard() {
  const { pool, open, todays } = nearestTasks();
  const done = todays.filter((t) => t.done).length;
  const rows = open.map((t) => `
    <div class="mini-task">
      <button class="check-dot" data-act="check" data-id="${t.id}" aria-label="انجام شد">${icon('check')}</button>
      <button class="mini-task-text" data-act="task" data-id="${t.id}">
        <span class="truncate">${esc(t.title)}</span>
        <small>${t.date === today() ? 'امروز' : faDayMonth(parseIso(t.date))}${t.time ? ` • ${fa(t.time)}` : ''}</small>
      </button>
    </div>`).join('');
  const zen = open.length ? '' : `
    <button class="zen" data-act="zen">
      <span class="zen-well">${icon('spa')}</span>
      <b>${pool.length ? 'همه‌چیز مرتب است!' : 'کاری ثبت نشده'}</b>
      <small>${pool.length ? 'کارهای این بخش تکمیل شده‌اند.' : 'برای افزودن کار، اینجا را بزنید.'}</small>
    </button>`;
  return `
    <section class="card dash-card">
      <div class="card-head">
        <span class="card-title"><span class="chip-icon accent">${icon('task_alt')}</span>وظایف نزدیک</span>
        <button class="link accent" data-act="filter">${FILTERS[filterMode]}</button>
      </div>
      <div class="stack-sm">${rows}</div>
      ${zen}
      <button class="well metric" data-act="progress"><span>پیشرفت روز</span><b>${fa(done)} / ${fa(todays.length)} <i class="dot sage"></i></b></button>
    </section>`;
}

function financeCard() {
  const now = new Date();
  const cols = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(now, -i);
    cols.push({ v: fin.daySpend(iso(d)), label: WD_SHORT[d.getDay()], active: 6 - i === pickedBar, title: `${faDayMonth(d)}: ${money(fin.daySpend(iso(d)))}` });
  }
  const picked = addDays(now, pickedBar - 6);
  const left = S.wallet.budget - fin.monthSum('expense');
  return `
    <section class="card dash-card">
      <div class="card-head">
        <span class="card-title"><span class="chip-icon sage">${icon('query_stats')}</span>وضعیت مالی</span>
        <button class="link sage" data-act="report">گزارش</button>
      </div>
      <div class="well chart-well">${barChart(cols, { height: 118, act: 'bar' })}</div>
      <div class="grid2 gap-sm">
        <div class="well metric col"><small>${pickedBar === 6 ? 'هزینه امروز' : `هزینه ${faDayMonth(picked)}`}</small><b>${money(fin.daySpend(iso(picked)))}</b></div>
        <button class="well metric col" data-act="budget"><small>بودجه باقی</small><b class="${left < 0 ? 'neg' : 'pos'}">${money(Math.max(0, left))}</b></button>
      </div>
    </section>`;
}

function gymCard() {
  const s = G.session(today());
  const st = G.setsOf(s);
  const pct = st.tot ? Math.round((st.done / st.tot) * 100) : 0;
  const hasWork = s && s.exercises.length;
  const label = !hasWork ? 'امروز جلسه‌ای ثبت نشده' : s.finished ? `جلسه انجام شد: ${s.name}` : `جلسه فعال: ${s.name}`;
  const action = !hasWork ? 'شروع' : s.finished ? 'بازگشایی' : 'ثبت پایان';
  return `
    <section class="card dash-card dash-wide">
      <div class="card-head">
        <span class="card-title"><span class="chip-icon accent">${icon('fitness_center')}</span>وضعیت باشگاه</span>
        <button class="link muted" data-act="gym">${fa(G.streak())} روز پیاپی</button>
      </div>
      <div class="gym-row">
        <button class="ring-well" data-act="gym" aria-label="ورزش">${ring(pct, `${fa(pct)}%`, 76)}</button>
        <div class="grow stack-sm">
          <div class="well metric"><small>ست‌های روز</small><b>${fa(st.done)}/${fa(st.tot)}</b></div>
          <div class="well metric"><small>زمان تمرین</small><b>${fa(G.sessionMinutes(s))} <small>دقیقه</small></b></div>
        </div>
      </div>
      <button class="well session-btn" data-act="session"><span class="row"><i class="dot ${hasWork && s.finished ? 'sage' : 'accent pulse'}"></i>${esc(label)}</span><b class="accent">${action}</b></button>
    </section>`;
}

export default {
  id: 'dashboard',
  title: 'پیشخوان',
  render() {
    return `
      <section class="card clock-card">
        <span class="row"><button class="icon-btn sm" data-act="calendar" aria-label="تقویم">${icon('calendar_month')}</button><small class="muted">امروز، ${faDayMonth(new Date())}</small></span>
        <span class="clock" data-clock>${nowHM()}</span>
        <button class="icon-btn sm" data-act="calendar" aria-label="برنامه‌ریزی">${icon('schedule')}</button>
      </section>
      <div class="grid2 gap-sm dash-grid">${tasksCard()}${financeCard()}</div>
      ${gymCard()}`;
  },
  act: {
    calendar: () => go('planner'),
    zen: () => go('tasks'),
    progress: () => go('tasks'),
    gym: () => go('gym'),
    filter: () => { filterMode = (filterMode + 1) % FILTERS.length; toast(`نمایش: ${FILTERS[filterMode]}`); refresh(); },
    check: (el) => toggleTask(el.dataset.id),
    task: (el) => taskSheet(el.dataset.id),
    bar: (el) => { pickedBar = +el.dataset.i; refresh(); },
    report: reportSheet,
    budget: budgetSheet,
    session: () => { if (!finishOrReopen({ requireExercises: false })) go('gym'); },
  },
};
