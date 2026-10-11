import { S, commit } from '../core/store.js';
import { today, parseIso, hmToMin, minToHM, nowHM } from '../core/dates.js';
import { fa } from '../core/format.js';
import { faDayMonth } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { form, menu } from '../ui/sheet.js';
import { askNotif } from '../services/notify.js';
import { uid } from '../core/util.js';
import * as P from '../domain/planner.js';

export function blockSheet(id, date, start) {
  const b = id ? P.findBlock(id) : null;
  const slot = P.defaultSlot(hmToMin(nowHM()));
  const from = b ? b.start : start || slot.start;
  const to = b ? b.end : start ? minToHM(Math.min(hmToMin(start) + 60, 23 * 60 + 59)) : slot.end;
  form({
    title: b ? 'ویرایش بلوک زمانی' : 'بلوک زمانی جدید',
    fields: [
      { name: 'title', label: 'عنوان', value: b ? b.title : '', placeholder: 'مثلاً کار روی پروژه' },
      { name: 'date', label: 'تاریخ', type: 'date', value: b ? b.date : date || today() },
      { name: 'start', label: 'شروع', type: 'time', value: from, row: 'a' },
      { name: 'end', label: 'پایان', type: 'time', value: to, row: 'a' },
      { name: 'color', label: 'نوع', type: 'chips', value: b ? b.color : 'terracotta', options: Object.entries(P.BLOCK_COLORS).map(([k, c]) => ({ value: k, label: c.label, icon: c.icon })) },
      { name: 'notify', label: 'یادآوری هنگام شروع', type: 'switch', value: b ? b.notify : false },
    ],
    extra: b ? [{ label: 'حذف', cls: 'danger', run: () => { S.blocks.splice(S.blocks.indexOf(b), 1); commit(); toast('بلوک حذف شد'); } }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('عنوان را وارد کنید'); return false; }
      if (!v.start || !v.end || hmToMin(v.end) <= hmToMin(v.start)) { toast('زمان پایان باید بعد از شروع باشد'); return false; }
      const f = { title, date: v.date || today(), start: v.start, end: v.end, color: v.color, notify: v.notify };
      const clash = P.clashWith(f, b);
      const saved = P.saveBlock(b, f);
      commit();
      toast(clash ? `ذخیره شد — با «${clash.title}» هم‌پوشانی دارد` : b ? 'بلوک ویرایش شد' : 'بلوک اضافه شد');
      if (saved.notify) askNotif();
    },
  });
}

export function blockMenu(b) {
  menu(b.title, [
    { icon: 'edit', label: 'ویرایش', run: () => blockSheet(b.id) },
    { icon: b.notify ? 'notifications_off' : 'notifications_active', label: b.notify ? 'خاموش کردن یادآور' : 'یادآوری هنگام شروع', run: () => toggleBlockNotify(b) },
    { icon: 'content_copy', label: 'کپی برای روز بعد', run: () => { const c = P.duplicateToNextDay(b); commit(); toast(`برای ${faDayMonth(parseIso(c.date))} کپی شد`); } },
    {
      icon: 'add_task', label: 'افزودن به فهرست کارها',
      run: () => {
        S.tasks.push({ id: uid(), title: b.title, date: b.date, time: b.start, category: 'work', priority: 'med', starred: false, done: b.done, archived: false, reminder: false, note: 'از برنامه‌ریز', subtasks: [], repeat: 'none' });
        commit();
        toast('به کارها اضافه شد');
      },
    },
    {
      icon: 'delete', label: 'حذف', danger: true,
      run: () => {
        const i = S.blocks.indexOf(b);
        S.blocks.splice(i, 1);
        commit();
        toast('بلوک حذف شد', { label: 'واگرد', run: () => { S.blocks.splice(i, 0, b); commit(); } });
      },
    },
  ], `${faDayMonth(parseIso(b.date))} • ${fa(b.start)} تا ${fa(b.end)}`);
}

export function toggleBlockNotify(b) {
  b.notify = !b.notify;
  b.notified = false;
  commit();
  toast(b.notify ? 'یادآور شروع بلوک فعال شد' : 'یادآور خاموش شد');
  if (b.notify) askNotif();
}
