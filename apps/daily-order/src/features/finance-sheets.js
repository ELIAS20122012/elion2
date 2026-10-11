/* Money dialogs: transactions, transfers, payments, installments, bills, accounts, reports. */
import { S, commit } from '../core/store.js';
import { today, parseIso } from '../core/dates.js';
import { fa, num, esc, money } from '../core/format.js';
import { faDayMonth, fullDate, relDay, monthKey, monthLabel, monthName, monthYear, useJ, addMonthsIso, currentMonthKey, prevMonthKey, jalaliString } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { form, menu, confirmBox, infoSheet, later } from '../ui/sheet.js';
import { saveFile } from '../services/files.js';
import * as fin from '../domain/finance.js';

const M = (v) => money(v);
const accOptions = () => S.accounts.map((a) => ({ value: a.id, label: a.name, icon: fin.accType(a).icon }));
const needPositive = (v, msg = 'مبلغ را وارد کنید') => { const a = Math.abs(num(v)); if (!a) toast(msg); return a; };

/* ---------- transactions ---------- */
export function txSheet(type, preset = {}, editId) {
  const t = editId ? fin.findTx(editId) : null;
  type = t ? t.type : type;
  if (type === 'transfer') return transferSheet(t);

  const keys = t ? (type === 'income' ? fin.INC_CATS : fin.EXP_CATS) : (type === 'income' ? fin.SIMPLE_INC : fin.SIMPLE_EXP);
  const cats = keys.map((k) => ({ value: k, label: fin.catOf(k).label, icon: fin.catOf(k).icon }));
  const linked = t && (t.loanId || t.billId);
  const fields = [
    { name: 'amount', label: `مبلغ (${S.profile.currency})`, type: 'number', value: t ? t.amount : preset.amount || '', placeholder: '0' },
    { name: 'category', label: 'دسته', type: 'chips', value: t ? t.category : preset.category || cats[0].value, options: cats },
    { name: 'note', label: 'توضیح (اختیاری)', value: t ? t.note : preset.note || '' },
  ];
  if (t) fields.push({ name: 'date', label: 'تاریخ', type: 'date', value: t.date });
  if (S.accounts.length > 1) {
    fields.push({ name: 'acc', label: 'حساب', type: 'chips', value: t ? fin.txAccount(t) : fin.defAcc(), options: accOptions() });
  }
  form({
    title: t ? 'ویرایش' : type === 'income' ? 'درآمد جدید' : 'هزینه جدید',
    sub: linked ? `این تراکنش به ${t.loanId ? 'یک قسط' : 'یک قبض'} متصل است؛ حذف آن، پرداخت را هم لغو می‌کند.` : undefined,
    fields,
    extra: t ? [{ label: 'حذف', cls: 'danger', run: () => removeTx(t.id) }] : [],
    onSubmit(v) {
      const amount = needPositive(v.amount);
      if (!amount) return false;
      fin.saveTx(t, { type, amount, category: v.category, note: (v.note || '').trim(), date: v.date, accountId: v.acc || (t && t.accountId) || fin.defAcc() });
      commit();
    },
  });
}

export function transferSheet(t) {
  if (S.accounts.length < 2) { toast('برای انتقال، حداقل دو حساب لازم است'); accountSheet(); return; }
  form({
    title: t ? 'ویرایش انتقال' : 'انتقال بین حساب‌ها',
    sub: 'انتقال روی مجموع موجودی، درآمد و هزینه اثری ندارد.',
    fields: [
      { name: 'amount', label: `مبلغ (${S.profile.currency})`, type: 'number', value: t ? t.amount : '' },
      { name: 'from', label: 'از حساب', type: 'chips', value: t ? t.accountId : S.accounts[0].id, options: accOptions() },
      { name: 'to', label: 'به حساب', type: 'chips', value: t ? t.toAccountId : S.accounts[1].id, options: accOptions() },
      { name: 'note', label: 'توضیح', value: t ? t.note : '', placeholder: 'اختیاری' },
      { name: 'date', label: 'تاریخ', type: 'date', value: t ? t.date : today() },
    ],
    extra: t ? [{ label: 'حذف', cls: 'danger', run: () => removeTx(t.id) }] : [],
    onSubmit(v) {
      const amount = needPositive(v.amount);
      if (!amount) return false;
      if (v.from === v.to) { toast('حساب مبدأ و مقصد یکی است'); return false; }
      fin.saveTransfer(t, { amount, from: v.from, to: v.to, note: (v.note || '').trim(), date: v.date });
      commit();
      toast('انتقال ثبت شد');
    },
  });
}

