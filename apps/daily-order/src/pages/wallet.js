/* Wallet: balance hero, quick actions, recent transactions, and the accounting hub. */
import { S, commit } from '../core/store.js';
import { today, parseIso, nowHM } from '../core/dates.js';
import { fa, esc, money } from '../core/format.js';
import { faDayMonth, monthKey, currentMonthKey, prevMonthKey } from '../core/calendar.js';
import { go } from '../router.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import { hubHtml, hubActions } from '../ui/hub.js';
import * as fin from '../domain/finance.js';
import { txSheet, newTxMenu, historySheet, reportSheet, scanReceipt } from '../features/finance-sheets.js';
import { hubSections, hubAct, hubChange, hubInput } from './wallet-hub.js';

function hero() {
  const bal = fin.balance();
  const hide = S.privacy;
  const exp = fin.monthSum('expense');
  const prev = fin.monthSum('expense', prevMonthKey());
  const diff = prev ? Math.round(((exp - prev) / prev) * 100) : null;
  const cur = S.profile.currency === 'تومان' ? 'ت' : S.profile.currency;
  const amount = hide ? '••••••' : `${bal < 0 ? '-' : ''}${Math.abs(bal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `<section class="card hero stack">
    <div class="row-between">
      <span class="row"><button class="icon-btn sm sage" data-act="all-tx" aria-label="همه تراکنش‌ها">${icon('account_balance_wallet', 'fill')}</button><span class="dots"><i class="dot sage"></i><i class="dot lav"></i><i class="dot accent"></i></span></span>
      <button class="icon-btn sm" data-act="privacy" aria-label="نمایش یا پنهان کردن مبالغ">${icon(hide ? 'visibility_off' : 'visibility')}</button>
    </div>
    <div class="row-between">
      <span class="row"><b class="hero-amount ltr">${amount}</b><b class="muted t-head">${esc(cur)}</b></span>
      <button class="pill well" data-act="report" title="هزینه نسبت به ماه قبل">${icon(diff != null && diff > 0 ? 'trending_up' : 'trending_down', diff != null && diff > 0 ? 'accent' : 'sage-text')}<b>${diff == null ? 'گزارش' : `${fa(Math.abs(diff))}٪`}</b></button>
    </div>
    <div class="grid2 gap-sm">
      <button class="well pod" data-act="pod" data-type="income">${icon('arrow_downward', 'sage-text')}<span class="col"><small class="muted">درآمد این ماه</small><b class="pos">${money(fin.monthSum('income'), hide)}</b></span></button>
      <button class="well pod" data-act="pod" data-type="expense">${icon('arrow_upward', 'accent')}<span class="col"><small class="muted">هزینه این ماه</small><b class="neg">${money(exp, hide)}</b></span></button>
    </div>
  </section>`;
}

function actions() {
  const tile = (act, ic, label, cls) => `<button class="card-sm action-tile" data-act="${act}" aria-label="${label}"><span class="action-icon ${cls}">${icon(ic)}</span><small class="muted">${label}</small></button>`;
  return `<section class="grid4 gap-sm">${tile('send', 'send', 'پرداخت', 'sage-text')}${tile('receive', 'call_received', 'دریافت', 'accent')}${tile('scan', 'qr_code_scanner', 'اسکن', 'lav')}${tile('add', 'add', 'ثبت', 'solid')}</section>`;
}

function recent() {
  const rows = fin.sortedTx().slice(0, 5).map((t) => {
    const c = fin.catOf(t.category);
    const cls = t.type === 'income' ? 'pos' : t.type === 'transfer' ? 'muted' : 'neg';
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '−';
    return `<button class="well tx-row" data-act="tx" data-id="${t.id}"><span class="item-icon">${icon(t.type === 'transfer' ? 'swap_horiz' : c.icon)}</span>
      <span class="grow col"><b class="truncate">${esc(t.note || c.label)}</b><small class="muted">${esc(fin.txLabel(t))} • ${faDayMonth(parseIso(t.date))}</small></span><b class="ltr ${cls}">${sign}${money(t.amount)}</b></button>`;
  }).join('') || '<div class="empty">تراکنشی ثبت نشده — از دکمه + شروع کنید</div>';
  return `<section class="card stack-sm"><div class="row-between"><b class="t-head">تراکنش‌های اخیر</b><button class="link accent" data-act="all-tx">همه</button></div>${rows}</section>`;
}

export default {
  id: 'wallet',
  title: 'کیف پول',
  render() {
    return `
      <section class="card clock-card">
        <button class="icon-btn sm" data-act="today-tx" aria-label="تراکنش‌های امروز">${icon('calendar_today', 'sage-text')}</button>
        <span class="row"><span class="clock sm" data-clock>${nowHM()}</span><button class="icon-btn xs accent" data-act="planner" aria-label="برنامه‌ریزی">${icon('schedule')}</button></span>
        <button class="toggle${S.wallet.alerts ? ' on' : ''}" data-act="alerts" title="هشدار بودجه" aria-label="هشدار بودجه"><i></i></button>
      </section>
      ${hero()}${actions()}${recent()}
      <div class="row-between section-head"><span class="row">${icon('account_balance', 'accent')}<b class="t-head">حسابداری</b></span><button class="mini-btn muted row" data-act="report">${icon('monitoring')}گزارش کامل</button></div>
      <div class="stack">${hubHtml('wallet', hubSections())}</div>`;
  },
  act: {
    ...hubActions,
    ...hubAct,
    privacy() { S.privacy = !S.privacy; commit(); toast(S.privacy ? 'مبالغ پنهان شد' : 'مبالغ نمایش داده شد'); },
    alerts() { S.wallet.alerts = !S.wallet.alerts; commit(); toast(S.wallet.alerts ? 'هشدار بودجه روشن شد' : 'هشدار بودجه خاموش شد'); },
    'all-tx': () => historySheet(null, 'همه تراکنش‌ها'),
    'today-tx': () => historySheet((t) => t.date === today(), 'تراکنش‌های امروز'),
    planner: () => go('planner'),
    report: reportSheet,
    pod(el) {
      const type = el.dataset.type;
      historySheet((t) => t.type === type && monthKey(t.date) === currentMonthKey(), type === 'income' ? 'درآمدهای این ماه' : 'هزینه‌های این ماه');
    },
    send: () => txSheet('expense', { title: 'ارسال / پرداخت', category: 'other', noteLabel: 'به چه کسی / بابت چه', sub: 'مبلغ از موجودی کم می‌شود.' }),
    receive: () => txSheet('income', { title: 'دریافت پول', category: 'transfer', noteLabel: 'از چه کسی / بابت چه' }),
    scan: scanReceipt,
    add: newTxMenu,
    tx: (el) => txSheet(null, {}, el.dataset.id),
  },
  change: hubChange,
  input: hubInput,
};
