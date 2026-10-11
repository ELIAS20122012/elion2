/* Tasks & habits: summary, quick add, and an accordion hub (today / upcoming / projects / habits / review / done). */
import { S, commit, persist, refresh } from '../core/store.js';
import { debounce } from '../core/util.js';
import { iso, addDays, parseIso, today, daysBetween, weekStart, WD_SHORT } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDate, faDayMonth, relDay } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { menu } from '../ui/sheet.js';
import { icon, stat, badge, emptyNote, addButton, progress, ring } from '../ui/widgets.js';
import { hubHtml, group, hubActions, setOpen } from '../ui/hub.js';
import { scrollToCard } from '../ui/dom.js';
import * as T from '../domain/tasks.js';
import { infoSheet } from '../ui/sheet.js';
import { taskSheet, taskMenu, toggleTask, quickAddTask, tomorrowTask, habitSheet, habitMenu, tapHabit } from '../features/task-sheets.js';

const expanded = new Set();
let reviewWeek = null;
const weekOfReview = () => reviewWeek || T.currentWeek();

/* ---------- task rows ---------- */
function taskRow(t, { showDate = false } = {}) {
  const p = T.prio(t);
  const c = T.catOf(t);
  const subs = t.subtasks || [];
  const subsDone = subs.filter((x) => x.done).length;
  const open = expanded.has(t.id);
  const overdue = !t.done && t.date < today();

  const meta = [];
  if (showDate || t.date !== today()) meta.push(overdue ? `<b class="neg">${relDay(t.date)}</b>` : relDay(t.date));
  if (t.time) meta.push(fa(t.time));
  meta.push(`<i class="dot" style="background:${c.color}"></i> ${c.label}`);
  if (subs.length) meta.push(`${icon('checklist', 'tiny')}${fa(subsDone)}/${fa(subs.length)}`);
  if (t.repeat && t.repeat !== 'none') meta.push(icon('repeat', 'tiny'));
  if (t.reminder) meta.push(icon('notifications_active', 'tiny'));

  const detail = open ? `
    <div class="trow-detail">
      ${subs.length ? `<div class="stack-xs">${subs.map((s) => `
        <button class="subtask${s.done ? ' done' : ''}" data-act="subtask" data-t="${t.id}" data-s="${s.id}">${icon(s.done ? 'check_box' : 'check_box_outline_blank')}${esc(s.title)}</button>`).join('')}</div>` : ''}
      ${t.note ? `<p class="muted small">${esc(t.note)}</p>` : ''}
      <p class="muted tiny">اولویت ${p.label} • ${T.REPEAT[t.repeat || 'none']} • ${faDate(parseIso(t.date), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div class="grid4 gap-xs">${[['edit', 'edit', 'ویرایش'], ['star', 'star', t.starred ? 'برداشتن ستاره' : 'مهم'], ['tomorrow', 'event_repeat', 'فردا'], ['more', 'more_horiz', 'بیشتر']]
        .map(([a, i, label]) => `<button class="mini-btn" data-act="tact" data-a="${a}" data-id="${t.id}">${icon(i)}${label}</button>`).join('')}</div>
    </div>` : '';

  return `
    <div class="trow${t.done ? ' is-done' : ''}">
      <div class="trow-main">
        <button class="check-circle${t.done ? ' on' : ''}" style="--prio:${p.color}" data-act="check" data-id="${t.id}" aria-label="انجام شد">${icon('check')}</button>
        <button class="trow-text" data-act="expand" data-id="${t.id}">
          <span class="trow-title truncate">${t.starred ? '⭐ ' : ''}${esc(t.title)}</span>
          <small class="muted truncate">${meta.join(' • ')}</small>
        </button>
        <span class="prio-bar" style="background:${p.color}" title="اولویت ${p.label}"></span>
      </div>
      ${detail}
    </div>`;
}

const rows = (list, opts) => list.map((t) => taskRow(t, opts)).join('');

