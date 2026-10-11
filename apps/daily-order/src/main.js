/* App shell: header, bottom nav, hash router and the render loop. */
import { init, S, subscribe, reloadFromStorage } from './core/store.js';
import { nowHM } from './core/dates.js';
import { $ } from './core/util.js';
import { ROUTES, currentRoute, go } from './router.js';
import { bindActions, patchHTML } from './ui/dom.js';
import { applyTheme, toggleDark } from './ui/theme.js';
import { icon } from './ui/widgets.js';
import { openSettings, openProfile } from './features/settings.js';
import { checkReminders } from './features/reminders.js';

import dashboard from './pages/dashboard.js';
import tasks from './pages/tasks.js';
import planner from './pages/planner.js';
import gym from './pages/gym.js';
import wallet from './pages/wallet.js';

const PAGES = { dashboard, tasks, planner, gym, wallet };
const NAV = [
  ['dashboard', 'dashboard', 'پیشخوان'], ['tasks', 'check_circle', 'کارها و عادت‌ها'], ['planner', 'calendar_today', 'برنامه‌ریزی'],
  ['gym', 'fitness_center', 'ورزش'], ['wallet', 'account_balance_wallet', 'کیف پول'],
];

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
  if (!ROUTES.includes(id)) { go('dashboard'); return; }
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
    `<a href="#/${id}" data-route="${id}" aria-label="${label}" title="${label}">${icon(ic)}</a>`).join('')}</div>`;
}

function boot() {
  init();
  applyTheme();
  buildNav();
  bindActions($('#header'), { act: { settings: openSettings, theme: toggleDark, profile: openProfile } });
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
