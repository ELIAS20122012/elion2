/* Money: a short summary, then four strips — transactions · installments · budget · report. */
import { S, commit, refresh } from '../core/store.js';
import { parseIso, today } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDayMonth, monthLabel, currentMonthKey } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import { pageHead, addLine, takeLine, putBack, hubGrid, subHead, toHub, enter, pills, row, empty, section, bar, bars, tabOf, setTab } from '../ui/kit.js';
import * as fin from '../domain/finance.js';
import * as MO from '../domain/monthly.js';
import * as SV from '../domain/savings.js';
import { parseMoneyLine, splitAmount } from '../domain/quick.js';
import { txSheet, historySheet, monthlySheet, savingSheet, budgetSheet, removeBudget, removeCatBudget, catBudgetSheet, exportCsv } from '../features/finance-sheets.js';

const ORDER = ['tx', 'monthly', 'budget', 'savings', 'report'];
const ICONS = { tx: 'receipt_long', monthly: 'event_repeat', budget: 'donut_large', savings: 'savings', report: 'bar_chart' };
const LABELS = { tx: 'تراکنش‌ها', monthly: 'قسط‌ها', budget: 'بودجه', savings: 'پس‌انداز', report: 'گزارش' };
let filter = 'all';
let q = '';
const M = (v) => money(v);

/* ---------- summary ---------- */
function summary() {
  const hide = S.privacy;
  const bal = fin.balance();
  const left = fin.budgetLeft();
  const used = fin.budgetUsedPct();
  const cur = S.profile.currency === 'تومان' ? 'ت' : S.profile.currency;
  const amount = hide ? '••••••' : `${bal < 0 ? '-' : ''}${Math.abs(bal).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `<section class="balance-card">
      <div class="row-between"><small class="eyebrow">موجودی فعلی</small><button class="eye" data-act="privacy" aria-label="نمایش یا پنهان کردن مبالغ">${icon(hide ? 'visibility_off' : 'visibility')}</button></div>
      <b class="big-num ltr">${amount} <small>${esc(cur)}</small></b>
      <div class="lines"><div><span>خرج امروز</span><b class="ltr">${money(fin.daySpend(today()), hide)}</b></div>
        <div><span>خرج این ماه</span><b class="ltr">${money(fin.monthSum('expense'), hide)}</b></div></div>
    </section>
    <div class="duo">
      <button class="mini" data-act="to-budget"><small>بودجه‌ی باقی‌مانده</small>${fin.monthBudget() ? `<b class="ltr ${left < 0 ? 'neg' : ''}">${money(Math.max(0, left), hide)}</b>${bar(used, used >= 100)}` : '<b>تعیین نشده</b>'}</button>
      <button class="mini" data-act="to-monthly"><small>قسط‌های ثابت ماهانه</small><b class="ltr">${money(MO.total(), hide)}</b><small>${fa(MO.list().length)} مورد</small></button>
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
  const rows = MO.list().map((m) => row({ ic: '', title: esc(m.title), sub: M(m.amount), act: 'monthly-edit', attrs: `data-id="${m.id}"`,
    trailing: `<button class="x-btn" data-act="monthly-remove" data-id="${m.id}" aria-label="حذف">${icon('close')}</button>` })).join('');
  return `<section class="card row-between"><span><small>جمع قسط‌های ماهانه</small><b class="big ltr block">${M(MO.total())}</b></span><span class="end"><small>باقی‌مانده‌ی بودجه</small><b class="ltr block ${fin.budgetLeft() < 0 ? 'neg' : 'pos'}">${M(fin.budgetLeft())}</b></span></section>
    <div class="list cols2">${rows || empty('هنوز چیزی ثبت نشده — مثلاً «برق ۵۰» بنویسید')}</div>
    <small class="center block">این مبلغ‌ها هر ماه از بودجه کم می‌شوند. وقتی قسطی تمام شد، با × حذفش کنید.</small>`;
}

function savingsTab() {
  const rows = SV.list().map((x) => row({ ic: '', title: esc(x.place), sub: M(x.amount), act: 'saving-edit', attrs: `data-id="${x.id}"`,
    trailing: `<button class="x-btn" data-act="saving-remove" data-id="${x.id}" aria-label="حذف">${icon('close')}</button>` })).join('');
  return `<section class="card row-between"><span><small>جمع پس‌انداز</small><b class="big ltr block">${M(SV.total())}</b></span><span class="end"><small>${fa(SV.list().length)} جا</small></span></section>
    <div class="list cols2">${rows || empty('هنوز چیزی ثبت نشده — مثلاً «طلا ۸۰۰» بنویسید')}</div>
    <small class="center block">بنویس کجا پس‌انداز کرده‌ای و چقدر. با × حذف می‌شود.</small>`;
}

