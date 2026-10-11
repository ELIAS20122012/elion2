/* Planner: week strip, 06–24 timeline and the day's time blocks. */
import { S, commit, refresh } from '../core/store.js';
import { iso, addDays, parseIso, today, nowHM, hmToMin, minToHM, weekStart, WD_SHORT } from '../core/dates.js';
import { fa, esc } from '../core/format.js';
import { faDayMonth, faDayNum } from '../core/calendar.js';
import { toast } from '../ui/toast.js';
import { form } from '../ui/sheet.js';
import { icon } from '../ui/widgets.js';
import * as P from '../domain/planner.js';
import { blockSheet, blockMenu, toggleBlockNotify } from '../features/planner-sheets.js';

let sel = today();
let weekOffset = 0;

const gotoDate = (d) => {
  sel = d;
  weekOffset = Math.round((weekStart(parseIso(d)) - weekStart(new Date())) / (7 * 864e5));
  refresh();
};

function weekStrip(ws) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i);
    const k = iso(d);
    const on = k === sel;
    const has = S.blocks.some((b) => b.date === k);
    return `<button class="day-btn${on ? ' on' : ''}${k === today() ? ' is-today' : ''}" data-act="day" data-date="${k}">
      <small>${WD_SHORT[d.getDay()]}</small><b>${faDayNum(d)}</b><i class="dot ${has ? (on ? 'accent' : 'sage') : 'none'}"></i></button>`;
  }).join('');
}

function timeline(blocks) {
  const nowMin = hmToMin(nowHM()) - P.DAY_START;
  const showNow = sel === today() && nowMin >= 0 && nowMin <= P.DAY_SPAN;
  const segs = blocks.map((b) => {
    const s = Math.max(0, hmToMin(b.start) - P.DAY_START);
    const e = Math.min(P.DAY_SPAN, Math.max(s + 10, hmToMin(b.end) - P.DAY_START));
    const c = P.blockColor(b);
    return `<button class="seg${b.done ? ' done' : ''}" data-act="seg" data-id="${b.id}" title="${esc(b.title)} ${b.start}–${b.end}"
      style="left:${(s / P.DAY_SPAN) * 100}%;width:${((e - s) / P.DAY_SPAN) * 100}%;background:${c.color}">${icon(b.icon || c.icon)}</button>`;
  }).join('');
  return `<div class="card-sm timeline">
    <div class="stamps">${['06:00', '12:00', '18:00', '24:00'].map((x) => `<span>${fa(x)}</span>`).join('')}</div>
    <div class="track well" data-act="track">${segs}${showNow ? `<i class="knob" style="left:calc(${(nowMin / P.DAY_SPAN) * 100}% - 6px)"></i>` : ''}</div>
  </div>`;
}

function blockCard(b) {
  const c = P.blockColor(b);
  return `<div class="card-sm block${b.done ? ' is-done' : ''}">
    <button class="check-square${b.done ? ' on' : ''}" data-act="check" data-id="${b.id}" aria-label="انجام شد">${icon('check')}</button>
    <button class="grow block-text" data-act="edit" data-id="${b.id}">
      <span class="row"><b class="block-title">${esc(b.title)}</b><i class="dot" style="background:${c.color}"></i></span>
      <small class="muted">${fa(b.start)} تا ${fa(b.end)}</small>
    </button>
    <button class="badge-icon${b.notify ? ' accent' : ''}" data-act="notify" data-id="${b.id}" aria-label="یادآور">${icon(b.notify ? 'notifications_active' : (b.icon || c.icon))}</button>
    <button class="icon-btn sm" data-act="menu" data-id="${b.id}" aria-label="گزینه‌ها">${icon('edit')}</button>
  </div>`;
}

export default {
  id: 'planner',
  title: 'برنامه‌ریزی',
  tick: 60000,
  render() {
    const ws = addDays(weekStart(new Date()), weekOffset * 7);
    const blocks = P.blocksOn(sel);
    const visible = blocks.filter((b) => !(S.plannerHideDone && b.done));
    const label = weekOffset === 0 ? 'این هفته' : `${faDayMonth(ws)} تا ${faDayMonth(addDays(ws, 6))}`;
    const empty = `<div class="empty well">${blocks.length ? 'همه بلوک‌های این روز انجام شده‌اند' : `برای ${sel === today() ? 'امروز' : faDayMonth(parseIso(sel))} بلوکی ثبت نشده`}</div>`;
    return `
      <section class="card clock-card">
        <span class="row"><button class="icon-btn sm" data-act="goto" aria-label="رفتن به تاریخ">${icon('calendar_today')}</button>
          <button class="toggle${S.plannerHideDone ? ' on' : ''}" data-act="hide-done" aria-label="پنهان کردن انجام‌شده‌ها" title="پنهان کردن انجام‌شده‌ها"><i></i></button></span>
        <span class="clock" data-clock>${nowHM()}</span>
        <span class="icon-btn sm static accent">${icon('schedule')}</span>
      </section>
      <section class="card-sm week">
        <div class="row-between week-nav">
          <button class="icon-btn xs" data-act="week" data-d="-1" aria-label="هفته قبل">${icon('chevron_right')}</button>
          <button class="week-label" data-act="today">${label}</button>
          <button class="icon-btn xs" data-act="week" data-d="1" aria-label="هفته بعد">${icon('chevron_left')}</button>
        </div>
        <div class="grid7">${weekStrip(ws)}</div>
      </section>
      ${timeline(blocks)}
      <div class="stack-sm">${visible.map(blockCard).join('') || empty}</div>
      <button class="btn-add" data-act="add">${icon('add_circle')}بلوک زمانی جدید</button>`;
  },
  act: {
    day(el) { sel = el.dataset.date; refresh(); },
    week(el) { weekOffset += +el.dataset.d; sel = iso(addDays(weekStart(new Date()), weekOffset * 7)); refresh(); },
    today() { weekOffset = 0; sel = today(); refresh(); toast('برگشت به امروز'); },
    goto: () => form({ title: 'رفتن به تاریخ', fields: [{ name: 'd', label: 'تاریخ', type: 'date', value: sel }], submit: 'برو', onSubmit(v) { if (!v.d) return false; gotoDate(v.d); } }),
    'hide-done'() { S.plannerHideDone = !S.plannerHideDone; commit(); toast(S.plannerHideDone ? 'بلوک‌های انجام‌شده پنهان شدند' : 'همه بلوک‌ها نمایش داده می‌شوند'); },
    add: () => blockSheet(null, sel),
    track(el, ev) {
      const r = el.getBoundingClientRect();
      const ratio = (ev.clientX - r.left) / r.width;
      const min = Math.round((P.DAY_START + ratio * P.DAY_SPAN) / 15) * 15;
      blockSheet(null, sel, minToHM(Math.max(P.DAY_START, Math.min(23 * 60, min))));
    },
    seg: (el) => { const b = P.findBlock(el.dataset.id); if (b) blockMenu(b); },
    check(el) { const b = P.findBlock(el.dataset.id); b.done = !b.done; commit(); if (b.done) toast(`«${b.title}» انجام شد`); },
    notify: (el) => toggleBlockNotify(P.findBlock(el.dataset.id)),
    edit: (el) => blockSheet(el.dataset.id),
    menu: (el) => blockMenu(P.findBlock(el.dataset.id)),
  },
};
