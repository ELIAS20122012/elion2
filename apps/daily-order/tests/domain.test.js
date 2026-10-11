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
  ['tasks', 'habits', 'blocks', 'tx', 'accounts', 'loans', 'bills', 'gym', 'weekly', 'ui'].forEach((k) => assert.ok(S[k] !== undefined, k));
  assert.ok(S.accounts.length >= 2);
  assert.equal(S.loans[0].count, 24);
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
test('account balances combine income, expense and transfers', () => {
  replaceState(emptyState());
  S.accounts.push({ id: 'cash', name: 'نقد', type: 'cash', opening: 0 });
  S.accounts[0].opening = 100;
  fin.saveTx(null, { type: 'income', amount: 50, category: 'salary', note: '', date: today(), accountId: 'main' });
  fin.saveTx(null, { type: 'expense', amount: 30, category: 'food', note: '', date: today(), accountId: 'main' });
  fin.saveTransfer(null, { amount: 20, from: 'main', to: 'cash', note: '', date: today() });
  assert.equal(fin.accBalance('main'), 100);
  assert.equal(fin.accBalance('cash'), 20);
  assert.equal(fin.balance(), 120); // transfers do not change the total
});

test('paying an installment records an expense and links both ways', () => {
  const loan = S.loans[0];
  const n = fin.loanNextN(loan);
  const left = fin.payObligation({ kind: 'loan', ref: loan, n, due: fin.loanDue(loan, n) }, { amount: 250, date: today(), accountId: 'main', record: true });
  assert.equal(left, loan.count - fin.loanPaidCount(loan));
  const tx = S.tx.find((t) => t.loanId === loan.id && t.loanN === n);
  assert.ok(tx);
  assert.equal(loan.paid[n].txId, tx.id);

  // deleting the expense un-pays the installment; undo restores both
  const undo = fin.deleteTx(tx.id);
  assert.ok(!loan.paid[n]);
  fin.restoreTx(undo);
  assert.equal(loan.paid[n].txId, tx.id);

  // cancelling the payment removes the expense too
  fin.cancelPayment(loan, n);
  assert.ok(!S.tx.some((t) => t.id === tx.id));
});

test('settling a loan marks every remaining installment paid', () => {
  const loan = S.loans[0];
  fin.settleLoan(loan, 5000, today());
  assert.equal(fin.loanNextN(loan), null);
  assert.equal(fin.loanRemaining(loan), 0);
  assert.ok(S.tx.some((t) => t.note.startsWith('تسویه کامل')));
});

test('editing a linked transaction keeps the payment entry in sync', () => {
  const bill = S.bills[1];
  const nx = fin.billNext(bill);
  fin.payObligation({ kind: 'bill', ref: bill, due: nx.due, amount: 35 }, { amount: 35, date: today(), record: true });
  const tx = S.tx.find((t) => t.billId === bill.id);
  fin.saveTx(tx, { type: 'expense', amount: 41, category: 'bills', note: tx.note, date: tx.date, accountId: tx.accountId });
  assert.equal(bill.paid[nx.due].amount, 41);
  assert.equal(fin.billAvg(bill), 41);
});

test('dueItems lists overdue first and respects paused bills', () => {
  const items = fin.dueItems(60);
  assert.ok(items.length > 0);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].due <= items[i].due);
  const before = items.filter((d) => d.kind === 'bill').length;
  S.bills.forEach((b) => { b.paused = true; });
  assert.equal(fin.dueItems(60).filter((d) => d.kind === 'bill').length, 0);
  assert.ok(before > 0);
  const b = fin.dueBuckets();
  assert.equal(b.over.length + b.week.length + b.month.length + b.later.length, b.items.length);
});

test('ledger filters by month, type and text', () => {
  const month = monthKey(today());
  const rows = fin.ledgerRows({ month, type: 'expense' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((t) => t.type === 'expense' && monthKey(t.date) === month));
  assert.equal(fin.ledgerRows({ month, q: 'zzz-no-match' }).length, 0);
  assert.ok(fin.ledgerRows({ month, acc: 'cash' }).every((t) => fin.txAccount(t) === 'cash'));
});

test('reconcile creates the difference as an adjusting transaction', () => {
  const acc = S.accounts[0];
  const cur = fin.accBalance(acc.id);
  assert.equal(fin.reconcileAccount(acc, cur), false);
  assert.equal(fin.reconcileAccount(acc, cur + 10), true);
  assert.equal(fin.accBalance(acc.id), cur + 10);
});

test('deleting an account is blocked while it has transactions', () => {
  assert.equal(fin.accountInUse(S.accounts[0]), true);
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
