/* Gym: workout plan · calories · food photo. A 7-day strip picks the day for every tab. */
import { S, commit } from '../core/store.js';
import { iso, addDays, today, weekStart, WD_SHORT, WD_LONG, parseIso } from '../core/dates.js';
import { fa, faInt, esc } from '../core/format.js';
import { faDayMonth, faDate } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { menu } from '../ui/sheet.js';
import { icon } from '../ui/widgets.js';
import { pageHead, drawers, toggleDrawer, row, empty, section, ring, bar, bars, tabOf, openOr } from '../ui/kit.js';
import * as G from '../domain/gym.js';
import { exerciseSheet, finishOrReopen, mealSheet, goalSheet, planSheet, foodPhoto, toggleTimer } from '../features/gym-sheets.js';

const ORDER = ['program', 'calories', 'photo'];
const LABELS = { program: 'برنامه تمرین', calories: 'کالری', photo: 'عکس غذا' };
let selected = today();

const planOf = (date) => S.gym.weekly[parseIso(date).getDay()];
const weekDates = () => Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart(new Date()), i)));
const dayName = (d) => (d === today() ? 'امروز' : faDate(parseIso(d), { weekday: 'long', day: 'numeric', month: 'long' }));

function strip() {
  return `<div class="week">${weekDates().map((d) => {
    const p = planOf(d);
    return `<button class="wd${d === selected ? ' on' : ''}${d === today() ? ' now' : ''}" data-act="day" data-date="${d}"><small>${WD_SHORT[parseIso(d).getDay()]}</small><b>${p && p.name ? '●' : '○'}</b></button>`;
  }).join('')}</div>`;
}

/* ---------- program ---------- */
function exerciseRow(e) {
  const sets = Array.from({ length: e.sets }, (_, k) => `<button class="set${k < e.done ? ' on' : ''}" data-act="set" data-id="${e.id}" data-k="${k}">${fa(k + 1)}</button>`).join('');
  return row({ ic: 'fitness_center', title: esc(e.name), cls: `wrap${e.done >= e.sets ? ' is-done' : ''}`, act: 'ex-edit', attrs: `data-id="${e.id}"`,
    sub: `${fa(e.sets)} ست × ${fa(e.reps)}${e.weight ? ` · ${esc(e.weight)}` : ''}`, trailing: `<div class="sets">${sets}</div>` });
}

function programTab() {
  const s = G.sessionFromPlan(selected) || G.session(selected);
  const plan = planOf(selected);
  const has = s && s.exercises.length;
  const st = G.setsOf(s);
  const isToday = selected === today();
  const running = !!S.gym.timerStart && isToday;
  return `${strip()}
    <section class="card plan-card">
      ${ring(st.tot ? Math.round((st.done / st.tot) * 100) : 0, has ? `${fa(st.done)}/${fa(st.tot)}` : '—', 'ست', 100)}
      <div class="grow col">
        <small>${WD_LONG[parseIso(selected).getDay()]}</small>
        <b class="t-lg">${esc((plan && plan.name) || (has && s.name) || 'استراحت')}</b>
        ${isToday && has ? `<button class="btn-sm ${running ? 'live' : ''}" data-act="timer">${icon(running ? 'pause' : 'timer')}${fa(G.sessionMinutes(s))}${s.target ? `/${fa(s.target)}` : ''} دقیقه</button>` : ''}
      </div>
    </section>
    <div class="list">${has ? s.exercises.map(exerciseRow).join('') : empty(plan ? 'حرکتی در برنامه نیست' : 'روز استراحت، یا برنامه‌ای ثبت نشده')}</div>
    <div class="btns"><button class="btn-ghost" data-act="plan">${icon('edit_calendar')}ویرایش برنامه</button>
      ${isToday && has ? `<button class="btn-primary" data-act="finish">${icon('flag')}${s.finished ? 'بازکردن تمرین' : 'پایان تمرین'}</button>` : ''}</div>`;
}

/* ---------- calories ---------- */
function mealRow(m) {
  return row({ ic: 'restaurant', title: esc(m.name), sub: `${fa(m.kcal)} کیلوکالری${m.p ? ` · ${fa(m.p)} گرم پروتئین` : ''}`, act: 'meal', attrs: `data-id="${m.id}"`,
    trailing: m.photo ? `<img class="mini-photo" src="${m.photo}" alt="">` : '' });
}

