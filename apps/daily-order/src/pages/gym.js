/* Gym: workout session, calories & meals, weight tracking and a weekly analysis. */
import { S, commit } from '../core/store.js';
import { iso, addDays, today, weekStart, WD_SHORT, WD_LONG } from '../core/dates.js';
import { fa, faInt, esc } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { icon, progress } from '../ui/widgets.js';
import * as G from '../domain/gym.js';
import {
  exerciseSheet, exerciseMenu, renameSession, toggleTimer, finishOrReopen, loadFromPlan, planSheet,
  mealSheet, goalsSheet, scanFood, addScanToday, editScan, weightSheet, nudgeWeight, weightHistory,
} from '../features/gym-sheets.js';

const kcal = (n) => `${faInt(n)} kcal`;

/* ---------- workout ---------- */
function exerciseRow(e, i, s) {
  const full = e.done >= e.sets;
  const started = e.done > 0 && !full;
  const next = s.exercises.findIndex((x) => x.done < x.sets);
  const status = full ? '<span class="tag sage">تکمیل</span>' : started ? '<span class="tag accent">درحال انجام</span>' : `<span class="tag">${i === next ? 'بعدی' : 'در صف'}</span>`;
  const sets = Array.from({ length: e.sets }, (_, k) => {
    const on = k < e.done;
    return `<button class="set-chip${on ? ' on' : ''}" data-act="set" data-id="${e.id}" data-k="${k}">ست ${fa(k + 1)}${on ? ' ✓' : ''}</button>`;
  }).join('');
  return `<div class="card-sm exercise${started ? ' active' : ''}">
    <div class="row-between">
      <span class="row grow">
        <button class="check-square sm${full ? ' on' : started ? ' part' : ''}" data-act="all-sets" data-id="${e.id}" aria-label="انجام همه ست‌ها">${icon(full ? 'done' : started ? 'fitness_center' : 'hourglass_empty')}</button>
        <button class="grow ex-text" data-act="ex-edit" data-id="${e.id}"><b class="truncate${full ? ' muted strike' : ''}">${esc(e.name)}</b><small class="muted">${fa(e.sets)} ست × ${fa(e.reps)} ${e.unit || 'تکرار'}${e.weight ? ` • ${esc(e.weight)}` : ''}</small></button>
      </span>
      <span class="row">${status}<button class="icon-btn xs flat" data-act="ex-menu" data-id="${e.id}" aria-label="گزینه‌ها">${icon('more_vert')}</button></span>
    </div>
    <div class="row wrap"><small class="muted">ست‌ها:</small>${sets}</div></div>`;
}

function sessionCard() {
  const s = G.session(today());
  const st = G.setsOf(s);
  const plan = S.gym.weekly[new Date().getDay()];
  const running = !!S.gym.timerStart;
  const has = s && s.exercises.length;
  return `<section class="card stack">
    <div class="row-between">
      <button class="card-title" data-act="rename"><b>${esc(s ? s.name : plan ? plan.name : 'جلسه امروز')}</b></button>
      <button class="pill${running ? ' accent' : ''}" data-act="timer" title="${running ? 'توقف زمان‌سنج' : 'شروع زمان‌سنج'}">${icon(running ? 'pause_circle' : 'timer')}${fa(G.sessionMinutes(s))}${s && s.target ? `/${fa(s.target)}` : ''} دقیقه</button>
    </div>
    <div class="stack-xs"><div class="row-between small"><span class="muted">پیشرفت جلسه</span><b>${fa(st.done)}/${fa(st.tot)} ست</b></div>${progress(st.tot ? (st.done / st.tot) * 100 : 0, 'var(--accent)')}</div>
    <div class="stack-sm">${has ? s.exercises.map((e, i) => exerciseRow(e, i, s)).join('') : `<div class="empty well">هنوز حرکتی برای امروز ثبت نشده${plan ? `<br><small>می‌توانید برنامه «${esc(plan.name)}» را بارگذاری کنید.</small>` : ''}</div>`}</div>
    <button class="btn-add" data-act="ex-add">${icon('add_circle')}افزودن حرکت جدید</button>
    ${has ? `<button class="btn-add sage" data-act="finish">${icon('flag')}${s.finished ? 'جلسه ثبت شد ✓ (بازگشایی)' : 'ثبت پایان جلسه'}</button>` : ''}
    ${plan ? `<button class="btn-add muted" data-act="load-plan">${icon('event_repeat')}بارگذاری از برنامه هفتگی</button>` : ''}
  </section>`;
}

