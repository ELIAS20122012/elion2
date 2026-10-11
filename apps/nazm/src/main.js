/* App shell: top bar (profile · name · settings), fixed bottom bar with four sections, router and render loop. */
import { init, subscribe, reloadFromStorage, S } from './core/store.js';
import { $ } from './core/util.js';
import { currentRoute } from './router.js';
import { bindActions, patchHTML } from './ui/dom.js';
import { icon } from './ui/widgets.js';
import { checkReminders } from './features/reminders.js';
import { openSettings, openProfile } from './features/settings.js';

import today from './pages/today.js';
import tasks from './pages/tasks.js';
import gym from './pages/gym.js';
import money from './pages/money.js';
import shop from './pages/shop.js';

const PAGES = { today, tasks, gym, money, shop };
const NAV = [['today', 'wb_sunny', 'امروز'], ['tasks', 'task_alt', 'کارها'], ['gym', 'fitness_center', 'ورزش'], ['money', 'account_balance_wallet', 'مالی'], ['shop', 'shopping_basket', 'خرید']];

let page = null;
let view = null;

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
  page = PAGES[id];
  view = document.createElement('div');
  view.className = `view page-${id}`;
  $('#app').replaceChildren(view);
  bindActions(view, page);
  document.title = `${page.title} · نظم`;
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  render();
  window.scrollTo(0, 0);
}

function buildChrome() {
  $('#top').innerHTML = `<button class="tb-btn" data-act="profile" aria-label="پروفایل">${icon('account_circle')}</button><span class="wordmark">نظم</span><button class="tb-btn" data-act="settings" aria-label="تنظیمات">${icon('settings')}</button>`;
  $('#nav').innerHTML = NAV.map(([id, ic, label]) => `<a href="#/${id}" data-route="${id}">${icon(ic)}<small>${label}</small></a>`).join('');
}

function splash() {
  const el = $('#splash');
  try { if (sessionStorage.getItem('nazm-splash')) { el.remove(); return; } sessionStorage.setItem('nazm-splash', '1'); } catch { /* storage blocked */ }
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
}

function boot() {
  init();
  buildChrome();
  bindActions($('#top'), { act: { profile: openProfile, settings: openSettings } });
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
