/* Money: a short summary, then four strips — transactions · installments · budget · report. */
import { S, commit, refresh } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDayMonth, monthLabel, currentMonthKey } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import { pageHead, addLine, takeLine, putBack, drawers, toggleDrawer, pills, row, check, empty, section, bar, bars, tabOf, setTab } from '../ui/kit.js';
import * as fin from '../domain/finance.js';
import * as MO from '../domain/monthly.js';
import { parseMoneyLine, splitAmount } from '../domain/quick.js';
import { txSheet, historySheet, monthlySheet, budgetSheet, catBudgetSheet, addCatBudget, exportCsv } from '../features/finance-sheets.js';

const ORDER = ['tx', 'monthly', 'budget', 'report'];
const LABELS = { tx: 'تراکنش‌ها', monthly: 'قسط‌ها', budget: 'بودجه', report: 'گزارش' };
let filter = 'all';
let q = '';
const M = (v) => money(v);

/* ---------- summary ---------- */
function summary() {
  const hide = S.privacy;
  const bal = fin.balance();
  const left = fin.budgetLeft();
  const used = fin.monthBudget() ? (fin.monthSum('expense') / fin.monthBudget()) * 100 : 0;
  const cur = S.profile.currency === 'تومان' ? 'ت' : S.profile.currency;
  const amount = hide ? '••••••' : `${bal < 0 ? '-' : ''}${Math.abs(bal).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `<section class="balance-card">
      <div class="row-between"><small class="eyebrow">موجودی فعلی</small><button class="eye" data-act="privacy" aria-label="نمایش یا پنهان کردن مبالغ">${icon(hide ? 'visibility_off' : 'visibility')}</button></div>
      <b class="big-num ltr">${amount} <small>${esc(cur)}</small></b>
      <div class="lines"><div><span>خرج امروز</span><b class="ltr">${money(fin.daySpend(today()), hide)}</b></div>
        <div><span>خرج این ماه</span><b class="ltr">${money(fin.monthSum('expense'), hide)}</b></div></div>
    </section>
    <div class="duo">
      <button class="mini" data-act="to-budget"><small>بودجه‌ی باقی‌مانده</small><b class="ltr ${left < 0 ? 'neg' : ''}">${money(Math.max(0, left), hide)}</b>${bar(used, used >= 100)}</button>
      <button class="mini" data-act="to-monthly"><small>قسط‌های باقی‌مانده این ماه</small><b class="ltr">${money(MO.remainingTotal(), hide)}</b><small>${MO.remainingCount() ? `${fa(MO.remainingCount())} مورد` : 'همه پرداخت شد ✓'}</small></button>
    </div>`;
}

/* ---------- tabs ---------- */
function txTab() {
  const needle = q.trim();
  const list = fin.sortedTx().filter((t) => (filter === 'all' || t.type === filter) && (!needle || `${t.note || ''} ${fin.txLabel(t)}`.includes(needle))).slice(0, 40);
  const rows = list.map((t) => {
    const c = fin.catOf(t.category);
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '−';
    return row({ ic: t.type === 'transfer' ? 'swap_horiz' : c.icon, title: esc(t.note || c.label), sub: `${esc(fin.txLabel(t))} · ${faDayMonth(parseIso(t.date))}`, act: 'tx', attrs: `data-id="${t.id}"`,
      trailing: `<b class="amt ltr ${t.type === 'income' ? 'pos' : ''}">${sign}${M(t.amount)}</b>` });
  }).join('');
  return `<form class="add-line search" data-submit="noop">${icon('search', 'muted')}<input data-key="q" data-input="q" value="${esc(q)}" placeholder="جست‌وجو در تراکنش‌ها…"></form>
    ${pills([{ key: 'all', label: 'همه' }, { key: 'income', label: 'درآمد' }, { key: 'expense', label: 'هزینه' }], filter, 'filter')}
    <div class="list">${rows || empty('تراکنشی پیدا نشد')}</div>
    <button class="link center" data-act="all">همه‌ی تراکنش‌ها</button>`;
}

function monthlyTab() {
  const rows = MO.list().map((m) => row({ ic: '', title: esc(m.title), cls: MO.isPaid(m) ? 'is-done' : '', sub: M(m.amount), act: 'monthly-edit', attrs: `data-id="${m.id}"`, trailing: check('monthly-pay', m.id, MO.isPaid(m)) })).join('');
  return `<section class="card row-between"><span><small>${monthLabel(currentMonthKey())}</small><b class="big ltr block">${M(MO.remainingTotal())}</b><small>باقی‌مانده از ${M(MO.total())}</small></span><span class="end"><small>پرداخت‌شده</small><b class="ltr block pos">${M(MO.paidTotal())}</b></span></section>
    <div class="list cols2">${rows || empty('هنوز چیزی ثبت نشده — مثلاً «برق ۵۰» بنویسید')}</div>
    <small class="center block">با تیک زدن، هزینه‌ی همین ماه ثبت می‌شود؛ ماه بعد خودکار از اول شروع می‌شود.</small>`;
}

function budgetTab() {
  const budget = fin.monthBudget();
  const spent = fin.monthSum('expense');
  const rows = fin.categoryBudgetRows().map((r) => {
    const c = fin.catOf(r.key);
    return row({ ic: c.icon, title: c.label, act: 'cat-budget', attrs: `data-k="${r.key}"`,
      sub: `${M(r.spent)}${r.budget ? ` از ${M(r.budget)}` : ' · بدون بودجه'}${r.budget ? bar((r.spent / r.budget) * 100, r.spent > r.budget) : ''}` });
  }).join('');
  return `<section class="card stack-s">
      <div class="row-between"><b>بودجه‌ی ${monthLabel(currentMonthKey())}</b><button class="link" data-act="set-budget">تنظیم</button></div>
      <div class="row-between"><span><small>خرج‌شده</small><b class="big ltr block">${M(spent)}</b></span><span class="end"><small>باقی‌مانده</small><b class="big ltr block ${budget - spent < 0 ? 'neg' : ''}">${M(Math.max(0, budget - spent))}</b></span></div>
      ${bar(budget ? (spent / budget) * 100 : 0, spent > budget)}
      <small>از ${M(budget)}</small>
    </section>
    ${section('بودجه‌ی دسته‌ها', `<div class="list">${rows || empty('برای دسته‌ها بودجه تعیین نشده')}</div>`)}
    <button class="link center" data-act="new-cat">+ بودجه برای یک دسته</button>`;
}

function reportTab() {
  const top = fin.topExpenseCategory();
  const flow = fin.cashFlow(6);
  const cols = flow.map((r, i) => ({ v: r.expense, label: monthLabel(r.key).split(' ')[0], on: i === flow.length - 1 }));
  const tile = (label, value, cls = '') => `<div class="mini static"><small>${label}</small><b class="ltr ${cls}">${value}</b></div>`;
  return `<div class="duo">${tile('خرج این ماه', M(fin.monthSum('expense')), 'neg')}${tile('درآمد این ماه', M(fin.monthSum('income')), 'pos')}</div>
    <div class="duo">${tile('قسط‌های پرداخت‌شده', M(MO.paidTotal()))}${tile('بیشترین هزینه', top ? `${fin.catOf(top.key).label}` : '—')}</div>
    ${section('خرج ۶ ماه اخیر', `<div class="card">${bars(cols)}</div>`)}
    <button class="link center" data-act="csv">خروجی اکسل (CSV)</button>`;
}

export default {
  id: 'money',
  title: 'مالی',
  mount() { filter = 'all'; q = ''; },
  render() {
    const bodies = { tx: txTab, monthly: monthlyTab, budget: budgetTab, report: reportTab };
    const items = ORDER.map((key) => ({ key, label: LABELS[key], body: () => `<div class="stack">${bodies[key]()}</div>` }));
    const stored = tabOf('money', 'tx');
    const open = ORDER.includes(stored) || stored === '' ? stored : 'tx';
    return `${pageHead('مالی', 'موجودی، خرج و قسط‌ها')}${summary()}${open === 'tx' ? addLine('مثلاً نهار ۱۲۰ — برای درآمد: +حقوق ۱۵۰۰') : open === 'monthly' ? addLine('مثلاً برق ۵۰ — و Enter') : ''}${drawers(items, open)}`;
  },
  act: {
    tab: toggleDrawer('money'),
    privacy() { S.privacy = !S.privacy; commit(); },
    'to-budget': () => setTab('money', 'budget'),
    'to-monthly': () => setTab('money', 'monthly'),
    filter(el) { filter = el.dataset.v; refresh(); },
    noop() {},
    tx: (el) => txSheet(null, {}, el.dataset.id),
    all: () => historySheet(),
    'monthly-pay'(el) {
      const m = MO.findMonthly(el.dataset.id);
      if (MO.isPaid(m)) MO.unpay(m); else MO.pay(m);
      commit();
    },
    'monthly-edit': (el) => monthlySheet(el.dataset.id),
    'set-budget': budgetSheet,
    'new-cat': addCatBudget,
    'cat-budget': (el) => catBudgetSheet(el.dataset.k),
    csv: () => exportCsv(S.tx, 'all'),
    quick(el) {
      const line = takeLine(el);
      if (!line) return;
      if (tabOf('money', 'tx') === 'monthly') {
        const { title, amount } = splitAmount(line);
        if (!title || !amount) { toast('نام و مبلغ را بنویسید، مثلاً برق ۵۰'); putBack(el, line); return; }
        MO.saveMonthly(null, { title, amount });
      } else {
        const { type, title, amount } = parseMoneyLine(line);
        if (!amount) { toast('مبلغ را هم بنویسید، مثلاً نهار ۱۲۰'); putBack(el, line); return; }
        fin.saveTx(null, { type, amount, category: type === 'income' ? 'salary' : 'other', note: title, date: today(), accountId: fin.defAcc() });
      }
      commit();
    },
  },
  input: { q(el) { q = el.value; refresh(); } },
};
