/* Workout, nutrition and weight dialogs. */
import { S, commit } from '../core/store.js';
import { uid } from '../core/util.js';
import { today, parseIso } from '../core/dates.js';
import { fa, num } from '../core/format.js';
import { faDate, faDayMonth } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { form, menu, confirmBox, infoSheet, later } from '../ui/sheet.js';
import { pickFile, shrinkImage } from '../services/files.js';
import { askVision } from '../services/ai.js';
import * as G from '../domain/gym.js';
import { WD_LONG } from '../core/dates.js';

/* ---------- exercises ---------- */
export function exerciseSheet(id) {
  const s = G.session(today(), true);
  const e = id ? s.exercises.find((x) => x.id === id) : null;
  form({
    title: e ? 'ویرایش حرکت' : 'افزودن حرکت',
    fields: [
      { name: 'name', label: 'نام حرکت', value: e ? e.name : '', placeholder: 'مثلاً اسکوات' },
      { name: 'sets', label: 'تعداد ست', type: 'number', value: e ? e.sets : 3, row: '3a' },
      { name: 'reps', label: 'تکرار / زمان', type: 'number', value: e ? e.reps : 12, row: '3a' },
      { name: 'weight', label: 'وزنه', value: e ? e.weight : '', placeholder: '30 kg', row: '3a' },
      { name: 'unit', label: 'واحد', type: 'chips', value: e ? e.unit || 'تکرار' : 'تکرار', options: ['تکرار', 'ثانیه', 'دقیقه'].map((u) => ({ value: u, label: u })) },
    ],
    extra: e ? [{ label: 'حذف', cls: 'danger', run: () => { s.exercises.splice(s.exercises.indexOf(e), 1); commit(); toast('حرکت حذف شد'); } }] : [],
    onSubmit(v) {
      const name = (v.name || '').trim();
      if (!name) { toast('نام حرکت را وارد کنید'); return false; }
      const o = e || { id: uid(), done: 0 };
      Object.assign(o, { name, sets: Math.max(1, Math.min(10, Math.round(num(v.sets)) || 3)), reps: String(num(v.reps) || 12), weight: (v.weight || '').trim(), unit: v.unit });
      o.done = Math.min(o.done, o.sets);
      if (!e) s.exercises.push(o);
      s.finished = false;
      commit();
      toast(e ? 'حرکت ویرایش شد' : `«${name}» اضافه شد`);
    },
  });
}

export function exerciseMenu(e) {
  const s = G.session(today());
  const i = s.exercises.indexOf(e);
  const move = (to) => () => { s.exercises.splice(i, 1); s.exercises.splice(to, 0, e); commit(); };
  menu(e.name, [
    { icon: 'edit', label: 'ویرایش', run: () => exerciseSheet(e.id) },
    { icon: 'restart_alt', label: 'صفر کردن ست‌ها', run: () => { e.done = 0; commit(); } },
    i > 0 && { icon: 'arrow_upward', label: 'انتقال به بالا', run: move(i - 1) },
    i < s.exercises.length - 1 && { icon: 'arrow_downward', label: 'انتقال به پایین', run: move(i + 1) },
    {
      icon: 'delete', label: 'حذف حرکت', danger: true,
      run: () => { s.exercises.splice(i, 1); commit(); toast('حرکت حذف شد', { label: 'واگرد', run: () => { s.exercises.splice(i, 0, e); commit(); } }); },
    },
  ]);
}

/* ---------- session ---------- */
export function renameSession() {
  const s = G.session(today(), true);
  form({
    title: 'نام جلسه امروز',
    fields: [{ name: 'n', label: 'نام', value: s.name }, { name: 't', label: 'زمان هدف (دقیقه)', type: 'number', value: s.target || 45 }],
    onSubmit(v) { s.name = (v.n || '').trim() || s.name; s.target = Math.max(5, num(v.t)) || 45; commit(); },
  });
}

export function toggleTimer() {
  const s = G.session(today(), true);
  if (S.gym.timerStart) { G.stopTimer(s); toast(`زمان‌سنج متوقف شد: ${fa(Math.round(s.minutes))} دقیقه`); }
  else { S.gym.timerStart = Date.now(); s.finished = false; toast('زمان‌سنج تمرین شروع شد'); }
  commit();
}

/** Finish or reopen today's session (asks before finishing). */
export function finishOrReopen({ requireExercises = true } = {}) {
  const s = G.session(today());
  if (!s || !s.exercises.length) { if (requireExercises) toast('اول حرکتی اضافه کنید'); return false; }
  if (s.finished) { s.finished = false; commit(); toast('جلسه دوباره باز شد'); return true; }
  const st = G.setsOf(s);
  confirmBox('پایان جلسه امروز؟', `ست‌های انجام‌شده: ${fa(st.done)} از ${fa(st.tot)} • زمان: ${fa(G.sessionMinutes(s))} دقیقه`, 'ثبت پایان', () => {
    G.finishSession(s);
    commit();
    toast('جلسه امروز ثبت شد. خسته نباشید! 💪');
  });
  return true;
}