function caloriesTab() {
  const goal = S.gym.goals.kcal;
  const pgoal = S.gym.goals.p;
  const meals = G.mealsOn(selected);
  const tot = G.sumMeals(meals);
  const trend = weekDates().map((d) => ({ v: G.sumMeals(G.mealsOn(d)).kcal, label: WD_SHORT[parseIso(d).getDay()], on: d === selected }));
  return `${strip()}
    <section class="card plan-card">
      ${ring(Math.round((tot.kcal / goal) * 100), faInt(tot.kcal), 'کیلوکالری', 108)}
      <div class="grow col gap">
        <small>${dayName(selected)}</small>
        <span class="small">${tot.kcal <= goal ? `${faInt(goal - tot.kcal)} مانده تا هدف` : `${faInt(tot.kcal - goal)} بیشتر از هدف`}</span>
        <div class="col"><span class="small row-between"><span>پروتئین</span><b>${fa(Math.round(tot.p))} / ${fa(pgoal)} گرم</b></span>${bar((tot.p / pgoal) * 100)}</div>
        <button class="link" data-act="goal">تغییر هدف (${faInt(goal)})</button>
      </div>
    </section>
    ${section('روند هفتگی', `<div class="card">${bars(trend, 'trend')}</div>`)}
    ${section('غذاهای ثبت‌شده', `<div class="list">${meals.map(mealRow).join('') || empty('هنوز غذایی ثبت نشده')}</div>`)}`;
}

/* ---------- food photo ---------- */
function photoTab() {
  const hist = Object.keys(S.gym.meals).sort().reverse().flatMap((d) => G.mealsOn(d).filter((m) => m.photo).map((m) => ({ ...m, date: d }))).slice(0, 20);
  return `<section class="card photo-card">
      <span class="photo-ic">${icon('photo_camera')}</span>
      <b>عکس غذا را اضافه کنید</b>
      <small>کالری و پروتئین تخمین زده می‌شود و در ${dayName(selected)} ذخیره می‌شود.</small>
      <button class="btn-accent" data-act="photo">${icon('add_a_photo')}افزودن عکس</button>
    </section>
    ${strip()}
    ${section('تاریخچه‌ی غذاها', `<div class="list">${hist.map((m) => row({ ic: 'restaurant', title: esc(m.name), sub: `${faDayMonth(parseIso(m.date))} · ${fa(m.kcal)} کیلوکالری${m.p ? ` · ${fa(m.p)}g پروتئین` : ''}`, act: 'hist', attrs: `data-id="${m.id}" data-date="${m.date}"`, trailing: `<img class="mini-photo" src="${m.photo}" alt="">` })).join('') || empty('هنوز عکسی ثبت نشده')}</div>`)}`;
}

export default {
  id: 'gym',
  title: 'ورزش',
  mount() { selected = today(); },
  render() {
    const bodies = { program: programTab, calories: caloriesTab, photo: photoTab };
    const items = ORDER.map((key) => ({ key, label: LABELS[key], body: () => `<div class="stack">${bodies[key]()}</div>` }));
    return `${pageHead('ورزش', 'تمرین، کالری و غذا', 'add')}${drawers(items, tabOf('gym', 'program'))}`;
  },
  act: {
    tab: toggleDrawer('gym'),
    day(el) { selected = el.dataset.date; G.sessionFromPlan(selected); commit(); },
    trend(el) { selected = weekDates()[+el.dataset.i]; commit(); },
    plan: () => planSheet(selected),
    timer: toggleTimer,
    'ex-edit': (el) => exerciseSheet(el.dataset.id, selected),
    set(el) {
      const e = G.session(selected).exercises.find((x) => x.id === el.dataset.id);
      const k = +el.dataset.k;
      e.done = k < e.done ? k : k + 1;
      commit();
      if (e.done >= e.sets) toast(`«${e.name}» کامل شد`);
    },
    finish: finishOrReopen,
    goal: goalSheet,
    meal(el) { const m = G.mealsOn(selected).find((x) => x.id === el.dataset.id); if (m) mealSheet(m, selected); },
    hist(el) { const m = G.mealsOn(el.dataset.date).find((x) => x.id === el.dataset.id); if (m) mealSheet(m, el.dataset.date); },
    photo: () => foodPhoto(selected),
    add() {
      const tab = openOr('gym', 'program');
      if (tab === 'program') exerciseSheet(null, selected);
      else if (tab === 'photo') foodPhoto(selected);
      else menu('افزودن غذا', [{ icon: 'photo_camera', label: 'عکس غذا', run: () => foodPhoto(selected) }, { icon: 'edit', label: 'دستی', run: () => mealSheet(null, selected) }]);
    },
  },
};
