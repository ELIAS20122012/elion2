/* Sample data for a fresh install, plus the empty skeleton used by "clear all data". */
import { uid } from './util.js';
import { iso, addDays, pad } from './dates.js';
import { toJ, fromJ } from './jalali.js';
import { addMonthsIso, dayOfMonth, useJ } from './calendar.js';

export const STATE_VERSION = 2;

export function emptyState() {
  return {
    v: STATE_VERSION, privacy: false,
    profile: { name: '', currency: '€', calendar: 'jalali' },
    tasks: [], habits: [], blocks: [], plannerHideDone: false, appointments: [], shopping: [],
    wallet: { startBalance: 0, budget: 1500, alerts: true, quickSet: 0 },
    accounts: [{ id: 'main', name: 'حساب اصلی', type: 'bank', opening: 0 }],
    loans: [], bills: [], tx: [],
    gym: {
      goals: { kcal: 2400, p: 160, c: 230, f: 65 }, weekly: {}, sessions: {}, meals: {},
      lastScan: null, weights: [], tab: 'workout', view: 'daily', timerStart: null,
    },
    weekly: {}, ui: { open: {}, sub: {} },
  };
}

export function seed() {
  const t = new Date();
  const d = (n) => iso(addDays(t, n));

  /* ---- wallet ---- */
  const tx = [];
  const spend = [5, 10, 26, 20, 48, 32, 14];
  const cats = ['cafe', 'shopping', 'food', 'transport', 'shopping', 'bills', 'cafe'];
  spend.forEach((amount, i) => tx.push({ id: uid(), type: 'expense', amount, category: cats[i], note: '', date: d(-i) }));
  const monthStart = iso(new Date(t.getFullYear(), t.getMonth(), 1));
  tx.push(
    { id: uid(), type: 'income', amount: 1200, category: 'salary', note: 'حقوق', date: monthStart },
    { id: uid(), type: 'income', amount: 1150, category: 'salary', note: 'حقوق ماه قبل', date: d(-31) },
    { id: uid(), type: 'expense', amount: 85, category: 'bills', note: 'قبض اینترنت', date: d(-12) },
    { id: uid(), type: 'expense', amount: 60, category: 'food', note: 'خرید هفتگی', date: d(-16) },
    { id: uid(), type: 'income', amount: 1150, category: 'salary', note: 'حقوق', date: d(-39) },
    { id: uid(), type: 'expense', amount: 640, category: 'bills', note: 'اجاره', date: d(-35) },
  );

  /* ---- loans & bills: due dates follow the active calendar ---- */
  const t0 = d(0);
  const dueOn = (months, day) => {
    const x = addMonthsIso(t0, months);
    return useJ() ? fromJ(toJ(x).jy, toJ(x).jm, day) : `${x.slice(0, 8)}${pad(day)}`;
  };
  const cur = dayOfMonth(t0);
  const soon = (offset, fallbackDay) => (cur + offset > 28 ? dueOn(1, fallbackDay) : dueOn(0, cur + offset));
  const loan = { id: uid(), title: 'وام خرید خودرو', lender: 'بانک', amount: 250, count: 24, start: dueOn(-5, 15), every: 1, accountId: 'main', remind: true, paid: {} };
  for (let n = 1; n <= 5; n++) loan.paid[n] = { date: addMonthsIso(loan.start, n - 1), amount: 250, txId: null, before: true };
  const bills = [
    { id: uid(), kind: 'rent', title: 'اجاره خانه', amount: 640, every: 1, start: dueOn(0, 1), accountId: 'main', remind: true, paid: {} },
    { id: uid(), kind: 'internet', title: 'اینترنت خانه', amount: 35, every: 1, start: soon(2, 2), accountId: 'main', remind: true, paid: {} },
    { id: uid(), kind: 'electricity', title: 'قبض برق و گاز', amount: 95, every: 2, start: dueOn(0, Math.min(28, cur + 6 > 28 ? 28 : cur + 6)), accountId: 'main', remind: true, paid: {} },
    { id: uid(), kind: 'mobile', title: 'قبض موبایل', amount: 15, every: 1, start: soon(12, 5), accountId: 'cash', remind: true, paid: {} },
  ];
  bills[0].paid[bills[0].start] = { date: bills[0].start, amount: 640, txId: null, before: true };

  /* ---- gym ---- */
  const weights = [];
  for (let i = 30; i >= 0; i--) weights.push({ date: d(-i), kg: Math.round((76.5 + i * 0.105 + (i % 3 === 0 ? 0.1 : 0)) * 10) / 10 });
  weights[weights.length - 1].kg = 76.5;
  const sessions = {};
  for (let j = 1; j <= 4; j++) {
    sessions[d(-j)] = { name: 'تمرین', minutes: 45, finished: true, exercises: [{ id: uid(), name: 'تمرین عمومی', sets: 4, reps: '12', weight: '', done: 4 }] };
  }
  sessions[d(0)] = {
    name: 'بالاتنه و میان‌تنه', minutes: 0, target: 45, finished: false,
    exercises: [
      { id: uid(), name: 'پرس سینه دمبل', sets: 4, reps: '10', unit: 'تکرار', weight: '30 kg', done: 4 },
      { id: uid(), name: 'زیربغل قایقی سیم‌کش', sets: 3, reps: '12', unit: 'تکرار', weight: '45 kg', done: 2 },
      { id: uid(), name: 'پلانک و کرانچ شکم', sets: 3, reps: '45', unit: 'ثانیه', weight: 'وزن بدن', done: 0 },
    ],
  };

  return {
    v: STATE_VERSION, privacy: false,
    profile: { name: 'الیاس', currency: '€', calendar: 'jalali' },
    tasks: [
      { id: uid(), title: 'بررسی کدهای هفتگی تیم طراحی', date: d(0), time: '10:00', category: 'work', priority: 'high', starred: true, done: false, archived: false, reminder: false, note: 'پروژه داشبورد' },
      { id: uid(), title: 'ارسال گزارش مالی ماهانه به حسابدار', date: d(0), time: '14:30', category: 'finance', priority: 'med', starred: false, done: true, archived: false, reminder: false, note: 'امور مالی' },
      { id: uid(), title: 'تمرین هوازی و پیاده‌روی سریع', date: d(0), time: '19:00', category: 'health', priority: 'med', starred: false, done: false, archived: false, reminder: true, note: 'سلامت' },
      { id: uid(), title: 'تمدید اشتراک باشگاه', date: d(1), time: '12:00', category: 'personal', priority: 'low', starred: false, done: false, archived: false, reminder: false, note: '' },
    ],
    habits: [
      { id: uid(), title: 'نوشیدن آب', icon: 'local_drink', target: 8, step: 1, unit: 'لیوان', log: { [d(0)]: 6 } },
      { id: uid(), title: 'مطالعه کتاب', icon: 'menu_book', target: 20, step: 5, unit: 'دقیقه', log: { [d(0)]: 20 } },
      { id: uid(), title: 'مدیتیشن', icon: 'self_improvement', target: 1, step: 1, unit: 'بار', log: { [d(0)]: 1 } },
    ],
    blocks: [
      { id: uid(), date: d(0), title: 'کار عمیق', start: '09:00', end: '10:30', color: 'terracotta', icon: 'bolt', done: false, notify: false },
      { id: uid(), date: d(0), title: 'جلسه و بازبینی', start: '11:30', end: '12:45', color: 'slate', icon: 'groups', done: false, notify: false },
      { id: uid(), date: d(0), title: 'استراحت و شارژ', start: '16:00', end: '17:00', color: 'sage', icon: 'spa', done: false, notify: true },
      { id: uid(), date: d(1), title: 'برنامه‌ریزی هفته', start: '10:00', end: '11:00', color: 'slate', icon: 'event_note', done: false, notify: false },
    ],
    plannerHideDone: false,
    appointments: [
      { id: uid(), title: 'دندان‌پزشکی', kind: 'visit', date: d(1), time: '10:30', place: 'کلینیک مرکزی' },
      { id: uid(), title: 'جلسه‌ی تیم طراحی', kind: 'meeting', date: d(0), time: '17:00', place: 'آنلاین' },
      { id: uid(), title: 'ملاقات با دوست', kind: 'meet', date: d(3), time: '19:30', place: 'کافه' },
    ],
    shopping: [
      { id: uid(), title: 'سیب', cat: 'produce', done: false },
      { id: uid(), title: 'ماست', cat: 'dairy', done: false },
      { id: uid(), title: 'نان سنگک', cat: 'bakery', done: true },
      { id: uid(), title: 'مرغ', cat: 'meat', done: false },
    ],
    wallet: { startBalance: 0, budget: 1500, alerts: true, quickSet: 0, catBudgets: { food: 300, shopping: 200, transport: 100 } },
    accounts: [
      { id: 'main', name: 'حساب بانکی', type: 'bank', opening: 0 },
      { id: 'cash', name: 'کیف پول نقد', type: 'cash', opening: 0 },
    ],
    loans: [loan], bills, tx,
    gym: {
      goals: { kcal: 2400, p: 160, c: 230, f: 65 },
      weekly: {
        6: { name: 'بالاتنه و میان‌تنه', items: 'پرس سینه دمبل | 4 | 10 | 30 kg\nزیربغل قایقی سیم‌کش | 3 | 12 | 45 kg\nپلانک و کرانچ شکم | 3 | 45 | وزن بدن' },
        1: { name: 'پایین‌تنه', items: 'اسکوات | 4 | 10 | 60 kg\nلانژ دمبل | 3 | 12 | 14 kg\nپرس پا | 3 | 12 | 100 kg' },
        3: { name: 'کاردیو و شکم', items: 'تردمیل | 1 | 25 | دقیقه\nکرانچ | 3 | 20 | وزن بدن' },
      },
      sessions,
      meals: {
        [d(0)]: [
          { id: uid(), name: 'صبحانه', kcal: 450, p: 25, c: 55, f: 14 },
          { id: uid(), name: 'ناهار', kcal: 900, p: 70, c: 95, f: 26 },
          { id: uid(), name: 'میان‌وعده', kcal: 500, p: 40, c: 40, f: 15 },
        ],
      },
      lastScan: { name: 'سینه مرغ گریل + کینوا', kcal: 420, p: 42, c: 38, f: 9, photo: null, added: false },
      weights, tab: 'workout', view: 'daily', timerStart: null,
    },
    weekly: {}, ui: { open: {}, sub: {} },
  };
}