function weeklyCard() {
  const ws = weekStart(new Date());
  const rows = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i);
    const wd = d.getDay();
    const p = S.gym.weekly[wd];
    const n = p ? G.parsePlan(p.items).length : 0;
    const isToday = iso(d) === today();
    return `<button class="card-sm plan-row${isToday ? ' today' : ''}" data-act="plan" data-wd="${wd}">
      <span class="plan-day">${WD_SHORT[wd]}</span>
      <span class="grow col"><b class="truncate">${esc(p && p.name ? p.name : 'استراحت')}</b><small class="muted">${WD_LONG[wd]}${n ? ` • ${fa(n)} حرکت` : ''}${isToday ? ' • امروز' : ''}</small></span>
      ${icon('chevron_left', 'muted')}</button>`;
  }).join('');
  return `<section class="card stack"><div class="row-between"><b class="t-head">برنامه هفتگی</b><small class="muted">برای ویرایش روی هر روز بزنید</small></div><div class="stack-sm">${rows}</div></section>`;
}

/* ---------- calories ---------- */
function calorieCards() {
  const goals = S.gym.goals;
  const meals = G.mealsOn();
  const tot = G.sumMeals(meals);
  const left = goals.kcal - tot.kcal;
  const macros = [['p', 'پروتئین'], ['c', 'کربوهیدرات'], ['f', 'چربی']].map(([k, label]) =>
    `<button class="well macro" data-act="goals"><small class="muted">${label}</small><b>${fa(Math.round(tot[k]))}g</b><small class="muted">هدف ${fa(goals[k])}g</small></button>`).join('');
  const mealRows = meals.map((m) => `<button class="well meal" data-act="meal" data-id="${m.id}"><span class="col"><b class="truncate">${esc(m.name)}</b><small class="muted">P ${fa(m.p || 0)}g • C ${fa(m.c || 0)}g • F ${fa(m.f || 0)}g</small></span><b class="accent">${kcal(m.kcal)}</b></button>`).join('');
  const r = S.gym.lastScan;
  const scanned = r ? `<div class="well scan-result">
      ${r.photo ? `<img src="${r.photo}" alt="">` : `<span class="scan-thumb">${icon('restaurant')}</span>`}
      <button class="grow col ex-text" data-act="scan-edit"><small class="tag sage">${r.pending ? `${icon('progress_activity', 'spin tiny')} در حال تحلیل با هوش مصنوعی…` : `${icon('auto_awesome', 'tiny')} ${r.added ? 'ثبت شده • برای اسکن جدید بزنید' : 'تشخیص هوشمند • برای اصلاح بزنید'}`}</small>
        <b class="truncate">${esc(r.name)}</b><small class="muted">P <b>${fa(r.p)}g</b> • C <b>${fa(r.c)}g</b> • F <b>${fa(r.f)}g</b></small></button>
      <b class="big">${fa(r.kcal)}</b></div>
    <button class="btn-add" data-act="scan-add">${icon(r.added ? 'photo_camera' : 'add_task')}${r.added ? 'اسکن عکس جدید' : 'ثبت در کالری مصرفی امروز'}</button>` : '';
  return `
    <section class="card stack">
      <div class="row-between"><span class="card-title">${icon('local_fire_department', 'accent')}<b>کالری مصرفی روزانه</b></span><button class="link accent" data-act="meal-new">ثبت دستی</button></div>
      <div class="row-between"><span><b class="big">${faInt(tot.kcal)}</b> <small class="muted">/ ${kcal(goals.kcal)}</small></span><small class="${left < 0 ? 'neg' : 'muted'}">${left >= 0 ? `${kcal(left)} مانده` : `${kcal(-left)} بیشتر از هدف`}</small></div>
      ${progress((tot.kcal / goals.kcal) * 100, tot.kcal > goals.kcal ? 'var(--danger)' : 'var(--accent)')}
      <button class="link muted" data-act="goals">هدف روزانه: ${kcal(goals.kcal)} (تغییر)</button>
      <div class="grid3 gap-sm">${macros}</div>
      <div class="row-between"><b>وعده‌های امروز</b><small class="muted">${fa(meals.length)} وعده</small></div>
      <div class="stack-xs">${mealRows || '<div class="empty">هنوز وعده‌ای ثبت نشده</div>'}</div>
    </section>
    <section class="card stack">
      <div class="row"><span class="chip-icon accent">${icon('photo_camera')}</span><b>اسکن هوشمند غذا</b></div>
      <button class="well drop" data-act="scan">${icon('add_a_photo')}<b>انتخاب یا گرفتن عکس</b><small class="muted">کالری و درشت‌مغذی‌ها تخمین زده می‌شوند</small></button>
      ${scanned}
    </section>`;
}

