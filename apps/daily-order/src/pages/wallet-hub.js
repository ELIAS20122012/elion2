/* The "accounting" accordion on the wallet page: dues, installments, bills, accounts, ledger, chart, budget, quick add. */
import { S, commit, refresh } from '../core/store.js';
import { iso, addDays, parseIso, today, WD_SHORT } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDayMonth, monthKey, monthLabel, monthYear, shiftMonthKey, currentMonthKey, relDay } from '../core/calendar.js';
import { sum } from '../core/util.js';
import { toast } from '../ui/toast.js';
import { icon, stat, badge, emptyNote, addButton, ring, barChart, progress } from '../ui/widgets.js';
import { group } from '../ui/hub.js';
import * as fin from '../domain/finance.js';
import {
  payDialog, payLoan, payBill, loanSheet, loanMenu, loanSchedule, billSheet, billMenu, billHistory,
  accountSheet, accountMenu, transferSheet, txSheet, newTxMenu, exportCsv,
} from '../features/finance-sheets.js';

const M = (v) => money(v);
const ledger = { month: currentMonthKey(), type: 'all', acc: 'all', q: '', limit: 8, showFilter: false };
const chart = { range: '7d', picked: null };

export const SECTION_DEFS = [
  { key: 'dues', title: 'سررسیدها', icon: 'notifications_active', color: '#DE8353' },
  { key: 'loans', title: 'اقساط و وام‌ها', icon: 'event_repeat', color: '#865228' },
  { key: 'bills', title: 'قبوض و پرداخت‌های دوره‌ای', icon: 'receipt_long', color: '#5d7a8c' },
  { key: 'accounts', title: 'حساب‌ها و کارت‌ها', icon: 'account_balance', color: '#4d7c62' },
  { key: 'ledger', title: 'دفتر تراکنش‌ها', icon: 'menu_book', color: '#6b6f9c' },
  { key: 'chart', title: 'نمودار هزینه‌ها', icon: 'bar_chart', color: '#8EAA97' },
  { key: 'budget', title: 'بودجه ماهانه', icon: 'speed', color: '#c08a3e' },
  { key: 'quick', title: 'ثبت سریع هزینه', icon: 'bolt', color: '#DE8353' },
];

const money2 = (v) => Math.round(v * 100) / 100;
const subOn = (id, def = false) => (S.ui.sub[id] === undefined ? def : S.ui.sub[id]);
const sumAmount = (l) => sum(l, (d) => d.amount);

/* ---------- dues ---------- */
function dueLine(d) {
  const over = d.due < today();
  const ref = d.kind === 'loan' ? `data-n="${d.n}"` : `data-due="${d.due}"`;
  return `<div class="due-row card-sm">
    ${icon(d.icon, over ? 'accent' : 'muted')}
    <span class="grow col"><b class="truncate">${esc(d.title)}</b><small class="${over ? 'neg bold' : 'muted'} truncate">${relDay(d.due)} • ${esc(d.sub)}</small></span>
    <b class="ltr">${M(d.amount)}</b>
    <button class="mini-btn accent" data-act="pay" data-kind="${d.kind}" data-id="${d.ref.id}" ${ref}>پرداخت</button></div>`;
}

function duesBody(b) {
  const empty = emptyNote('موردی نیست');
  let html = `<div class="grid2 gap-sm">${stat('پرداختنی ۳۰ روز', M(sumAmount(b.week) + sumAmount(b.month)))}${stat('مانده بدهی اقساط', M(fin.loansRemaining()), 'neg')}</div>`;
  if (b.over.length) html += group({ id: 'g-over', title: 'معوق', count: b.over.length, red: true, def: true, inner: b.over.map(dueLine).join(''), extra: M(sumAmount(b.over)) });
  html += group({ id: 'g-week', title: 'تا ۷ روز آینده', count: b.week.length, def: true, inner: b.week.map(dueLine).join('') || empty, extra: M(sumAmount(b.week)) });
  html += group({ id: 'g-month', title: 'تا ۳۰ روز آینده', count: b.month.length, inner: b.month.map(dueLine).join('') || empty, extra: M(sumAmount(b.month)) });
  if (b.later.length) html += group({ id: 'g-later', title: 'بعدتر (تا ۶۰ روز)', count: b.later.length, inner: b.later.map(dueLine).join(''), extra: M(sumAmount(b.later)) });
  return html;
}

