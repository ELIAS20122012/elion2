/* Accordion "hub": a column of icon cards of which at most one is open (used by Tasks and Wallet).
   Open section and nested group state persist in S.ui. */
import { S, commit } from '../core/store.js';
import { chev, badge, icon } from './widgets.js';
import { scrollToCard } from './dom.js';

export const openKey = (name, def = '') => (S.ui.open[name] === undefined ? def : S.ui.open[name]);
export const setOpen = (name, key) => { S.ui.open[name] = key; commit(); };

/** sections: [{ key, title, icon, color, sum, badge?, body() }] — body() runs only for the open one. */
export function hubHtml(name, sections, def = '') {
  const open = openKey(name, def);
  return sections.map((s) => {
    const on = open === s.key;
    return `<div class="hub-card${on ? ' is-open' : ''}" data-sec="${s.key}">
      <button class="hub-head" data-act="hub" data-hub="${name}" data-section="${s.key}">
        <span class="hub-icon" style="color:${s.color}">${icon(s.icon)}</span>
        <span class="hub-text"><span class="hub-title">${s.title}${s.badge || ''}</span><span class="hub-sum">${s.sum}</span></span>
        ${chev(on)}
      </button>
      ${on ? `<div class="hub-body">${s.body()}</div>` : ''}
    </div>`;
  }).join('');
}

/** Collapsible sub-group inside a hub body. */
export function group({ id, title, count = 0, inner, def = false, red = false, extra = '' }) {
  const on = S.ui.sub[id] === undefined ? def : S.ui.sub[id];
  return `<div class="group">
    <button class="group-head" data-act="sub" data-id="${id}" data-def="${def ? 1 : 0}">
      <span class="group-title${red ? ' neg' : ''}">${title}${badge(count, red)}</span>
      <span class="group-extra">${extra}${chev(on)}</span>
    </button>
    ${on ? `<div class="group-body">${inner}</div>` : ''}
  </div>`;
}

/** Click handlers for data-act="hub" / "sub". Spread into a page's `act` map. */
export const hubActions = {
  hub(el) {
    const { hub, section: key } = el.dataset;
    const next = openKey(hub) === key ? '' : key;
    setOpen(hub, next);
    if (next) scrollToCard(document.querySelector(`[data-sec="${key}"]`));
  },
  sub(el) {
    const { id, def } = el.dataset;
    const cur = S.ui.sub[id] === undefined ? def === '1' : S.ui.sub[id];
    S.ui.sub[id] = !cur;
    commit();
  },
};
