/* Workout, calories and weight dialogs — kept deliberately short. */
import { S, commit } from '../core/store.js';
import { uid } from '../core/util.js';
import { today } from '../core/dates.js';
import { fa, num } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { form, confirmBox } from '../ui/sheet.js';
import * as G from '../domain/gym.js';

export function exerciseSheet(id) {
  const s = G.session(today(), true);
  const e = id ? s.exercises.find((x) => x.id === id) : null;
  form({
    title: e ? 'ویرایش حرکت' : 'حرکت جدید',
    fields: [
      { name: 'name', label: 'نام حرکت', value: e ? e.name : '', placeholder: 'مثلاً اسکوات' },
      { name: 'sets', label: 'تعداد ست', type: 'number', value: e ? e.sets : 3, row: 'a' },
      { name: 'reps', label: 'تکرار', type: 'number', value: e ? e.reps : 12, row: 'a' },
    ],
    extra: e ? [{ label: 'حذف', cls: 'danger', run: () => { s.exercises.splice(s.exercises.indexOf(e), 1); commit(); toast('حرکت حذف شد'); } }] : [],
    onSubmit(v) {
      const name = (v.name || '').trim();
      if (!name) { toast('نام حرکت را وارد کنید'); return false; }
      const o = e || { id: uid(), done: 0, unit: 'تکرار', weight: '' };
      Object.assign(o, { name, sets: Math.max(1, Math.min(10, Math.round(num(v.sets)) || 3)), reps: String(num(v.reps) || 12) });
      o.done = Math.min(o.done, o.sets);
      if (!e) s.exercises.push(o);
      s.finished = false;
      commit();
    },
  });
}

/** Finish or reopen today's session (asks before finishing). */
export function finishOrReopen() {
  const s = G.session(today());
  if (!s || !s.exercises.length) return;
  if (s.finished) { s.finished = false; commit(); return; }
  const st = G.setsOf(s);
  confirmBox('پایان تمرین امروز؟', `ست‌های انجام‌شده: ${fa(st.done)} از ${fa(st.tot)}`, 'ثبت پایان', () => {
    G.finishSession(s);
    commit();
    toast('تمرین امروز ثبت شد. خسته نباشید! 💪');
  });
}

export function mealSheet(m) {
  const editing = m && m.id;
  form({
    title: editing ? 'ویرایش وعده' : 'وعده جدید',
    fields: [
      { name: 'kcal', label: 'کالری (kcal)', type: 'number', value: (m && m.kcal) || '' },
      { name: 'name', label: 'غذا (اختیاری)', value: m ? m.name : '' },
    ],
    extra: editing ? [{
      label: 'حذف', cls: 'danger',
      run: () => { const list = G.mealsOn(); const i = list.indexOf(m); list.splice(i, 1); commit(); toast('وعده حذف شد', { label: 'واگرد', run: () => { list.splice(i, 0, m); commit(); } }); },
    }] : [],
    onSubmit(v) {
      const kcal = Math.round(num(v.kcal));
      if (!kcal) { toast('کالری را وارد کنید'); return false; }
      const o = { name: (v.name || '').trim() || 'وعده', kcal };
      if (editing) Object.assign(m, o); else G.addMeal({ ...o, p: 0, c: 0, f: 0 });
      commit();
    },
  });
}

export function goalSheet() {
  form({
    title: 'هدف کالری روزانه',
    fields: [{ name: 'kcal', label: 'کالری (kcal)', type: 'number', value: S.gym.goals.kcal }],
    onSubmit(v) { S.gym.goals.kcal = Math.max(500, num(v.kcal)) || S.gym.goals.kcal; commit(); },
  });
}

export function weightSheet() {
  const lw = G.lastWeight();
  form({
    title: 'ثبت وزن',
    fields: [{ name: 'kg', label: 'وزن (kg)', type: 'number', value: lw ? lw.kg : '' }],
    onSubmit(v) {
      const kg = num(v.kg);
      if (kg < 20 || kg > 400) { toast('وزن معتبر وارد کنید'); return false; }
      G.setWeight(today(), kg);
      commit();
    },
  });
}

export function nudgeWeight(delta) {
  const lw = G.lastWeight();
  let entry = S.gym.weights.find((w) => w.date === today());
  if (!entry) { entry = { date: today(), kg: lw ? lw.kg : 75 }; S.gym.weights.push(entry); }
  entry.kg = G.round1(entry.kg + delta);
  commit();
}
