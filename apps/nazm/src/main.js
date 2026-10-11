/* App shell: brand bar, bottom tabs, hash router and the render loop. */
import { init, subscribe, reloadFromStorage, S } from './core/store.js';
import { $ } from './core/util.js';
import { currentRoute } from './router.js';
import { bindActions, patchHTML } from './ui/dom.js';
import { icon } from './ui/widgets.js';
import { checkReminders } from './features/reminders.js';

import home from './pages/home.js';
import gym from './pages/gym.js';
import money from './pages/money.js';
import me from './pages/me.js';

const PAGES = { home, gym, money, me };
const NAV = [['home', 'home', 'خانه'], ['gym', 'fitness_center', 'ورزش'], ['money', 'account_balance_wallet', 'پول'], ['me', 'person', 'من']];

let page = null;
let view = null;
let tickTimer = null;

function render() {
  if (!page || !view) return;
  try {
    patchHTML(view, page.render());
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="empty">خطایی رخ داد.<br><small>${String(e.message || e)}</small></p>`;
  }
}

function show() {
  const id = currentRoute();
  clearInterval(tickTimer);
  page = PAGES[id];
  view = document.createElement('div');
  view.className = `view page-${id}`;
  $('#app').replaceChildren(view);
  bindActions(view, page);
  document.title = `${page.title ? `${page.title} · ` : ''}نظم`;
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (page.mount) page.mount();
  render();
  window.scrollTo(0, 0);
  if (page.tick) tickTimer = setInterval(render, page.tick);
}

function buildNav() {
  $('#nav').innerHTML = NAV.map(([id, ic, label]) =>
    `<a href="#/${id}" data-route="${id}" aria-label="${label}">${icon(ic)}<small>${label}</small></a>`).join('');
}

function splash() {
  try { if (sessionStorage.getItem('nazm-splash')) return; sessionStorage.setItem('nazm-splash', '1'); } catch { /* storage blocked: still show once */ }
  const el = $('#splash');
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1100);
}

function boot() {
  init();
  buildNav();
  subscribe(render);
  window.addEventListener('hashchange', show);
  window.addEventListener('pageshow', (e) => { if (e.persisted) { reloadFromStorage(); render(); } });
  setInterval(checkReminders, 30000);
  show();
  splash();
  checkReminders();
  window.__app = { state: () => S };
}

boot();
