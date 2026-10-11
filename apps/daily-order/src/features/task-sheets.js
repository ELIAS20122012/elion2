/* Task and habit dialogs and the small actions around them (all share undo toasts). */
import { S, commit } from '../core/store.js';
import { uid } from '../core/util.js';
import { today, iso, addDays, parseIso, hmToMin, minToHM } from '../core/dates.js';
import { fa, num } from '../core/format.js';
import { faDate, faDayMonth } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { form, menu } from '../ui/sheet.js';
import { askNotif } from '../services/notify.js';
import * as T from '../domain/tasks.js';

export function taskSheet(id, presetDate, presetTitle) {
  const t = id ? T.findTask(id) : null;
  form({
    title: t ? 'ویرایش کار' : 'کار جدید',
    fields: [
      { name: 'title', label: 'عنوان', value: t ? t.title : presetTitle || '', placeholder: 'مثلاً تماس با حسابدار' },
      { name: 'date', label: 'تاریخ', type: 'date', value: t ? t.date : presetDate || today(), row: 'a' },
      { name: 'time', label: 'ساعت', type: 'time', value: t ? t.time : '', row: 'a' },
      { name: 'priority', label: 'اولویت', type: 'chips', value: t ? t.priority || 'med' : 'med', options: Object.entries(T.PRIO).map(([k, p]) => ({ value: k, label: p.label, icon: p.icon })) },
      { name: 'category', label: 'دسته / پروژه', type: 'chips', value: t ? t.category : 'work', options: Object.entries(T.CAT).map(([k, c]) => ({ value: k, label: c.label })) },
      { name: 'repeat', label: 'تکرار', type: 'chips', value: t ? t.repeat || 'none' : 'none', options: Object.entries(T.REPEAT).map(([k, label]) => ({ value: k, label })) },
      { name: 'subs', label: 'زیرکارها (هر خط یک مورد)', type: 'textarea', value: t && t.subtasks ? t.subtasks.map((s) => s.title).join('\n') : '', placeholder: 'اختیاری' },
      { name: 'note', label: 'یادداشت', value: t ? t.note : '', placeholder: 'اختیاری' },
      { name: 'starred', label: 'مهم ⭐', type: 'switch', value: t ? t.starred : false },
      { name: 'reminder', label: 'یادآوری در زمان تعیین‌شده', type: 'switch', value: t ? t.reminder : false },
    ],
    focus: !t,
    extra: t ? [{ label: 'حذف', cls: 'danger', run: () => deleteTask(t.id) }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('عنوان را وارد کنید'); return false; }
      if (v.reminder && !v.time) { toast('برای یادآوری، ساعت را مشخص کنید'); return false; }
      const o = t || T.newTask();
      const previous = new Map((o.subtasks || []).map((s) => [s.title, s]));
      Object.assign(o, {
        title, date: v.date || today(), time: v.time || '', category: v.category, priority: v.priority || 'med', repeat: v.repeat || 'none',
        subtasks: String(v.subs || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => previous.get(x) || { id: uid(), title: x, done: false }),
        note: (v.note || '').trim(), starred: !!v.starred, reminder: !!v.reminder, notified: false,
      });
      if (!t) S.tasks.push(o);
      commit();
      toast(t ? 'کار ویرایش شد' : 'کار اضافه شد');
      if (o.reminder) askNotif();
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
  const spawned = T.toggleDone(t);
  commit();
  if (t.done) toast(`آفرین! «${t.title}» انجام شد${spawned ? ` — تکرار بعدی: ${faDayMonth(parseIso(spawned.date))}` : ''}`);
}

export function quickAddTask(raw) {
  let title = raw.trim();
  if (!title) { taskSheet(); return; }
  const urgent = /!!|فوری/.test(title);
  title = title.replace(/!!/g, '').trim();
  S.tasks.push(T.newTask({ title, priority: urgent ? 'high' : 'med' }));
  commit();
  toast(`«${title}» به امروز اضافه شد`);
}

export function taskMenu(t) {
  const when = `${faDate(parseIso(t.date), { weekday: 'long', day: 'numeric', month: 'long' })}${t.time ? ` • ${fa(t.time)}` : ''}`;
  const items = t.archived
    ? [
      { icon: 'unarchive', label: 'بازگرداندن از آرشیو', run: () => { t.archived = false; commit(); toast('به فهرست برگشت'); } },
      { icon: 'delete', label: 'حذف', danger: true, run: () => deleteTask(t.id) },
    ]
    : [
      { icon: 'edit', label: 'ویرایش کامل', run: () => taskSheet(t.id) },
      {
        icon: 'flag', label: `تغییر اولویت (الان: ${T.prio(t).label})`,
        run: () => { const ks = Object.keys(T.PRIO); t.priority = ks[(ks.indexOf(t.priority || 'med') + 1) % ks.length]; commit(); toast(`اولویت: ${T.PRIO[t.priority].label}`); },
      },
      {
        icon: t.reminder ? 'notifications_off' : 'notifications_active', label: t.reminder ? 'خاموش کردن یادآور' : 'روشن کردن یادآور',
        run: () => {
          if (!t.time) { toast('اول برای این کار ساعت تعیین کنید'); taskSheet(t.id); return; }
          t.reminder = !t.reminder; t.notified = false; commit();
          if (t.reminder) askNotif();
        },
      },
      { icon: 'content_copy', label: 'تکثیر', run: () => { T.duplicateTask(t); commit(); toast('کپی ساخته شد'); } },
      {
        icon: 'event_note', label: 'افزودن به برنامه‌ریز (بلوک زمانی)',
        run: () => {
          const start = t.time || '09:00';
          const end = minToHM(Math.min(hmToMin(start) + 60, 23 * 60 + 59));
          S.blocks.push({ id: uid(), date: t.date, title: t.title, start, end, color: 'terracotta', icon: 'bolt', done: false, notify: false });
          commit();
          toast('به برنامه‌ریز اضافه شد');
        },
      },
      { icon: 'inventory_2', label: 'آرشیو', run: () => { t.archived = true; commit(); toast('به آرشیو رفت', { label: 'واگرد', run: () => { t.archived = false; commit(); } }); } },
      { icon: 'delete', label: 'حذف', danger: true, run: () => deleteTask(t.id) },
    ];
  menu(t.title, items, when);
}

export function tomorrowTask(t) {
  const base = t.date > today() ? t.date : today();
  T.moveTaskTo(t, iso(addDays(parseIso(base), 1)));
  commit();
  toast(`به ${faDayMonth(parseIso(t.date))} منتقل شد`);
}

/* ---------- habits ---------- */
export function habitSheet(id) {
  const h = id ? T.findHabit(id) : null;
  form({
    title: h ? 'ویرایش عادت' : 'عادت جدید',
    fields: [
      { name: 'title', label: 'نام عادت', value: h ? h.title : '', placeholder: 'مثلاً پیاده‌روی' },
      { name: 'icon', label: 'آیکون', type: 'chips', value: h ? h.icon : T.HABIT_ICONS[3], options: T.HABIT_ICONS.map((i) => ({ value: i, label: '', icon: i })) },
      { name: 'target', label: 'هدف روزانه', type: 'number', value: h ? h.target : 1, row: '3a' },
      { name: 'step', label: 'هر لمس', type: 'number', value: h ? h.step : 1, row: '3a' },
      { name: 'unit', label: 'واحد', value: h ? h.unit : 'بار', row: '3a' },
    ],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('نام عادت را وارد کنید'); return false; }
      const o = h || { id: uid(), log: {} };
      Object.assign(o, { title, icon: v.icon, target: Math.max(1, num(v.target)), step: Math.max(1, num(v.step)), unit: (v.unit || '').trim() });
      if (!h) S.habits.push(o);
      commit();
      toast(h ? 'عادت ویرایش شد' : 'عادت اضافه شد');
    },
  });
}