export function loadFromPlan() {
  const dow = new Date().getDay();
  const plan = S.gym.weekly[dow];
  if (!plan || !plan.items || !G.parsePlan(plan.items).length) {
    toast(`برای امروز (${WD_LONG[dow]}) برنامه هفتگی تعریف نشده`);
    S.gym.view = 'weekly';
    commit();
    return;
  }
  const s = G.session(today(), true);
  const apply = () => { G.loadPlanInto(s, plan); commit(); toast(`برنامه «${s.name}» بارگذاری شد`); };
  if (s.exercises.length) confirmBox('جایگزینی حرکات امروز؟', `حرکات فعلی با برنامه هفتگی «${plan.name || ''}» جایگزین می‌شوند.`, 'جایگزین کن', apply);
  else apply();
}

export function planSheet(wd) {
  const p = S.gym.weekly[wd] || { name: '', items: '' };
  form({
    title: `برنامه ${WD_LONG[wd]}`, sub: 'هر حرکت در یک خط: نام | تعداد ست | تکرار | وزن', focus: false,
    fields: [
      { name: 'name', label: 'نام جلسه', value: p.name, placeholder: 'مثلاً پایین‌تنه (خالی = استراحت)' },
      { name: 'items', label: 'حرکات', type: 'textarea', value: p.items, placeholder: 'اسکوات | 4 | 10 | 60 kg' },
    ],
    extra: S.gym.weekly[wd] ? [{ label: 'روز استراحت', cls: 'danger', run: () => { delete S.gym.weekly[wd]; commit(); } }] : [],
    onSubmit(v) {
      if (!(v.name || '').trim() && !(v.items || '').trim()) delete S.gym.weekly[wd];
      else S.gym.weekly[wd] = { name: (v.name || '').trim() || 'تمرین', items: v.items || '' };
      commit();
      toast('برنامه ذخیره شد');
    },
  });
}

/* ---------- meals ---------- */
export function mealSheet(m) {
  const editing = m && m.id;
  form({
    title: editing ? 'ویرایش وعده' : 'ثبت دستی کالری',
    fields: [
      { name: 'name', label: 'غذا / وعده', value: m ? m.name : '', placeholder: 'مثلاً ناهار' },
      { name: 'kcal', label: 'کالری (kcal)', type: 'number', value: (m && m.kcal) || '' },
      { name: 'p', label: 'پروتئین g', type: 'number', value: (m && m.p) || '', row: '3a' },
      { name: 'c', label: 'کربوهیدرات g', type: 'number', value: (m && m.c) || '', row: '3a' },
      { name: 'f', label: 'چربی g', type: 'number', value: (m && m.f) || '', row: '3a' },
    ],
    extra: editing ? [{
      label: 'حذف', cls: 'danger',
      run: () => { const list = G.mealsOn(); const i = list.indexOf(m); list.splice(i, 1); commit(); toast('وعده حذف شد', { label: 'واگرد', run: () => { list.splice(i, 0, m); commit(); } }); },
    }] : [],
    onSubmit(v) {
      const kcal = num(v.kcal);
      if (!kcal) { toast('کالری را وارد کنید'); return false; }
      const o = { name: (v.name || '').trim() || 'وعده', kcal: Math.round(kcal), p: num(v.p), c: num(v.c), f: num(v.f) };
      if (editing) Object.assign(m, o); else G.addMeal(o);
      commit();
      toast(editing ? 'وعده ویرایش شد' : `${fa(o.kcal)} کالری ثبت شد`);
    },
  });
}

export function goalsSheet() {
  const g = S.gym.goals;
  form({
    title: 'اهداف تغذیه روزانه',
    fields: [
      { name: 'kcal', label: 'کالری (kcal)', type: 'number', value: g.kcal },
      { name: 'p', label: 'پروتئین g', type: 'number', value: g.p, row: '3a' },
      { name: 'c', label: 'کربوهیدرات g', type: 'number', value: g.c, row: '3a' },
      { name: 'f', label: 'چربی g', type: 'number', value: g.f, row: '3a' },
    ],
    onSubmit(v) {
      g.kcal = Math.max(500, num(v.kcal)) || g.kcal;
      g.p = num(v.p) || g.p; g.c = num(v.c) || g.c; g.f = num(v.f) || g.f;
      commit();
      toast('اهداف ذخیره شد');
    },
  });
}

