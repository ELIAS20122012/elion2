/* Profile settings and data backup. */
import { S, commit, replaceState, resetToSample, clearAll } from '../core/store.js';
import { today } from '../core/dates.js';
import { toast } from '../ui/toast.js';
import { form, menu, confirmBox } from '../ui/sheet.js';
import { weightSheet, goalSheet } from './gym-sheets.js';
import { saveFile, pickFile } from '../services/files.js';
import { getGeminiKey, setGeminiKey } from '../services/ai.js';

export function exportData() {
  saveFile(`nazm-backup-${today()}.json`, JSON.stringify(S, null, 2), 'application/json', 'فایل پشتیبان آماده شد');
}

export function importData() {
  pickFile('application/json,.json', false, (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const o = JSON.parse(reader.result);
        if (!o || !o.v || !o.tasks) throw new Error('bad file');
        replaceState(o);
        toast('اطلاعات بازیابی شد');
      } catch { toast('فایل معتبر نیست'); }
    };
    reader.readAsText(file);
  });
}

export const confirmSample = () => confirmBox('بازگشت به داده‌های نمونه؟', 'همه اطلاعات فعلی جایگزین می‌شود.', 'بله', resetToSample);
export const confirmClear = () => confirmBox('همه اطلاعات پاک شود؟', 'قابل بازگشت نیست.', 'پاک کن', clearAll);

export function openSettings() {
  form({
    title: 'تنظیمات',
    fields: [
      { name: 'name', label: 'نام شما', value: S.profile.name },
      { name: 'currency', label: 'واحد پول', type: 'chips', value: S.profile.currency, options: [{ value: '€', label: '€' }, { value: '$', label: '$' }, { value: 'تومان', label: 'تومان' }] },
      { name: 'calendar', label: 'تقویم', type: 'chips', value: S.profile.calendar || 'jalali', options: [{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }] },
      { name: 'gemini', label: 'کلید Gemini (برای تشخیص کالری از عکس غذا)', value: getGeminiKey(), placeholder: 'AIza…' },
    ],
    onSubmit(v) {
      Object.assign(S.profile, { name: (v.name || '').trim(), currency: v.currency, calendar: v.calendar || 'jalali' });
      setGeminiKey(v.gemini || '');
      commit();
    },
  });
}

/** Profile menu: body numbers and data (opened from the avatar at the top). */
export function openProfile() {
  menu(S.profile.name ? `سلام ${S.profile.name}` : 'پروفایل', [
    { icon: 'monitor_weight', label: 'ثبت وزن', run: weightSheet },
    { icon: 'local_fire_department', label: 'اهداف کالری و پروتئین', run: goalSheet },
    { icon: 'download', label: 'گرفتن نسخه پشتیبان', run: exportData },
    { icon: 'upload', label: 'بازیابی از نسخه پشتیبان', run: importData },
    { icon: 'restart_alt', label: 'بازگشت به داده‌های نمونه', run: confirmSample },
    { icon: 'delete', label: 'پاک کردن همه اطلاعات', danger: true, run: confirmClear },
  ]);
}