/* ---------- loans ---------- */
function loansBody() {
  const t0 = today();
  const thisMonth = sum(S.loans, (l) => { const n = fin.loanNextN(l); return n && monthKey(fin.loanDue(l, n)) <= currentMonthKey() ? l.amount : 0; });
  const cards = S.loans.map((l) => {
    const id = `l-${l.id}`;
    const on = subOn(id);
    const paid = fin.loanPaidCount(l);
    const nx = fin.loanNextN(l);
    const pct = Math.round((paid / l.count) * 100);
    const nd = nx && fin.loanDue(l, nx);
    const over = nd && nd < t0;
    const head = `<button class="group-head" data-act="sub" data-id="${id}" data-def="0">
      ${ring(pct, `${fa(pct)}٪`, 38)}
      <span class="grow col"><b class="truncate">${esc(l.title)}</b><small class="${over ? 'neg bold' : 'muted'} truncate">${nx ? `قسط ${fa(nx)} • ${relDay(nd)}` : 'تسویه شد ✓'}</small></span>
      <b class="ltr">${M(fin.loanRemaining(l))}</b><span class="chev material-symbols-outlined${on ? ' open' : ''}">chevron_left</span></button>`;
    const detail = on ? `<div class="group-body">
      <div class="grid2 gap-sm">${stat('هر قسط', M(l.amount))}${stat('پرداخت‌شده', `${fa(paid)} از ${fa(l.count)}`)}${stat('قسط بعدی', nx ? faDayMonth(parseIso(nd)) : '—', over ? 'neg' : '')}${stat('وام‌دهنده', esc(l.lender || '—'))}</div>
      <div class="grid3 gap-sm">${nx ? `<button class="mini-btn accent" data-act="pay-loan" data-id="${l.id}">پرداخت قسط</button>` : '<span></span>'}<button class="mini-btn" data-act="loan-schedule" data-id="${l.id}">جدول اقساط</button><button class="mini-btn muted" data-act="loan-menu" data-id="${l.id}">بیشتر…</button></div></div>` : '';
    return `<div class="group">${head}${detail}</div>`;
  }).join('') || emptyNote('هنوز قسطی ثبت نشده');
  return `<div class="grid2 gap-sm">${stat('مانده کل بدهی', M(fin.loansRemaining()), 'neg')}${stat('قسط‌های این ماه', M(thisMonth))}</div>${cards}${addButton('ثبت قسط / وام جدید', 'loan-new')}`;
}

/* ---------- bills ---------- */
function billsBody() {
  const t0 = today();
  const active = S.bills.filter((b) => !b.paused);
  const monthly = sum(active, (b) => fin.billAvg(b) / (b.every || 1));
  const paidThisMonth = sum(fin.paidObligationsThisMonth().filter((t) => t.billId), (t) => t.amount);
  const cards = S.bills.map((b) => {
    const id = `b-${b.id}`;
    const on = subOn(id);
    const k = fin.billKind(b);
    const nx = fin.billNext(b);
    const over = nx && nx.due < t0 && !b.paused;
    const recent = Object.keys(b.paid).sort().reverse().slice(0, 4);
    const head = `<button class="group-head${b.paused ? ' faded' : ''}" data-act="sub" data-id="${id}" data-def="0">
      ${icon(k.icon, over ? 'accent' : 'muted')}
      <span class="grow col"><b class="truncate">${esc(b.title)}</b><small class="${over ? 'neg bold' : 'muted'} truncate">${b.paused ? 'متوقف' : `${over ? 'معوق • ' : ''}${relDay(nx.due)}`} • ${fin.EVERY[b.every || 1]}</small></span>
      <b class="ltr">${M(fin.billAvg(b))}</b><span class="chev material-symbols-outlined${on ? ' open' : ''}">chevron_left</span></button>`;
    const detail = on ? `<div class="group-body">
      ${recent.length ? `<small class="muted bold">آخرین پرداخت‌ها</small>${recent.map((d) => `<div class="row-between small"><span>${monthYear(d)}</span><b class="ltr">${M(b.paid[d].amount)}</b></div>`).join('')}` : '<small class="muted">هنوز پرداختی ثبت نشده</small>'}
      <div class="grid3 gap-sm">${b.paused ? '<span></span>' : `<button class="mini-btn accent" data-act="pay-bill" data-id="${b.id}">پرداخت</button>`}<button class="mini-btn" data-act="bill-history" data-id="${b.id}">سابقه</button><button class="mini-btn muted" data-act="bill-menu" data-id="${b.id}">بیشتر…</button></div></div>` : '';
    return `<div class="group">${head}${detail}</div>`;
  }).join('') || emptyNote('هنوز قبضی ثبت نشده');
  return `<div class="grid2 gap-sm">${stat('میانگین ماهانه', M(monthly))}${stat('پرداخت‌شده این ماه', M(paidThisMonth), 'pos')}</div>${cards}${addButton('قبض یا پرداخت دوره‌ای جدید', 'bill-new')}`;
}

