import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { S, replaceState, migrate } from '../src/core/store.js';
import { seed, emptyState } from '../src/core/seed.js';
import { today, iso, addDays, parseIso } from '../src/core/dates.js';
import { monthKey } from '../src/core/calendar.js';
import * as fin from '../src/domain/finance.js';
import * as T from '../src/domain/tasks.js';
import * as G from '../src/domain/gym.js';

beforeEach(() => replaceState(seed()));

/* ---------- store ---------- */
test('seed produces a complete, self-consistent document', () => {
  ['tasks', 'habits', 'blocks', 'tx', 'accounts', 'monthly', 'gym', 'weekly', 'ui'].forEach((k) => assert.ok(S[k] !== undefined, k));
  assert.ok(S.accounts.length >= 2);
});

test('migrate upgrades the old layout (ui memory moved under S.ui)', () => {
  const old = emptyState();
  delete old.accounts; delete old.ui;
  old.wallet.accOpen = 'loans'; old.wallet.accSub = { 'g-week': true };
  old.ui = { tasksOpen: 'habits', tasksSub: { 't-over': false } };
  old.tasks = [{ id: 'a', title: 'x', date: today(), done: false }];
  const m = migrate(old);
  assert.equal(m.accounts.length, 2);
  assert.equal(m.ui.open.wallet, 'loans');
  assert.equal(m.ui.open.tasks, 'habits');
  assert.deepEqual(m.ui.sub, { 'g-week': true, 't-over': false });
  assert.equal(m.tasks[0].priority, 'med');
  assert.equal(m.wallet.accOpen, undefined);
});

/* ---------- finance ---------- */
test('account balances combine income and expense; the total is their sum', () => {
  replaceState(emptyState());
  S.accounts.push({ id: 'cash', name: 'نقد', type: 'cash', opening: 20 });
  S.accounts[0].opening = 100;
  fin.saveTx(null, { type: 'income', amount: 50, category: 'salary', note: '', date: today(), accountId: 'main' });
  fin.saveTx(null, { type: 'expense', amount: 30, category: 'food', note: '', date: today(), accountId: 'cash' });
  assert.equal(fin.accBalance('main'), 150);
  assert.equal(fin.accBalance('cash'), -10);
  assert.equal(fin.balance(), 140);
});