function budgetTab() {
  const budget = fin.monthBudget();
  const spent = fin.monthSum('expense');
  const fixed = MO.total();
  const left = fin.budgetLeft();
  const rows = fin.categoryBudgetRows().map((r) => {
    const c = fin.catOf(r.key);
    return row({ ic: '', title: c.label,
      sub: `${M(r.spent)}${r.budget ? ` از ${M(r.budget)}` : ' · بدون بودجه'}${r.budget ? bar((r.spent / r.budget) * 100, r.spent > r.budget) : ''}`,
      trailing: `<span class="gym-tools"><button class="link" data-act="cat-budget" data-k="${r.key}">${r.budget ? 'ویرایش' : 'تعیین'}</button>${r.budget ? `<button class="link bad" data-act="cat-remove" data-k="${r.key}">حذف</button>` : ''}</span>` });
  }).join('');
  const main = budget
    ? `<section class="card stack-s">
      <div class="row-between"><b>بودجه‌ی ${monthLabel(currentMonthKey())}</b><span class="gym-tools"><button class="link" data-act="set-budget">ویرایش</button><button class="link bad" data-act="budget-remove">حذف</button></span></div>
      <div class="lines-plain"><div><span>بودجه</span><b class="ltr">${M(budget)}</b></div><div><span>قسط‌های ثابت</span><b class="ltr">− ${M(fixed)}</b></div><div><span>خرج‌شده</span><b class="ltr">− ${M(spent)}</b></div></div>
      <div class="row-between"><small>باقی‌مانده</small><b class="big ltr ${left < 0 ? 'neg' : ''}">${M(left)}</b></div>
      ${bar(fin.budgetUsedPct(), left < 0)}
    </section>`
    : `<section class="card stack-s"><div class="row-between"><b>بودجه‌ی ${monthLabel(currentMonthKey())}</b><button class="link" data-act="set-budget">+ تعیین بودجه</button></div><small>بودجه‌ای تعیین نشده.</small></section>`;
  return `${main}
    ${section('بودجه‌ی دسته‌ها', `<div class="list">${rows || empty('برای دسته‌ها بودجه تعیین نشده')}</div>`)}
    <button class="link center" data-act="new-cat">+ بودجه برای یک دسته</button>`;
}

function reportTab() {
  const top = fin.topExpenseCategory();
  const flow = fin.cashFlow(6);
  const cols = flow.map((r, i) => ({ v: r.expense, label: monthLabel(r.key).split(' ')[0], on: i === flow.length - 1 }));
  const tile = (label, value, cls = '') => `<div class="mini static"><small>${label}</small><b class="ltr ${cls}">${value}</b></div>`;
  return `<div class="duo">${tile('خرج این ماه', M(fin.monthSum('expense')), 'neg')}${tile('درآمد این ماه', M(fin.monthSum('income')), 'pos')}</div>
    <div class="duo">${tile('قسط‌های ثابت', M(MO.total()))}${tile('بیشترین هزینه', top ? `${fin.catOf(top.key).label}` : '—')}</div>
    ${section('خرج ۶ ماه اخیر', `<div class="card">${bars(cols)}</div>`)}
    <button class="link center" data-act="csv">خروجی اکسل (CSV)</button>`;
}

export default {
  id: 'money',
  title: 'مالی',
  mount() { filter = 'all'; q = ''; enter('money'); },
  render() {
    const bodies = { tx: txTab, monthly: monthlyTab, budget: budgetTab, savings: savingsTab, report: reportTab };
    const cur = tabOf('money', '');
    if (!bodies[cur]) return `${pageHead('مالی', 'موجودی، خرج و قسط‌ها')}${summary()}${hubGrid(ORDER.map((key) => ({ key, label: LABELS[key], ic: ICONS[key] })))}`;
    const line = cur === 'tx' ? addLine('مثلاً نهار ۱۲۰ — برای درآمد: +حقوق ۱۵۰۰') : cur === 'monthly' ? addLine('مثلاً برق ۵۰ — و Enter') : cur === 'savings' ? addLine('مثلاً طلا ۸۰۰ — و Enter') : '';
    return `${subHead(LABELS[cur])}${line}<div class="stack">${bodies[cur]()}</div>`;
  },
  act: {
    tab: (el) => setTab('money', el.dataset.v),
    hub: () => toHub('money'),
    privacy() { S.privacy = !S.privacy; commit(); },
    'to-budget': () => setTab('money', 'budget'),
    'to-monthly': () => setTab('money', 'monthly'),
    filter(el) { filter = el.dataset.v; refresh(); },
    noop() {},
    tx: (el) => txSheet(null, {}, el.dataset.id),
    all: () => historySheet(),
    'monthly-remove'(el) {
      const r = MO.removeMonthly(el.dataset.id);
      if (!r) return;
      commit();
      toast(`«${r.item.title}» حذف شد`, { label: 'واگرد', run: () => { S.monthly.splice(r.index, 0, r.item); commit(); } });
    },
    'monthly-edit': (el) => monthlySheet(el.dataset.id),
    'saving-edit': (el) => savingSheet(el.dataset.id),
    'saving-remove'(el) {
      const r = SV.removeSaving(el.dataset.id);
      if (!r) return;
      commit();
      toast(`«${r.item.place}» حذف شد`, { label: 'واگرد', run: () => { S.savings.splice(r.index, 0, r.item); commit(); } });
    },
    'set-budget': budgetSheet,
    'budget-remove': removeBudget,
    'cat-remove'(el) { removeCatBudget(el.dataset.k); },
    'new-cat': () => catBudgetSheet(null),
    'cat-budget': (el) => catBudgetSheet(el.dataset.k),
    csv: () => exportCsv(S.tx, 'all'),
    quick(el) {
      const line = takeLine(el);
      if (!line) return;
      const where = tabOf('money', 'tx');
      if (where === 'savings') {
        const { title, amount } = splitAmount(line);
        if (!title || !amount) { toast('محل و مبلغ را بنویسید، مثلاً طلا ۸۰۰'); putBack(el, line); return; }
        SV.saveSaving(null, { place: title, amount });
      } else if (where === 'monthly') {
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