/* ---------- section bodies ---------- */
function todayBody({ todays, overdue }) {
  const open = todays.filter((t) => !t.done).sort(T.sortTasks);
  const done = todays.filter((t) => t.done);
  let html = '';
  if (overdue.length) {
    html += group({ id: 't-over', title: 'معوق', count: overdue.length, red: true, def: true, inner: `${rows(overdue.sort(T.sortTasks), { showDate: true })}<button class="link accent" data-act="over-today">انتقال همه به امروز</button>` });
  }
  ['high', 'med', 'low'].forEach((pk) => {
    const list = open.filter((t) => (t.priority || 'med') === pk);
    if (list.length) html += group({ id: `t-${pk}`, title: `<i class="dot" style="background:${T.PRIO[pk].color}"></i>اولویت ${T.PRIO[pk].label}`, count: list.length, inner: rows(list), def: true });
  });
  if (!open.length && !overdue.length) html += emptyNote(todays.length ? 'همه کارهای امروز انجام شده 🎉' : 'برای امروز کاری ندارید. از نوار بالا اضافه کنید.');
  if (done.length) html += group({ id: 't-done', title: 'انجام‌شده امروز', count: done.length, inner: rows(done) });
  return html;
}

function upcomingBody(all) {
  const t0 = today();
  let html = '';
  for (let i = 1; i <= 7; i++) {
    const d = iso(addDays(new Date(), i));
    const list = all.filter((t) => t.date === d).sort(T.sortTasks);
    const title = `${i === 1 ? 'فردا' : faDate(parseIso(d), { weekday: 'long' })} <small class="muted">${faDayMonth(parseIso(d))}</small>`;
    html += group({
      id: `u-${i}`, title, count: list.filter((t) => !t.done).length, def: i <= 2 && list.length > 0,
      inner: `${rows(list) || emptyNote('کاری ثبت نشده')}<button class="link accent" data-act="addon" data-date="${d}">+ افزودن کار برای این روز</button>`,
    });
  }
  const later = all.filter((t) => !t.done && daysBetween(t0, t.date) > 7).sort(T.sortTasks);
  if (later.length) html += group({ id: 'u-later', title: 'بعدتر', count: later.length, inner: rows(later, { showDate: true }) });
  return html;
}

function projectsBody(all) {
  let html = Object.entries(T.CAT).map(([k, c]) => {
    const list = all.filter((t) => (t.category || 'work') === k);
    const open = list.filter((t) => !t.done).sort(T.sortTasks);
    const done = list.length - open.length;
    return group({
      id: `p-${k}`, title: `<i class="dot" style="background:${c.color}"></i>${c.label}`, count: open.length,
      inner: rows(open, { showDate: true }) || emptyNote('کار بازی در این دسته نیست'),
      extra: `${progress(list.length ? (done / list.length) * 100 : 0, 'var(--sage)')} ${fa(done)}/${fa(list.length)}`,
    });
  }).join('');
  const starred = all.filter((t) => t.starred && !t.done).sort(T.sortTasks);
  if (starred.length) html = group({ id: 'p-star', title: '⭐ مهم‌ها', count: starred.length, def: true, inner: rows(starred, { showDate: true }) }) + html;
  return html;
}

