/* Building blocks shared by the four sections (return HTML strings; callers escape user text). */
import { S, commit } from '../core/store.js';
import { go } from '../router.js';
import { icon } from './widgets.js';

/* ---- the active tab of each section is remembered in S.ui.tabs ---- */
/* which drawer is open: '' means all closed; undefined means "never touched" → the default */
export const tabOf = (page, def) => { const v = S.ui.tabs && S.ui.tabs[page]; return v === undefined ? def : v; };
export const openOr = (page, def) => tabOf(page, def) || def;
export function setTab(page, key) { S.ui.tabs = S.ui.tabs || {}; S.ui.tabs[page] = key; commit(); }
export function goTab(page, key) { S.ui.tabs = S.ui.tabs || {}; S.ui.tabs[page] = key; go(page); }

export const pageHead = (title, desc = '') => `<header class="page-head"><div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div></header>`;

/** One writing line at the top of a page: type, press Enter (or the ↵ button) and it lands in the list. */
export const addLine = (placeholder) =>
  `<div class="add-line"><input data-key="qa" data-enter="quick" autocomplete="off" placeholder="${placeholder}"><button class="enter-btn" data-act="quick" aria-label="ثبت">${icon('keyboard_return')}</button></div>`;

/** Put a rejected line back so the user can fix it. */
export function putBack(el, line) { (el.matches('input') ? el : el.parentElement.querySelector('input')).value = line; }

/** Read (and clear) the add line from either the input or its button. Returns '' when empty. */
export function takeLine(el) {
  const input = el.matches('input') ? el : el.parentElement.querySelector('input');
  const v = input.value.trim();
  if (v) { input.value = ''; input.focus(); }
  return v;
}

/** Text-only drawers (one open at a time): items [{ key, label, body() }]. Tap a header to open / close it. */
export const drawers = (items, current, act = 'tab') =>
  `<div class="drawers">${items.map((d) => {
    const on = d.key === current;
    return `<section class="drawer${on ? ' open' : ''}" data-k="${d.key}">
      <button class="drawer-head" data-act="${act}" data-v="${d.key}" aria-expanded="${on}"><span>${d.label}</span>${icon('expand_more', 'dchev')}</button>
      ${on ? `<div class="drawer-body">${d.body()}</div>` : ''}</section>`;
  }).join('')}</div>`;

/** Click handler for the drawer headers of a page. */
export const toggleDrawer = (page) => (el) => setTab(page, tabOf(page, '') === el.dataset.v ? '' : el.dataset.v);

/** Small pill chips (filters). */
export const pills = (items, current, act) =>
  `<div class="pills">${items.map((c) => `<button class="pill${c.key === current ? ' on' : ''}" data-act="${act}" data-v="${c.key}">${c.label}</button>`).join('')}</div>`;

/** A simple list row (bone card). */
export function row({ ic, title, sub = '', trailing = '', act = '', attrs = '', cls = '', tint = '' }) {
  const body = `${ic ? `<span class="row-ic ${tint}">${icon(ic)}</span>` : ''}<span class="grow col"><b class="truncate">${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>`;
  const main = act ? `<button class="row-main" data-act="${act}" ${attrs}>${body}</button>` : `<div class="row-main">${body}</div>`;
  return `<div class="row ${cls}">${main}${trailing}</div>`;
}

export const check = (act, id, on) => `<button class="chk${on ? ' on' : ''}" data-act="${act}" data-id="${id}" aria-label="انجام شد">${icon('check')}</button>`;
export const empty = (text) => `<p class="empty">${text}</p>`;
export const section = (title, inner, extra = '') => `<section class="sec"><div class="sec-head"><h3>${title}</h3>${extra}</div>${inner}</section>`;

/** Circular progress with centred text. */
export function ring(pct, big, small = '', size = 104) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return `<span class="ring" style="--s:${size}px"><svg viewBox="0 0 100 100"><circle class="rg-bg" cx="50" cy="50" r="${r}"/><circle class="rg-fg" cx="50" cy="50" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c - (Math.min(100, Math.max(0, pct)) / 100) * c).toFixed(1)}"/></svg><span class="rg-t"><b>${big}</b>${small ? `<small>${small}</small>` : ''}</span></span>`;
}

export const bar = (pct, over = false) => `<span class="meter${over ? ' over' : ''}"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></span>`;

/** Tiny vertical bars: cols [{ v, label, on, i }] */
export function bars(cols, act = '') {
  const top = Math.max(1, ...cols.map((c) => c.v));
  return `<div class="bars">${cols.map((c, i) => `<button class="bcol${c.on ? ' on' : ''}" ${act ? `data-act="${act}" data-i="${i}"` : ''}><i style="height:${Math.max(5, Math.round((c.v / top) * 100))}%"></i><small>${c.label}</small></button>`).join('')}</div>`;
}
