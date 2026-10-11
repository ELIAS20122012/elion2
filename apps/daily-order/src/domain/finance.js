/* Money: accounts, ledger, installments, recurring bills and what is due. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid, sum } from '../core/util.js';
import { iso, addDays, today, daysBetween } from '../core/dates.js';
import { fa } from '../core/format.js';
import { monthKey, shiftMonthKey, addMonthsIso, dayOfMonth, currentMonthKey, monthName } from '../core/calendar.js';

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
export const QUICK_SETS = [['shopping', 'bills', 'cafe'], ['food', 'transport', 'sport'], ['travel', 'health', 'other']];
export const catOf = (key) => TXCAT[key] || TXCAT.other;

export const ACC_TYPES = {
  bank: { label: 'حساب بانکی', icon: 'account_balance' }, card: { label: 'کارت', icon: 'credit_card' },
  cash: { label: 'نقد', icon: 'payments' }, saving: { label: 'پس‌انداز', icon: 'savings' },
};
export const BILL_KINDS = {
  electricity: { label: 'برق', icon: 'bolt' }, gas: { label: 'گاز', icon: 'local_fire_department' }, water: { label: 'آب', icon: 'water_drop' },
  internet: { label: 'اینترنت', icon: 'wifi' }, mobile: { label: 'موبایل', icon: 'smartphone' }, rent: { label: 'اجاره', icon: 'home' },
  insurance: { label: 'بیمه', icon: 'shield' }, subscription: { label: 'اشتراک', icon: 'subscriptions' },
  tax: { label: 'مالیات / عوارض', icon: 'gavel' }, other: { label: 'سایر', icon: 'receipt_long' },
};
export const EVERY = { 1: 'ماهانه', 2: 'دوماهه', 3: 'سه‌ماهه', 6: 'شش‌ماهه', 12: 'سالانه' };
export const billKind = (b) => BILL_KINDS[b.kind] || BILL_KINDS.other;
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

export function accountInUse(a) {
  return S.tx.some((t) => txAccount(t) === a.id || t.toAccountId === a.id);
}

/** Add/subtract the difference so the app matches the real bank balance. */
export function reconcileAccount(a, real) {
  const diff = Math.round((real - accBalance(a.id)) * 100) / 100;
  if (!diff) return false;
  S.tx.push({ id: uid(), type: diff > 0 ? 'income' : 'expense', category: 'other', amount: Math.abs(diff), date: today(), note: 'اصلاح موجودی', accountId: a.id });
  return true;
}

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

/* ---------- installments (loans) ---------- */
export const loanDue = (l, n) => addMonthsIso(l.start, (n - 1) * (l.every || 1), dayOfMonth(l.start));
export const loanPaidCount = (l) => Object.keys(l.paid || {}).length;
export function loanNextN(l) {
  for (let n = 1; n <= l.count; n++) if (!l.paid[n]) return n;
  return null;
}
export const loanRemaining = (l) => (l.count - loanPaidCount(l)) * l.amount;
export const loansRemaining = () => sum(S.loans, loanRemaining);

/* ---------- recurring bills ---------- */
export const billDue = (b, k) => addMonthsIso(b.start, k * (b.every || 1), dayOfMonth(b.start));
export function billNext(b) {
  for (let k = 0; k < 600; k++) {
    const d = billDue(b, k);
    if (!b.paid[d]) return { k, due: d };
  }
  return null;
}
export function billAvg(b) {
  const paid = Object.values(b.paid).map((p) => p.amount).filter((x) => x > 0);
  return paid.length ? sum(paid) / paid.length : b.amount;
}

