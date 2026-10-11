/* Money: balance, add expense/income in one step, what is due soon, recent activity. */
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
  return `<div class="due-row well">
    ${icon(d.icon, over ? 'neg' : 'muted')}
    <span class="grow col"><b class="truncate">${esc(d.title)}</b><small class="${over ? 'neg bold' : 'muted'}">${relDay(d.due)}</small></span>
    <b class="ltr">${money(d.amount)}</b>
    <button class="mini-btn accent" data-act="pay" data-kind="${d.kind}" data-id="${d.ref.id}" ${ref}>پرداخت</button></div>`;
}

function txRow(t) {
  const c = fin.catOf(t.category);
  const cls = t.type === 'income' ? 'pos' : t.type === 'transfer' ? 'muted' : 'neg';
  const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '−';
  return `<button class="well tx-row" data-act="tx" data-id="${t.id}"><span class="item-icon">${icon(t.type === 'transfer' ? 'swap_horiz' : c.icon)}</span>
    <span class="grow col"><b class="truncate">${esc(t.note || c.label)}</b><small class="muted">${esc(fin.txLabel(t))} • ${faDayMonth(parseIso(t.date))}</small></span><b class="ltr ${cls}">${sign}${money(t.amount)}</b></button>`;
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
      <section class="card stack">
        <div class="row-between"><small class="muted">موجودی کل</small>
          <button class="icon-btn xs" data-act="privacy" aria-label="نمایش یا پنهان کردن مبالغ">${icon(hide ? 'visibility_off' : 'visibility')}</button></div>
        <div class="row"><b class="hero-amount ltr">${amount}</b><b class="muted t-head">${esc(cur)}</b></div>
        <div class="grid2 gap-sm">
          <div class="well metric"><small>درآمد این ماه</small><b class="pos">${money(fin.monthSum('income'), hide)}</b></div>
          <div class="well metric"><small>هزینه این ماه</small><b class="neg">${money(fin.monthSum('expense'), hide)}</b></div>
        </div>
      </section>
      <div class="grid2 gap-sm">
        <button class="btn-add" data-act="expense">${icon('arrow_upward')}هزینه</button>
        <button class="btn-add sage" data-act="income">${icon('arrow_downward')}درآمد</button>
      </div>
      ${due.length ? `<section class="stack-sm"><b class="section-head">سررسید نزدیک</b>${due.map(dueRow).join('')}</section>` : ''}
      <section class="stack-sm">
        <div class="row-between section-head"><b>اخیر</b><button class="link accent" data-act="all">همه</button></div>
        ${recent.map(txRow).join('') || '<div class="empty">هنوز چیزی ثبت نشده</div>'}
      </section>
      <button class="link muted center" data-act="manage">${icon('tune', 'tiny')} قسط، قبض و حساب‌ها</button>`;
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
