/* One small sheet for tasks. */
import { S, commit } from '../core/store.js';
import { today } from '../core/dates.js';
import { toast } from '../ui/toast.js';
import { form } from '../ui/sheet.js';
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
