/* Me: weight, targets, settings and data — everything that is not a daily action. */
import { S } from '../core/store.js';
import { fa, faInt, esc } from '../core/format.js';
import { icon } from '../ui/widgets.js';
import * as G from '../domain/gym.js';
import { weightSheet, nudgeWeight, goalSheet } from '../features/gym-sheets.js';
import { openSettings, exportData, importData, confirmSample, confirmClear } from '../features/settings.js';

const row = (act, ic, label, value = '') =>
  `<button class="row-item" data-act="${act}"><span class="thumb">${icon(ic)}</span><span class="grow">${label}</span>${value ? `<small>${value}</small>` : ''}${icon('chevron_left', 'muted')}</button>`;

export default {
  id: 'me',
  title: 'من',
  render() {
    const lw = G.lastWeight();
    const d = G.weightChange(30);
    return `
      <header class="greet"><h1>${esc(S.profile.name || 'پروفایل')}</h1><p>تنظیمات و اطلاعات شما</p></header>
      <section class="hero">
        <small class="eyebrow">وزن</small>
        <div class="weight">
          <button class="round ghost-light" data-act="nudge" data-d="-0.1" aria-label="کم کردن">${icon('remove')}</button>
          <button class="weight-value" data-act="weight"><b>${lw ? fa(lw.kg.toFixed(1)) : '—'}</b><small>کیلوگرم</small></button>
          <button class="round ghost-light" data-act="nudge" data-d="0.1" aria-label="زیاد کردن">${icon('add')}</button>
        </div>
        ${d == null ? '' : `<small class="center block">${d > 0 ? '+' : ''}${fa(d.toFixed(1))} کیلوگرم در ۳۰ روز گذشته</small>`}
      </section>
      <section class="section"><div class="list-plain">
        ${row('goal', 'local_fire_department', 'هدف کالری روزانه', faInt(S.gym.goals.kcal))}
        ${row('settings', 'tune', 'تنظیمات')}
      </div></section>
      <section class="section"><div class="section-head"><h3>داده‌ها</h3></div><div class="list-plain">
        ${row('export', 'download', 'گرفتن نسخه پشتیبان')}
        ${row('import', 'upload', 'بازیابی از نسخه پشتیبان')}
        ${row('sample', 'restart_alt', 'بازگشت به داده‌های نمونه')}
        ${row('clear', 'delete', 'پاک کردن همه اطلاعات')}
      </div></section>`;
  },
  act: {
    nudge: (el) => nudgeWeight(+el.dataset.d),
    weight: weightSheet,
    goal: goalSheet,
    settings: openSettings,
    export: exportData,
    import: importData,
    sample: confirmSample,
    clear: confirmClear,
  },
};