export function removeTx(id) {
  const undo = fin.deleteTx(id);
  if (!undo) return;
  commit();
  toast(undo.unlinked ? 'تراکنش حذف و پرداخت لغو شد' : 'تراکنش حذف شد', { label: 'واگرد', run: () => { fin.restoreTx(undo); commit(); } });
}

/* ---------- ledger lists ---------- */
export function txRowsHtml(list) {
  if (!list.length) return '<div class="empty">تراکنشی ثبت نشده</div>';
  return `<div class="list">${list.map((t) => {
    const c = fin.catOf(t.category);
    const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
    const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '⇄ ';
    const where = S.accounts.length > 1 && t.type !== 'transfer' ? ` • ${esc(fin.accName(fin.txAccount(t)))}` : '';
    return `<div class="item" data-pick="${t.id}" role="button">
      <span class="item-icon"><span class="material-symbols-outlined">${t.type === 'transfer' ? 'swap_horiz' : c.icon}</span></span>
      <span class="grow"><span class="item-title">${esc(t.note || c.label)}</span><span class="item-sub">${esc(fin.txLabel(t))} • ${faDayMonth(parseIso(t.date))}${where}</span></span>
      <b class="amt ${cls}">${sign}${M(t.amount)}</b></div>`;
  }).join('')}</div>`;
}

