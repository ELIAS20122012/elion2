/* Gym: today's workout, today's calories, current weight. */
import { S, commit } from '../core/store.js';
import { today } from '../core/dates.js';
import { fa, faInt, esc } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { icon, progress } from '../ui/widgets.js';
import * as G from '../domain/gym.js';
import { exerciseSheet, finishOrReopen, mealSheet, goalSheet, weightSheet, nudgeWeight } from '../features/gym-sheets.js';

function exerciseRow(e) {
  const full = e.done >= e.sets;
  const sets = Array.from({ length: e.sets }, (_, k) => `<button class="set-chip${k < e.done ? ' on' : ''}" data-act="set" data-id="${e.id}" data-k="${k}">${fa(k + 1)}</button>`).join('');
  return `<div class="card-sm exercise">
    <button class="ex-text" data-act="ex-edit" data-id="${e.id}"><b class="truncate${full ? ' muted strike' : ''}">${esc(e.name)}</b><small class="muted">${fa(e.sets)} ست × ${fa(e.reps)}</small></button>
    <div class="row wrap">${sets}</div></div>`;
}

function workout() {
  const s = G.session(today());
  const st = G.setsOf(s);
  const has = s && s.exercises.length;
  return `<section class="card stack">
    <div class="row-between"><b class="t-head">تمرین امروز</b><span class="pill">${icon('local_fire_department', 'accent')}${fa(G.streak())} روز پیاپی</span></div>
    ${has ? `<div class="stack-xs"><div class="row-between small"><span class="muted">${esc(s.name)}</span><b>${fa(st.done)}/${fa(st.tot)} ست</b></div>${progress(st.tot ? (st.done / st.tot) * 100 : 0, 'var(--accent)')}</div>` : ''}
    <div class="stack-sm">${has ? s.exercises.map(exerciseRow).join('') : '<div class="empty">هنوز حرکتی ثبت نشده</div>'}</div>
    <div class="grid2 gap-sm"><button class="btn-add" data-act="ex-add">${icon('add_circle')}حرکت</button>
      ${has ? `<button class="btn-add sage" data-act="finish">${icon('flag')}${s.finished ? 'بازکردن' : 'پایان'}</button>` : '<span></span>'}</div>
  </section>`;
}

function calories() {
  const goal = S.gym.goals.kcal;
  const meals = G.mealsOn();
  const total = G.sumMeals(meals).kcal;
  const left = goal - total;
  return `<section class="card stack">
    <div class="row-between"><b class="t-head">کالری امروز</b><button class="link muted" data-act="goal">هدف ${faInt(goal)}</button></div>
    <div class="row-between"><span><b class="big">${faInt(total)}</b> <small class="muted">kcal</small></span><small class="${left < 0 ? 'neg' : 'muted'}">${left >= 0 ? `${faInt(left)} مانده` : `${faInt(-left)} بیشتر از هدف`}</small></div>
    ${progress((total / goal) * 100, total > goal ? 'var(--danger)' : 'var(--accent)')}
    ${meals.map((m) => `<button class="well meal" data-act="meal" data-id="${m.id}"><b class="truncate">${esc(m.name)}</b><b class="accent">${faInt(m.kcal)}</b></button>`).join('')}
    <button class="btn-add" data-act="meal-new">${icon('add_circle')}وعده</button>
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
  render: () => `${workout()}${calories()}${weight()}`,
  act: {
    'ex-add': () => exerciseSheet(),
    'ex-edit': (el) => exerciseSheet(el.dataset.id),
    set(el) {
      const e = G.session(today()).exercises.find((x) => x.id === el.dataset.id);
      const k = +el.dataset.k;
      e.done = k < e.done ? k : k + 1;
      G.autoStartTimer();
      commit();
      if (e.done >= e.sets) toast(`«${e.name}» کامل شد`);
    },
    finish: finishOrReopen,
    meal(el) { const m = G.mealsOn().find((x) => x.id === el.dataset.id); if (m) mealSheet(m); },
    'meal-new': () => mealSheet(),
    goal: goalSheet,
    weight: weightSheet,
    nudge: (el) => nudgeWeight(+el.dataset.d),
  },
};
