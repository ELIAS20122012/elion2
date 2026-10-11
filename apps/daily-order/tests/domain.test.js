import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { S, replaceState, migrate } from '../src/core/store.js';
import { seed, emptyState } from '../src/core/seed.js';
import { today, iso, addDays } from '../src/core/dates.js';
import { monthKey } from '../src/core/calendar.js';
import * as fin from '../src/domain/finance.js';
import * as T from '../src/domain/tasks.js';
import * as G from '../src/domain/gym.js';
import * as P from '../src/domain/planner.js';

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
test('completing a repeating task spawns the next occurrence once', () => {
  const t = T.newTask({ title: 'daily', repeat: 'daily', subtasks: [{ id: 's', title: 'a', done: true }] });
  S.tasks.push(t);
  const next = T.toggleDone(t);
  assert.ok(next);
  assert.equal(next.date, iso(addDays(new Date(), 1)));
  assert.equal(next.subtasks[0].done, false);
  assert.equal(t.spawnedNext, next.id);
  T.toggleDone(t); // reopen
  assert.equal(T.toggleDone(t), null); // already spawned: no duplicate
});

test('tasks sort: open before done, by date, priority then time', () => {
  const a = T.newTask({ title: 'a', priority: 'low', time: '09:00' });
  const b = T.newTask({ title: 'b', priority: 'high', time: '10:00' });
  const c = T.newTask({ title: 'c', done: true });
  assert.deepEqual([c, a, b].sort(T.sortTasks).map((t) => t.title), ['b', 'a', 'c']);
});

test('overdue tasks can be pushed to today and done tasks archived', () => {
  const od = T.newTask({ title: 'old', date: iso(addDays(new Date(), -3)) });
  S.tasks.push(od);
  assert.equal(T.taskBuckets().overdue.includes(od), true);
  T.pushOverdueToToday();
  assert.equal(od.date, today());
  S.tasks.forEach((t) => { t.done = true; });
  assert.ok(T.archiveDone() > 0);
  assert.equal(T.activeTasks().length, 0);
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

test('weekly review lines become unique high-priority tasks', () => {
  const ws = T.currentWeek();
  T.editReview(ws).next = '- پروژه اول\n2) پروژه دوم\n';
  const first = T.reviewToTasks(ws);
  assert.equal(first.added, 2);
  assert.equal(T.reviewToTasks(ws).added, 0);
  T.editReview(ws).next = '';
  assert.equal(T.reviewToTasks(ws), null);
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

/* ---------- planner ---------- */
test('block overlap detection and slot defaults', () => {
  const f = { date: today(), start: '09:30', end: '10:00' };
  const clash = P.clashWith(f);
  assert.ok(clash, 'seed has a 09:00–10:30 block today');
  assert.equal(P.clashWith({ date: today(), start: '10:30', end: '11:00' }), undefined);
  assert.deepEqual(P.defaultSlot(9 * 60 + 5), { start: '09:30', end: '10:30' });
  const copy = P.duplicateToNextDay(S.blocks[0]);
  assert.equal(copy.date, iso(addDays(new Date(), 1)));
  assert.equal(copy.done, false);
});