export function historySheet(filter, title = 'همه تراکنش‌ها') {
  const list = fin.sortedTx(filter ? S.tx.filter(filter) : S.tx);
  const groups = new Map();
  list.forEach((t) => { const k = monthKey(t.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  let html = '';
  groups.forEach((rows, k) => { html += `<div class="group-label">${monthLabel(k)}</div>${txRowsHtml(rows)}`; });
  if (!html) html = '<div class="empty">تراکنشی ثبت نشده</div>';
  infoSheet(title, `<p class="sheet-sub">برای ویرایش یا حذف، روی تراکنش بزنید.</p>${html}`,
    [{ label: 'تراکنش جدید', cls: 'primary', run: () => txSheet('expense') }],
    (el, close) => { close(); later(() => txSheet(null, {}, el.dataset.pick)); });
}

/* ---------- reports ---------- */
export function reportSheet() {
  const mk = currentMonthKey();
  const inc = fin.monthSum('income');
  const exp = fin.monthSum('expense');
  const prev = fin.monthSum('expense', prevMonthKey());
  const diff = prev ? Math.round(((exp - prev) / prev) * 100) : null;
  const debt = fin.loansRemaining();
  const due30 = fin.dueItems(30).reduce((s, d) => s + d.amount, 0);
  const by = fin.expenseByCategory(mk);
  const cats = Object.keys(by).sort((a, b) => by[b] - by[a]);
  const flow = fin.cashFlow(6);
  const top = Math.max(1, ...flow.flatMap((r) => [r.income, r.expense]));
  const tile = (label, value, cls = '') => `<div><small>${label}</small><b class="${cls}">${value}</b></div>`;

  let html = `<p class="sheet-sub">${monthLabel(mk)}</p><div class="stat-grid">
    ${tile('درآمد این ماه', M(inc), 'pos')}${tile('هزینه این ماه', M(exp), 'neg')}${tile('خالص این ماه', M(inc - exp))}
    ${tile('هزینه نسبت به ماه قبل', diff == null ? '—' : `${diff > 0 ? '+' : ''}${fa(diff)}٪`)}
    ${tile('بدهی باقی‌مانده اقساط', M(debt), 'neg')}${tile('دارایی خالص', M(fin.balance() - debt))}
    ${tile('پرداختنی ۳۰ روز آینده', M(due30))}</div>`;

  html += '<div class="group-label">جریان نقدی ۶ ماه اخیر</div><div class="list">';
  html += flow.map((r) => `<div class="item item-block">
    <div class="row-between small"><b>${monthLabel(r.key)}</b><span><span class="pos">+${M(r.income)}</span> / <span class="neg">−${M(r.expense)}</span></span></div>
    <span class="progress"><i style="width:${Math.round((r.income / top) * 100)}%;background:var(--sage)"></i></span>
    <span class="progress"><i style="width:${Math.round((r.expense / top) * 100)}%"></i></span></div>`).join('');
  html += '</div><div class="group-label">هزینه این ماه بر اساس دسته</div>';
  html += cats.length
    ? cats.map((k) => {
      const c = fin.catOf(k);
      const pct = Math.round((by[k] / exp) * 100);
      return `<div class="item"><span class="item-icon"><span class="material-symbols-outlined">${c.icon}</span></span>
        <span class="grow"><span class="item-title">${c.label} <span class="item-sub">${fa(pct)}٪</span></span><span class="progress"><i style="width:${pct}%"></i></span></span>
        <b class="amt">${M(by[k])}</b></div>`;
    }).join('')
    : '<div class="empty">هنوز هزینه‌ای در این ماه ثبت نشده</div>';

  infoSheet('گزارش مالی', html, [{ label: 'خروجی اکسل (CSV)', run: () => exportCsv(S.tx, 'all') }]);
}

export function exportCsv(list, tag) {
  const q = (x) => { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const rows = [['تاریخ میلادی', 'تاریخ شمسی', 'نوع', 'دسته', 'توضیح', 'حساب', 'به حساب', 'مبلغ', 'واحد']];
  list.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((t) => {
    rows.push([t.date, jalaliString(t.date), t.type === 'income' ? 'درآمد' : t.type === 'expense' ? 'هزینه' : 'انتقال', fin.catOf(t.category).label, t.note,
      fin.accName(fin.txAccount(t)), t.type === 'transfer' ? fin.accName(t.toAccountId) : '', t.type === 'expense' ? -t.amount : t.amount, S.profile.currency]);
  });
  saveFile(`ledger-${tag}-${today()}.csv`, `﻿${rows.map((r) => r.map(q).join(',')).join('\r\n')}`, 'text/csv');
}

/* ---------- paying installments & bills ---------- */
export function payDialog(it, done) {
  const isLoan = it.kind === 'loan';
  const ref = it.ref;
  const fields = [
    { name: 'amount', label: `مبلغ پرداختی (${S.profile.currency})`, type: 'number', value: it.amount },
    { name: 'date', label: 'تاریخ پرداخت', type: 'date', value: today() },
  ];
  if (S.accounts.length > 1) fields.push({ name: 'acc', label: 'پرداخت از حساب', type: 'chips', value: ref.accountId || fin.defAcc(), options: accOptions() });
  fields.push({ name: 'record', label: 'ثبت به‌عنوان هزینه در حساب‌ها', type: 'switch', value: true });
  form({
    title: isLoan ? `پرداخت قسط ${fa(it.n)} — ${ref.title}` : `پرداخت ${ref.title}`,
    sub: `سررسید: ${fullDate(it.due)} (${relDay(it.due)})`,
    fields, submit: 'ثبت پرداخت',
    onSubmit(v) {
      const amount = needPositive(v.amount);
      if (!amount) return false;
      const left = fin.payObligation(it, { amount, date: v.date, accountId: v.acc, record: v.record });
      commit();
      toast(isLoan ? (left ? `قسط ثبت شد — ${fa(left)} قسط باقی‌مانده` : `🎉 همه اقساط «${ref.title}» تسویه شد`) : `پرداخت «${ref.title}» ثبت شد`);
      if (done) done();
    },
  });
}

export function undoPayment(ref, key) {
  const entry = ref.paid[key];
  if (!entry) return;
  confirmBox('لغو این پرداخت؟', entry.txId ? 'تراکنش هزینه مربوط هم حذف می‌شود.' : 'وضعیت به «پرداخت‌نشده» برمی‌گردد.', 'لغو پرداخت', () => {
    fin.cancelPayment(ref, key);
    commit();
    toast('پرداخت لغو شد');
  });
}

export const payLoan = (l, n) => payDialog({ kind: 'loan', ref: l, n, due: fin.loanDue(l, n), amount: l.amount });
export const payBill = (b) => { const nx = fin.billNext(b); payDialog({ kind: 'bill', ref: b, due: nx.due, amount: Math.round(fin.billAvg(b) * 100) / 100 }); };

/* ---------- loans ---------- */
export function loanSheet(id) {
  const l = id ? S.loans.find((x) => x.id === id) : null;
  const fields = [
    { name: 'title', label: 'عنوان', value: l ? l.title : '', placeholder: 'مثلاً وام خودرو، اقساط گوشی' },
    { name: 'lender', label: 'وام‌دهنده / فروشنده', value: l ? l.lender : '', placeholder: 'اختیاری' },
    { name: 'amount', label: 'مبلغ هر قسط', type: 'number', value: l ? l.amount : '', row: 'a' },
    { name: 'count', label: 'تعداد اقساط', type: 'number', value: l ? l.count : 12, row: 'a' },
    { name: 'start', label: 'سررسید قسط اول', type: 'date', value: l ? l.start : addMonthsIso(today(), 1) },
    { name: 'every', label: 'فاصله اقساط', type: 'chips', value: String(l ? l.every || 1 : 1), options: [{ value: '1', label: 'ماهانه' }, { value: '2', label: 'دوماهه' }, { value: '3', label: 'سه‌ماهه' }] },
    { name: 'paidBefore', label: 'تعداد اقساطی که قبلاً پرداخت شده', type: 'number', value: l ? '' : 0, placeholder: l ? 'بدون تغییر' : '0' },
  ];
  if (S.accounts.length > 1) fields.push({ name: 'acc', label: 'پرداخت معمولاً از حساب', type: 'chips', value: l ? l.accountId || fin.defAcc() : fin.defAcc(), options: accOptions() });
  fields.push({ name: 'remind', label: 'یادآوری سررسید (یک روز قبل)', type: 'switch', value: l ? l.remind !== false : true });
  form({
    title: l ? 'ویرایش قسط' : 'ثبت قسط / وام جدید',
    sub: `روز سررسید هر ماه بر اساس تقویم ${useJ() ? 'شمسی' : 'میلادی'} تکرار می‌شود.`,
    fields, focus: !l,
    extra: l ? [{ label: 'حذف', cls: 'danger', run: () => confirmDeleteLoan(l) }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      const amount = num(v.amount);
      const count = Math.round(num(v.count));
      if (!title) { toast('عنوان را وارد کنید'); return false; }
      if (amount <= 0) { toast('مبلغ قسط را وارد کنید'); return false; }
      if (count < 1 || count > 600) { toast('تعداد اقساط معتبر نیست'); return false; }
      fin.saveLoan(l, { title, lender: (v.lender || '').trim(), amount, count, start: v.start || today(), every: +v.every || 1, accountId: v.acc, remind: !!v.remind, paidBefore: Math.round(num(v.paidBefore)) });
      commit();
      toast(l ? 'قسط ویرایش شد' : `قسط «${title}» ثبت شد`);
    },
  });
}

export function confirmDeleteLoan(l) {
  const linked = S.tx.filter((t) => t.loanId === l.id).length;
  confirmBox(`حذف «${l.title}»؟`, linked ? `${fa(linked)} تراکنش پرداخت‌شده در دفتر باقی می‌ماند.` : 'برنامه اقساط حذف می‌شود.', 'حذف', () => {
    fin.deleteLoan(l);
    commit();
    toast('حذف شد');
  });
}

export function loanSchedule(l) {
  const tile = (label, value, cls = '') => `<div><small>${label}</small><b class="${cls}">${value}</b></div>`;
  let html = `<div class="stat-grid">${tile('پرداخت‌شده', `${fa(fin.loanPaidCount(l))} از ${fa(l.count)}`)}${tile('مانده بدهی', M(fin.loanRemaining(l)), 'neg')}${tile('مبلغ کل', M(l.amount * l.count))}${tile('آخرین سررسید', monthYear(fin.loanDue(l, l.count)))}</div><div class="list">`;
  for (let n = 1; n <= l.count; n++) {
    const due = fin.loanDue(l, n);
    const p = l.paid[n];
    const over = !p && due < today();
    const state = p ? `پرداخت شد${p.before ? ' (قبل از ثبت)' : ` • ${faDayMonth(parseIso(p.date))}`}` : over ? `معوق — ${relDay(due)}` : relDay(due);
    html += `<div class="item" data-pick="${n}" role="button"><span class="item-icon num">${fa(n)}</span>
      <span class="grow"><span class="item-title">${fullDate(due)}</span><span class="item-sub${over ? ' neg' : ''}">${state}</span></span>
      <b class="amt${p ? ' pos' : ''}">${p ? (p.settled ? 'تسویه ✓' : `✓ ${M(p.amount)}`) : M(l.amount)}</b></div>`;
  }
  infoSheet(l.title, `${html}</div>`, [{ label: 'ویرایش', run: () => loanSheet(l.id) }], (el, close) => {
    const n = +el.dataset.pick;
    close();
    later(() => (l.paid[n] ? undoPayment(l, n) : payLoan(l, n)));
  });
}

export function loanMenu(l) {
  const nx = fin.loanNextN(l);
  menu(l.title, [
    nx && { icon: 'payments', label: `پرداخت قسط ${fa(nx)} (${fullDate(fin.loanDue(l, nx))})`, run: () => payLoan(l, nx) },
    { icon: 'calendar_month', label: 'جدول کامل اقساط', run: () => loanSchedule(l) },
    nx && { icon: 'done_all', label: 'تسویه کامل (پرداخت همه اقساط باقی‌مانده)', run: () => settleSheet(l) },
    { icon: 'edit', label: 'ویرایش', run: () => loanSheet(l.id) },
    { icon: 'delete', label: 'حذف', danger: true, run: () => confirmDeleteLoan(l) },
  ], `${l.lender ? `${l.lender} • ` : ''}مانده: ${M(fin.loanRemaining(l))}`);
}

function settleSheet(l) {
  const rem = fin.loanRemaining(l);
  form({
    title: `تسویه کامل ${l.title}`,
    sub: `${fa(l.count - fin.loanPaidCount(l))} قسط باقی‌مانده به مبلغ ${M(rem)}. اگر تخفیف تسویه گرفته‌اید مبلغ را اصلاح کنید.`,
    fields: [{ name: 'amount', label: 'مبلغ پرداختی', type: 'number', value: rem }, { name: 'date', label: 'تاریخ', type: 'date', value: today() }],
    submit: 'تسویه',
    onSubmit(v) {
      const amount = num(v.amount);
      if (amount <= 0) { toast('مبلغ را وارد کنید'); return false; }
      fin.settleLoan(l, amount, v.date);
      commit();
      toast(`🎉 «${l.title}» تسویه شد`);
    },
  });
}

/* ---------- bills ---------- */
export function billSheet(id) {
  const b = id ? S.bills.find((x) => x.id === id) : null;
  const autoTitle = (kind) => `قبض ${fin.BILL_KINDS[kind].label}`;
  const fields = [
    {
      name: 'kind', label: 'نوع', type: 'chips', value: b ? b.kind : 'electricity',
      options: Object.entries(fin.BILL_KINDS).map(([k, v]) => ({ value: k, label: v.label, icon: v.icon })),
      onChange(kind, f) {
        const input = f.querySelector('input[name=title]');
        const isAuto = Object.keys(fin.BILL_KINDS).some((k) => input && input.value === autoTitle(k));
        if (input && (!input.value || isAuto)) { input.value = autoTitle(kind); input.dispatchEvent(new Event('input')); }
      },
    },
    { name: 'title', label: 'عنوان', value: b ? b.title : 'قبض برق' },
    { name: 'amount', label: 'مبلغ تقریبی هر دوره', type: 'number', value: b ? b.amount : '', row: 'a' },
    { name: 'start', label: 'سررسید بعدی', type: 'date', value: b ? b.start : addMonthsIso(today(), 0), row: 'a' },
    { name: 'every', label: 'دوره پرداخت', type: 'chips', value: String(b ? b.every || 1 : 1), options: Object.entries(fin.EVERY).map(([k, label]) => ({ value: k, label })) },
  ];
  if (S.accounts.length > 1) fields.push({ name: 'acc', label: 'پرداخت معمولاً از حساب', type: 'chips', value: b ? b.accountId || fin.defAcc() : fin.defAcc(), options: accOptions() });
  fields.push({ name: 'remind', label: 'یادآوری سررسید (یک روز قبل)', type: 'switch', value: b ? b.remind !== false : true });
  form({
    title: b ? 'ویرایش قبض' : 'قبض یا پرداخت دوره‌ای جدید',
    sub: 'مثل برق، گاز، اینترنت، اجاره، بیمه یا اشتراک‌ها.', fields, focus: false,
    extra: b ? [{ label: 'حذف', cls: 'danger', run: () => confirmDeleteBill(b) }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      if (!title) { toast('عنوان را وارد کنید'); return false; }
      fin.saveBill(b, { kind: v.kind, title, amount: num(v.amount), every: +v.every || 1, start: v.start || today(), accountId: v.acc, remind: !!v.remind });
      commit();
      toast(b ? 'قبض ویرایش شد' : `«${title}» ثبت شد`);
    },
  });
}

function confirmDeleteBill(b) {
  confirmBox(`حذف «${b.title}»؟`, 'تراکنش‌های پرداخت‌شده در دفتر باقی می‌مانند.', 'حذف', () => { fin.deleteBill(b); commit(); toast('حذف شد'); });
}

export function billMenu(b) {
  const nx = fin.billNext(b);
  menu(b.title, [
    nx && { icon: 'payments', label: `پرداخت دوره ${monthName(nx.due)} (${relDay(nx.due)})`, run: () => payBill(b) },
    { icon: 'history', label: 'سابقه پرداخت‌ها', run: () => billHistory(b) },
    { icon: b.paused ? 'play_circle' : 'pause_circle', label: b.paused ? 'فعال‌سازی دوباره' : 'توقف موقت (مثلاً قطع اشتراک)', run: () => { b.paused = !b.paused; commit(); } },
    { icon: 'edit', label: 'ویرایش', run: () => billSheet(b.id) },
  ], `${fin.billKind(b).label} • ${fin.EVERY[b.every || 1]} • میانگین ${M(fin.billAvg(b))}`);
}

export function billHistory(b) {
  const keys = Object.keys(b.paid).sort().reverse();
  const html = keys.length
    ? `<p class="sheet-sub">برای لغو یک پرداخت، روی آن بزنید.</p><div class="list">${keys.map((k) => {
      const e = b.paid[k];
      return `<div class="item" data-pick="${k}" role="button"><span class="grow"><span class="item-title">دوره ${monthYear(k)}</span><span class="item-sub">پرداخت: ${fullDate(e.date)}${e.txId ? '' : ' • بدون ثبت هزینه'}</span></span><b class="amt">${M(e.amount)}</b></div>`;
    }).join('')}</div>`
    : '<div class="empty">هنوز پرداختی ثبت نشده</div>';
  infoSheet(`سابقه ${b.title}`, html, [], (el, close) => { close(); later(() => undoPayment(b, el.dataset.pick)); });
}

/* ---------- accounts ---------- */
export function accountSheet(id) {
  const a = id ? fin.findAccount(id) : null;
  form({
    title: a ? 'ویرایش حساب' : 'حساب یا کارت جدید',
    fields: [
      { name: 'name', label: 'نام', value: a ? a.name : '', placeholder: 'مثلاً کارت ملت، حساب Erste' },
      { name: 'type', label: 'نوع', type: 'chips', value: a ? a.type : 'bank', options: Object.entries(fin.ACC_TYPES).map(([k, v]) => ({ value: k, label: v.label, icon: v.icon })) },
      { name: 'opening', label: `موجودی اولیه (${S.profile.currency})`, type: 'number', value: a ? a.opening : 0 },
    ],
    extra: a && S.accounts.length > 1 ? [{ label: 'حذف', cls: 'danger', run: () => deleteAccountFlow(a) }] : [],
    onSubmit(v) {
      const name = (v.name || '').trim();
      if (!name) { toast('نام حساب را وارد کنید'); return false; }
      fin.saveAccount(a, { name, type: v.type, opening: num(v.opening) });
      commit();
      toast(a ? 'حساب ویرایش شد' : `حساب «${name}» اضافه شد`);
    },
  });
}

function deleteAccountFlow(a) {
  if (fin.accountInUse(a)) { toast('این حساب تراکنش دارد؛ اول تراکنش‌ها را به حساب دیگری منتقل یا حذف کنید'); return; }
  confirmBox(`حذف «${a.name}»؟`, 'این حساب تراکنشی ندارد.', 'حذف', () => { S.accounts.splice(S.accounts.indexOf(a), 1); commit(); });
}

export function accountMenu(a) {
  menu(a.name, [
    { icon: 'receipt_long', label: 'تراکنش‌های این حساب', run: () => historySheet((t) => fin.txAccount(t) === a.id || t.toAccountId === a.id, `تراکنش‌های ${a.name}`) },
    { icon: 'swap_horiz', label: 'انتقال از این حساب', run: () => transferSheet() },
    { icon: 'tune', label: 'اصلاح موجودی (تطبیق با بانک)', run: () => reconcileSheet(a) },
    { icon: 'edit', label: 'ویرایش', run: () => accountSheet(a.id) },
  ], `${fin.accType(a).label} • موجودی: ${M(fin.accBalance(a.id))}`);
}

function reconcileSheet(a) {
  const cur = fin.accBalance(a.id);
  form({
    title: `تطبیق موجودی ${a.name}`,
    sub: `موجودی فعلی در برنامه: ${M(cur)}. موجودی واقعی حساب را وارد کنید؛ اختلاف به‌صورت تراکنش «اصلاح موجودی» ثبت می‌شود.`,
    fields: [{ name: 'real', label: 'موجودی واقعی', type: 'number', value: Math.round(cur * 100) / 100 }],
    submit: 'تطبیق',
    onSubmit(v) {
      if (!fin.reconcileAccount(a, num(v.real))) { toast('موجودی از قبل درست است'); return; }
      commit();
      toast('موجودی تطبیق داده شد');
    },
  });
}

/* ---------- one-tap payment (used by the "due soon" list) ---------- */
/** Pay a due item at its usual amount today and record the expense; the toast offers undo. */
export function payNow(it) {
  fin.payObligation(it, { amount: it.amount, date: today(), accountId: it.ref.accountId, record: true });
  const key = it.kind === 'loan' ? it.n : it.due;
  commit();
  toast(`«${it.title}» پرداخت شد`, { label: 'واگرد', run: () => { fin.cancelPayment(it.ref, key); commit(); } });
}

/* ---------- management lives behind one entry ---------- */
function listSheet(title, rows, addLabel, onAdd, onPick) {
  const html = rows.length
    ? `<div class="list">${rows.map((r) => `<div class="item" data-pick="${r.id}" role="button"><span class="grow"><span class="item-title">${esc(r.title)}</span><span class="item-sub">${r.sub}</span></span><b class="amt">${r.amount}</b></div>`).join('')}</div>`
    : '<div class="empty">هنوز چیزی ثبت نشده</div>';
  infoSheet(title, html, [{ label: addLabel, cls: 'primary', run: onAdd }], (el, close) => { close(); later(() => onPick(el.dataset.pick)); });
}

export function manageMenu() {
  menu('قسط، قبض و حساب‌ها', [
    {
      icon: 'event_repeat', label: 'اقساط و وام‌ها',
      run: () => listSheet('اقساط و وام‌ها', S.loans.map((l) => ({ id: l.id, title: l.title, sub: `${fa(fin.loanPaidCount(l))} از ${fa(l.count)} پرداخت شد`, amount: M(fin.loanRemaining(l)) })), 'قسط جدید', () => loanSheet(), (id) => loanMenu(S.loans.find((l) => l.id === id))),
    },
    {
      icon: 'receipt_long', label: 'قبض‌ها و پرداخت‌های دوره‌ای',
      run: () => listSheet('قبض‌ها', S.bills.map((b) => ({ id: b.id, title: b.title, sub: `${fin.billKind(b).label} • ${fin.EVERY[b.every || 1]}${b.paused ? ' • متوقف' : ''}`, amount: M(fin.billAvg(b)) })), 'قبض جدید', () => billSheet(), (id) => billMenu(S.bills.find((b) => b.id === id))),
    },
    {
      icon: 'account_balance', label: 'حساب‌ها و کارت‌ها',
      run: () => listSheet('حساب‌ها', S.accounts.map((a) => ({ id: a.id, title: a.name, sub: fin.accType(a).label, amount: M(fin.accBalance(a.id)) })), 'حساب جدید', () => accountSheet(), (id) => accountMenu(fin.findAccount(id))),
    },
    { icon: 'swap_horiz', label: 'انتقال بین حساب‌ها', run: () => transferSheet() },
    { icon: 'monitoring', label: 'گزارش ماهانه', run: reportSheet },
  ]);
}