test('ledger filters by month, type and text', () => {
  const month = monthKey(today());
  const rows = fin.ledgerRows({ month, type: 'expense' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((t) => t.type === 'expense' && monthKey(t.date) === month));
  assert.equal(fin.ledgerRows({ month, q: 'zzz-no-match' }).length, 0);
  assert.ok(fin.ledgerRows({ month, acc: 'cash' }).every((t) => fin.txAccount(t) === 'cash'));
});

/* ---------- tasks ---------- */
test('today buckets: overdue and today open, done today, future later', () => {
  S.tasks = [
    T.newTask({ title: 'late', date: iso(addDays(new Date(), -2)) }),
    T.newTask({ title: 'now' }),
    T.newTask({ title: 'finished', done: true, doneAt: today() }),
    T.newTask({ title: 'old finished', done: true, doneAt: iso(addDays(new Date(), -3)) }),
    T.newTask({ title: 'next week', date: iso(addDays(new Date(), 7)) }),
    T.newTask({ title: 'archived', archived: true }),
  ];
  const b = T.todayBuckets();
  assert.deepEqual(b.open.map((t) => t.title), ['late', 'now']);
  assert.deepEqual(b.done.map((t) => t.title), ['finished']);
  assert.deepEqual(b.later.map((t) => t.title), ['next week']);
  assert.equal(b.total, 3);
});

test('tasks sort: open before done, then date, then time', () => {
  const a = T.newTask({ title: 'a', time: '09:00' });
  const b = T.newTask({ title: 'b', time: '10:00' });
  const c = T.newTask({ title: 'c', done: true });
  const d = T.newTask({ title: 'd', date: iso(addDays(new Date(), -1)) });
  assert.deepEqual([c, b, a, d].sort(T.sortTasks).map((t) => t.title), ['d', 'a', 'b', 'c']);
});

test('toggling a task records when it was finished; removal can be undone by index', () => {
  const t = T.newTask({ title: 'x' });
  S.tasks.push(t);
  T.toggleDone(t);
  assert.equal(t.done, true);
  assert.equal(t.doneAt, today());
  T.toggleDone(t);
  assert.equal(t.doneAt, null);
  const removed = T.removeTask(t.id);
  assert.equal(removed.task, t);
  assert.equal(T.findTask(t.id), undefined);
});

test('habit counters and streaks', () => {
  const h = S.habits[0];
  h.log = {};
  assert.equal(T.habitDone(h), false);
  T.bumpHabit(h, h.target);
  assert.equal(T.habitDone(h), true);
  T.bumpHabit(h, -999);
  assert.equal(T.habitValue(h), 0);
  h.log[iso(addDays(new Date(), -1))] = h.target;
  h.log[iso(addDays(new Date(), -2))] = h.target;
  assert.equal(T.habitStreak(h), 2);
});

/* ---------- gym ---------- */
test('plan lines parse into exercises with units', () => {
  const list = G.parsePlan('اسکوات | 4 | 10 | 60 kg\nتردمیل | 1 | 25 | دقیقه\n\nپلانک | 3 | 45 | ثانیه');
  assert.equal(list.length, 3);
  assert.deepEqual([list[0].sets, list[0].reps, list[0].unit, list[0].weight], [4, '10', 'تکرار', '60 kg']);
  assert.equal(list[1].unit, 'دقیقه');
  assert.equal(list[2].unit, 'ثانیه');
  assert.equal(G.parsePlan('x | 99 | 5 | 1 kg')[0].sets, 10); // clamped
});

test('streak counts consecutive active days ending today or yesterday', () => {
  S.gym.sessions = {};
  assert.equal(G.streak(), 0);
  for (let i = 1; i <= 3; i++) S.gym.sessions[iso(addDays(new Date(), -i))] = { finished: true, exercises: [] };
  assert.equal(G.streak(), 3);
  S.gym.sessions[today()] = { finished: false, exercises: [{ sets: 3, done: 1 }] };
  assert.equal(G.streak(), 4);
});

test('timer accumulates minutes and finishing stops it', () => {
  const s = G.session(today(), true);
  S.gym.timerStart = Date.now() - 5 * 60000;
  assert.equal(G.sessionMinutes(s), (s.minutes || 0) + 5);
  G.finishSession(s);
  assert.equal(S.gym.timerStart, null);
  assert.ok(s.finished && s.minutes >= 5);
});

test('meal totals and weight change', () => {
  S.gym.meals[today()] = [];
  G.addMeal({ name: 'a', kcal: 100, p: 10, c: 20, f: 5 });
  G.addMeal({ name: 'b', kcal: 250, p: 1, c: 2, f: 3 });
  assert.deepEqual(G.sumMeals(G.mealsOn()), { kcal: 350, p: 11, c: 22, f: 8 });
  S.gym.weights = [{ date: iso(addDays(new Date(), -30)), kg: 80 }];
  G.setWeight(today(), 77.5);
  assert.equal(G.weightChange(30), -2.5);
  G.setWeight(today(), 78);
  assert.equal(S.gym.weights.length, 2); // same-day entry is replaced
});

test('a day opened for the first time is built from that weekday plan', () => {
  S.gym.sessions = {};
  const sat = iso(addDays(new Date(), -((new Date().getDay() + 1) % 7))); // this week's Saturday (≤ today)
  S.gym.weekly = { 6: { name: 'سینه', items: 'پرس | 4 | 10 | 30 kg\nشنا | 3 | 15' } };
  const s = G.sessionFromPlan(sat);
  assert.equal(s.name, 'سینه');
  assert.equal(s.exercises.length, 2);
  assert.equal(G.sessionFromPlan(sat), s, 'second call reuses the session');
  // any day of the week works, including days still ahead
  const future = iso(addDays(new Date(), 3));
  S.gym.weekly[parseIso(future).getDay()] = { name: 'بعدی', items: 'a | 1 | 1' };
  assert.equal(G.sessionFromPlan(future).exercises.length, 1);
  // a day without a plan stays empty
  S.gym.weekly = {};
  assert.equal(G.sessionFromPlan(iso(addDays(new Date(), 5))), undefined);
});

test('editing the plan re-applies it only to a day without progress', () => {
  const day = today();
  const wd = new Date().getDay();
  S.gym.weekly = { [wd]: { name: 'قدیم', items: 'الف | 3 | 10' } };
  S.gym.sessions = {};
  const s = G.sessionFromPlan(day);
  S.gym.weekly[wd] = { name: 'جدید', items: 'ب | 2 | 8\nج | 2 | 8' };
  G.resyncSessionWithPlan(day);
  assert.deepEqual(s.exercises.map((e) => e.name), ['ب', 'ج']);
  s.exercises[0].done = 1;
  S.gym.weekly[wd] = { name: 'سوم', items: 'د | 1 | 1' };
  G.resyncSessionWithPlan(day);
  assert.deepEqual(s.exercises.map((e) => e.name), ['ب', 'ج'], 'progress is never overwritten');
});

test('meals are stored per day', () => {
  const other = iso(addDays(new Date(), -2));
  G.addMeal({ name: 'x', kcal: 400, p: 0, c: 0, f: 0, photo: 'data:' }, other);
  assert.equal(G.sumMeals(G.mealsOn(other)).kcal, 400);
  assert.equal(G.mealsOn(other)[0].photo, 'data:');
});

/* ---------- new sections: repeat, appointments, shopping, budgets ---------- */
import * as A from '../src/domain/appointments.js';
import * as MO from '../src/domain/monthly.js';
import { fromLegacy } from '../src/core/legacy.js';
import * as SH from '../src/domain/shopping.js';

test('completing a daily/weekly task creates the next one exactly once', () => {
  const t = T.newTask({ title: 'ورزش صبحگاهی', repeat: 'daily' });
  S.tasks.push(t);
  const next = T.toggleDone(t);
  assert.equal(next.date, iso(addDays(new Date(), 1)));
  assert.equal(next.done, false);
  T.toggleDone(t); // reopen
  assert.equal(T.toggleDone(t), null, 'no duplicate on second completion');
  const w = T.newTask({ title: 'هفتگی', repeat: 'weekly' }); S.tasks.push(w);
  assert.equal(T.toggleDone(w).date, iso(addDays(new Date(), 7)));
  const once = T.newTask({ title: 'یک‌بار' }); S.tasks.push(once);
  assert.equal(T.toggleDone(once), null);
  assert.ok(T.tasksOn(next.date).some((x) => x.id === next.id));
});

test('appointments are sorted and the next one skips the past', () => {
  S.appointments = [];
  const past = A.saveAppt(null, { title: 'گذشته', kind: 'visit', date: iso(addDays(new Date(), -1)), time: '10:00' });
  const later = A.saveAppt(null, { title: 'بعدتر', kind: 'meet', date: iso(addDays(new Date(), 2)), time: '09:00', place: 'کافه' });
  const sooner = A.saveAppt(null, { title: 'زودتر', kind: 'meeting', date: iso(addDays(new Date(), 1)), time: '18:00' });
  assert.equal(A.nextAppointment().id, sooner.id);
  assert.deepEqual(A.upcoming().map((a) => a.id), [sooner.id, later.id]);
  assert.deepEqual(A.on(past.date).map((a) => a.id), [past.id]);
  assert.equal(A.kindOf(later).label, 'ملاقات');
  const r = A.removeAppt(later.id);
  assert.equal(S.appointments.includes(r.appt), false);
  S.appointments.splice(r.index, 0, r.appt);
  assert.equal(A.findAppt(later.id).place, 'کافه');
});

test('shopping list: add, tick, order and clear bought items', () => {
  S.shopping = [];
  const apple = SH.addItem('  سیب ');
  const milk = SH.addItem('شیر');
  SH.addItem('نان');
  assert.equal(apple.title, 'سیب');
  assert.equal(SH.remaining(), 3);
  apple.done = true;
  assert.equal(SH.remaining(), 2);
  assert.deepEqual(SH.ordered().map((i) => i.title), ['شیر', 'نان', 'سیب'], 'bought items sink to the end');
  assert.equal(SH.boughtCount(), 1);
  assert.equal(SH.clearBought(), 1);
  assert.deepEqual(S.shopping.map((i) => i.id).includes(milk.id), true);
  assert.equal(S.shopping.length, 2);
});

test('budgets: remaining, per-category rows and top category', () => {
  S.wallet.budget = 1000;
  S.wallet.catBudgets = { food: 100 };
  S.tx = [
    { id: 'a', type: 'expense', amount: 150, category: 'food', date: today() },
    { id: 'b', type: 'expense', amount: 400, category: 'shopping', date: today() },
    { id: 'c', type: 'income', amount: 900, category: 'salary', date: today() },
  ];
  assert.equal(fin.budgetLeft(), 450);
  const rows = fin.categoryBudgetRows();
  assert.deepEqual(rows.map((r) => [r.key, r.spent, r.budget]), [['shopping', 400, 0], ['food', 150, 100]].sort((x, y) => fin.EXP_CATS.indexOf(x[0]) - fin.EXP_CATS.indexOf(y[0])));
  assert.deepEqual(fin.topExpenseCategory(), { key: 'shopping', amount: 400 });
  S.tx = [];
  assert.equal(fin.topExpenseCategory(), null);
});

test('migrate gives old documents the new collections', () => {
  const old = emptyState();
  delete old.appointments; delete old.shopping; delete old.wallet.catBudgets;
  const m = migrate(old);
  assert.deepEqual([m.appointments, m.shopping, m.wallet.catBudgets], [[], [], {}]);
});

/* ---------- monthly payments (replace loans & bills) ---------- */
test('seed has plain monthly payments and no loan/bill collections', () => {
  assert.ok(S.monthly.length >= 3);
  assert.equal(S.loans, undefined);
  assert.equal(S.bills, undefined);
});

test('ticking a monthly payment records an expense; unticking removes it', () => {
  S.tx = []; S.monthly = [];
  const m = MO.saveMonthly(null, { title: 'برق', amount: 50 });
  assert.equal(MO.remainingTotal(), 50);
  MO.pay(m);
  assert.equal(MO.isPaid(m), true);
  assert.equal(MO.paidTotal(), 50);
  assert.equal(MO.remainingCount(), 0);
  assert.equal(S.tx.length, 1);
  assert.deepEqual([S.tx[0].type, S.tx[0].amount, S.tx[0].note, S.tx[0].monthlyId], ['expense', 50, 'برق', m.id]);
  MO.pay(m); // second tick in the same month does nothing
  assert.equal(S.tx.length, 1);
  MO.unpay(m);
  assert.equal(MO.isPaid(m), false);
  assert.equal(S.tx.length, 0);
});

test('the tick resets every month (paid state is keyed by month)', () => {
  const m = MO.saveMonthly(null, { title: 'اینترنت', amount: 35 });
  m.paid = { '1999-01': { txId: 'x', date: '1999-01-05' } };
  assert.equal(MO.isPaid(m), false);
  assert.equal(MO.isPaid(m, '1999-01'), true);
});

test('deleting a payment expense by hand un-ticks the month, and undo ticks it again', () => {
  S.tx = []; S.monthly = [];
  const m = MO.saveMonthly(null, { title: 'اجاره', amount: 600 });
  MO.pay(m);
  const undo = fin.deleteTx(S.tx[0].id);
  const link = MO.detach(undo.tx);
  assert.equal(MO.isPaid(m), false);
  fin.restoreTx(undo); MO.reattach(link);
  assert.equal(MO.isPaid(m), true);
  assert.equal(S.tx.length, 1);
});

test('legacy loans and bills fold into monthly payments (finished loans and paused bills are skipped)', () => {
  const out = fromLegacy({
    loans: [{ title: 'قسط ماشین', amount: 250, count: 24, paid: {} }, { title: 'تمام‌شده', amount: 10, count: 1, paid: { 1: {} } }],
    bills: [{ title: 'برق', amount: 95, every: 2, paid: {} }, { title: 'متوقف', amount: 5, every: 1, paused: true, paid: {} }, { title: 'اینترنت', amount: 30, every: 1, paid: { a: { amount: 40 }, b: { amount: 20 } } }],
  });
  assert.deepEqual(out.map((m) => [m.title, m.amount]), [['قسط ماشین', 250], ['برق', 47.5], ['اینترنت', 30]]);
  const doc = emptyState(); delete doc.monthly; doc.loans = [{ title: 'x', amount: 5, count: 3, paid: {} }];
  assert.equal(migrate(doc).monthly[0].title, 'x');
  const had = emptyState(); had.monthly = [{ id: 'k', title: 'k', amount: 1, paid: {} }];
  assert.equal(migrate(had).monthly.length, 1, 'existing monthly list is kept');
});
