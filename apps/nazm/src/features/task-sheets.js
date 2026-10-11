/* One small sheet for tasks, plus habit actions. */
import { S, commit } from '../core/store.js';
import { uid } from '../core/util.js';
import { today } from '../core/dates.js';
import { fa, num } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { form, menu } from '../ui/sheet.js';
import * as T from '../domain/tasks.js';

export function taskSheet(id, date = today()) {
  const t = id ? T.findTask(id) : null;
  const fields = [
    { name: 'title', label: 'عنوان', value: t ? t.title : '' },
    { name: 'time', label: 'ساعت (اختیاری)', type: 'time', value: t ? t.time : '' },
    { name: 'repeat', label: 'تکرار', type: 'chips', value: t ? t.repeat || 'none' : 'none', options: Object.entries(T.REPEAT).map(([value, label]) => ({ value, label })) },
  ];
  if (t) fields.splice(1, 0, { name: 'date', label: 'تاریخ', type: 'date', value: t.date });
  form({
    title: t ? 'ویرایش کار' : 'کار جدید',
    fields, focus: !t,
    extra: t ? [{ label: 'حذف', cls: 'danger', run: () => deleteTask(t.id) }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('عنوان را وارد کنید'); return false; }
      const f = { title, time: v.time || '', repeat: v.repeat || 'none' };
      if (t) Object.assign(t, f, { date: v.date || t.date });
      else S.tasks.push(T.newTask({ ...f, date }));
      commit();
    },
  });
}

export function deleteTask(id) {
  const removed = T.removeTask(id);
  if (!removed) return;
  commit();
  toast('کار حذف شد', { label: 'واگرد', run: () => { S.tasks.splice(removed.index, 0, removed.task); commit(); } });
}

export function toggleTask(id) {
  const t = T.findTask(id);
  if (!t) return;
  const next = T.toggleDone(t);
  commit();
  if (next) toast(`تکرار بعدی: ${next.date}`);
}

/** Quick add from the input line; "!!" or "فوری" is accepted and ignored (kept for old muscle memory). */
export function quickAddTask(raw, date = today()) {
  const title = raw.replace(/!!/g, '').trim();
  if (!title) return false;
  S.tasks.push(T.newTask({ title, date }));
  commit();
  return true;
}

/* ---------- habits ---------- */
export function habitSheet(id) {
  const h = id ? T.findHabit(id) : null;
  form({
    title: h ? 'ویرایش عادت' : 'عادت جدید',
    fields: [
      { name: 'title', label: 'نام عادت', value: h ? h.title : '', placeholder: 'مثلاً نوشیدن آب' },
      { name: 'icon', label: 'آیکون', type: 'chips', value: h ? h.icon : T.HABIT_ICONS[0], options: T.HABIT_ICONS.map((i) => ({ value: i, label: '', icon: i })) },
      { name: 'target', label: 'هدف روزانه', type: 'number', value: h ? h.target : 1, row: 'a' },
      { name: 'step', label: 'هر لمس', type: 'number', value: h ? h.step : 1, row: 'a' },
    ],
    extra: h ? [{
      label: 'حذف', cls: 'danger',
      run: () => { const i = S.habits.indexOf(h); S.habits.splice(i, 1); commit(); toast('عادت حذف شد', { label: 'واگرد', run: () => { S.habits.splice(i, 0, h); commit(); } }); },
    }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('نام عادت را وارد کنید'); return false; }
      const o = h || { id: uid(), log: {}, unit: '' };
      Object.assign(o, { title, icon: v.icon, target: Math.max(1, num(v.target)), step: Math.max(1, num(v.step)) });
      if (!h) S.habits.push(o);
      commit();
    },
  });
}

/** Tap = +1 step; tapping a finished habit starts it over. */
export function tapHabit(h) {
  const before = T.habitValue(h);
  const finished = T.habitDone(h);
  const step = h.step || 1;
  const v = finished ? T.bumpHabit(h, -before) : T.bumpHabit(h, step);
  commit();
  toast(finished ? `${h.title}: از اول` : `${h.title}: ${fa(v)}/${fa(h.target)}${v >= h.target ? ' ✓' : ''}`,
    { label: 'واگرد', run: () => { T.bumpHabit(h, before - v); commit(); } });
}

export function habitMenu(h) {
  menu(h.title, [{ icon: 'edit', label: 'ویرایش یا حذف', run: () => habitSheet(h.id) }]);
}
