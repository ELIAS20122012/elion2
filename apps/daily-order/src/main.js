/* App shell: header, bottom nav, hash router and the render loop. */
import { init, S, subscribe, reloadFromStorage } from './core/store.js';
import { nowHM } from './core/dates.js';
import { $ } from './core/util.js';
import { currentRoute } from './router.js';
import { bindActions, patchHTML } from './ui/dom.js';
import { applyTheme } from './ui/theme.js';
import { icon } from './ui/widgets.js';
import { openSettings } from './features/settings.js';
import { checkReminders } from './features/reminders.js';

import today from './pages/today.js';
import money from './pages/money.js';
import gym from './pages/gym.js';

const PAGES = { today, money, gym };
const NAV = [['today', 'check_circle', 'امروز'], ['money', 'account_balance_wallet', 'پول'], ['gym', 'fitness_center', 'ورزش']];

let page = null;
let view = null;
let tickTimer = null;

function paintClocks() {
  document.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = nowHM(); });
}

function render() {
  if (!page || !view) return;
  try {
    patchHTML(view, page.render());
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card empty">خطایی رخ داد.<br><small>${String(e.message || e)}</small></div>`;
  }
  paintClocks();
}

function show() {
  const id = currentRoute();
  clearInterval(tickTimer);
  page = PAGES[id];
  view = document.createElement('div');
  view.className = `view page-${id}`;
  $('#app').replaceChildren(view);
  bindActions(view, page);
  $('#title').textContent = page.title;
  document.title = `${page.title} · Daily Order`;
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (page.mount) page.mount();
  render();
  window.scrollTo(0, 0);
  if (page.tick) tickTimer = setInterval(render, page.tick);
}

function buildNav() {
  $('#nav').innerHTML = `<div class="dock">${NAV.map(([id, ic, label]) =>
    `<a href="#/${id}" data-route="${id}" aria-label="${label}">${icon(ic)}<small>${label}</small></a>`).join('')}</div>`;
}

function boot() {
  init();
  applyTheme();
  buildNav();
  bindActions($('#header'), { act: { settings: openSettings } });
  subscribe(render);
  window.addEventListener('hashchange', show);
  window.addEventListener('pageshow', (e) => { if (e.persisted) { reloadFromStorage(); applyTheme(); render(); } });
  setInterval(paintClocks, 10000);
  setInterval(checkReminders, 30000);
  show();
  checkReminders();
  window.__app = { state: () => S };
}

boot();