/* ---------- weight ---------- */
function weightCard() {
  const lw = G.lastWeight();
  const delta = (d) => G.weightChange(d);
  const trend = (label, d) => `<div class="well metric col"><small class="muted">${label}</small><b class="row">${icon(d == null ? 'remove' : d <= 0 ? 'trending_down' : 'trending_up', d != null && d <= 0 ? 'sage-text' : 'accent')}${d == null ? '—' : `${d > 0 ? '+' : ''}${fa(d.toFixed(1))} kg`}</b></div>`;
  const vals = [];
  for (let i = 6; i >= 0; i--) vals.push(G.weightOn(iso(addDays(new Date(), -i))));
  const known = vals.filter((v) => v != null);
  const mn = Math.min(...known, 999);
  const mx = Math.max(...known, 0);
  const change = known.length > 1 ? known[known.length - 1] - known[0] : 0;
  const status = known.length > 1 ? (Math.abs(change) < 0.3 ? 'پایدار و منظم' : change < 0 ? 'روند کاهشی' : 'روند افزایشی') : 'داده کافی نیست';
  const bars = vals.map((v, i) => {
    const d = addDays(new Date(), i - 6);
    const h = v == null ? 4 : mx === mn ? 70 : 45 + ((v - mn) / (mx - mn)) * 45;
    return `<span class="spark-col${i === 6 ? ' active' : ''}" title="${v == null ? '' : `${fa(v)} kg`}"><i style="height:${h}%"></i><small>${WD_SHORT[d.getDay()]}</small></span>`;
  }).join('');
  return `<section class="card stack">
    <div class="row-between"><span class="card-title">${icon('monitor_weight', 'accent')}<b>ثبت وزن</b></span><button class="link accent" data-act="weight-new">ثبت جدید</button></div>
    <div class="row-between weight-now">
      <button class="icon-btn" data-act="nudge" data-d="-0.1" aria-label="کم کردن">${icon('remove')}</button>
      <button class="col center" data-act="weight-history"><b class="hero">${lw ? fa(lw.kg.toFixed(1)) : '—'}</b><small class="muted">کیلوگرم (برای سابقه بزنید)</small></button>
      <button class="icon-btn" data-act="nudge" data-d="0.1" aria-label="زیاد کردن">${icon('add')}</button>
    </div>
    <div class="grid2 gap-sm">${trend('تغییر این هفته', delta(7))}${trend('تغییر ۳۰ روز گذشته', delta(30))}</div>
    <button class="well stack-sm" data-act="weight-history"><div class="row-between small"><b>روند ۷ روز گذشته</b><span class="tag sage">${status}</span></div><div class="spark">${bars}</div></button>
  </section>`;
}

