/* Money: accounts, ledger, installments, recurring bills and what is due. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid, sum } from '../core/util.js';
import { today } from '../core/dates.js';
import { total as monthlyTotal } from './monthly.js';
import { monthKey, shiftMonthKey, currentMonthKey } from '../core/calendar.js';

/* ---------- catalogues ---------- */
export const TXCAT = {
  shopping: { label: 'خرید', icon: 'shopping_cart' }, bills: { label: 'قبوض و کارت', icon: 'credit_card' },
  cafe: { label: 'کافه', icon: 'local_cafe' }, food: { label: 'خوراک', icon: 'restaurant' },
  transport: { label: 'حمل‌ونقل', icon: 'directions_car' }, sport: { label: 'ورزش', icon: 'fitness_center' },
  travel: { label: 'سفر', icon: 'flight' }, health: { label: 'سلامت', icon: 'spa' }, other: { label: 'سایر', icon: 'payments' },
  installment: { label: 'قسط و وام', icon: 'event_repeat' }, salary: { label: 'حقوق', icon: 'work' },
  gift: { label: 'هدیه', icon: 'redeem' }, transfer: { label: 'انتقال', icon: 'swap_horiz' },
};
export const EXP_CATS = ['shopping', 'food', 'cafe', 'bills', 'installment', 'transport', 'sport', 'travel', 'health', 'other'];
export const INC_CATS = ['salary', 'gift', 'transfer', 'other'];
/* The short lists offered when adding something new. */
export const SIMPLE_EXP = ['food', 'shopping', 'transport', 'bills', 'health', 'other'];
export const SIMPLE_INC = ['salary', 'gift', 'other'];
export const catOf = (key) => TXCAT[key] || TXCAT.other;

export const ACC_TYPES = {
  bank: { label: 'حساب بانکی', icon: 'account_balance' }, card: { label: 'کارت', icon: 'credit_card' },
  cash: { label: 'نقد', icon: 'payments' }, saving: { label: 'پس‌انداز', icon: 'savings' },
};
export const accType = (a) => ACC_TYPES[a.type] || ACC_TYPES.bank;

/* ---------- accounts ---------- */
export const findAccount = (id) => S.accounts.find((a) => a.id === id);
export const accName = (id) => (findAccount(id) || { name: 'حساب اصلی' }).name;
export const defAcc = () => (S.accounts[0] || { id: 'main' }).id;
export const txAccount = (t) => t.accountId || defAcc();

export function accBalance(id) {
  const a = findAccount(id);
  let b = a ? +a.opening || 0 : 0;
  S.tx.forEach((t) => {
    const acc = txAccount(t);
    if (t.type === 'income' && acc === id) b += t.amount;
    else if (t.type === 'expense' && acc === id) b -= t.amount;
    else if (t.type === 'transfer') {
      if (acc === id) b -= t.amount;
      if (t.toAccountId === id) b += t.amount;
    }
  });
  return b;
}
export const balance = () => sum(S.accounts, (a) => accBalance(a.id));

/* ---------- ledger queries ---------- */
export const monthSum = (type, mk = currentMonthKey()) =>
  sum(S.tx.filter((t) => t.type === type && monthKey(t.date) === mk), (t) => t.amount);
export const daySpend = (date) => sum(S.tx.filter((t) => t.type === 'expense' && t.date === date), (t) => t.amount);
export const sortedTx = (list = S.tx) => list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export function expenseByCategory(mk = currentMonthKey()) {
  const by = {};
  S.tx.filter((t) => t.type === 'expense' && monthKey(t.date) === mk).forEach((t) => { by[t.category] = (by[t.category] || 0) + t.amount; });
  return by;
}

/** Income and expense totals for the last `n` months, oldest first. */
export function cashFlow(n = 6) {
  const mk = currentMonthKey();
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = shiftMonthKey(mk, -i);
    rows.push({ key, income: monthSum('income', key), expense: monthSum('expense', key) });
  }
  return rows;
}

/** 0..1+ fraction of the monthly budget already used. */
export const budgetUsed = () => (S.wallet.budget ? monthSum('expense') / S.wallet.budget : 0);

export function txLabel(t) {
  return t.type === 'transfer' ? `انتقال: ${accName(t.accountId)} ← ${accName(t.toAccountId)}` : catOf(t.category).label;
}

/* ---------- transactions ---------- */
export const findTx = (id) => S.tx.find((t) => t.id === id);

/** Create (existing = null) or edit a plain income/expense. */
export function saveTx(existing, { type, amount, category, note, date, accountId }) {
  if (existing) {
    Object.assign(existing, { amount, category, note, date: date || existing.date, accountId });
    return existing;
  }
  const t = { id: uid(), type, amount, category, note, date: date || today(), accountId };
  S.tx.push(t);
  return t;
}

/** Remove a transaction; returns what is needed to undo it. */
export function deleteTx(id) {
  const i = S.tx.findIndex((t) => t.id === id);
  return i < 0 ? null : { tx: S.tx.splice(i, 1)[0], index: i };
}
export function restoreTx({ tx, index }) { S.tx.splice(Math.min(index, S.tx.length), 0, tx); }

/** Ledger rows for one month, filtered. */
export function ledgerRows({ month, type = 'all', acc = 'all', q = '' }) {
  return sortedTx(S.tx.filter((t) => {
    if (monthKey(t.date) !== month) return false;
    if (type !== 'all' && t.type !== type) return false;
    if (acc !== 'all' && txAccount(t) !== acc && t.toAccountId !== acc) return false;
    if (q && !`${t.note || ''} ${txLabel(t)}`.includes(q)) return false;
    return true;
  }));
}

/* ---------- budgets & reporting ---------- */
export const catBudgets = () => S.wallet.catBudgets || (S.wallet.catBudgets = {});
export const monthBudget = () => S.wallet.budget || 0;
/** Fixed monthly payments come off the budget first, then what was spent. */
export const budgetLeft = () => monthBudget() - monthlyTotal() - monthSum('expense');
export const budgetUsedPct = () => (monthBudget() ? ((monthlyTotal() + monthSum('expense')) / monthBudget()) * 100 : 0);

/** Spending per expense category this month, with its optional budget. */
export function categoryBudgetRows(mk = currentMonthKey()) {
  const spent = expenseByCategory(mk);
  const budgets = catBudgets();
  return EXP_CATS.filter((k) => spent[k] || budgets[k]).map((k) => ({ key: k, spent: spent[k] || 0, budget: budgets[k] || 0 }));
}

/** The category with the highest spending this month, or null. */
export function topExpenseCategory(mk = currentMonthKey()) {
  const spent = expenseByCategory(mk);
  const top = Object.keys(spent).sort((a, b) => spent[b] - spent[a])[0];
  return top ? { key: top, amount: spent[top] } : null;
}