export function tapHabit(h) {
  const step = h.step || 1;
  const v = T.bumpHabit(h, step);
  commit();
  toast(`${h.title}: ${fa(v)}/${fa(h.target)}${v >= h.target ? ' ✓' : ''}`, { label: 'واگرد', run: () => { T.bumpHabit(h, -step); commit(); } });
}

export function habitMenu(h) {
  const step = h.step || 1;
  const bump = (d) => () => { T.bumpHabit(h, d); commit(); };
  menu(h.title, [
    { icon: 'add', label: `افزودن ${fa(step)} ${h.unit || ''}`, run: bump(step) },
    { icon: 'remove', label: `کم کردن ${fa(step)}`, run: bump(-step) },
    { icon: 'restart_alt', label: 'صفر کردن امروز', run: () => { h.log[today()] = 0; commit(); } },
    { icon: 'edit', label: 'ویرایش عادت', run: () => habitSheet(h.id) },
    {
      icon: 'delete', label: 'حذف عادت', danger: true,
      run: () => {
        const i = S.habits.indexOf(h);
        S.habits.splice(i, 1);
        commit();
        toast('عادت حذف شد', { label: 'واگرد', run: () => { S.habits.splice(i, 0, h); commit(); } });
      },
    },
  ], `امروز: ${fa(T.habitValue(h))} از ${fa(h.target)} ${h.unit || ''} • زنجیره ${fa(T.habitStreak(h))} روز`);
}
