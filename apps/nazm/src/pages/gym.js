/* Gym: the "gym program" bar → the seven weekdays → that day's program and calories (with food photo). */
import { S, commit, refresh } from '../core/store.js';
import { iso, addDays, today, weekStart, WD_LONG, WD_SHORT, parseIso } from '../core/dates.js';
import { fa, faInt, esc } from '../core/format.js';
import { faDayMonth } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import * as G from '../domain/gym.js';
import { exerciseSheet, finishOrReopen, mealSheet, goalSheet, planSheet, foodPhoto } from '../features/gym-sheets.js';

let selected = today();
let weekOpen = false;

const planOf = (date) => S.gym.weekly[parseIso(date).getDay()];
const weekDates = () => Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart(new Date()), i)));
const bar = (pct, over) => `<span class="bar${over ? ' over' : ''}"><i style="width:${Math.min(100, pct)}%"></i></span>`;

function programBar() {
  const plan = planOf(selected);
  const label = `${WD_LONG[parseIso(selected).getDay()]} · ${plan && plan.name ? esc(plan.name) : 'استراحت'}`;
  const days = weekOpen ? `<div class="days">${weekDates().map((d) => {
    const p = planOf(d);
    return `<button class="day${d === selected ? ' on' : ''}${d === today() ? ' now' : ''}" data-act="day" data-date="${d}">
      <span class="day-circle">${WD_SHORT[parseIso(d).getDay()]}</span><small class="truncate">${p && p.name ? esc(p.name) : 'استراحت'}</small></button>`;
  }).join('')}</div>` : '';
  return `<section class="bar-card${weekOpen ? ' open' : ''}">
    <button class="bar-head" data-act="toggle-week" aria-expanded="${weekOpen}">
      <span class="bar-icon">${icon('fitness_center')}</span>
      <span class="grow col"><b>برنامه باشگاه</b><small>${label}</small></span>
      ${icon('expand_more', 'chev')}
    </button>${days}</section>`;
}

function exerciseRow(e) {
  const full = e.done >= e.sets;
  const sets = Array.from({ length: e.sets }, (_, k) => `<button class="set${k < e.done ? ' on' : ''}" data-act="set" data-id="${e.id}" data-k="${k}">${fa(k + 1)}</button>`).join('');
  return `<div class="exercise">
    <button class="col grow ex-text" data-act="ex-edit" data-id="${e.id}"><span class="truncate${full ? ' strike' : ''}">${esc(e.name)}</span><small>${fa(e.sets)} ست × ${fa(e.reps)}${e.weight ? ` · ${esc(e.weight)}` : ''}</small></button>
    <div class="sets">${sets}</div></div>`;
}

function program() {
  const s = G.sessionFromPlan(selected) || G.session(selected);
  const plan = planOf(selected);
  const has = s && s.exercises.length;
  const st = G.setsOf(s);
  const isToday = selected === today();
  return `<section class="section">
    <div class="section-head"><h3>${esc((plan && plan.name) || (has && s.name) || 'برنامه این روز')}</h3>
      ${isToday ? `<small class="chip-info">${icon('local_fire_department', 'tiny')} ${fa(G.streak())} روز پیاپی</small>` : `<small>${faDayMonth(parseIso(selected))}</small>`}</div>
    ${has ? `<div class="progress-line"><span>${fa(st.done)} از ${fa(st.tot)} ست</span>${bar(st.tot ? (st.done / st.tot) * 100 : 0)}</div>` : ''}
    <div class="list-plain">${has ? s.exercises.map(exerciseRow).join('') : `<p class="empty">${plan ? 'حرکتی در برنامه نیست' : 'روز استراحت، یا برنامه‌ای ثبت نشده'}</p>`}</div>
    <div class="actions"><button class="btn ghost" data-act="plan">${icon('edit_calendar')}ویرایش برنامه</button>
      ${isToday && has ? `<button class="btn" data-act="finish">${s.finished ? 'بازکردن تمرین' : 'پایان تمرین'}</button>` : `<button class="btn ghost" data-act="ex-add">${icon('add')}حرکت</button>`}</div>
  </section>`;
}

function calories() {
  const goal = S.gym.goals.kcal;
  const meals = G.mealsOn(selected);
  const total = G.sumMeals(meals).kcal;
  const left = goal - total;
  const rows = meals.map((m) => `<button class="row-item meal" data-act="meal" data-id="${m.id}">
    ${m.photo ? `<img src="${m.photo}" alt="">` : `<span class="thumb">${icon('restaurant')}</span>`}<span class="grow truncate">${esc(m.name)}</span><b>${faInt(m.kcal)}</b></button>`).join('');
  return `<section class="section">
    <div class="section-head"><h3>کالری ${selected === today() ? 'امروز' : faDayMonth(parseIso(selected))}</h3><button class="link" data-act="goal">هدف ${faInt(goal)}</button></div>
    <div class="cal-card">
      <div class="row-between"><span><b class="big">${faInt(total)}</b> <small>کیلوکالری</small></span><small class="${left < 0 ? 'neg' : ''}">${left >= 0 ? `${faInt(left)} مانده` : `${faInt(-left)} بیشتر از هدف`}</small></div>
      ${bar((total / goal) * 100, total > goal)}
    </div>
    <div class="list-plain">${rows}</div>
    <div class="actions"><button class="btn" data-act="photo">${icon('photo_camera')}عکس غذا</button><button class="btn ghost" data-act="meal-new">${icon('add')}دستی</button></div>
  </section>`;
}

export default {
  id: 'gym',
  title: 'ورزش',
  mount() { selected = today(); weekOpen = false; },
  render: () => `${programBar()}${program()}${calories()}`,
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
  },
};
