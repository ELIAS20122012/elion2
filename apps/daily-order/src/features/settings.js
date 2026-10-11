/* Settings and data backup. */
import { S, commit, replaceState, resetToSample, clearAll } from '../core/store.js';
import { today } from '../core/dates.js';
import { toast } from '../ui/toast.js';
import { form, menu, confirmBox } from '../ui/sheet.js';
import { applyTheme } from '../ui/theme.js';
import { saveFile, pickFile } from '../services/files.js';

export function exportData() {
  saveFile(`daily-order-backup-${today()}.json`, JSON.stringify(S, null, 2), 'application/json', 'فایل پشتیبان آماده شد');
}

export function importData() {
  pickFile('application/json,.json', false, (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const o = JSON.parse(reader.result);
        if (!o || !o.v || !o.tasks) throw new Error('bad file');
        replaceState(o);
        applyTheme();
        toast('اطلاعات بازیابی شد');
      } catch { toast('فایل معتبر نیست'); }
    };
    reader.readAsText(file);
  });
}

function dataMenu() {
  menu('داده‌ها', [
    { icon: 'download', label: 'گرفتن نسخه پشتیبان', run: exportData },
    { icon: 'upload', label: 'بازیابی از نسخه پشتیبان', run: importData },
    { icon: 'restart_alt', label: 'بازگشت به داده‌های نمونه', run: () => confirmBox('بازگشت به داده‌های نمونه؟', 'همه اطلاعات فعلی جایگزین می‌شود.', 'بله', () => { resetToSample(); applyTheme(); }) },
    { icon: 'delete_forever', label: 'پاک کردن همه اطلاعات', danger: true, run: () => confirmBox('همه اطلاعات پاک شود؟', 'قابل بازگشت نیست.', 'پاک کن', () => { clearAll(); applyTheme(); }) },
  ]);
}

export function openSettings() {
  form({
    title: 'تنظیمات',
    fields: [
      { name: 'name', label: 'نام شما', value: S.profile.name },
      { name: 'currency', label: 'واحد پول', type: 'chips', value: S.profile.currency, options: [{ value: '€', label: '€' }, { value: '$', label: '$' }, { value: 'تومان', label: 'تومان' }] },
      { name: 'calendar', label: 'تقویم', type: 'chips', value: S.profile.calendar || 'jalali', options: [{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }] },
      { name: 'dark', label: 'حالت تاریک', type: 'switch', value: S.dark },
    ],
    extra: [{ label: 'داده‌ها…', run: dataMenu }],
    onSubmit(v) {
      Object.assign(S.profile, { name: (v.name || '').trim(), currency: v.currency, calendar: v.calendar || 'jalali' });
      S.dark = !!v.dark;
      commit();
      applyTheme();
    },
  });
}