/* ---------- analysis ---------- */
function analysisCard() {
  const a = G.weekAnalysis();
  const top = Math.max(1, ...a.days.map((d) => d.v));
  const wd = G.weightChange(30);
  const tile = (label, value, cls = '') => `<div class="well metric col"><small class="muted">${label}</small><b class="${cls}">${value}</b></div>`;
  const bars = a.days.map((x, i) => `<span class="spark-col${i === 6 ? ' active' : ''}"><small>${x.v ? fa(x.v) : ''}</small><i style="height:${Math.max(4, Math.round((x.v / top) * 70))}%"></i><small>${WD_SHORT[x.d.getDay()]}</small></span>`).join('');
  return `<section class="card stack">
    <div class="row"><span class="chip-icon accent">${icon('insights')}</span><b class="t-head">آنالیز ۷ روز اخیر</b></div>
    <div class="grid2 gap-sm">
      ${tile('جلسات تمرین', `${fa(a.sessions)} از ۷ روز`)}${tile('ست‌های انجام‌شده', `${fa(a.totalSets)} ست`)}
      ${tile('میانگین کالری روزانه', `${a.avgKcal == null ? '—' : fa(a.avgKcal.toLocaleString('en-US'))} <small class="muted">/ ${fa(S.gym.goals.kcal)}</small>`)}
      ${tile('تغییر وزن ۳۰ روز', wd == null ? '—' : `${wd > 0 ? '+' : ''}${fa(wd.toFixed(1))} kg`, wd != null && wd <= 0 ? 'pos' : 'neg')}
    </div>
    <div class="well stack-sm"><small class="muted">ست‌های انجام‌شده در هر روز</small><div class="spark tall">${bars}</div></div>
  </section>`;
}

export default {
  id: 'gym',
  title: 'ورزش',
  tick: 30000,
  render() {
    const tab = S.gym.tab || 'workout';
    const dow = new Date().getDay();
    const plan = S.gym.weekly[dow];
    const tabs = G.TABS.map((t) => `<button class="tab${t.key === tab ? ' on' : ''}" data-act="tab" data-tab="${t.key}" aria-label="${t.label}" title="${t.label}">${icon(t.icon)}</button>`).join('');
    const segment = tab === 'workout' ? `<div class="seg-control"><button class="${S.gym.view === 'daily' ? 'on' : ''}" data-act="view" data-view="daily">امروز</button><button class="${S.gym.view === 'weekly' ? 'on' : ''}" data-act="view" data-view="weekly">برنامه هفتگی</button></div>` : '';
    const body = tab === 'workout' ? (S.gym.view === 'weekly' ? weeklyCard() : sessionCard()) : tab === 'calorie' ? calorieCards() : tab === 'weight' ? weightCard() : analysisCard();
    return `
      <section class="gym-head row-between"><span class="col"><b class="t-head">برنامه و باشگاه</b><small class="muted">${WD_LONG[dow]} • ${plan ? esc(plan.name) : 'روز استراحت'}</small></span>
        <span class="pill">${icon('local_fire_department', 'accent')}${fa(G.streak())} روز پیاپی</span></section>
      <nav class="tabs card-sm">${tabs}</nav>
      ${segment}${body}`;
  },
  act: {
    tab(el) { S.gym.tab = el.dataset.tab; commit(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    view(el) { S.gym.view = el.dataset.view; commit(); },
    rename: renameSession,
    timer: toggleTimer,
    'ex-add': () => exerciseSheet(),
    'ex-edit': (el) => exerciseSheet(el.dataset.id),
    'ex-menu'(el) { const e = G.session(today()).exercises.find((x) => x.id === el.dataset.id); if (e) exerciseMenu(e); },
    set(el) {
      const e = G.session(today()).exercises.find((x) => x.id === el.dataset.id);
      const k = +el.dataset.k;
      e.done = k < e.done ? k : k + 1;
      if (G.autoStartTimer()) toast('زمان‌سنج تمرین خودکار شروع شد');
      commit();
      if (e.done >= e.sets) toast(`«${e.name}» کامل شد`);
    },
    'all-sets'(el) {
      const e = G.session(today()).exercises.find((x) => x.id === el.dataset.id);
      e.done = e.done >= e.sets ? 0 : e.sets;
      G.autoStartTimer();
      commit();
    },
    finish: () => finishOrReopen(),
    'load-plan': loadFromPlan,
    plan: (el) => planSheet(+el.dataset.wd),
    goals: goalsSheet,
    'meal-new': () => mealSheet(),
    meal(el) { const m = G.mealsOn().find((x) => x.id === el.dataset.id); if (m) mealSheet(m); },
    scan: scanFood,
    'scan-add': addScanToday,
    'scan-edit': editScan,
    'weight-new': weightSheet,
    'weight-history': weightHistory,
    nudge: (el) => nudgeWeight(+el.dataset.d),
  },
};