/* ---------- accounts ---------- */
function accountsBody() {
  const net = fin.balance() - fin.loansRemaining();
  const rows = S.accounts.map((a) => {
    const t = fin.accType(a);
    const bal = fin.accBalance(a.id);
    return `<button class="group account-row" data-act="account" data-id="${a.id}">${icon(t.icon, 'muted')}<span class="grow col"><b class="truncate">${esc(a.name)}</b><small class="muted">${t.label}</small></span><b class="ltr${bal < 0 ? ' neg' : ''}">${M(bal)}</b>${icon('more_vert', 'muted')}</button>`;
  }).join('');
  return `<div class="grid2 gap-sm">${stat('مجموع موجودی', M(fin.balance()))}${stat('دارایی خالص', M(net), net >= 0 ? 'pos' : 'neg')}</div>${rows}
    <div class="grid2 gap-sm"><button class="btn-add" data-act="transfer">${icon('swap_horiz')}انتقال</button>${addButton('حساب جدید', 'account-new')}</div>`;
}

/* ---------- ledger ---------- */
const ledgerList = () => fin.ledgerRows(ledger);

function ledgerBody() {
  const list = ledgerList();
  const inc = sum(list.filter((t) => t.type === 'income'), (t) => t.amount);
  const exp = sum(list.filter((t) => t.type === 'expense'), (t) => t.amount);
  const filtered = ledger.type !== 'all' || ledger.acc !== 'all' || !!ledger.q;
  const open = ledger.showFilter || filtered;
  const typeChips = [['all', 'همه'], ['expense', 'هزینه'], ['income', 'درآمد'], ['transfer', 'انتقال']]
    .map(([k, label]) => `<button class="chip${ledger.type === k ? ' on' : ''}" data-act="l-type" data-v="${k}">${label}</button>`).join('');
  const accSelect = S.accounts.length > 1 ? `<select class="chip" data-change="l-acc"><option value="all">همه حساب‌ها</option>${S.accounts.map((a) => `<option value="${a.id}"${ledger.acc === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : '';
  const rows = list.slice(0, ledger.limit).map((t) => {
    const c = fin.catOf(t.category);
    const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '⇄ ';
    const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : 'muted';
    return `<button class="group tx-row" data-act="l-tx" data-id="${t.id}">${icon(t.type === 'transfer' ? 'swap_horiz' : c.icon, 'muted')}<span class="grow col"><b class="truncate">${esc(t.note || c.label)}</b><small class="muted truncate">${esc(fin.txLabel(t))} • ${faDayMonth(parseIso(t.date))}</small></span><b class="ltr ${cls}">${sign}${M(t.amount)}</b></button>`;
  }).join('') || '<div class="empty">تراکنشی با این فیلتر نیست</div>';
  return `
    <div class="row-between"><button class="icon-btn xs" data-act="l-month" data-d="-1" aria-label="ماه قبل">${icon('chevron_right')}</button><b>${monthLabel(ledger.month)}</b><button class="icon-btn xs" data-act="l-month" data-d="1" aria-label="ماه بعد">${icon('chevron_left')}</button></div>
    <div class="grid3 gap-sm">${stat('درآمد', M(inc), 'pos')}${stat('هزینه', M(exp), 'neg')}${stat('خالص', M(inc - exp))}</div>
    <div class="group"><button class="group-head" data-act="l-filter"><span class="group-title">${icon('filter_list')}فیلتر و جستجو${filtered ? ' <span class="accent">(فعال)</span>' : ''}</span><span class="chev material-symbols-outlined${open ? ' open' : ''}">chevron_left</span></button>
      ${open ? `<div class="group-body"><div class="chips">${typeChips}${accSelect}</div><input class="input" data-key="lq" data-input="l-q" placeholder="جستجو در توضیحات…" value="${esc(ledger.q)}"></div>` : ''}</div>
    ${rows}
    ${list.length > ledger.limit ? `<button class="link accent center" data-act="l-more">نمایش ${fa(Math.min(10, list.length - ledger.limit))} مورد دیگر (از ${fa(list.length - ledger.limit)})</button>` : ''}
    <div class="grid2 gap-sm">${addButton('ثبت جدید', 'new-tx')}<button class="btn-add" data-act="csv">${icon('download')}خروجی اکسل</button></div>`;
}

/* ---------- chart / budget / quick ---------- */
function chartBody() {
  const now = new Date();
  const cols = [];
  if (chart.range === '7d') {
    for (let i = 6; i >= 0; i--) { const d = addDays(now, -i); cols.push({ v: fin.daySpend(iso(d)), label: WD_SHORT[d.getDay()], text: faDayMonth(d) }); }
  } else {
    for (let g = 5; g >= 0; g--) {
      let v = 0;
      for (let k = 0; k < 5; k++) v += fin.daySpend(iso(addDays(now, -(g * 5 + k))));
      cols.push({ v, label: fa(5 - g), text: `${faDayMonth(addDays(now, -(g * 5 + 4)))} تا ${faDayMonth(addDays(now, -g * 5))}` });
    }
  }
  const picked = chart.picked != null && cols[chart.picked] ? chart.picked : cols.length - 1;
  cols.forEach((c, i) => { c.active = i === picked; });
  return `<div class="row-between"><span class="small muted">${chart.range === '7d' ? 'هزینه ۷ روز اخیر' : 'هزینه ۳۰ روز اخیر (هر ستون ۵ روز)'}</span>
      <span class="seg-control sm"><button class="${chart.range === '7d' ? 'on' : ''}" data-act="c-range" data-v="7d" aria-label="۷ روز">${icon('bar_chart')}</button><button class="${chart.range === '30d' ? 'on' : ''}" data-act="c-range" data-v="30d" aria-label="۳۰ روز">${icon('show_chart')}</button></span></div>
    <div class="well chart-well">${barChart(cols, { height: 130, act: 'c-bar' })}</div>
    <p class="center bold small">${cols[picked].text}: <span class="accent">${M(cols[picked].v)}</span></p>`;
}

function budgetBody() {
  const exp = fin.monthSum('expense');
  const used = S.wallet.budget ? (exp / S.wallet.budget) * 100 : 0;
  return `<button class="well stack-sm budget" data-act="budget">
    <div class="row-between"><b>بودجه ماه: ${M(exp)} از ${M(S.wallet.budget)}</b><b class="${used >= 100 ? 'neg' : 'accent'}">${fa(Math.round(used))}%</b></div>
    ${progress(used, used >= 100 ? 'var(--danger)' : used >= 80 ? '#c08a3e' : 'var(--sage)')}
    <small class="muted">برای تغییر سقف بودجه و هشدارها بزنید</small></button>`;
}

function quickBody() {
  const set = fin.QUICK_SETS[S.wallet.quickSet] || fin.QUICK_SETS[0];
  const exp = fin.monthSum('expense');
  const by = fin.expenseByCategory();
  const cards = set.map((key) => {
    const c = fin.catOf(key);
    const spent = by[key] || 0;
    return `<button class="well quick-card" data-act="quick" data-cat="${key}">${icon(c.icon)}<span class="progress"><i style="width:${exp ? Math.round((spent / exp) * 100) : 0}%"></i></span><small class="muted">${c.label} • ${M(spent)}</small></button>`;
  }).join('');
  return `<div class="grid3 gap-sm">${cards}</div><button class="link muted center" data-act="quick-shuffle">${icon('shuffle', 'tiny')} تغییر دسته‌ها</button>`;
}

/* ---------- assembly ---------- */
export function hubSections() {
  const t0 = today();
  const b = fin.dueBuckets();
  const activeBills = S.bills.filter((x) => !x.paused);
  const openLoans = S.loans.filter((l) => fin.loanNextN(l));
  const exp = fin.monthSum('expense');
  const inc = fin.monthSum('income');
  const usedPct = S.wallet.budget ? Math.round((exp / S.wallet.budget) * 100) : 0;
  const quick = (fin.QUICK_SETS[S.wallet.quickSet] || fin.QUICK_SETS[0]).map((k) => fin.catOf(k).label).join('، ');
  const sums = {
    dues: b.over.length ? `${fa(b.over.length)} معوق • ${fa(b.week.length)} مورد تا ۷ روز آینده` : b.week.length ? `${fa(b.week.length)} پرداخت تا ۷ روز آینده • ${M(sumAmount(b.week))}` : 'هفته آینده سررسیدی ندارید ✓',
    loans: openLoans.length ? `${fa(openLoans.length)} وام فعال • مانده ${M(fin.loansRemaining())}` : 'وام یا قسط فعالی ندارید',
    bills: activeBills.length ? `${fa(activeBills.length)} قبض فعال • حدود ${M(sum(activeBills, (x) => fin.billAvg(x) / (x.every || 1)))} در ماه` : 'قبضی ثبت نشده',
    accounts: `${fa(S.accounts.length)} حساب • موجودی ${M(fin.balance())}`,
    ledger: `${monthLabel(currentMonthKey())}: +${M(inc)} / −${M(exp)}`,
    chart: `هزینه امروز ${M(fin.daySpend(t0))} • این ماه ${M(exp)}`,
    budget: `${fa(usedPct)}٪ مصرف شده • باقی ${M(Math.max(0, S.wallet.budget - exp))}`,
    quick,
  };
  const badges = { dues: badge(b.over.length || b.week.length, !!b.over.length), budget: usedPct >= 80 ? badge(`${usedPct}٪`, true) : '' };
  const bodies = { dues: () => duesBody(b), loans: loansBody, bills: billsBody, accounts: accountsBody, ledger: ledgerBody, chart: chartBody, budget: budgetBody, quick: quickBody };
  return SECTION_DEFS.map((s) => ({ ...s, sum: sums[s.key], badge: badges[s.key] || '', body: bodies[s.key] }));
}

const findLoan = (id) => S.loans.find((x) => x.id === id);
const findBill = (id) => S.bills.find((x) => x.id === id);

export const hubAct = {
  pay(el) {
    const { kind, id } = el.dataset;
    if (kind === 'loan') payLoan(findLoan(id), +el.dataset.n);
    else { const b = findBill(id); payDialog({ kind: 'bill', ref: b, due: el.dataset.due, amount: money2(fin.billAvg(b)) }); }
  },
  'pay-loan': (el) => { const l = findLoan(el.dataset.id); payLoan(l, fin.loanNextN(l)); },
  'loan-schedule': (el) => loanSchedule(findLoan(el.dataset.id)),
  'loan-menu': (el) => loanMenu(findLoan(el.dataset.id)),
  'loan-new': () => loanSheet(),
  'pay-bill': (el) => payBill(findBill(el.dataset.id)),
  'bill-history': (el) => billHistory(findBill(el.dataset.id)),
  'bill-menu': (el) => billMenu(findBill(el.dataset.id)),
  'bill-new': () => billSheet(),
  account: (el) => accountMenu(fin.findAccount(el.dataset.id)),
  'account-new': () => accountSheet(),
  transfer: () => transferSheet(),
  'l-tx': (el) => txSheet(null, {}, el.dataset.id),
  'l-month'(el) { ledger.month = shiftMonthKey(ledger.month, +el.dataset.d); ledger.limit = 8; refresh(); },
  'l-type'(el) { ledger.type = el.dataset.v; refresh(); },
  'l-filter'() { ledger.showFilter = !ledger.showFilter; refresh(); },
  'l-more'() { ledger.limit += 10; refresh(); },
  'new-tx': newTxMenu,
  csv: () => exportCsv(ledgerList(), ledger.month),
  'c-range'(el) { chart.range = el.dataset.v; chart.picked = null; refresh(); },
  'c-bar'(el) { chart.picked = +el.dataset.i; refresh(); },
  quick: (el) => txSheet('expense', { category: el.dataset.cat, title: `هزینه ${fin.catOf(el.dataset.cat).label}` }),
  'quick-shuffle'() { S.wallet.quickSet = (S.wallet.quickSet + 1) % fin.QUICK_SETS.length; commit(); toast('دسته‌های سریع عوض شد'); },
};

export const hubChange = {
  'l-acc'(el) { ledger.acc = el.value; refresh(); },
};

let searchTimer;
export const hubInput = {
  'l-q'(el) { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ledger.q = el.value.trim(); refresh(); }, 400); },
};

