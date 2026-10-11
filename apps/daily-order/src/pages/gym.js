/* Gym: a "gym program" bar → the 7 weekdays → that day's program, calories (with food photo) and weight. */
import { S, commit, refresh } from '../core/store.js';
import { iso, addDays, today, weekStart, WD_LONG, WD_SHORT, parseIso } from '../core/dates.js';
import { fa, faInt, esc } from '../core/format.js';
import { faDayMonth } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { icon, progress } from '../ui/widgets.js';
import * as G from '../domain/gym.js';
import { exerciseSheet, finishOrReopen, mealSheet, goalSheet, weightSheet, nudgeWeight, planSheet, foodPhoto } from '../features/gym-sheets.js';

let selected = today();
let weekOpen = false;

const planOf = (date) => S.gym.weekly[parseIso(date).getDay()];
const weekDates = () => Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart(new Date()), i)));

function weekBar() {
  const plan = planOf(selected);
  const label = `${WD_LONG[parseIso(selected).getDay()]} • ${plan && plan.name ? esc(plan.name) : 'استراحت'}`;
  const days = weekOpen ? `<div class="week-list">${weekDates().map((d) => {
    const p = planOf(d);
    const on = d === selected;
    return `<button class="day-row${on ? ' on' : ''}" data-act="day" data-date="${d}">
      <span class="plan-day">${WD_SHORT[parseIso(d).getDay()]}</span>
      <span class="grow col"><b class="truncate">${p && p.name ? esc(p.name) : 'استراحت'}</b><small class="muted">${WD_LONG[parseIso(d).getDay()]}${d === today() ? ' • امروز' : ''}</small></span>
      ${on ? icon('check', 'accent') : ''}</button>`;
  }).join('')}</div>` : '';
  return `<section class="card week-bar">
    <button class="week-bar-head" data-act="toggle-week" aria-expanded="${weekOpen}">
      ${icon('fitness_center', 'accent')}
      <span class="grow col"><b>برنامه باشگاه</b><small class="muted">${label}</small></span>
      <span class="chev material-symbols-outlined${weekOpen ? ' open' : ''}">expand_more</span>
    </button>${days}</section>`;
}

function exerciseRow(e) {
  const full = e.done >= e.sets;
  const sets = Array.from({ length: e.sets }, (_, k) => `<button class="set-chip${k < e.done ? ' on' : ''}" data-act="set" data-id="${e.id}" data-k="${k}">${fa(k + 1)}</button>`).join('');
  return `<div class="card-sm exercise">
    <button class="ex-text" data-act="ex-edit" data-id="${e.id}"><b class="truncate${full ? ' muted strike' : ''}">${esc(e.name)}</b><small class="muted">${fa(e.sets)} ست × ${fa(e.reps)}${e.weight ? ` • ${esc(e.weight)}` : ''}</small></button>
    <div class="row wrap">${sets}</div></div>`;
}

function program() {
  const s = G.sessionFromPlan(selected) || G.session(selected);
  const plan = planOf(selected);
  const has = s && s.exercises.length;
  const st = G.setsOf(s);
  const isToday = selected === today();
  const future = selected > today();
  return `<section class="card stack">
    <div class="row-between"><b class="t-head">${esc((plan && plan.name) || (s && s.exercises.length && s.name) || 'برنامه این روز')}</b>
      ${isToday ? `<span class="pill">${icon('local_fire_department', 'accent')}${fa(G.streak())} روز پیاپی</span>` : `<small class="muted">${faDayMonth(parseIso(selected))}</small>`}</div>
    ${has ? `<div class="stack-xs"><div class="row-between small"><span class="muted">پیشرفت</span><b>${fa(st.done)}/${fa(st.tot)} ست</b></div>${progress(st.tot ? (st.done / st.tot) * 100 : 0, 'var(--accent)')}</div>` : ''}
    <div class="stack-sm">${has ? s.exercises.map(exerciseRow).join('') : `<div class="empty">${plan || future ? 'حرکتی در برنامه نیست' : 'روز استراحت یا هنوز برنامه‌ای ثبت نشده'}</div>`}</div>
    <div class="grid2 gap-sm"><button class="btn-add" data-act="plan">${icon('edit_calendar')}ویرایش برنامه</button>
      ${isToday && has ? `<button class="btn-add sage" data-act="finish">${icon('flag')}${s.finished ? 'بازکردن' : 'پایان'}</button>` : `<button class="btn-add muted" data-act="ex-add">${icon('add_circle')}حرکت</button>`}</div>
  </section>`;
}