/** Everything due within `days` days (overdue included), soonest first. */
export function dueItems(days) {
  const limit = iso(addDays(new Date(), days));
  const out = [];
  S.loans.forEach((l) => {
    for (let n = 1; n <= l.count; n++) {
      if (l.paid[n]) continue;
      const due = loanDue(l, n);
      if (due > limit) break;
      out.push({ kind: 'loan', ref: l, n, due, amount: l.amount, title: l.title, icon: 'event_repeat', sub: `قسط ${fa(n)} از ${fa(l.count)}${l.lender ? ` • ${l.lender}` : ''}` });
    }
  });
  S.bills.forEach((b) => {
    if (b.paused) return;
    let overdue = 0;
    for (let k = 0; k < 600; k++) {
      const due = billDue(b, k);
      if (due > limit) break;
      if (b.paid[due]) continue;
      if (due < today() && ++overdue > 6) continue;
      out.push({ kind: 'bill', ref: b, due, amount: Math.round(billAvg(b) * 100) / 100, title: b.title, icon: billKind(b).icon, sub: `${billKind(b).label} • ${EVERY[b.every || 1]}` });
    }
  });
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/** Split dueItems(60) into the buckets the UI shows. */
export function dueBuckets() {
  const t0 = today();
  const items = dueItems(60);
  const gap = (d) => daysBetween(t0, d.due);
  return {
    items,
    over: items.filter((d) => d.due < t0),
    week: items.filter((d) => d.due >= t0 && gap(d) <= 7),
    month: items.filter((d) => gap(d) > 7 && gap(d) <= 30),
    later: items.filter((d) => gap(d) > 30),
  };
}

export const paidObligationsThisMonth = () =>
  S.tx.filter((t) => (t.loanId || t.billId) && monthKey(t.date) === currentMonthKey());

/* ---------- ledger entries linked to a payment ---------- */
export function unlinkTx(t) {
  if (t.loanId) {
    const l = S.loans.find((x) => x.id === t.loanId);
    if (l && l.paid[t.loanN] && l.paid[t.loanN].txId === t.id) { const e = l.paid[t.loanN]; delete l.paid[t.loanN]; return e; }
  }
  if (t.billId) {
    const b = S.bills.find((x) => x.id === t.billId);
    if (b && b.paid[t.billDue] && b.paid[t.billDue].txId === t.id) { const e = b.paid[t.billDue]; delete b.paid[t.billDue]; return e; }
  }
  return null;
}
export function relinkTx(t, entry) {
  if (!entry) return;
  if (t.loanId) { const l = S.loans.find((x) => x.id === t.loanId); if (l) l.paid[t.loanN] = entry; }
  if (t.billId) { const b = S.bills.find((x) => x.id === t.billId); if (b) b.paid[t.billDue] = entry; }
}
function syncLinked(t) {
  const holder = t.loanId ? S.loans.find((x) => x.id === t.loanId) : t.billId ? S.bills.find((x) => x.id === t.billId) : null;
  const entry = holder && holder.paid[t.loanId ? t.loanN : t.billDue];
  if (entry) { entry.amount = t.amount; entry.date = t.date; }
}

/* ---------- transactions ---------- */
export const findTx = (id) => S.tx.find((t) => t.id === id);

/** Create (existing = null) or edit a plain income/expense. */
export function saveTx(existing, { type, amount, category, note, date, accountId }) {
  if (existing) {
    Object.assign(existing, { amount, category, note, date: date || existing.date, accountId });
    syncLinked(existing);
    return existing;
  }
  const t = { id: uid(), type, amount, category, note, date: date || today(), accountId };
  S.tx.push(t);
  return t;
}

export function saveTransfer(existing, { amount, from, to, note, date }) {
  const t = existing || { id: uid(), type: 'transfer', category: 'transfer' };
  Object.assign(t, { amount, accountId: from, toAccountId: to, note, date: date || today() });
  if (!existing) S.tx.push(t);
  return t;
}

/** Remove a transaction; returns what is needed to undo it. */
export function deleteTx(id) {
  const i = S.tx.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const tx = S.tx.splice(i, 1)[0];
  return { tx, unlinked: unlinkTx(tx) };
}
export function restoreTx({ tx, unlinked }) {
  S.tx.push(tx);
  relinkTx(tx, unlinked);
}

/* ---------- paying obligations ---------- */
/** Mark a due item as paid; optionally records the matching expense. Returns installments left (loans). */
export function payObligation(it, { amount, date, accountId, record }) {
  const isLoan = it.kind === 'loan';
  const ref = it.ref;
  const entry = { date: date || today(), amount, txId: null };
  if (record) {
    const tx = { id: uid(), type: 'expense', category: isLoan ? 'installment' : 'bills', amount, date: entry.date, accountId: accountId || ref.accountId || defAcc() };
    if (isLoan) Object.assign(tx, { note: `قسط ${it.n} از ${ref.count} — ${ref.title}`, loanId: ref.id, loanN: it.n });
    else Object.assign(tx, { note: `${ref.title} (${monthName(it.due)})`, billId: ref.id, billDue: it.due });
    S.tx.push(tx);
    entry.txId = tx.id;
  }
  ref.paid[isLoan ? it.n : it.due] = entry;
  return isLoan ? ref.count - loanPaidCount(ref) : null;
}

export function cancelPayment(ref, key) {
  const entry = ref.paid[key];
  if (!entry) return;
  delete ref.paid[key];
  if (entry.txId) S.tx = S.tx.filter((t) => t.id !== entry.txId);
}

/** Pay off every remaining installment at once. */
export function settleLoan(l, amount, date) {
  const tx = { id: uid(), type: 'expense', category: 'installment', amount, date: date || today(), note: `تسویه کامل — ${l.title}`, accountId: l.accountId || defAcc() };
  S.tx.push(tx);
  for (let n = 1; n <= l.count; n++) if (!l.paid[n]) l.paid[n] = { date: tx.date, amount: 0, txId: null, settled: tx.id };
}

/** Create or update a loan; `paidBefore` marks that many leading installments as already paid. */
export function saveLoan(existing, f) {
  const l = existing || { id: uid(), paid: {} };
  Object.assign(l, { title: f.title, lender: f.lender, amount: f.amount, count: f.count, start: f.start, every: f.every, accountId: f.accountId || l.accountId || defAcc(), remind: f.remind });
  const before = Math.min(f.count, f.paidBefore || 0);
  for (let n = 1; n <= before; n++) if (!l.paid[n]) l.paid[n] = { date: loanDue(l, n), amount: f.amount, txId: null, before: true };
  Object.keys(l.paid).forEach((k) => { if (+k > f.count) delete l.paid[k]; });
  if (!existing) S.loans.push(l);
  return l;
}

export function deleteLoan(l) {
  S.loans.splice(S.loans.indexOf(l), 1);
  S.tx.forEach((t) => { if (t.loanId === l.id) { delete t.loanId; delete t.loanN; } });
}

export function saveBill(existing, f) {
  const b = existing || { id: uid(), paid: {} };
  const startChanged = existing && existing.start !== f.start;
  Object.assign(b, { kind: f.kind, title: f.title, amount: f.amount, every: f.every, start: f.start, accountId: f.accountId || b.accountId || defAcc(), remind: f.remind });
  if (startChanged) {
    const keep = {};
    Object.keys(b.paid).forEach((k) => { if (k >= b.start) keep[k] = b.paid[k]; });
    b.paid = keep;
  }
  if (!existing) S.bills.push(b);
  return b;
}

export function deleteBill(b) {
  S.bills.splice(S.bills.indexOf(b), 1);
  S.tx.forEach((t) => { if (t.billId === b.id) { delete t.billId; delete t.billDue; } });
}

export function saveAccount(existing, { name, type, opening }) {
  const a = existing || { id: uid() };
  Object.assign(a, { name, type, opening });
  if (!existing) S.accounts.push(a);
  return a;
}

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