/* ---------- food photo scan (AI, optional) ---------- */
export function scanFood() {
  pickFile('image/*', true, (file) => {
    shrinkImage(file, 160, (thumb) => {
      S.gym.lastScan = { name: 'در حال تحلیل…', kcal: 0, p: 0, c: 0, f: 0, photo: thumb, added: true, pending: true };
      commit();
      askVision(file, 'You are a nutrition assistant. Look at this photo of a meal and estimate the total for the visible portion. Reply with only JSON: {"name": string (dish name in Persian/Farsi), "kcal": number, "protein": number (grams), "carbs": number (grams), "fat": number (grams)}. If the image is not food, reply {"name": "غذا تشخیص داده نشد", "kcal": 0, "protein": 0, "carbs": 0, "fat": 0}.')
        .then((r) => {
          S.gym.lastScan = { name: String(r.name || 'غذا'), kcal: Math.round(num(r.kcal)), p: Math.round(num(r.protein)), c: Math.round(num(r.carbs)), f: Math.round(num(r.fat)), photo: thumb, added: false };
          commit();
          toast('تخمین آماده شد — برای ثبت، دکمه پایین کارت را بزنید');
        })
        .catch((e) => {
          S.gym.lastScan = { name: 'غذای عکس‌گرفته‌شده', kcal: 0, p: 0, c: 0, f: 0, photo: thumb, added: true };
          commit();
          toast(e && e.code === 'not_granted' ? 'اجازه تحلیل داده نشد؛ مقادیر را دستی وارد کنید' : 'تحلیل خودکار در دسترس نبود؛ مقادیر را دستی وارد کنید');
          mealSheet({ name: '' });
        });
    });
  });
}

export function addScanToday() {
  const r = S.gym.lastScan;
  if (!r || r.added) { scanFood(); return; }
  G.addMeal({ name: r.name, kcal: r.kcal, p: r.p, c: r.c, f: r.f });
  r.added = true;
  commit();
  toast(`${fa(r.kcal)} کالری به امروز اضافه شد`);
}

export function editScan() {
  const r = S.gym.lastScan;
  if (!r) return;
  form({
    title: 'اصلاح نتیجه اسکن',
    fields: [
      { name: 'name', label: 'غذا', value: r.name },
      { name: 'kcal', label: 'کالری', type: 'number', value: r.kcal, row: '3a' },
      { name: 'p', label: 'پروتئین g', type: 'number', value: r.p, row: '3b' },
      { name: 'c', label: 'کربو g', type: 'number', value: r.c, row: '3b' },
      { name: 'f', label: 'چربی g', type: 'number', value: r.f, row: '3b' },
    ],
    onSubmit(v) { Object.assign(r, { name: v.name || r.name, kcal: num(v.kcal), p: num(v.p), c: num(v.c), f: num(v.f) }); commit(); },
  });
}

/* ---------- weight ---------- */
export function weightSheet() {
  const lw = G.lastWeight();
  form({
    title: 'ثبت وزن',
    fields: [{ name: 'kg', label: 'وزن (kg)', type: 'number', value: lw ? lw.kg : '' }, { name: 'date', label: 'تاریخ', type: 'date', value: today() }],
    onSubmit(v) {
      const kg = num(v.kg);
      if (kg < 20 || kg > 400) { toast('وزن معتبر وارد کنید'); return false; }
      G.setWeight(v.date || today(), kg);
      commit();
      toast(`وزن ${fa(kg)} kg ثبت شد`);
    },
  });
}

export function nudgeWeight(delta) {
  const lw = G.lastWeight();
  const base = lw ? lw.kg : 75;
  let entry = S.gym.weights.find((w) => w.date === today());
  if (!entry) { entry = { date: today(), kg: base }; S.gym.weights.push(entry); }
  entry.kg = G.round1(entry.kg + delta);
  commit();
}

export function weightHistory() {
  const rows = S.gym.weights.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
  const html = rows.length
    ? `<p class="sheet-sub">برای حذف، روی ردیف بزنید.</p><div class="list">${rows.map((x) => `<div class="item" data-pick="${x.date}" role="button"><span class="grow"><span class="item-title">${faDate(parseIso(x.date), { weekday: 'long', day: 'numeric', month: 'long' })}</span></span><b class="amt">${fa(x.kg)} kg</b></div>`).join('')}</div>`
    : '<div class="empty">هنوز وزنی ثبت نشده</div>';
  infoSheet('سابقه وزن', html, [{ label: 'ثبت وزن', cls: 'primary', run: weightSheet }], (el, close) => {
    const d = el.dataset.pick;
    close();
    later(() => confirmBox('حذف این ثبت وزن؟', faDayMonth(parseIso(d)), 'حذف', () => { S.gym.weights = S.gym.weights.filter((x) => x.date !== d); commit(); }));
  });
}