function calories() {
  const goal = S.gym.goals.kcal;
  const meals = G.mealsOn(selected);
  const total = G.sumMeals(meals).kcal;
  const left = goal - total;
  const rows = meals.map((m) => `<button class="well meal" data-act="meal" data-id="${m.id}">
    ${m.photo ? `<img src="${m.photo}" alt="">` : icon('restaurant', 'muted')}<b class="grow truncate">${esc(m.name)}</b><b class="accent">${faInt(m.kcal)}</b></button>`).join('');
  return `<section class="card stack">
    <div class="row-between"><b class="t-head">کالری ${selected === today() ? 'امروز' : faDayMonth(parseIso(selected))}</b><button class="link muted" data-act="goal">هدف ${faInt(goal)}</button></div>
    <div class="row-between"><span><b class="big">${faInt(total)}</b> <small class="muted">kcal</small></span><small class="${left < 0 ? 'neg' : 'muted'}">${left >= 0 ? `${faInt(left)} مانده` : `${faInt(-left)} بیشتر از هدف`}</small></div>
    ${progress((total / goal) * 100, total > goal ? 'var(--danger)' : 'var(--accent)')}
    ${rows}
    <div class="grid2 gap-sm"><button class="btn-add" data-act="photo">${icon('photo_camera')}عکس غذا</button><button class="btn-add muted" data-act="meal-new">${icon('add_circle')}دستی</button></div>
  </section>`;
}

function weight() {
  const lw = G.lastWeight();
  const d = G.weightChange(30);
  return `<section class="card stack">
    <div class="row-between"><b class="t-head">وزن</b>${d == null ? '' : `<small class="${d <= 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${fa(d.toFixed(1))} kg در ۳۰ روز</small>`}</div>
    <div class="row-between weight-now">
      <button class="icon-btn" data-act="nudge" data-d="-0.1" aria-label="کم کردن">${icon('remove')}</button>
      <button class="col center" data-act="weight"><b class="hero">${lw ? fa(lw.kg.toFixed(1)) : '—'}</b><small class="muted">کیلوگرم</small></button>
      <button class="icon-btn" data-act="nudge" data-d="0.1" aria-label="زیاد کردن">${icon('add')}</button>
    </div>
  </section>`;
}

export default {
  id: 'gym',
  title: 'ورزش',
  mount() { selected = today(); weekOpen = false; },
  render: () => `${weekBar()}${program()}${calories()}${weight()}`,
  act: {
    'toggle-week'() { weekOpen = !weekOpen; refresh(); },
    day(el) { selected = el.dataset.date; weekOpen = false; G.sessionFromPlan(selected); commit(); },
    plan: () => planSheet(selected),
    'ex-add': () => exerciseSheet(null, selected),
    'ex-edit': (el) => exerciseSheet(el.dataset.id, selected),
    set(el) {
      const e = G.session(selected).exercises.find((x) => x.id === el.dataset.id);
      const k = +el.dataset.k;
      e.done = k < e.done ? k : k + 1;
      commit();
      if (e.done >= e.sets) toast(`«${e.name}» کامل شد`);
    },
    finish: finishOrReopen,
    photo: () => foodPhoto(selected),
    meal(el) { const m = G.mealsOn(selected).find((x) => x.id === el.dataset.id); if (m) mealSheet(m, selected); },
    'meal-new': () => mealSheet(null, selected),
    goal: goalSheet,
    weight: weightSheet,
    nudge: (el) => nudgeWeight(+el.dataset.d),
  },
};
