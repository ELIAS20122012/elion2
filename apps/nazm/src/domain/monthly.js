/* Monthly payments (electricity, internet, car installment…): a name, a monthly amount and a
   "paid this month" tick. No due dates, no loan arithmetic. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';
import { today } from '../core/dates.js';
import { currentMonthKey } from '../core/calendar.js';
import { defAcc } from './finance.js';

export const list = () => S.monthly;
export const findMonthly = (id) => S.monthly.find((m) => m.id === id);
export const isPaid = (m, mk = currentMonthKey()) => !!(m.paid && m.paid[mk]);
export const total = () => S.monthly.reduce((s, m) => s + m.amount, 0);
export const paidTotal = () => S.monthly.filter((m) => isPaid(m)).reduce((s, m) => s + m.amount, 0);
export const remainingTotal = () => total() - paidTotal();
export const remainingCount = () => S.monthly.filter((m) => !isPaid(m)).length;

export function saveMonthly(existing, { title, amount }) {
  const m = existing || { id: uid(), paid: {} };
  Object.assign(m, { title, amount });
  if (!existing) S.monthly.push(m);
  return m;
}

export function removeMonthly(id) {
  const i = S.monthly.findIndex((m) => m.id === id);
  return i < 0 ? null : { item: S.monthly.splice(i, 1)[0], index: i };
}

/** Mark this month's payment as made and record it as an expense. */
export function pay(m) {
  const mk = currentMonthKey();
  if (isPaid(m, mk)) return;
  const tx = { id: uid(), type: 'expense', amount: m.amount, category: 'bills', note: m.title, date: today(), accountId: defAcc(), monthlyId: m.id };
  S.tx.push(tx);
  m.paid = m.paid || {};
  m.paid[mk] = { txId: tx.id, date: tx.date };
}

/** Undo this month's payment and drop the expense it created. */
export function unpay(m) {
  const mk = currentMonthKey();
  const entry = m.paid && m.paid[mk];
  if (!entry) return;
  S.tx = S.tx.filter((t) => t.id !== entry.txId);
  delete m.paid[mk];
}

/** A payment's expense was deleted by hand: un-tick it. Returns what is needed to undo. */
export function detach(tx) {
  const m = tx.monthlyId && findMonthly(tx.monthlyId);
  if (!m) return null;
  const key = Object.keys(m.paid || {}).find((k) => m.paid[k].txId === tx.id);
  if (!key) return null;
  const entry = m.paid[key];
  delete m.paid[key];
  return { m, key, entry };
}
export function reattach(link) { if (link) link.m.paid[link.key] = link.entry; }
