/* Small HTML fragments shared by the pages. Everything returns strings (already escaped). */
import { fa } from '../core/format.js';

export const icon = (name, cls = '') => `<span class="material-symbols-outlined ${cls}">${name}</span>`;

export const stat = (label, value, cls = '') =>
  `<div class="stat"><small>${label}</small><b class="${cls}">${value}</b></div>`;

export const badge = (n, red = false) =>
  n ? `<span class="badge${red ? ' badge-red' : ''}">${fa(n)}</span>` : '';

export const chev = (open) => `<span class="chev material-symbols-outlined${open ? ' open' : ''}">chevron_left</span>`;

export const emptyNote = (text) => `<div class="empty">${text}</div>`;

export const addButton = (label, act, extra = '') =>
  `<button class="btn-add" data-act="${act}" ${extra}>${icon('add_circle')}${label}</button>`;

/** Horizontal progress bar. */
export const progress = (pct, color) =>
  `<span class="progress"><i style="width:${Math.max(0, Math.min(100, pct))}%${color ? `;background:${color}` : ''}"></i></span>`;

/** Circular progress ring with a centered label. */
export function ring(pct, label, size = 36) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return `<span class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="${r}" class="ring-bg"/><circle cx="18" cy="18" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c - (pct / 100) * c).toFixed(1)}"/></svg><span>${label}</span></span>`;
}

/** Vertical mini bar chart. cols: [{ v, label, active, title }] */
export function barChart(cols, { height = 100, act = '', max } = {}) {
  const top = max || Math.max(1, ...cols.map((c) => c.v));
  return `<div class="bars" style="height:${height}px">${cols.map((c, i) => `
    <button class="bar-col${c.active ? ' active' : ''}" ${act ? `data-act="${act}" data-i="${i}"` : ''} title="${c.title || ''}">
      <i style="height:${Math.max(6, Math.round((c.v / top) * 100))}%"></i><span>${c.label}</span>
    </button>`).join('')}</div>`;
}
