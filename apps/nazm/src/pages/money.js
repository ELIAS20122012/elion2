/* Money: balance, add in one step, what is due soon, recent activity. */
import { S, commit } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { esc, money } from '../core/format.js';
import { faDayMonth, relDay } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import * as fin from '../domain/finance.js';
import { txSheet, historySheet, payNow, manageMenu } from '../features/finance-sheets.js';

function dueRow(d) {
  const over = d.due < today();
  const ref = d.kind === 'loan' ? `data-n="${d.n}"` : `data-due="${d.due}"`;
  return `<div class="row-item">
    <span class="thumb">${icon(d.icon)}</span>
    <span class="grow col"><span class="truncate">${esc(d.title)}</span><small class="${over ? 'neg' : ''}">${relDay(d.due)}</small></span>
    <b class="ltr">${money(d.amount)}</b>
    <button class="pill" data-act="pay" data-kind="${d.kind}" data-id="${d.ref.id}" ${ref}>پرداخت</button></div>`;
}

function txRow(t) {
  const c = fin.catOf(t.category);
  const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '−';
  return `<button class="row-item" data-act="tx" data-id="${t.id}"><span class="thumb">${icon(t.type === 'transfer' ? 'swap_horiz' : c.icon)}</span>
    <span class="grow col"><span class="truncate">${esc(t.note || c.label)}</span><small>${esc(fin.txLabel(t))} · ${faDayMonth(parseIso(t.date))}</small></span>
    <b class="ltr ${t.type === 'income' ? 'pos' : ''}">${sign}${money(t.amount)}</b></button>`;
}

export default {
  id: 'money',
  title: 'پول',
  render() {
    const bal = fin.balance();
    const hide = S.privacy;
    const due = fin.dueItems(7);
    const recent = fin.sortedTx().slice(0, 8);
    const cur = S.profile.currency === 'تومان' ? 'ت' : S.profile.currency;
    const amount = hide ? '••••••' : `${bal < 0 ? '-' : ''}${Math.abs(bal).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    return `
      <section class="hero">
        <div class="row-between"><small class="eyebrow">موجودی کل</small>
          <button class="round ghost-light" data-act="privacy" aria-label="نمایش یا پنهان کردن مبالغ">${icon(hide ? 'visibility_off' : 'visibility')}</button></div>
        <div class="balance"><b class="ltr">${amount}</b><span>${esc(cur)}</span></div>
        <div class="glance two">
          <div class="glance-cell"><b>${money(fin.monthSum('income'), hide)}</b><small>درآمد این ماه</small></div>
          <div class="glance-cell"><b>${money(fin.monthSum('expense'), hide)}</b><small>هزینه این ماه</small></div>
        </div>
      </section>
      <div class="actions"><button class="btn" data-act="expense">${icon('arrow_upward')}هزینه</button><button class="btn ghost" data-act="income">${icon('arrow_downward')}درآمد</button></div>
      ${due.length ? `<section class="section"><div class="section-head"><h3>سررسید نزدیک</h3></div><div class="list-plain">${due.map(dueRow).join('')}</div></section>` : ''}
      <section class="section">
        <div class="section-head"><h3>اخیر</h3><button class="link" data-act="all">همه</button></div>
        <div class="list-plain">${recent.map(txRow).join('') || '<p class="empty">هنوز چیزی ثبت نشده</p>'}</div>
      </section>
      <button class="link center" data-act="manage">قسط، قبض و حساب‌ها ${icon('chevron_left', 'tiny')}</button>`;
  },
  act: {
    privacy() { S.privacy = !S.privacy; commit(); },
    expense: () => txSheet('expense'),
    income: () => txSheet('income'),
    tx: (el) => txSheet(null, {}, el.dataset.id),
    all: () => historySheet(),
    manage: manageMenu,
    pay(el) {
      const { kind, id } = el.dataset;
      const it = fin.dueItems(7).find((d) => d.kind === kind && d.ref.id === id && (kind === 'loan' ? d.n === +el.dataset.n : d.due === el.dataset.due));
      if (it) payNow(it); else toast('این مورد دیگر سررسید نیست');
    },
  },
};
