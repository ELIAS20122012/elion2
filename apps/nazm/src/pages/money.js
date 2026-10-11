/* Money: a short summary, then four strips — transactions · installments · budget · report. */
import { S, commit, refresh } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDayMonth, fullDate, relDay, monthLabel, shiftMonthKey, currentMonthKey } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { menu } from '../ui/sheet.js';
import { icon } from '../ui/widgets.js';
import { pageHead, drawers, toggleDrawer, pills, row, fab, empty, section, bar, bars, tabOf, openOr, setTab } from '../ui/kit.js';
import * as fin from '../domain/finance.js';
import { txSheet, historySheet, payLoan, loanSheet, loanMenu, budgetSheet, catBudgetSheet, addCatBudget, exportCsv } from '../features/finance-sheets.js';

const ORDER = ['tx', 'loans', 'budget', 'report'];
const LABELS = { tx: 'تراکنش‌ها', loans: 'قسط‌ها', budget: 'بودجه', report: 'گزارش' };
let filter = 'all';
let q = '';
const M = (v) => money(v);

/* ---------- summary ---------- */
function summary() {
  const hide = S.privacy;
  const bal = fin.balance();
  const left = fin.budgetLeft();
  const used = fin.monthBudget() ? (fin.monthSum('expense') / fin.monthBudget()) * 100 : 0;
  const near = fin.nearestInstallment();
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
      <button class="mini" data-act="to-loans"><small>نزدیک‌ترین قسط</small><b class="truncate">${near ? esc(near.title) : 'قسطی نیست'}</b>${near ? `<small class="${near.due < today() ? 'neg' : ''}">${relDay(near.due)} · ${money(near.amount, hide)}</small>` : '<small>—</small>'}</button>
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

const STATUS = { done: ['پرداخت‌شده', 'ok'], overdue: ['معوق', 'bad'], soon: ['نزدیک', 'warn'], open: ['در انتظار', ''] };

function loansTab() {
  const rows = S.loans.map((l) => {
    const n = fin.loanNextN(l);
    const st = fin.loanStatus(l);
    const left = l.count - fin.loanPaidCount(l);
    return row({ ic: 'event_repeat', title: esc(l.title), act: 'loan', attrs: `data-id="${l.id}"`,
      sub: `${M(l.amount)} · ${n ? `سررسید ${fullDate(fin.loanDue(l, n))}` : 'تسویه شد'} · ${fa(left)} قسط مانده<span class="badge ${STATUS[st][1]}">${STATUS[st][0]}</span>`,
      trailing: `<button class="icon-btn sm${l.remind !== false ? ' on' : ''}" data-act="remind" data-id="${l.id}" aria-label="یادآور">${icon(l.remind !== false ? 'notifications_active' : 'notifications_off')}</button>${n ? `<button class="btn-sm" data-act="pay-loan" data-id="${l.id}">پرداخت</button>` : ''}` });
  }).join('');
  return `<section class="card row-between"><span><small>مانده‌ی کل اقساط</small><b class="big ltr block">${M(fin.loansRemaining())}</b></span></section>
    <div class="list">${rows || empty('قسطی ثبت نشده')}</div>`;
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
    ${section('بودجه‌ی دسته‌ها', `<div class="list">${rows || empty('برای دسته‌ها بودجه تعیین نشده')}</div>`)}`;
}

function reportTab() {
  const top = fin.topExpenseCategory();
  const flow = fin.cashFlow(6);
  const cols = flow.map((r, i) => ({ v: r.expense, label: monthLabel(r.key).split(' ')[0], on: i === flow.length - 1 }));
  const tile = (label, value, cls = '') => `<div class="mini static"><small>${label}</small><b class="ltr ${cls}">${value}</b></div>`;
  return `<div class="duo">${tile('خرج این ماه', M(fin.monthSum('expense')), 'neg')}${tile('درآمد این ماه', M(fin.monthSum('income')), 'pos')}</div>
    <div class="duo">${tile('قسط‌های پرداخت‌شده', M(fin.installmentsPaidThisMonth()))}${tile('بیشترین هزینه', top ? `${fin.catOf(top.key).label}` : '—')}</div>
    ${section('خرج ۶ ماه اخیر', `<div class="card">${bars(cols)}</div>`)}
    <button class="link center" data-act="csv">خروجی اکسل (CSV)</button>`;
}

export default {
  id: 'money',
  title: 'مالی',
  mount() { filter = 'all'; q = ''; },
  render() {
    const bodies = { tx: txTab, loans: loansTab, budget: budgetTab, report: reportTab };
    const items = ORDER.map((key) => ({ key, label: LABELS[key], body: () => `<div class="stack">${bodies[key]()}</div>` }));
    const open = tabOf('money', 'tx');
    return `${pageHead('مالی', 'موجودی، خرج و قسط‌ها')}${summary()}${drawers(items, open)}${open === 'report' ? '' : fab('add')}`;
  },
  act: {
    tab: toggleDrawer('money'),
    privacy() { S.privacy = !S.privacy; commit(); },
    'to-budget': () => setTab('money', 'budget'),
    'to-loans': () => setTab('money', 'loans'),
    filter(el) { filter = el.dataset.v; refresh(); },
    noop() {},
    tx: (el) => txSheet(null, {}, el.dataset.id),
    all: () => historySheet(),
    loan(el) { const l = S.loans.find((x) => x.id === el.dataset.id); if (l) loanMenu(l); },
    'pay-loan'(el) { const l = S.loans.find((x) => x.id === el.dataset.id); payLoan(l, fin.loanNextN(l)); },
    remind(el) { const l = S.loans.find((x) => x.id === el.dataset.id); l.remind = l.remind === false; commit(); toast(l.remind ? 'یادآور روشن شد' : 'یادآور خاموش شد'); },
    'set-budget': budgetSheet,
    'cat-budget': (el) => catBudgetSheet(el.dataset.k),
    csv: () => exportCsv(S.tx, 'all'),
    add() {
      const tab = openOr('money', 'tx');
      if (tab === 'loans') loanSheet();
      else if (tab === 'budget') menu('بودجه', [{ icon: 'savings', label: 'بودجه‌ی ماهانه', run: budgetSheet }, { icon: 'category', label: 'بودجه برای یک دسته', run: addCatBudget }]);
      else menu('ثبت جدید', [{ icon: 'arrow_upward', label: 'هزینه', run: () => txSheet('expense') }, { icon: 'arrow_downward', label: 'درآمد', run: () => txSheet('income') }]);
    },
  },
  input: { q(el) { q = el.value; refresh(); } },
};
