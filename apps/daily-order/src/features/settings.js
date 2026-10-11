/* Settings, data backup/restore and the profile summary. */
import { S, commit, replaceState, resetToSample, clearAll } from '../core/store.js';
import { today } from '../core/dates.js';
import { fa, num, money } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { form, menu, confirmBox, infoSheet } from '../ui/sheet.js';
import { applyTheme } from '../ui/theme.js';
import { saveFile, pickFile } from '../services/files.js';
import { askNotif, notifAllowed } from '../services/notify.js';
import { balance } from '../domain/finance.js';
import { streak, lastWeight } from '../domain/gym.js';

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

export function dataMenu() {
  menu('مدیریت داده‌ها', [
    { icon: 'download', label: 'گرفتن نسخه پشتیبان (JSON)', run: exportData },
    { icon: 'upload', label: 'بازیابی از فایل پشتیبان', run: importData },
    {
      icon: 'restart_alt', label: 'بازگشت به داده‌های نمونه',
      run: () => confirmBox('بازگشت به داده‌های نمونه؟', 'همه اطلاعات فعلی با داده‌های نمونه جایگزین می‌شود.', 'بله، جایگزین کن', () => { resetToSample(); applyTheme(); }),
    },
    {
      icon: 'delete_forever', label: 'پاک کردن همه اطلاعات', danger: true,
      run: () => confirmBox('همه اطلاعات پاک شود؟', 'کارها، عادت‌ها، تراکنش‌ها و سوابق ورزشی حذف می‌شوند و قابل بازگشت نیست.', 'پاک کن', () => { clearAll(); applyTheme(); }),
    },
  ]);
}

export function openSettings() {
  form({
    title: 'تنظیمات', sub: 'اطلاعات فقط روی همین دستگاه و مرورگر ذخیره می‌شوند.',
    fields: [
      { name: 'name', label: 'نام شما', value: S.profile.name },
      { name: 'currency', label: 'واحد پول', type: 'chips', value: S.profile.currency, options: [{ value: '€', label: 'یورو €' }, { value: '$', label: 'دلار $' }, { value: 'تومان', label: 'تومان' }] },
      { name: 'budget', label: 'بودجه ماهانه', type: 'number', value: S.wallet.budget, row: 'a' },
      { name: 'kcal', label: 'هدف کالری روزانه', type: 'number', value: S.gym.goals.kcal, row: 'a' },
      { name: 'calendar', label: 'تقویم (نمایش تاریخ‌ها و سررسید اقساط/قبوض)', type: 'chips', value: S.profile.calendar || 'jalali', options: [{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }] },
      { name: 'dark', label: 'حالت تاریک', type: 'switch', value: S.dark },
      { name: 'notif', label: 'اعلان یادآورها در مرورگر', type: 'switch', value: notifAllowed() },
    ],
    extra: [{ label: 'داده‌ها…', run: dataMenu }],
    onSubmit(v) {
      S.profile.name = (v.name || '').trim();
      S.profile.currency = v.currency;
      S.profile.calendar = v.calendar || 'jalali';
      S.wallet.budget = Math.max(0, num(v.budget)) || S.wallet.budget;
      S.gym.goals.kcal = Math.max(500, num(v.kcal)) || S.gym.goals.kcal;
      S.dark = !!v.dark;
      commit();
      applyTheme();
      if (v.notif && !notifAllowed()) askNotif();
      toast('تنظیمات ذخیره شد');
    },
  });
}

export function openProfile() {
  const todays = S.tasks.filter((x) => x.date === today() && !x.archived);
  const done = todays.filter((x) => x.done).length;
  const lw = lastWeight();
  const tile = (label, value) => `<div><small>${label}</small><b>${value}</b></div>`;
  infoSheet(S.profile.name ? `سلام ${S.profile.name}` : 'نمای کلی امروز',
    `<div class="stat-grid">${tile('کارهای امروز', `${fa(done)}/${fa(todays.length)}`)}${tile('موجودی کیف پول', money(balance()))}${tile('روزهای پیاپی ورزش', `${fa(streak())} روز`)}${tile('آخرین وزن', lw ? `${fa(lw.kg)} kg` : '—')}</div>`,
    [{ label: 'تنظیمات', cls: 'primary', run: openSettings }]);
}