function habitsBody() {
  const t0 = today();
  const ws = weekStart(new Date());
  const cards = S.habits.map((h) => {
    const v = T.habitValue(h);
    const ok = T.habitDone(h);
    return `<button class="habit${ok ? ' ok' : ''}" data-act="habit" data-hold="habit" data-id="${h.id}">
      ${icon(h.icon || 'repeat')}<b class="truncate">${esc(h.title)}</b>
      <span class="habit-count">${fa(v)}/${fa(h.target)}${icon(ok ? 'done_all' : 'add', 'tiny')}</span></button>`;
  }).join('');
  const header = `<div class="row-between small"><b>این هفته</b><span class="week-cells muted">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span>${WD_SHORT[addDays(ws, i).getDay()]}</span>`).join('')}</span></div>`;
  const lines = S.habits.map((h) => {
    const streak = T.habitStreak(h);
    const cells = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const k = iso(addDays(ws, i));
      const cls = T.habitDone(h, k) ? 'full' : T.habitValue(h, k) ? 'part' : k > t0 ? 'future' : 'miss';
      return `<i class="hcell ${cls}${k === t0 ? ' today' : ''}"></i>`;
    }).join('');
    return `<div class="row-between"><span class="small truncate">${esc(h.title)}${streak > 1 ? ` <b class="accent tiny">🔥${fa(streak)}</b>` : ''}</span><span class="week-cells">${cells}</span></div>`;
  }).join('');
  return `${S.habits.length ? `<div class="grid3 gap-sm">${cards}</div>` : emptyNote('هنوز عادتی تعریف نشده')}
    <div class="well pad stack-sm">${header}${lines}</div>
    ${addButton('عادت جدید', 'habit-new')}
    <p class="muted tiny center">لمس کارت: افزودن • نگه‌داشتن: گزینه‌ها</p>`;
}

function reviewBody() {
  const ws = weekOfReview();
  const we = iso(addDays(parseIso(ws), 6));
  const r = T.reviewOf(ws);
  const st = T.weekStats(ws);
  const current = ws === T.currentWeek();
  let html = `<div class="row-between">
    <button class="icon-btn sm" data-act="wk" data-d="-1" aria-label="هفته قبل">${icon('chevron_right')}</button>
    <div class="center"><b>${current ? 'این هفته' : 'هفته'}</b><small class="muted block">${faDayMonth(parseIso(ws))} تا ${faDayMonth(parseIso(we))}</small></div>
    <button class="icon-btn sm${current ? ' disabled' : ''}" data-act="wk" data-d="1" aria-label="هفته بعد">${icon('chevron_left')}</button></div>
    <div class="grid2 gap-sm">${stat('کارهای انجام‌شده', `${fa(st.done)} از ${fa(st.due)}`)}${stat('تکمیل عادت‌ها', `${fa(st.habit)}٪`, st.habit >= 70 ? 'pos' : '')}${stat('جلسات ورزش', `${fa(st.gym)} روز`)}${stat('هزینه هفته', money(st.spend), 'neg')}</div>
    <div class="well pad row-between"><b class="small">حال کلی هفته</b><span class="row">${T.MOODS.map((m, i) => `<button class="mood${r.mood === i + 1 ? ' on' : ''}" data-act="mood" data-v="${i + 1}">${m}</button>`).join('')}</span></div>`;
  T.REVIEW_FIELDS.forEach(([key, label, ic, hint]) => {
    const val = r[key] || '';
    const id = `rv-${key}`;
    const on = S.ui.sub[id] === undefined ? !val || key === 'wins' : S.ui.sub[id];
    html += `<div class="group"><button class="group-head" data-act="sub" data-id="${id}" data-def="${on ? 1 : 0}">
      <span class="group-title">${icon(ic, 'muted')}${label}</span>
      <span class="group-extra">${val ? `${fa(val.split('\n').filter(Boolean).length)} خط` : 'خالی'}<span class="chev material-symbols-outlined${on ? ' open' : ''}">chevron_left</span></span></button>
      ${on ? `<div class="group-body"><textarea class="input" rows="4" data-key="${id}" data-input="rv" data-field="${key}" placeholder="${esc(hint)}">${esc(val)}</textarea>
        ${key === 'next' ? `<button class="mini-btn row" data-act="next-to-tasks">${icon('add_task')}تبدیل به کار برای شروع هفته بعد</button>` : ''}</div>` : ''}</div>`;
  });
  html += `<div class="row-between tiny muted"><span data-saved>${r.updatedAt ? `آخرین ذخیره: ${faDayMonth(parseIso(r.updatedAt))}` : 'ذخیره خودکار هنگام نوشتن'}</span>
    <button class="link accent" data-act="all-reviews">همه مرورها (${fa(T.writtenReviews().length)})</button></div>`;
  return html;
}

function doneBody() {
  const wsk = T.currentWeek();
  const doneList = S.tasks.filter((t) => t.done && !t.archived).sort((a, b) => ((a.doneAt || a.date) < (b.doneAt || b.date) ? 1 : -1));
  const when = (t) => t.doneAt || t.date;
  const thisWeek = doneList.filter((t) => when(t) >= wsk);
  const older = doneList.filter((t) => when(t) < wsk);
  const archived = S.tasks.filter((t) => t.archived);
  let html = group({ id: 'd-week', title: 'انجام‌شده این هفته', count: thisWeek.length, def: true, inner: rows(thisWeek, { showDate: true }) || emptyNote('هنوز موردی نیست') });
  if (older.length) html += group({ id: 'd-old', title: 'انجام‌شده قبلی', count: older.length, inner: rows(older.slice(0, 30), { showDate: true }) });
  html += group({ id: 'd-arch', title: 'آرشیو', count: archived.length, inner: rows(archived, { showDate: true }) || emptyNote('آرشیو خالی است') });
  if (doneList.length) html += `<button class="mini-btn row wide" data-act="archive-done">${icon('inventory_2')}انتقال همه انجام‌شده‌ها به آرشیو</button>`;
  return html;
}

/* ---------- page ---------- */
function summary(b) {
  const pct = b.todays.length ? Math.round((b.doneToday / b.todays.length) * 100) : 0;
  const mood = !b.todays.length ? 'آزاد' : pct === 100 ? 'عالی' : pct >= 50 ? 'خوب' : 'شروع کن';
  return `<section class="card summary">
    ${ring(pct, `${fa(pct)}%`, 64)}
    <div class="grow stack-xs">
      <div class="row-between"><b>${fa(b.doneToday)} از ${fa(b.todays.length)} انجام شده${b.overdue.length ? ` • ${fa(b.overdue.length)} معوق` : ''}</b><span class="pill sage">${mood}</span></div>
      <span class="progress"><i style="width:${Math.max(pct, 8)}%"></i></span>
      <small class="muted">ذخیره خودکار روی این دستگاه فعال است</small>
    </div></section>`;
}

function sections(b) {
  const t0 = today();
  const up = b.all.filter((t) => !t.done && t.date > t0 && daysBetween(t0, t.date) <= 7);
  const hDone = S.habits.filter((h) => T.habitDone(h)).length;
  const best = S.habits.reduce((m, h) => Math.max(m, T.habitStreak(h)), 0);
  const rv = T.reviewOf(T.currentWeek());
  const projectsSum = Object.entries(T.CAT).map(([k, c]) => { const n = b.all.filter((t) => !t.done && t.category === k).length; return n ? `${c.label} ${fa(n)}` : ''; }).filter(Boolean).join(' • ');
  return [
    { key: 'today', title: 'امروز', icon: 'today', color: '#DE8353', sum: `${b.overdue.length ? `${fa(b.overdue.length)} معوق • ` : ''}${fa(b.doneToday)} از ${fa(b.todays.length)} کار امروز انجام شده`, badge: badge(b.overdue.length || b.todays.length - b.doneToday, !!b.overdue.length), body: () => todayBody(b) },
    { key: 'upcoming', title: 'هفت روز آینده', icon: 'date_range', color: '#5d7a8c', sum: up.length ? `${fa(up.length)} کار در ۷ روز آینده` : 'برنامه‌ای برای روزهای آینده ثبت نشده', body: () => upcomingBody(b.all) },
    { key: 'projects', title: 'دسته‌ها و پروژه‌ها', icon: 'folder_open', color: '#865228', sum: projectsSum || 'کار بازی ندارید', body: () => projectsBody(b.all) },
    { key: 'habits', title: 'عادت‌ها', icon: 'all_inclusive', color: '#4d7c62', sum: `${fa(hDone)} از ${fa(S.habits.length)} امروز${best ? ` • بهترین زنجیره ${fa(best)} روز` : ''}`, badge: badge(S.habits.length - hDone), body: habitsBody },
    { key: 'review', title: 'یادداشت و مرور هفتگی', icon: 'edit_note', color: '#6b6f9c', sum: T.reviewHasText(rv) ? `هفته جاری نوشته شده • ${fa(Object.keys(S.weekly).length)} مرور ثبت‌شده` : 'مرور این هفته هنوز نوشته نشده', badge: !(rv && (rv.wins || rv.next)) && new Date().getDay() === 5 ? badge('!', true) : '', body: reviewBody },
    { key: 'done', title: 'انجام‌شده و آرشیو', icon: 'inventory_2', color: '#8a8478', sum: `${fa(T.weekStats(T.currentWeek()).done)} کار این هفته انجام شد • ${fa(S.tasks.filter((t) => t.archived).length)} در آرشیو`, body: doneBody },
  ];
}

const saveReviewText = debounce((el) => {
  const r = T.editReview(weekOfReview());
  r[el.dataset.field] = el.value;
  r.updatedAt = today();
  persist();
  const label = document.querySelector('[data-saved]');
  if (label) label.textContent = 'ذخیره شد ✓';
}, 500);

function openReview() { setOpen('tasks', 'review'); scrollToCard(document.querySelector('[data-sec="review"]')); }

function allReviews() {
  const keys = T.writtenReviews().sort().reverse();
  const html = keys.length ? `<div class="list">${keys.map((k) => {
    const x = S.weekly[k];
    return `<div class="item item-block" data-pick="${k}" role="button"><div class="row-between"><b>${faDayMonth(parseIso(k))} تا ${faDayMonth(addDays(parseIso(k), 6))}</b><span>${x.mood ? T.MOODS[x.mood - 1] : ''}</span></div><span class="item-sub clamp">${esc(x.wins || x.notes || x.next || '')}</span></div>`;
  }).join('')}</div>` : emptyNote('هنوز مروری نوشته نشده');
  infoSheet('همه مرورهای هفتگی', html, [], (el, close) => { reviewWeek = el.dataset.pick; close(); openReview(); });
}

export default {
  id: 'tasks',
  title: 'کارها و عادت‌ها',
  mount() {
    reviewWeek = null;
    if (new Date().getDay() === 5 && S.ui.reviewNudge !== today()) {
      S.ui.reviewNudge = today();
      persist();
      setTimeout(() => toast('آخر هفته است — وقت مرور هفتگی', { label: 'باز کن', run: openReview }), 1500);
    }
  },
  render() {
    const b = T.taskBuckets();
    return `${summary(b)}
      <form class="well quick-add" data-submit="qa">
        ${icon('add_task', 'muted')}
        <input data-key="qa" name="qa" autocomplete="off" placeholder="افزودن سریع کار برای امروز…">
        <button type="button" class="icon-btn sm" data-act="qa-more" aria-label="جزئیات">${icon('tune')}</button>
        <button type="submit" class="icon-btn sm primary" aria-label="افزودن">${icon('arrow_upward')}</button>
      </form>
      <div class="stack">${hubHtml('tasks', sections(b), 'today')}</div>
      <button class="fab" data-act="fab" aria-label="افزودن">${icon('add')}</button>`;
  },
  act: {
    ...hubActions,
    qa(el) { const input = el.querySelector('input'); quickAddTask(input.value); input.value = ''; },
    'qa-more'(el) { const input = el.closest('form').querySelector('input'); const v = input.value.trim(); input.value = ''; taskSheet(null, null, v); },
    fab: () => menu('افزودن', [
      { icon: 'task_alt', label: 'کار جدید', run: () => taskSheet() },
      { icon: 'all_inclusive', label: 'عادت جدید', run: () => habitSheet() },
      { icon: 'edit_note', label: 'مرور هفتگی', run: openReview },
    ]),
    check: (el) => toggleTask(el.dataset.id),
    expand(el) { const id = el.dataset.id; if (!expanded.delete(id)) expanded.add(id); refresh(); },
    subtask(el) {
      const t = T.findTask(el.dataset.t);
      const s = t && t.subtasks.find((x) => x.id === el.dataset.s);
      if (!s) return;
      s.done = !s.done;
      commit();
      if (t.subtasks.every((x) => x.done) && !t.done) toast('همه زیرکارها انجام شد — کار اصلی را هم تیک بزنید', { label: 'تیک بزن', run: () => toggleTask(t.id) });
    },
    tact(el) {
      const t = T.findTask(el.dataset.id);
      if (!t) return;
      const a = el.dataset.a;
      if (a === 'edit') taskSheet(t.id);
      else if (a === 'star') { t.starred = !t.starred; commit(); }
      else if (a === 'tomorrow') tomorrowTask(t);
      else taskMenu(t);
    },
    addon: (el) => taskSheet(null, el.dataset.date),
    'habit-new': () => habitSheet(),
    habit(el) { const h = T.findHabit(el.dataset.id); if (h) tapHabit(h); },
    'over-today'() { T.pushOverdueToToday(); commit(); toast('کارهای معوق به امروز منتقل شدند'); },
    'archive-done'() { const n = T.archiveDone(); commit(); toast(`${fa(n)} کار به آرشیو رفت`); },
    mood(el) { const r = T.editReview(weekOfReview()); const m = +el.dataset.v; r.mood = r.mood === m ? 0 : m; r.updatedAt = today(); commit(); },
    wk(el) { reviewWeek = iso(addDays(parseIso(weekOfReview()), 7 * +el.dataset.d)); refresh(); },
    'all-reviews': allReviews,
    'next-to-tasks'() {
      const res = T.reviewToTasks(weekOfReview());
      if (!res) { toast('اول اولویت‌ها را بنویسید (هر خط یکی)'); return; }
      commit();
      toast(res.added ? `${fa(res.added)} کار با اولویت بالا برای ${faDayMonth(parseIso(res.date))} ساخته شد` : 'این اولویت‌ها قبلاً به کار تبدیل شده‌اند');
    },
  },
  hold: { habit(el) { const h = T.findHabit(el.dataset.id); if (h) habitMenu(h); } },
  input: { rv: (el) => saveReviewText(el) },
};
