/* Appointments and shopping dialogs — kept to a handful of short fields. */
import { S, commit } from '../core/store.js';
import { today } from '../core/dates.js';
import { toast } from '../ui/toast.js';
import { form } from '../ui/sheet.js';
import * as A from '../domain/appointments.js';
import * as SH from '../domain/shopping.js';

export function apptSheet(id, date = today()) {
  const a = id ? A.findAppt(id) : null;
  form({
    title: a ? 'ویرایش قرار' : 'قرار جدید',
    fields: [
      { name: 'title', label: 'عنوان', value: a ? a.title : '' },
      { name: 'kind', label: 'نوع', type: 'chips', value: a ? a.kind : 'visit', options: Object.entries(A.KINDS).map(([value, k]) => ({ value, label: k.label, icon: k.icon })) },
      { name: 'date', label: 'تاریخ', type: 'date', value: a ? a.date : date, row: 'a' },
      { name: 'time', label: 'ساعت', type: 'time', value: a ? a.time : '', row: 'a' },
      { name: 'place', label: 'مکان (اختیاری)', value: a ? a.place : '' },
    ],
    focus: !a,
    extra: a ? [{
      label: 'حذف', cls: 'danger',
      run: () => { const r = A.removeAppt(a.id); commit(); toast('قرار حذف شد', { label: 'واگرد', run: () => { S.appointments.splice(r.index, 0, r.appt); commit(); } }); },
    }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('عنوان را وارد کنید'); return false; }
      A.saveAppt(a, { title, kind: v.kind, date: v.date || today(), time: v.time, place: (v.place || '').trim() });
      commit();
    },
  });
}

export function shopSheet(id) {
  const it = id ? SH.findItem(id) : null;
  form({
    title: it ? 'ویرایش' : 'خرید جدید',
    fields: [{ name: 'title', label: 'چه چیزی؟', value: it ? it.title : '' }],
    focus: !it,
    extra: it ? [{ label: 'حذف', cls: 'danger', run: () => { S.shopping.splice(S.shopping.indexOf(it), 1); commit(); } }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('نام را وارد کنید'); return false; }
      if (it) it.title = title; else SH.addItem(title);
      commit();
    },
  });
}
