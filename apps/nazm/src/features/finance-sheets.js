/* Money dialogs: edit a transaction, history, report, budgets and monthly payments. */
import { S, commit } from '../core/store.js';
import { today, parseIso } from '../core/dates.js';
import { fa, num, esc, money } from '../core/format.js';
import { faDayMonth, monthKey, monthLabel, currentMonthKey, prevMonthKey, jalaliString } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { form, menu, infoSheet, later } from '../ui/sheet.js';
import { saveFile } from '../services/files.js';
import * as fin from '../domain/finance.js';
import * as MO from '../domain/monthly.js';
import * as SV from '../domain/savings.js';

const M = (v) => money(v);
const accOptions = () => S.accounts.map((a) => ({ value: a.id, label: a.name, icon: fin.accType(a).icon }));

/* ---------- transactions ---------- */
export function txSheet(type, preset = {}, editId) {
  const t = editId ? fin.findTx(editId) : null;
  type = t ? t.type : type;
  const keys = t ? (type === 'income' ? fin.INC_CATS : fin.EXP_CATS) : (type === 'income' ? fin.SIMPLE_INC : fin.SIMPLE_EXP);
  const cats = keys.map((k) => ({ value: k, label: fin.catOf(k).label, icon: fin.catOf(k).icon }));
  const fields = [
    { name: 'amount', label: `مبلغ (${S.profile.currency})`, type: 'number', value: t ? t.amount : preset.amount || '', placeholder: '0' },
    { name: 'category', label: 'دسته', type: 'chips', value: t ? t.category : preset.category || cats[0].value, options: cats },
    { name: 'note', label: 'توضیح (اختیاری)', value: t ? t.note : preset.note || '' },
  ];
  if (t) fields.push({ name: 'date', label: 'تاریخ', type: 'date', value: t.date });
  if (S.accounts.length > 1) fields.push({ name: 'acc', label: 'حساب', type: 'chips', value: t ? fin.txAccount(t) : fin.defAcc(), options: accOptions() });
  form({
    title: t ? 'ویرایش' : type === 'income' ? 'درآمد جدید' : 'هزینه جدید',
    fields,
    extra: t ? [{ label: 'حذف', cls: 'danger', run: () => removeTx(t.id) }] : [],
    onSubmit(v) {
      const amount = Math.abs(num(v.amount));
      if (!amount) { toast('مبلغ را وارد کنید'); return false; }
      fin.saveTx(t, { type, amount, category: v.category, note: (v.note || '').trim(), date: v.date, accountId: v.acc || (t && t.accountId) || fin.defAcc() });
      commit();
    },
  });
}

export function removeTx(id) {
  const undo = fin.deleteTx(id);
  if (!undo) return;
  commit();
  toast('تراکنش حذف شد', { label: 'واگرد', run: () => { fin.restoreTx(undo); commit(); } });
}

/* ---------- ledger list ---------- */
export function txRowsHtml(list) {
  if (!list.length) return '<div class="empty">تراکنشی ثبت نشده</div>';
  return `<div class="list">${list.map((t) => {
    const c = fin.catOf(t.category);
    const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
    const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '⇄ ';
    return `<div class="item" data-pick="${t.id}" role="button">
      <span class="item-icon"><span class="material-symbols-outlined">${c.icon}</span></span>
      <span class="grow"><span class="item-title">${esc(t.note || c.label)}</span><span class="item-sub">${esc(fin.txLabel(t))} • ${faDayMonth(parseIso(t.date))}</span></span>
      <b class="amt ${cls}">${sign}${M(t.amount)}</b></div>`;
  }).join('')}</div>`;
}

export function historySheet() {
  const list = fin.sortedTx();
  const groups = new Map();
  list.forEach((t) => { const k = monthKey(t.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  let html = '';
  groups.forEach((rows, k) => { html += `<div class="group-label">${monthLabel(k)}</div>${txRowsHtml(rows)}`; });
  infoSheet('همه‌ی تراکنش‌ها', `<p class="sheet-sub">برای ویرایش یا حذف، روی تراکنش بزنید.</p>${html || '<div class="empty">تراکنشی ثبت نشده</div>'}`, [],
    (el, close) => { close(); later(() => txSheet(null, {}, el.dataset.pick)); });
}

export function exportCsv(list, tag) {
  const q = (x) => { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const rows = [['تاریخ میلادی', 'تاریخ شمسی', 'نوع', 'دسته', 'توضیح', 'مبلغ', 'واحد']];
  list.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((t) => {
    rows.push([t.date, jalaliString(t.date), t.type === 'income' ? 'درآمد' : t.type === 'expense' ? 'هزینه' : 'انتقال', fin.catOf(t.category).label, t.note, t.type === 'expense' ? -t.amount : t.amount, S.profile.currency]);
  });
  saveFile(`ledger-${tag}-${today()}.csv`, `﻿${rows.map((r) => r.map(q).join(',')).join('\r\n')}`, 'text/csv');
}

/* ---------- report ---------- */
export function reportSheet() {
  const mk = currentMonthKey();
  const inc = fin.monthSum('income');
  const exp = fin.monthSum('expense');
  const prev = fin.monthSum('expense', prevMonthKey());
  const diff = prev ? Math.round(((exp - prev) / prev) * 100) : null;
  const by = fin.expenseByCategory(mk);
  const cats = Object.keys(by).sort((a, b) => by[b] - by[a]);
  const tile = (label, value, cls = '') => `<div><small>${label}</small><b class="${cls}">${value}</b></div>`;
  let html = `<p class="sheet-sub">${monthLabel(mk)}</p><div class="stat-grid">
    ${tile('درآمد', M(inc), 'pos')}${tile('هزینه', M(exp), 'neg')}${tile('خالص', M(inc - exp))}
    ${tile('نسبت به ماه قبل', diff == null ? '—' : `${diff > 0 ? '+' : ''}${fa(diff)}٪`)}</div>`;
  html += '<div class="group-label">هزینه بر اساس دسته</div>';
  html += cats.length ? cats.map((k) => {
    const c = fin.catOf(k);
    const pct = Math.round((by[k] / exp) * 100);
    return `<div class="item"><span class="item-icon"><span class="material-symbols-outlined">${c.icon}</span></span><span class="grow"><span class="item-title">${c.label} <span class="item-sub">${fa(pct)}٪</span></span><span class="progress"><i style="width:${pct}%"></i></span></span><b class="amt">${M(by[k])}</b></div>`;
  }).join('') : '<div class="empty">هنوز هزینه‌ای ثبت نشده</div>';
  infoSheet('گزارش مالی', html, [{ label: 'خروجی اکسل (CSV)', run: () => exportCsv(S.tx, 'all') }]);
}

/* ---------- budgets ---------- */
export function budgetSheet() {
  form({
    title: 'بودجه ماهانه', sub: `قسط‌های ثابت: ${M(MO.total())} • خرج این ماه: ${M(fin.monthSum('expense'))}`,
    fields: [{ name: 'b', label: `سقف ماهانه (${S.profile.currency})`, type: 'number', value: fin.monthBudget() || '' }],
    onSubmit(v) {
      const b = num(v.b);
      if (b <= 0) { toast('مبلغ معتبر وارد کنید'); return false; }
      S.wallet.budget = b;
      commit();
    },
  });
}

export function catBudgetSheet(key) {
  const c = fin.catOf(key);
  form({
    title: `بودجه ${c.label}`, sub: 'خالی بگذارید تا بودجه‌ی این دسته حذف شود.',
    fields: [{ name: 'b', label: `سقف ماهانه (${S.profile.currency})`, type: 'number', value: fin.catBudgets()[key] || '' }],
    onSubmit(v) {
      const b = num(v.b);
      if (b > 0) fin.catBudgets()[key] = b; else delete fin.catBudgets()[key];
      commit();
    },
  });
}

export function addCatBudget() {
  menu('بودجه‌ی دسته', fin.EXP_CATS.filter((k) => !fin.catBudgets()[k]).map((k) => ({ icon: fin.catOf(k).icon, label: fin.catOf(k).label, run: () => catBudgetSheet(k) })));
}

/* ---------- monthly payments ---------- */
export function monthlySheet(id) {
  const m = id ? MO.findMonthly(id) : null;
  form({
    title: m ? 'ویرایش قسط' : 'قسط جدید',
    fields: [
      { name: 'title', label: 'نام (مثلاً برق)', value: m ? m.title : '' },
      { name: 'amount', label: `مبلغ هر ماه (${S.profile.currency})`, type: 'number', value: m ? m.amount : '' },
    ],
    focus: !m,
    extra: m ? [{
      label: 'حذف', cls: 'danger',
      run: () => { const r = MO.removeMonthly(m.id); commit(); toast('حذف شد', { label: 'واگرد', run: () => { S.monthly.splice(r.index, 0, r.item); commit(); } }); },
    }] : [],
    onSubmit(v) {
      const title = (v.title || '').trim();
      const amount = Math.abs(num(v.amount));
      if (!title || !amount) { toast('نام و مبلغ را وارد کنید'); return false; }
      MO.saveMonthly(m, { title, amount });
      commit();
    },
  });
}

/* ---------- savings ---------- */
export function savingSheet(id) {
  const x = id ? SV.findSaving(id) : null;
  form({
    title: x ? 'ویرایش پس‌انداز' : 'پس‌انداز جدید',
    fields: [
      { name: 'place', label: 'کجا؟ (مثلاً بانک، طلا، صندوق)', value: x ? x.place : '' },
      { name: 'amount', label: `چقدر؟ (${S.profile.currency})`, type: 'number', value: x ? x.amount : '' },
    ],
    focus: !x,
    extra: x ? [{ label: 'حذف', cls: 'danger', run: () => { const r = SV.removeSaving(x.id); commit(); toast('حذف شد', { label: 'واگرد', run: () => { S.savings.splice(r.index, 0, r.item); commit(); } }); } }] : [],
    onSubmit(v) {
      const place = (v.place || '').trim();
      const amount = Math.abs(num(v.amount));
      if (!place || !amount) { toast('محل و مبلغ را وارد کنید'); return false; }
      SV.saveSaving(x, { place, amount });
      commit();
    },
  });
}
